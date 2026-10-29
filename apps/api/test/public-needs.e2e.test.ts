import 'reflect-metadata';
import { beforeAll, afterAll, describe, expect, it } from 'vitest';
import { Test } from '@nestjs/testing';
import type { INestApplication } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { AppModule } from '../dist/app.module.js';
import { configureApp } from '../dist/openapi.js';
import { PrismaService } from '../dist/prisma/prisma.service.js';
import { RedisThrottlerStorage } from '../dist/common/throttle.service.js';
import { PlacesService } from '../dist/club/places.service.js';

let app: INestApplication;
let places: PlacesService;
let target: { id: string; slug: string };
let inactive: { id: string };
let other: { id: string };
beforeAll(async () => {
  const url = new URL(process.env.DATABASE_URL ?? '');
  if (
    process.env.NODE_ENV !== 'test' ||
    !['localhost', '127.0.0.1'].includes(url.hostname) ||
    !url.pathname.startsWith('/club_test_')
  )
    throw new Error('Use an isolated local club_test_ database.');
  const module = await Test.createTestingModule({
    imports: [AppModule.configure({ offline: true, workers: false, telegram: false })],
  })
    .overrideProvider(RedisThrottlerStorage)
    .useValue({
      increment: async () => ({
        totalHits: 1,
        timeToExpire: 60,
        isBlocked: false,
        timeToBlockExpire: 0,
      }),
    })
    .compile();
  app = module.createNestApplication({ logger: false });
  configureApp(app);
  await app.init();
  const prisma = app.get(PrismaService);
  places = app.get(PlacesService);
  const region = await prisma.region.create({ data: { name: 'Needs region', slug: randomUUID() } });
  const create = (isActive: boolean) =>
    prisma.place.create({
      data: {
        slug: randomUUID(),
        name: 'Needs place',
        type: 'ORPHANAGE',
        regionId: region.id,
        city: 'Test',
        description: 'Public description',
        address: 'PRIVATE ADDRESS',
        privateNotes: 'PRIVATE NOTES',
        isActive,
      },
    });
  target = await create(true);
  inactive = await create(false);
  other = await create(true);
  await prisma.needItem.createMany({
    data: [
      ...Array.from({ length: 25 }, (_, i) => ({
        placeId: target.id,
        title: `Need ${i}`,
        description: 'Public need',
        isActive: true,
      })),
      { placeId: target.id, title: 'Unpublished', description: 'Hidden', isActive: false },
      {
        placeId: inactive.id,
        title: 'Inactive institution',
        description: 'Hidden',
        isActive: true,
      },
      { placeId: other.id, title: 'Other institution', description: 'Other', isActive: true },
    ],
  });
});
afterAll(async () => {
  await app?.close();
});

describe('Public needs API', () => {
  it('returns three published previews per card without exposing private place fields', async () => {
    const page = await places.list({ page: 1, limit: 100 });
    const place = page.items.find((item) => item.id === target.id)!;
    expect(place.needs).toHaveLength(3);
    expect(place.needsTotal).toBe(25);
    expect(place).not.toHaveProperty('address');
    expect(place).not.toHaveProperty('privateNotes');
    expect(place.needs?.every((need) => need.isActive && need.placeId === target.id)).toBe(true);
    expect(page.items.some((item) => item.id === inactive.id)).toBe(false);
  });
  it('includes the first complete page for server-rendered details', async () => {
    const place = await places.detail(target.slug);
    expect(place.needs).toHaveLength(20);
    expect(place.needsTotal).toBe(25);
    expect(place).not.toHaveProperty('address');
    expect(place).not.toHaveProperty('privateNotes');
    expect(Object.keys(place.needs![0]).sort()).toEqual([
      'description',
      'id',
      'isActive',
      'placeId',
      'title',
    ]);
  });
  it('paginates all active needs of the selected institution without mixing other institutions', async () => {
    const first = await places.publicNeeds({ page: 1, limit: 20, placeId: target.id });
    const second = await places.publicNeeds({ page: 2, limit: 20, placeId: target.id });
    expect(first.items).toHaveLength(20);
    expect(second.items).toHaveLength(5);
    expect(first.total).toBe(25);
    expect(second.total).toBe(25);
    const all = [...first.items, ...second.items];
    expect(new Set(all.map((item) => item.id)).size).toBe(25);
    expect(all.every((item) => item.placeId === target.id && item.isActive)).toBe(true);
  });
  it('returns no needs for an inactive institution', async () => {
    expect(await places.publicNeeds({ page: 1, limit: 20, placeId: inactive.id })).toMatchObject({
      items: [],
      total: 0,
    });
  });
  it('exposes the filter without authentication and rejects invalid identifiers', async () => {
    const valid = await request(app.getHttpServer())
      .get('/api/v1/needs')
      .query({ placeId: target.id, page: 2, limit: 20 });
    expect(valid.status).toBe(200);
    expect(valid.body.items).toHaveLength(5);
    expect(valid.body.total).toBe(25);
    const invalid = await request(app.getHttpServer())
      .get('/api/v1/needs')
      .query({ placeId: 'not-a-uuid' });
    expect(invalid.status).toBe(400);
  });
});

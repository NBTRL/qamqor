import 'reflect-metadata';
import { beforeAll, afterAll, describe, expect, it, vi } from 'vitest';
import { Test } from '@nestjs/testing';
import { JwtService } from '@nestjs/jwt';
import type { INestApplication } from '@nestjs/common';
import { createHash, randomUUID } from 'node:crypto';
import request from 'supertest';
import { CONSENT_VERSION } from '@club/shared';
import { AppModule } from '../dist/app.module.js';
import { configureApp } from '../dist/openapi.js';
import { PrismaService } from '../dist/prisma/prisma.service.js';
import { RedisThrottlerStorage } from '../dist/common/throttle.service.js';
import { EventsService } from '../dist/club/events.service.js';
import { PublicContentService } from '../dist/content/public-content.service.js';

let app: INestApplication;
let prisma: PrismaService;
let userId: string;
let access: string;
let tripId: string;
let privateId: string;
const range = { from: '2037-01-01T00:00:00.000Z', to: '2037-01-02T00:00:00.000Z' };
const startsAt = new Date('2037-01-01T12:00:00.000Z');
const endsAt = new Date('2037-01-01T14:00:00.000Z');
const hash = () => createHash('sha256').update(randomUUID()).digest('hex');
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
  prisma = app.get(PrismaService);
  const user = await prisma.user.create({
    data: {
      fullName: 'Calendar tester',
      telegramId: BigInt('0x' + randomUUID().replaceAll('-', '').slice(0, 12)),
      role: 'VOLUNTEER',
      birthDate: new Date('2000-01-01'),
      consentAt: new Date(),
      consentVersion: CONSENT_VERSION,
    },
  });
  userId = user.id;
  const session = await prisma.refreshToken.create({
    data: {
      userId,
      familyId: randomUUID(),
      tokenHash: hash(),
      deviceHash: hash(),
      expiresAt: new Date(Date.now() + 3600000),
    },
  });
  access = await app
    .get(JwtService)
    .signAsync({ sub: userId, sessionId: session.id, scope: 'access' }, { expiresIn: 3600 });
  const region = await prisma.region.create({
    data: { name: 'Calendar region', slug: randomUUID() },
  });
  const place = await prisma.place.create({
    data: {
      name: 'Calendar place',
      slug: randomUUID(),
      type: 'ORPHANAGE',
      regionId: region.id,
      city: 'Test',
      description: 'Public',
      address: 'PRIVATE ADDRESS',
      privateNotes: 'PRIVATE NOTES',
    },
  });
  const trip = await prisma.trip.create({
    data: {
      placeId: place.id,
      createdById: userId,
      title: 'PRIVATE TRIP TITLE',
      description: '',
      startsAt,
      endsAt,
      status: 'OPEN',
      meetingPoint: 'PRIVATE MEETING POINT',
      capacity: 5,
    },
  });
  tripId = trip.id;
  await prisma.event.createMany({
    data: Array.from({ length: 204 }, (_, i) => ({
      type: 'CLUB_EVENT' as const,
      title: `Calendar event ${i}`,
      description: '',
      location: 'Public location',
      startsAt,
      endsAt,
      createdById: userId,
      isPublic: true,
    })),
  });
  const privateEvent = await prisma.event.create({
    data: {
      type: 'CLUB_EVENT',
      title: 'PRIVATE EVENT',
      description: '',
      location: 'Private location',
      startsAt,
      endsAt,
      createdById: userId,
      isPublic: false,
    },
  });
  privateId = privateEvent.id;
});
afterAll(async () => {
  await app?.close();
});
async function pages(member = false) {
  const results: Array<{
    id: string;
    type: string;
    startsAt: string;
    title: string;
    place?: Record<string, unknown>;
    meetingPoint?: string;
  }> = [];
  for (let page = 1; page <= 3; page++) {
    const call = request(app.getHttpServer())
      .get(`/api/v1/${member ? '' : 'public/'}calendar`)
      .query({ ...range, page, limit: 100 });
    if (member) call.set('Authorization', `Bearer ${access}`);
    const response = await call;
    expect(response.status).toBe(200);
    expect(response.body.total).toBe(member ? 206 : 205);
    expect(response.body.items).toHaveLength(page < 3 ? 100 : member ? 6 : 5);
    results.push(...response.body.items);
  }
  expect(new Set(results.map((row) => `${row.type}-${row.id}`)).size).toBe(results.length);
  expect(results.map((row) => row.id)).toEqual(results.map((row) => row.id).sort());
  return results;
}
describe('Calendar pages and access', () => {
  it('returns all 205 public items in stable order across pages and hides private event and trip fields', async () => {
    const items = await pages();
    expect(items.some((row) => row.id === privateId)).toBe(false);
    const trip = items.find((row) => row.id === tripId)!;
    expect(trip.title).toBe('Поездка');
    expect(trip).not.toHaveProperty('place');
    expect(trip).not.toHaveProperty('meetingPoint');
  });
  it('authenticates real bearer sessions and includes private events and volunteer trip details on every page', async () => {
    const items = await pages(true);
    expect(items.find((row) => row.id === privateId)?.title).toBe('PRIVATE EVENT');
    const trip = items.find((row) => row.id === tripId)!;
    expect(trip).toMatchObject({
      title: 'PRIVATE TRIP TITLE',
      meetingPoint: 'PRIVATE MEETING POINT',
      place: { address: 'PRIVATE ADDRESS', privateNotes: 'PRIVATE NOTES' },
    });
  });
  it('does not expose volunteer-only fields after a role change', async () => {
    await prisma.user.update({ where: { id: userId }, data: { role: 'CANDIDATE' } });
    const items = await pages(true);
    const trip = items.find((row) => row.id === tripId)!;
    expect(trip).not.toHaveProperty('meetingPoint');
    expect(trip.place).not.toHaveProperty('address');
    expect(trip.place).not.toHaveProperty('privateNotes');
  });
  it('rejects anonymous private-calendar requests and pages beyond the configured maximum size', async () => {
    expect((await request(app.getHttpServer()).get('/api/v1/calendar').query(range)).status).toBe(
      401,
    );
    expect(
      (
        await request(app.getHttpServer())
          .get('/api/v1/public/calendar')
          .query({ ...range, limit: 101 })
      ).status,
    ).toBe(400);
  });
});

describe('Pagination validation before database queries', () => {
  const maxPage = Math.floor(2_147_483_647 / 100) + 1;
  const routes = ['/public/calendar', '/calendar', '/public/reports', '/news'];
  it.each([
    { page: String(maxPage + 1) },
    { page: '2147483647' },
    { page: String(Number.MAX_SAFE_INTEGER) },
    { page: '100000000000000000000' },
    { page: '1e309' },
    { page: 'Infinity' },
    { page: 'NaN' },
    { page: '1.5' },
    { page: '0' },
    { page: '-1' },
    { limit: '101' },
    { limit: '0' },
    { limit: '1.5' },
  ])('returns VALIDATION_ERROR without invoking list services for %j', async (input) => {
    const calls = [
      vi.spyOn(app.get(EventsService), 'calendar'),
      vi.spyOn(app.get(PublicContentService), 'reports'),
      vi.spyOn(app.get(PublicContentService), 'news'),
    ];
    try {
      for (const route of routes) {
        const call = request(app.getHttpServer())
          .get(`/api/v1${route}`)
          .query({ ...(route.includes('calendar') ? range : {}), limit: 20, ...input });
        if (route === '/calendar') call.set('Authorization', `Bearer ${access}`);
        const response = await call;
        expect(response.status, route).toBe(400);
        expect(response.body).toMatchObject({
          statusCode: 400,
          code: 'VALIDATION_ERROR',
          details: {
            fields: expect.arrayContaining([
              { path: Object.keys(input)[0], messages: expect.any(Array) },
            ]),
          },
        });
      }
      for (const call of calls) expect(call).not.toHaveBeenCalled();
    } finally {
      for (const call of calls) call.mockRestore();
    }
  });

  it.each(routes)(
    'accepts the maximum page with minimum and maximum limits on %s',
    async (route) => {
      for (const limit of [1, 100]) {
        const call = request(app.getHttpServer())
          .get(`/api/v1${route}`)
          .query({ ...(route.includes('calendar') ? range : {}), page: maxPage, limit });
        if (route === '/calendar') call.set('Authorization', `Bearer ${access}`);
        const response = await call;
        expect(response.status).toBe(200);
        expect(response.body).toMatchObject({ items: [], page: maxPage, limit });
        expect(response.body.total).toBeGreaterThanOrEqual(0);
      }
    },
  );
});

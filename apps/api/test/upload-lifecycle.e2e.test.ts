import 'reflect-metadata';
import { beforeAll, afterAll, describe, expect, it } from 'vitest';
import { Test, type TestingModule } from '@nestjs/testing';
import { createServer, type Server } from 'node:http';
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { Client } from 'pg';
import { AppModule } from '../dist/app.module.js';
import { PrismaService } from '../dist/prisma/prisma.service.js';
import { StorageService } from '../dist/storage/storage.service.js';
import { ContentService } from '../dist/content/content.service.js';
import { MeService } from '../dist/auth/me.service.js';
import { getEnvironment } from '../dist/config/environment.js';
import {
  inspectUnusedUploads,
  prepareFileDeletion,
  UNUSED_UPLOAD_GRACE_MS,
  UNFINISHED_UPLOAD_TTL_MS,
} from '../dist/storage/upload-lifecycle.js';
import { lockFileReferences, retainFileReferences } from '../dist/storage/file-references.js';
import type { Actor } from '../dist/common/http.js';

let app: TestingModule;
let prisma: PrismaService, storage: StorageService, content: ContentService, actor: Actor;
let server: Server;
const objects = new Map<string, Buffer>();
const deletes: string[] = [];
let denyDeletes = false;
const now = new Date('2038-01-01T00:00:00Z');
const before = new Date(now.getTime() - 2 * UNFINISHED_UPLOAD_TTL_MS);
const png = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10, 0, 0, 0, 0, 0, 0, 0, 0]);
const envBefore = process.env.S3_ENDPOINT;
async function asset(completed = true, purpose = 'CONTENT') {
  const key = `${purpose === 'AVATAR' ? 'private/avatars' : 'public/content'}/${randomUUID()}.png`;
  const row = await prisma.uploadAsset.create({
    data: {
      userId: actor.id,
      key,
      purpose,
      contentType: 'image/png',
      sizeBytes: png.length,
      createdAt: before,
      checkedAt: before,
      completedAt: completed ? before : null,
    },
  });
  objects.set(key, png);
  return row;
}
const uri = (id: string) => `${getEnvironment().WEB_URL}/api/v1/files/${id}`;
async function scan(at = now, dryRun = false) {
  return inspectUnusedUploads(prisma, { now: at, dryRun, limit: 100 });
}
beforeAll(async () => {
  const url = new URL(process.env.DATABASE_URL ?? '');
  if (
    process.env.NODE_ENV !== 'test' ||
    !['localhost', '127.0.0.1'].includes(url.hostname) ||
    !url.pathname.startsWith('/club_test_')
  )
    throw new Error('Use an isolated local club_test_ database.');
  server = createServer((req, res) => {
    const prefix = '/' + getEnvironment().S3_BUCKET + '/';
    const key = decodeURIComponent(new URL(req.url!, 'http://local').pathname.slice(prefix.length));
    if (req.method === 'DELETE') {
      deletes.push(key);
      if (denyDeletes) {
        res.writeHead(403, { 'Content-Type': 'application/xml' });
        res.end('<Error><Code>AccessDenied</Code><Message>Test denial</Message></Error>');
        return;
      }
      objects.delete(key);
      res.writeHead(204);
      res.end();
      return;
    }
    const value = objects.get(key);
    if (!value) {
      res.writeHead(404);
      res.end();
      return;
    }
    res.writeHead(200, { 'Content-Type': 'image/png', 'Content-Length': value.length });
    res.end(req.method === 'HEAD' ? undefined : value);
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Test S3 endpoint unavailable');
  process.env.S3_ENDPOINT = `http://127.0.0.1:${address.port}`;
  app = await Test.createTestingModule({
    imports: [AppModule.configure({ offline: true, workers: false, telegram: false })],
  }).compile();
  await app.init();
  prisma = app.get(PrismaService);
  storage = app.get(StorageService);
  content = app.get(ContentService);
  const user = await prisma.user.create({
    data: {
      telegramId: BigInt('0x' + randomUUID().replaceAll('-', '').slice(0, 12)),
      fullName: 'Upload lifecycle tester',
      role: 'ADMIN',
      birthDate: new Date('2000-01-01'),
      consentAt: new Date(),
      consentVersion: 'test',
    },
  });
  actor = { ...user, sessionId: randomUUID(), adminVerified: true };
});
afterAll(async () => {
  await app?.close();
  if (server) await new Promise<void>((resolve) => server.close(() => resolve()));
  if (envBefore === undefined) delete process.env.S3_ENDPOINT;
  else process.env.S3_ENDPOINT = envBefore;
});
describe('Upload lifecycle on PostgreSQL and HTTP S3 protocol fixture', () => {
  it('backfills pre-existing uploads conservatively when applying the migration', async () => {
    const client = new Client({ connectionString: process.env.DATABASE_URL });
    await client.connect();
    try {
      await client.query('BEGIN');
      await client.query(
        'CREATE TEMP TABLE upload_assets (id uuid, "createdAt" timestamptz NOT NULL, "deletedAt" timestamptz) ON COMMIT DROP',
      );
      await client.query('INSERT INTO upload_assets VALUES ($1, $2, NULL)', [randomUUID(), before]);
      await client.query(
        await readFile(
          new URL(
            '../prisma/migrations/20261030010000_upload_lifecycle/migration.sql',
            import.meta.url,
          ),
          'utf8',
        ),
      );
      const result = await client.query(
        'SELECT "completedAt", "orphanedAt", "createdAt" FROM upload_assets',
      );
      expect(result.rows[0].completedAt).toEqual(result.rows[0].createdAt);
      expect(result.rows[0].orphanedAt).toBeNull();
    } finally {
      await client.query('ROLLBACK');
      await client.end();
    }
  });
  it('dry-run does not change the database or object storage', async () => {
    const row = await asset(false);
    const snapshot = await prisma.uploadAsset.findUniqueOrThrow({ where: { id: row.id } });
    expect((await scan(now, true)).find((item) => item.id === row.id)?.state).toBe('ready');
    expect(await prisma.uploadAsset.findUniqueOrThrow({ where: { id: row.id } })).toEqual(snapshot);
    expect(objects.has(row.key)).toBe(true);
  });
  it('expires unfinished uploads but respects the seven-day orphan grace for completed uploads', async () => {
    const unfinished = await asset(false),
      completed = await asset();
    await scan();
    expect(
      (await prisma.uploadAsset.findUniqueOrThrow({ where: { id: unfinished.id } })).deletedAt,
    ).not.toBeNull();
    expect(
      (await prisma.uploadAsset.findUniqueOrThrow({ where: { id: completed.id } })).deletedAt,
    ).toBeNull();
    await scan(new Date(now.getTime() + UNUSED_UPLOAD_GRACE_MS - 1));
    expect(
      (await prisma.uploadAsset.findUniqueOrThrow({ where: { id: completed.id } })).deletedAt,
    ).toBeNull();
    await scan(new Date(now.getTime() + UNUSED_UPLOAD_GRACE_MS));
    expect(
      (await prisma.uploadAsset.findUniqueOrThrow({ where: { id: completed.id } })).deletionReason,
    ).toBe('UNUSED');
  });
  it('keeps shared HTML files while any draft references them, including old domains', async () => {
    const row = await asset();
    const first = await content.write(actor, 'pages', {
      slug: randomUUID(),
      title: 'First',
      bodyHtml: `<img src="${uri(row.id)}">`,
    });
    const second = await content.write(actor, 'pages', {
      slug: randomUUID(),
      title: 'Second',
      bodyHtml: `<a href="https://old-domain.test/api/v1/files/${row.id}">File</a>`,
    });
    await scan();
    expect(
      (await prisma.uploadAsset.findUniqueOrThrow({ where: { id: row.id } })).orphanedAt,
    ).toBeNull();
    await content.remove(actor, 'pages', first.id);
    await scan();
    expect(
      (await prisma.uploadAsset.findUniqueOrThrow({ where: { id: row.id } })).orphanedAt,
    ).toBeNull();
    await content.remove(actor, 'pages', second.id);
    await scan();
    expect(
      (await prisma.uploadAsset.findUniqueOrThrow({ where: { id: row.id } })).orphanedAt,
    ).toEqual(now);
    expect(objects.has(row.key)).toBe(true);
  });
  it('retains an inactive institution cover and an unpublished report photo', async () => {
    const cover = await asset(),
      photo = await asset(true, 'REPORT_PHOTO');
    const region = await prisma.region.create({
      data: { name: 'Uploads region', slug: randomUUID() },
    });
    const place = await prisma.place.create({
      data: {
        slug: randomUUID(),
        name: 'Inactive',
        type: 'ORPHANAGE',
        regionId: region.id,
        city: 'City',
        address: 'Test address',
        description: '',
        isActive: false,
        coverImageUrl: uri(cover.id),
      },
    });
    const trip = await prisma.trip.create({
      data: {
        placeId: place.id,
        createdById: actor.id,
        title: 'Trip',
        description: '',
        startsAt: now,
        endsAt: new Date(now.getTime() + 3600000),
        meetingPoint: 'Point',
        capacity: 1,
      },
    });
    await prisma.report.create({
      data: {
        tripId: trip.id,
        authorId: actor.id,
        text: '',
        hoursSpent: 1,
        photos: { create: { url: storage.uri(photo.key), isPublic: false } },
      },
    });
    await scan();
    for (const row of [cover, photo])
      expect(
        (await prisma.uploadAsset.findUniqueOrThrow({ where: { id: row.id } })).orphanedAt,
      ).toBeNull();
  });
  it('a real avatar replacement retains the new object and starts grace for the old one', async () => {
    const old = await asset(true, 'AVATAR'),
      next = await asset(false, 'AVATAR');
    await app.get(MeService).patch(actor, { avatarUrl: uri(old.id) });
    await app.get(MeService).patch(actor, { avatarUrl: uri(next.id) });
    await scan();
    expect(
      (await prisma.uploadAsset.findUniqueOrThrow({ where: { id: old.id } })).orphanedAt,
    ).toEqual(now);
    expect(
      (await prisma.uploadAsset.findUniqueOrThrow({ where: { id: next.id } })).orphanedAt,
    ).toBeNull();
    expect(
      (await prisma.uploadAsset.findUniqueOrThrow({ where: { id: next.id } })).completedAt,
    ).not.toBeNull();
  });
  it('rechecks references before S3 deletion, and rejects attaching a tombstoned asset', async () => {
    const row = await asset(false);
    await scan();
    await expect(
      content.write(actor, 'pages', {
        slug: randomUUID(),
        title: 'Late',
        bodyHtml: `<img src="${uri(row.id)}">`,
      }),
    ).rejects.toThrow();
    // Legacy/out-of-band references are protected by the final recheck too.
    await prisma.page.create({
      data: {
        slug: randomUUID(),
        title: 'Legacy reference',
        bodyHtml: `<img src="${uri(row.id)}">`,
      },
    });
    expect(await prepareFileDeletion(prisma, row.id)).toBeNull();
    expect(
      (await prisma.uploadAsset.findUniqueOrThrow({ where: { id: row.id } })).completedAt,
    ).not.toBeNull();
    expect(objects.has(row.key)).toBe(true);
    expect(
      (await prisma.uploadAsset.findUniqueOrThrow({ where: { id: row.id } })).deletedAt,
    ).toBeNull();
  });
  it('retries failed S3 deletion and makes repeated successful deletion idempotent', async () => {
    const row = await asset(false);
    await scan();
    denyDeletes = true;
    await expect(storage.purgeDeleted(row.id)).rejects.toThrow();
    denyDeletes = false;
    expect(await prisma.uploadAsset.findUnique({ where: { id: row.id } })).not.toBeNull();
    expect(objects.has(row.key)).toBe(true);
    await storage.purgeDeleted(row.id);
    const count = deletes.length;
    await storage.purgeDeleted(row.id);
    expect(objects.has(row.key)).toBe(false);
    expect(await prisma.uploadAsset.findUnique({ where: { id: row.id } })).toBeNull();
    expect(deletes).toHaveLength(count);
  });
  it('serializes a simultaneous attachment and orphan scan on independent transactions', async () => {
    const row = await asset(false);
    let locked!: () => void, release!: () => void;
    const entered = new Promise<void>((resolve) => {
      locked = resolve;
    });
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const attach = prisma.$transaction(
      async (tx) => {
        await lockFileReferences(tx);
        locked();
        await gate;
        await tx.page.create({
          data: { slug: randomUUID(), title: 'Concurrent', bodyHtml: `<img src="${uri(row.id)}">` },
        });
        await retainFileReferences(tx, uri(row.id), getEnvironment());
      },
      { timeout: 15000 },
    );
    await entered;
    const scanning = scan();
    release();
    await Promise.all([attach, scanning]);
    const final = await prisma.uploadAsset.findUniqueOrThrow({ where: { id: row.id } });
    expect(final.deletedAt).toBeNull();
    expect(final.orphanedAt).toBeNull();
  });
});

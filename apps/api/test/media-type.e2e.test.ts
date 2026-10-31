import 'reflect-metadata';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Test } from '@nestjs/testing';
import { JwtService } from '@nestjs/jwt';
import type { INestApplication } from '@nestjs/common';
import { createHash, randomUUID } from 'node:crypto';
import { DeleteObjectCommand, PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import request from 'supertest';
import { CONSENT_VERSION } from '@club/shared';
import { AppModule } from '../dist/app.module.js';
import { configureApp } from '../dist/openapi.js';
import { PrismaService } from '../dist/prisma/prisma.service.js';
import { RedisThrottlerStorage } from '../dist/common/throttle.service.js';
import { getEnvironment } from '../dist/config/environment.js';

let app: INestApplication;
let prisma: PrismaService;
let s3: S3Client;
let access: string;
let albumId: string;
const images: Array<{ contentType: string; key: string; id: string; url: string }> = [];
const videoUrl = 'https://media.example.test/video.mp4';
const hash = () => createHash('sha256').update(randomUUID()).digest('hex');
const samples = [
  ['image/png', Buffer.from([137, 80, 78, 71, 13, 10, 26, 10, 0, 0, 0, 0, 0, 0, 0, 0])],
  ['image/jpeg', Buffer.from([255, 216, 255, 224, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0])],
  ['image/webp', Buffer.from('RIFF0000WEBP0000')],
] as const;

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
      fullName: 'Media compatibility tester',
      telegramId: BigInt('0x' + randomUUID().replaceAll('-', '').slice(0, 12)),
      role: 'ADMIN',
      email: `${randomUUID()}@example.test`,
      emailVerifiedAt: new Date(),
      birthDate: new Date('2000-01-01'),
      consentAt: new Date(),
      consentVersion: CONSENT_VERSION,
    },
  });
  const session = await prisma.refreshToken.create({
    data: {
      userId: user.id,
      familyId: randomUUID(),
      tokenHash: hash(),
      deviceHash: hash(),
      adminVerified: true,
      expiresAt: new Date(Date.now() + 3600000),
    },
  });
  access = await app
    .get(JwtService)
    .signAsync({ sub: user.id, sessionId: session.id, scope: 'access' }, { expiresIn: 3600 });
  const album = await prisma.mediaAlbum.create({
    data: { slug: `media-types-${randomUUID()}`, title: 'Media type tests' },
  });
  albumId = album.id;
  const env = getEnvironment();
  s3 = new S3Client({
    endpoint: env.S3_ENDPOINT,
    region: env.S3_REGION,
    forcePathStyle: true,
    credentials: { accessKeyId: env.S3_ACCESS_KEY, secretAccessKey: env.S3_SECRET_KEY },
  });
  for (const [contentType, bytes] of samples) {
    const key = `public/content/media-types-${randomUUID()}.bin`;
    const asset = await prisma.uploadAsset.create({
      data: { userId: user.id, key, contentType, purpose: 'CONTENT', sizeBytes: bytes.length },
    });
    images.push({ contentType, key, id: asset.id, url: `${env.WEB_URL}/api/v1/files/${asset.id}` });
    await s3.send(
      new PutObjectCommand({
        Bucket: env.S3_BUCKET,
        Key: key,
        ContentType: contentType,
        Body: bytes,
      }),
    );
  }
});

afterAll(async () => {
  try {
    if (s3)
      for (const image of images)
        await s3.send(
          new DeleteObjectCommand({ Bucket: getEnvironment().S3_BUCKET, Key: image.key }),
        );
  } finally {
    s3?.destroy();
    await app?.close();
  }
});

const call = (method: 'post' | 'patch', id = '') =>
  request(app.getHttpServer())
    [method](`/api/v1/admin/media-items${id ? `/${id}` : ''}`)
    .set('Authorization', `Bearer ${access}`);
async function create(type: 'PHOTO' | 'VIDEO') {
  const response = await call('post').send({
    albumId,
    type,
    url: type === 'PHOTO' ? images[0].url : videoUrl,
    caption: 'Original caption',
  });
  expect(response.status).toBe(201);
  return response.body as { id: string; type: 'PHOTO' | 'VIDEO'; url: string; caption: string };
}
async function unchanged(row: { id: string; type: string; url: string; caption: string }) {
  expect(await prisma.mediaItem.findUniqueOrThrow({ where: { id: row.id } })).toMatchObject(row);
}

describe('PHOTO/VIDEO compatibility over HTTP with PostgreSQL and S3', () => {
  it.each([0, 1, 2])(
    'rejects managed image %i as VIDEO using its MIME, without creating a record',
    async (index) => {
      const before = await prisma.mediaItem.count({ where: { albumId } });
      const response = await call('post').send({ albumId, type: 'VIDEO', url: images[index].url });
      expect(response.status).toBe(400);
      expect(response.body).toMatchObject({ code: 'VALIDATION_ERROR' });
      expect(await prisma.mediaItem.count({ where: { albumId } })).toBe(before);
    },
  );

  it('rejects managed images through API-origin, encoded, query-string and direct S3 URL aliases', async () => {
    const image = images[0],
      env = getEnvironment();
    const encoded = `%${image.id.charCodeAt(0).toString(16)}${image.id.slice(1)}`;
    const urls = [
      `${env.PUBLIC_API_URL}/api/v1/files/${image.id}`,
      `${env.WEB_URL}/api/v1/files/${encoded}`,
      `${image.url}?download=1#player`,
      `${env.S3_ENDPOINT}/${env.S3_BUCKET}/${image.key}?X-Amz-Signature=test`,
    ];
    for (const url of urls) {
      const response = await call('post').send({ albumId, type: 'VIDEO', url });
      expect(response.status, url).toBe(400);
      expect(response.body.code).toBe('VALIDATION_ERROR');
    }
  });

  it('accepts each supported image MIME as PHOTO even when the object key has no image extension', async () => {
    for (const image of images) {
      const response = await call('post').send({ albumId, type: 'PHOTO', url: image.url });
      expect(response.status, image.contentType).toBe(201);
      expect(response.body).toMatchObject({ type: 'PHOTO', url: image.url });
    }
  });

  it.each(['PHOTO', 'VIDEO'] as const)(
    'requires a new URL when changing %s to the other type',
    async (type) => {
      const row = await create(type);
      const nextType = type === 'PHOTO' ? 'VIDEO' : 'PHOTO';
      for (const body of [{ type: nextType }, { type: nextType, url: row.url }]) {
        const response = await call('patch', row.id).send(body);
        expect(response.status).toBe(400);
        expect(response.body.code).toBe('VALIDATION_ERROR');
        await unchanged(row);
      }
      const url = nextType === 'PHOTO' ? images[0].url : videoUrl;
      const response = await call('patch', row.id).send({ type: nextType, url });
      expect(response.status).toBe(200);
      expect(response.body).toMatchObject({ type: nextType, url, caption: row.caption });
    },
  );

  it('checks the stored VIDEO type when a PATCH replaces only the URL with an image', async () => {
    const row = await create('VIDEO');
    for (const image of images) {
      const response = await call('patch', row.id).send({ url: image.url });
      expect(response.status).toBe(400);
      expect(response.body.code).toBe('VALIDATION_ERROR');
      await unchanged(row);
    }
  });

  it('preserves compatible type/URL pairs on partial metadata updates', async () => {
    for (const type of ['PHOTO', 'VIDEO'] as const) {
      const row = await create(type);
      const response = await call('patch', row.id).send({
        caption: 'Updated caption',
        isPublic: false,
      });
      expect(response.status).toBe(200);
      expect(response.body).toMatchObject({
        type,
        url: row.url,
        caption: 'Updated caption',
        isPublic: false,
      });
    }
  });

  it('keeps external HTTP(S) video streams without a file extension supported', async () => {
    const url = 'https://media.example.test/stream?id=club';
    const response = await call('post').send({ albumId, type: 'VIDEO', url });
    expect(response.status).toBe(201);
    expect(response.body).toMatchObject({ type: 'VIDEO', url });
  });

  it('keeps a compatible pair after concurrent type/URL and URL-only changes', async () => {
    const row = await create('PHOTO');
    const [video, image] = await Promise.all([
      call('patch', row.id).send({ type: 'VIDEO', url: videoUrl }),
      call('patch', row.id).send({ url: images[1].url }),
    ]);
    expect(video.status).toBe(200);
    expect([200, 400]).toContain(image.status);
    expect(await prisma.mediaItem.findUniqueOrThrow({ where: { id: row.id } })).toMatchObject({
      type: 'VIDEO',
      url: videoUrl,
    });
  });
});

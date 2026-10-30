import 'reflect-metadata';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Test } from '@nestjs/testing';
import { JwtService } from '@nestjs/jwt';
import type { INestApplication } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { CONSENT_VERSION } from '@club/shared';
import { AppModule } from '../dist/app.module.js';
import { configureApp } from '../dist/openapi.js';
import { PrismaService } from '../dist/prisma/prisma.service.js';
import { CryptoService } from '../dist/common/crypto.service.js';
import { MeService } from '../dist/auth/me.service.js';

let app: INestApplication;
let prisma: PrismaService;
let me: MeService;
let access: string;
let adminId: string;
const agent = 'Open-day attendance integration';
const future = () => new Date(Date.now() + 7 * 86400_000);
const past = () => new Date(Date.now() - 7 * 86400_000);

async function createUser(isBlocked = false) {
  return prisma.user.create({
    data: {
      telegramId: BigInt('0x' + randomUUID().replaceAll('-', '').slice(0, 14)),
      fullName: 'Attendance test participant',
      isBlocked,
      birthDate: new Date('1990-01-01'),
      consentAt: new Date(),
      consentVersion: CONSENT_VERSION,
    },
  });
}

beforeAll(async () => {
  const url = new URL(process.env.DATABASE_URL ?? '');
  if (
    process.env.NODE_ENV !== 'test' ||
    !['localhost', '127.0.0.1'].includes(url.hostname) ||
    !url.pathname.startsWith('/club_test_')
  )
    throw new Error('Use an isolated local club_test_ database (pnpm test:e2e).');
  const module = await Test.createTestingModule({
    imports: [AppModule.configure({ workers: false, telegram: false })],
  }).compile();
  app = module.createNestApplication({ logger: false });
  configureApp(app);
  await app.init();
  prisma = app.get(PrismaService);
  me = app.get(MeService);
  const user = await createUser();
  adminId = user.id;
  await prisma.user.update({
    where: { id: adminId },
    data: { role: 'ADMIN', email: `${adminId}@example.test`, emailVerifiedAt: new Date() },
  });
  // Only the fixture session is prepared directly; requests use the real authentication,
  // onboarding and ADMIN guards, DTO validation, services and PostgreSQL transactions.
  const crypto = app.get(CryptoService);
  const session = await prisma.refreshToken.create({
    data: {
      userId: adminId,
      familyId: randomUUID(),
      tokenHash: crypto.hash(crypto.random()),
      deviceHash: crypto.hash(agent),
      adminVerified: true,
      expiresAt: future(),
    },
  });
  access = await app
    .get(JwtService)
    .signAsync({ sub: adminId, sessionId: session.id, scope: 'access' }, { expiresIn: 900 });
});

afterAll(async () => {
  await app?.close();
});

function mark(
  mode: 'POST' | 'PATCH',
  target: { sessionId: string; userId: string; id?: string },
  attended = true,
) {
  const api = request(app.getHttpServer());
  const call =
    mode === 'POST'
      ? api.post(`/api/v1/admin/open-days/${target.sessionId}/attendance`)
      : api.patch(`/api/v1/admin/open-day-registrations/${target.id}`);
  return call
    .set('Authorization', `Bearer ${access}`)
    .set('User-Agent', agent)
    .set('Origin', process.env.WEB_URL ?? 'http://localhost:3000')
    .send(mode === 'POST' ? { userId: target.userId, attended } : { attended });
}

async function fixture(startsAt = future(), cancelledAt: Date | null = new Date()) {
  const user = await createUser();
  const day = await prisma.openDaySession.create({
    data: { startsAt, location: 'Attendance test room', capacity: 1 },
  });
  const registration = await prisma.openDayRegistration.create({
    data: { sessionId: day.id, userId: user.id, cancelledAt },
  });
  return { user, day, registration };
}

describe('Open-day attendance API invariants', () => {
  it.each(['POST', 'PATCH'] as const)(
    '%s cannot restore an anonymized future booking',
    async (mode) => {
      const f = await fixture(future(), null);
      await me.anonymize(f.user, adminId);
      const result = await mark(mode, f.registration);
      expect(result.status).toBe(403);
      expect(result.body.code).toBe('FORBIDDEN');
      const row = await prisma.openDayRegistration.findUniqueOrThrow({
        where: { id: f.registration.id },
      });
      expect(row.cancelledAt).not.toBeNull();
      expect(row.attended).toBe(false);
    },
  );

  it.each(['POST', 'PATCH'] as const)(
    '%s rejects a blocked future participant without changing the booking',
    async (mode) => {
      const f = await fixture();
      await prisma.user.update({ where: { id: f.user.id }, data: { isBlocked: true } });
      const result = await mark(mode, f.registration);
      expect(result.status).toBe(403);
      expect(result.body.code).toBe('FORBIDDEN');
      expect(
        await prisma.openDayRegistration.findUniqueOrThrow({ where: { id: f.registration.id } }),
      ).toMatchObject({ attended: false, cancelledAt: f.registration.cancelledAt });
    },
  );

  it.each(['POST', 'PATCH'] as const)(
    '%s cannot restore a cancelled future booking above capacity',
    async (mode) => {
      const f = await fixture();
      const other = await createUser();
      await prisma.openDayRegistration.create({
        data: { sessionId: f.day.id, userId: other.id },
      });
      const result = await mark(mode, f.registration);
      expect(result.status).toBe(409);
      expect(result.body.code).toBe('OPEN_DAY_FULL');
      expect(
        await prisma.openDayRegistration.findUniqueOrThrow({ where: { id: f.registration.id } }),
      ).toMatchObject({ attended: false, cancelledAt: f.registration.cancelledAt });
      expect(
        await prisma.openDayRegistration.count({
          where: { sessionId: f.day.id, cancelledAt: null },
        }),
      ).toBe(1);
    },
  );

  it.each(['POST', 'PATCH'] as const)(
    '%s can mark early attendance for an active booking in a full session',
    async (mode) => {
      const f = await fixture(future(), null);
      const result = await mark(mode, f.registration);
      expect(result.status).toBe(200);
      expect(result.body).toMatchObject({
        id: f.registration.id,
        attended: true,
        cancelledAt: null,
      });
      expect(
        await prisma.auditLog.count({
          where: { entityId: f.registration.id, action: 'ATTENDANCE_MARKED', actorId: adminId },
        }),
      ).toBe(1);
    },
  );

  it.each([false, true])('POST enforces capacity when creating attended=%s', async (attended) => {
    const f = await fixture(future(), null);
    const other = await createUser();
    const result = await mark('POST', { sessionId: f.day.id, userId: other.id }, attended);
    expect(result.status).toBe(409);
    expect(result.body.code).toBe('OPEN_DAY_FULL');
    expect(
      await prisma.openDayRegistration.count({ where: { sessionId: f.day.id, userId: other.id } }),
    ).toBe(0);
  });

  it.each([false, true])(
    'POST cannot create a blocked future booking attended=%s',
    async (attended) => {
      const f = await fixture();
      const blocked = await createUser(true);
      const result = await mark('POST', { sessionId: f.day.id, userId: blocked.id }, attended);
      expect(result.status).toBe(403);
      expect(result.body.code).toBe('FORBIDDEN');
      expect(
        await prisma.openDayRegistration.count({
          where: { sessionId: f.day.id, userId: blocked.id },
        }),
      ).toBe(0);
    },
  );

  it('keeps retrospective attendance without a prior booking, including inactive users', async () => {
    const f = await fixture(past(), null);
    const blocked = await createUser(true);
    const result = await mark('POST', { sessionId: f.day.id, userId: blocked.id });
    expect(result.status).toBe(200);
    expect(result.body).toMatchObject({ userId: blocked.id, attended: true, cancelledAt: null });
  });

  it('serializes competing administrative attendance for the last future place', async () => {
    const f = await fixture();
    const other = await createUser();
    const results = await Promise.all([
      mark('POST', f.registration),
      mark('POST', { sessionId: f.day.id, userId: other.id }),
    ]);
    expect(results.map((result) => result.status).sort()).toEqual([200, 409]);
    expect(results.find((result) => result.status === 409)?.body.code).toBe('OPEN_DAY_FULL');
    expect(
      await prisma.openDayRegistration.count({ where: { sessionId: f.day.id, cancelledAt: null } }),
    ).toBe(1);
  });

  it('does not reactivate a booking when attendance races account anonymization', async () => {
    const f = await fixture(future(), null);
    const [result] = await Promise.all([
      mark('POST', f.registration),
      me.anonymize(f.user, adminId),
    ]);
    expect([200, 403]).toContain(result.status);
    expect(
      (await prisma.openDayRegistration.findUniqueOrThrow({ where: { id: f.registration.id } }))
        .cancelledAt,
    ).not.toBeNull();
  });
});

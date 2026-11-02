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
    '%s rejects early attendance for an active booking in a full session',
    async (mode) => {
      const f = await fixture(future(), null);
      const result = await mark(mode, f.registration);
      expect(result.status).toBe(400);
      expect(result.body.code).toBe('VALIDATION_ERROR');
      expect(
        await prisma.openDayRegistration.findUniqueOrThrow({ where: { id: f.registration.id } }),
      ).toMatchObject({ attended: false, cancelledAt: null });
      expect(
        await prisma.auditLog.count({
          where: { entityId: f.registration.id, action: 'ATTENDANCE_MARKED', actorId: adminId },
        }),
      ).toBe(0);
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

  it('serializes competing administrative bookings for the last future place', async () => {
    const f = await fixture();
    await prisma.openDayRegistration.delete({ where: { id: f.registration.id } });
    const other = await createUser();
    const results = await Promise.all([
      mark('POST', f.registration, false),
      mark('POST', { sessionId: f.day.id, userId: other.id }, false),
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
    expect([400, 403]).toContain(result.status);
    expect(
      (await prisma.openDayRegistration.findUniqueOrThrow({ where: { id: f.registration.id } }))
        .cancelledAt,
    ).not.toBeNull();
  });
});

const questionnaire = {
  motivation: 'Хочу регулярно помогать и делиться полезными знаниями.',
  volunteeringExperience: 'Многолетний опыт волонтерства.',
  helpAreas: ['EDUCATION'],
  availableWeekdays: ['SATURDAY'],
  referralSource: 'Друзья',
  rulesAccepted: true,
};
async function tokenFor(userId: string) {
  const crypto = app.get(CryptoService);
  const session = await prisma.refreshToken.create({
    data: {
      userId,
      familyId: randomUUID(),
      tokenHash: crypto.hash(crypto.random()),
      deviceHash: crypto.hash(agent),
      expiresAt: future(),
    },
  });
  return app
    .get(JwtService)
    .signAsync({ sub: userId, sessionId: session.id, scope: 'access' }, { expiresIn: 900 });
}
function apiCall(method: 'get' | 'post' | 'patch', path: string, token = access) {
  return request(app.getHttpServer())
    [method](`/api/v1${path}`)
    .set('Authorization', `Bearer ${token}`)
    .set('User-Agent', agent)
    .set('Origin', process.env.WEB_URL ?? 'http://localhost:3000');
}
async function applicationFixture(
  status: 'NEW' | 'QUESTIONNAIRE_DONE' | 'REJECTED' = 'QUESTIONNAIRE_DONE',
) {
  const user = await createUser();
  const application = await prisma.candidateApplication.create({
    data: {
      userId: user.id,
      status,
      ...(status === 'QUESTIONNAIRE_DONE' ? { questionnaire } : {}),
    },
  });
  return { user, application };
}
function decide(mode: 'POST' | 'PATCH', id: string, body: object, token = access) {
  return apiCall(
    mode === 'POST' ? 'post' : 'patch',
    `/admin/applications/${id}${mode === 'POST' ? '/status' : ''}`,
    token,
  ).send(body);
}

describe('Admission requires a real open day, with explicit administrator exceptions', () => {
  it.each(['POST', 'PATCH'] as const)(
    '%s rejects missing, future and cancelled attendance in the ordinary path',
    async (mode) => {
      const f = await applicationFixture();
      const token = await tokenFor(f.user.id);
      for (const kind of ['missing', 'future', 'cancelled']) {
        if (kind !== 'missing') {
          await prisma.openDayRegistration.deleteMany({ where: { userId: f.user.id } });
          const day = await prisma.openDaySession.create({
            data: { startsAt: kind === 'future' ? future() : past(), location: kind, capacity: 10 },
          });
          await prisma.openDayRegistration.create({
            data: {
              userId: f.user.id,
              sessionId: day.id,
              attended: true,
              cancelledAt: kind === 'cancelled' ? new Date() : null,
            },
          });
        }
        for (const status of ['INTERVIEW', 'ACCEPTED']) {
          const result = await decide(mode, f.application.id, { status });
          expect(result.body.code).toBe('OPEN_DAY_REQUIRED');
        }
        const mine = await apiCall('get', '/me/application', token);
        const detail = await apiCall('get', `/admin/applications/${f.application.id}`);
        const list = await apiCall('get', '/admin/applications?limit=100');
        expect(mine.body.hasOpenDayAttended).toBe(false);
        expect(detail.body.hasOpenDayAttended).toBe(false);
        expect(
          list.body.items.find((row: { id: string }) => row.id === f.application.id)
            .hasOpenDayAttended,
        ).toBe(false);
      }
      expect((await prisma.user.findUniqueOrThrow({ where: { id: f.user.id } })).role).toBe(
        'CANDIDATE',
      );
      expect(
        await prisma.applicationHistory.count({ where: { applicationId: f.application.id } }),
      ).toBe(0);
    },
  );

  it.each(['POST', 'PATCH'] as const)(
    '%s accepts a complete candidate only after an explicit decision',
    async (mode) => {
      const f = await applicationFixture();
      const day = await prisma.openDaySession.create({
        data: { startsAt: past(), location: 'Completed meeting', capacity: 10 },
      });
      expect((await mark('POST', { sessionId: day.id, userId: f.user.id })).status).toBe(200);
      expect((await prisma.user.findUniqueOrThrow({ where: { id: f.user.id } })).role).toBe(
        'CANDIDATE',
      );
      expect((await decide(mode, f.application.id, { status: 'ACCEPTED' })).status).toBe(200);
      expect((await prisma.user.findUniqueOrThrow({ where: { id: f.user.id } })).role).toBe(
        'VOLUNTEER',
      );
    },
  );

  it.each(['POST', 'PATCH'] as const)(
    '%s permits an audited exception from NEW, QUESTIONNAIRE_DONE and REJECTED without fabricating attendance',
    async (mode) => {
      for (const status of ['NEW', 'QUESTIONNAIRE_DONE', 'REJECTED'] as const) {
        const f = await applicationFixture(status);
        if (status === 'REJECTED')
          await prisma.applicationHistory.create({
            data: {
              applicationId: f.application.id,
              actorId: adminId,
              fromStatus: 'NEW',
              toStatus: 'REJECTED',
              comment: 'Предыдущее решение',
            },
          });
        const result = await decide(mode, f.application.id, {
          status: 'ACCEPTED',
          adminOverride: true,
          comment: 'Личное решение основателя',
        });
        expect(result.status).toBe(200);
        expect(result.body).toMatchObject({ status: 'ACCEPTED', hasOpenDayAttended: false });
        expect(result.body.history.at(-1).comment).toContain('в порядке исключения');
        if (status === 'REJECTED')
          expect(result.body.history[0].comment).toBe('Предыдущее решение');
        expect((await prisma.user.findUniqueOrThrow({ where: { id: f.user.id } })).role).toBe(
          'VOLUNTEER',
        );
        expect(await prisma.openDayRegistration.count({ where: { userId: f.user.id } })).toBe(0);
        expect(
          await prisma.auditLog.findFirst({
            where: { entityId: f.application.id, action: 'APPLICATION_ACCEPTED_BY_ADMIN' },
          }),
        ).toMatchObject({
          actorId: adminId,
          diff: {
            from: status,
            to: 'ACCEPTED',
            reason: 'Личное решение основателя',
            hasOpenDayAttended: false,
          },
        });
        expect(
          await prisma.notification.count({
            where: { userId: f.user.id, type: 'ApplicationStatusChanged' },
          }),
        ).toBeGreaterThan(0);
        expect(
          (
            await decide(mode, f.application.id, {
              status: 'ACCEPTED',
              adminOverride: true,
              comment: 'Повтор',
            })
          ).body.code,
        ).toBe('INVALID_TRANSITION');
      }
    },
  );

  it('validates explicit exceptions and preserves blocked accounts', async () => {
    const f = await applicationFixture('NEW');
    for (const body of [
      { status: 'ACCEPTED', adminOverride: true },
      { status: 'ACCEPTED', adminOverride: true, comment: '   ' },
      { status: 'INTERVIEW', adminOverride: true, comment: 'Причина' },
      { status: 'ACCEPTED', adminOverride: 'true', comment: 'Причина' },
      { status: 'ACCEPTED', adminOverride: null, comment: 'Причина' },
    ])
      expect((await decide('POST', f.application.id, body)).status).toBe(400);
    expect(
      (await decide('POST', f.application.id, { status: 'ACCEPTED', adminOverride: false })).body
        .code,
    ).toBe('OPEN_DAY_REQUIRED');
    await prisma.user.update({ where: { id: f.user.id }, data: { isBlocked: true } });
    expect(
      (
        await decide('POST', f.application.id, {
          status: 'ACCEPTED',
          adminOverride: true,
          comment: 'Причина',
        })
      ).body.code,
    ).toBe('ACCOUNT_BLOCKED');
    expect(
      await prisma.applicationHistory.count({ where: { applicationId: f.application.id } }),
    ).toBe(0);
  });

  it('keeps direct administrator role assignment without completing application stages', async () => {
    const f = await applicationFixture('NEW');
    const result = await apiCall('patch', `/admin/users/${f.user.id}`).send({ role: 'VOLUNTEER' });
    expect(result.status).toBe(200);
    expect(result.body.role).toBe('VOLUNTEER');
    expect(
      (await prisma.candidateApplication.findUniqueOrThrow({ where: { id: f.application.id } }))
        .status,
    ).toBe('NEW');
    expect(
      await prisma.auditLog.findFirst({ where: { entityId: f.user.id, action: 'ROLE_CHANGED' } }),
    ).toMatchObject({ diff: { admissionMode: 'ADMIN_DIRECT' } });
    const created = await apiCall('post', '/admin/users').send({
      telegramId: BigInt('0x' + randomUUID().replaceAll('-', '').slice(0, 14)).toString(),
      fullName: 'Прямое назначение',
      role: 'VOLUNTEER',
    });
    expect(created.status).toBe(201);
    expect(created.body.role).toBe('VOLUNTEER');
  });

  it.each(['CANDIDATE', 'VOLUNTEER'] as const)(
    'does not grant %s administrator admission powers',
    async (role) => {
      const f = await applicationFixture();
      const actor = await createUser();
      await prisma.user.update({ where: { id: actor.id }, data: { role } });
      if (role === 'VOLUNTEER') {
        const region = await prisma.region.create({
          data: { name: randomUUID(), slug: randomUUID() },
        });
        const place = await prisma.place.create({
          data: {
            regionId: region.id,
            slug: randomUUID(),
            name: 'Curator institution',
            type: 'ORPHANAGE',
            city: 'Город',
            address: 'Адрес',
            description: 'Описание',
          },
        });
        await prisma.placeCurator.create({ data: { userId: actor.id, placeId: place.id } });
      }
      const token = await tokenFor(actor.id);
      for (const mode of ['POST', 'PATCH'] as const)
        expect(
          (
            await decide(
              mode,
              f.application.id,
              { status: 'ACCEPTED', adminOverride: true, comment: 'Попытка' },
              token,
            )
          ).status,
        ).toBe(403);
      expect(
        (await apiCall('patch', `/admin/users/${f.user.id}`, token).send({ role: 'VOLUNTEER' }))
          .status,
      ).toBe(403);
    },
  );
});

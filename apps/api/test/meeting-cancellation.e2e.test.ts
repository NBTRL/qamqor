import 'reflect-metadata';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { Test } from '@nestjs/testing';
import { JwtService } from '@nestjs/jwt';
import type { INestApplication } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { CONSENT_VERSION, RegistrationStatus } from '@club/shared';
import { AppModule } from '../dist/app.module.js';
import { configureApp } from '../dist/openapi.js';
import { PrismaService } from '../dist/prisma/prisma.service.js';
import { CryptoService } from '../dist/common/crypto.service.js';
import { EventsService, OpenDaysService } from '../dist/club/events.service.js';
import { MembershipService } from '../dist/club/membership.service.js';
import { ApplicationsService } from '../dist/club/applications.service.js';
import { AdminService } from '../dist/admin/admin.service.js';
import { NotificationService } from '../dist/notifications/notification.service.js';
import { ReminderService } from '../dist/notifications/reminder.service.js';
import { TelegramService } from '../dist/auth/telegram.service.js';
import { MailService } from '../dist/common/mail.service.js';
import type { Actor } from '../dist/common/http.js';

let app: INestApplication;
let prisma: PrismaService;
let events: EventsService;
let days: OpenDaysService;
let notifications: NotificationService;
const future = () => new Date(Date.now() + 7 * 86400000);
const past = () => new Date(Date.now() - 86400000);
const agent = 'Meeting cancellation test';
const page = { page: 1, limit: 100 };
type Kind = 'events' | 'open-days';
beforeAll(async () => {
  const url = new URL(process.env.DATABASE_URL ?? '');
  if (
    process.env.NODE_ENV !== 'test' ||
    !['localhost', '127.0.0.1'].includes(url.hostname) ||
    !url.pathname.startsWith('/club_test_')
  )
    throw new Error('Use isolated local test database');
  const module = await Test.createTestingModule({
    imports: [AppModule.configure({ workers: false, telegram: false })],
  }).compile();
  app = module.createNestApplication({ logger: false });
  configureApp(app);
  await app.init();
  prisma = app.get(PrismaService);
  events = app.get(EventsService);
  days = app.get(OpenDaysService);
  notifications = app.get(NotificationService);
});
afterAll(async () => {
  await app?.close();
});
async function user(role: 'ADMIN' | 'VOLUNTEER' | 'CANDIDATE' = 'VOLUNTEER') {
  const identity = randomUUID();
  const telegramId = BigInt('0x' + identity.replaceAll('-', '').slice(0, 12));
  return {
    ...(await prisma.user.create({
      data: {
        telegramId,
        chatId: telegramId,
        fullName: 'Synthetic cancellation participant',
        role,
        email: `${identity}@example.test`,
        emailVerifiedAt: new Date(),
        birthDate: new Date('1990-01-01'),
        consentAt: new Date(),
        consentVersion: CONSENT_VERSION,
      },
    })),
    sessionId: randomUUID(),
    adminVerified: true,
  } as Actor;
}
async function token(member: Actor) {
  const crypto = app.get(CryptoService);
  const session = await prisma.refreshToken.create({
    data: {
      userId: member.id,
      familyId: randomUUID(),
      tokenHash: crypto.hash(crypto.random()),
      deviceHash: crypto.hash(agent),
      adminVerified: true,
      expiresAt: future(),
    },
  });
  return app
    .get(JwtService)
    .signAsync({ sub: member.id, sessionId: session.id, scope: 'access' }, { expiresIn: 900 });
}
async function fixture(kind: Kind, startsAt = future()) {
  const admin = await user('ADMIN');
  const meeting =
    kind === 'events'
      ? await prisma.event.create({
          data: {
            type: 'CLUB_EVENT',
            title: 'Cancellation event',
            description: '',
            location: 'Synthetic',
            startsAt,
            endsAt: new Date(startsAt.getTime() + 3600000),
            capacity: 30,
            createdById: admin.id,
          },
        })
      : await prisma.openDaySession.create({
          data: { startsAt, location: 'Synthetic', capacity: 30 },
        });
  const cancel = (reason = '  Организатор заболел  ') =>
    kind === 'events'
      ? events.cancelMeeting(admin, meeting.id, reason)
      : days.cancelMeeting(admin, meeting.id, reason);
  const register = (member: Actor) =>
    kind === 'events' ? events.register(member, meeting.id) : days.register(member, meeting.id);
  const reload = () =>
    kind === 'events'
      ? prisma.event.findUniqueOrThrow({ where: { id: meeting.id } })
      : prisma.openDaySession.findUniqueOrThrow({ where: { id: meeting.id } });
  const type = kind === 'events' ? 'EventSessionCancelled' : 'OpenDayCancelled';
  const notices = () =>
    prisma.notification.findMany({
      where: {
        type,
        payload: { path: [kind === 'events' ? 'eventId' : 'sessionId'], equals: meeting.id },
      },
    });
  const rows = () =>
    kind === 'events'
      ? prisma.eventRegistration.findMany({ where: { eventId: meeting.id } })
      : prisma.openDayRegistration.findMany({ where: { sessionId: meeting.id } });
  return { kind, admin, meeting, cancel, register, reload, type, notices, rows };
}

describe.each(['events', 'open-days'] as const)('%s whole meeting cancellation', (kind) => {
  it('atomically cancels active registrations, keeps history, notifies once and closes every registration path', async () => {
    const f = await fixture(kind);
    const member = await user('CANDIDATE');
    const other = await user();
    await f.register(member);
    await f.register(other);
    await prisma.notificationSetting.create({
      data: { userId: other.id, type: f.type, telegram: false, email: false },
    });
    const first = await f.cancel();
    await f.cancel('Другая причина повторного запроса');
    expect(await f.reload()).toMatchObject({
      cancelledAt: first.cancelledAt,
      cancelReason: 'Организатор заболел',
    });
    const rows = await f.rows();
    expect(rows).toHaveLength(2);
    for (const row of rows)
      expect('status' in row ? row.status : !!row.cancelledAt).toBe(
        kind === 'events' ? 'CANCELLED' : true,
      );
    const notices = await f.notices();
    expect(notices).toHaveLength(4);
    expect(
      notices
        .filter((n) => n.userId === member.id)
        .map((n) => n.channel)
        .sort(),
    ).toEqual(['EMAIL', 'IN_APP', 'TELEGRAM']);
    expect(
      notices.every((n) => (n.payload as { reason: string }).reason === 'Организатор заболел'),
    ).toBe(true);
    expect(
      await prisma.auditLog.count({
        where: { entityId: f.meeting.id, action: 'CANCELLED', actorId: f.admin.id },
      }),
    ).toBe(1);
    await expect(f.register(member)).rejects.toMatchObject({
      code: kind === 'events' ? 'EVENT_CANCELLED' : 'OPEN_DAY_CANCELLED',
    });
    await expect(f.register(await user())).rejects.toMatchObject({
      code: kind === 'events' ? 'EVENT_CANCELLED' : 'OPEN_DAY_CANCELLED',
    });
    const history = await app.get(MembershipService).list(member, page);
    expect(history.items).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          entityId: f.meeting.id,
          entityCancelledAt: first.cancelledAt,
          cancelReason: 'Организатор заболел',
        }),
      ]),
    );
    expect(
      (await app.get(MembershipService).list(member, { ...page, upcoming: true })).items,
    ).toEqual([]);
    const visible = kind === 'events' ? await events.list(page) : await days.list(page);
    expect(visible.items.some((r) => r.id === f.meeting.id)).toBe(false);
    const adminList =
      kind === 'events'
        ? await events.list({ ...page, search: 'Cancellation' }, true)
        : await days.list({ ...page, search: 'Synthetic' }, true);
    expect(adminList.items.some((r) => r.id === f.meeting.id)).toBe(true);
    if (kind === 'events') {
      expect((await events.calendar(page)).items.some((r) => r.id === f.meeting.id)).toBe(false);
      expect(await events.detail(f.meeting.id)).toMatchObject({
        cancelReason: 'Организатор заболел',
      });
    }
    const remove = () =>
      kind === 'events'
        ? app.get(AdminService).eventDelete(f.admin, f.meeting.id)
        : app.get(AdminService).dayDelete(f.admin, f.meeting.id);
    await expect(remove()).rejects.toMatchObject({ code: 'CONFLICT' });
  });
  it('preserves attendance and previously cancelled records and skips blocked recipients', async () => {
    const f = await fixture(kind);
    const attended = await user();
    const cancelled = await user();
    const blocked = await user();
    if (kind === 'events') {
      await prisma.eventRegistration.createMany({
        data: [
          { eventId: f.meeting.id, userId: attended.id, status: 'ATTENDED' },
          { eventId: f.meeting.id, userId: cancelled.id, status: 'CANCELLED' },
          { eventId: f.meeting.id, userId: blocked.id, status: 'WAITLIST' },
        ],
      });
    } else {
      await prisma.openDayRegistration.createMany({
        data: [
          { sessionId: f.meeting.id, userId: attended.id, attended: true },
          { sessionId: f.meeting.id, userId: cancelled.id, cancelledAt: past() },
          { sessionId: f.meeting.id, userId: blocked.id },
        ],
      });
    }
    await prisma.user.update({ where: { id: blocked.id }, data: { isBlocked: true } });
    const before = (await f.rows()).filter((r) => r.userId !== blocked.id);
    await f.cancel();
    expect((await f.rows()).filter((r) => r.userId !== blocked.id)).toEqual(before);
    expect(await f.notices()).toHaveLength(0);
    if (kind === 'events')
      await expect(
        events.registrationStatus(f.admin, before[0].id, RegistrationStatus.CONFIRMED),
      ).rejects.toMatchObject({ code: 'EVENT_CANCELLED' });
    else
      await expect(
        days.markAttendance(f.admin, f.meeting.id, attended.id, true),
      ).rejects.toMatchObject({ code: 'OPEN_DAY_CANCELLED' });
  });
  it('serializes concurrent cancellation without duplicate notifications', async () => {
    const f = await fixture(kind);
    await f.register(await user());
    await Promise.all([f.cancel(), f.cancel()]);
    expect(await f.notices()).toHaveLength(3);
  });
  it('serializes registration against cancellation and never leaves an active registration', async () => {
    const f = await fixture(kind);
    const member = await user();
    const results = await Promise.allSettled([f.register(member), f.cancel()]);
    expect(results[1].status).toBe('fulfilled');
    for (const row of await f.rows())
      expect('status' in row ? row.status : !!row.cancelledAt).toBe(
        kind === 'events' ? 'CANCELLED' : true,
      );
    if (results[0].status === 'rejected')
      expect(results[0].reason).toMatchObject({
        code: kind === 'events' ? 'EVENT_CANCELLED' : 'OPEN_DAY_CANCELLED',
      });
  });
  it('rolls back the meeting, registrations, audit and outbox if persistence fails', async () => {
    const f = await fixture(kind);
    await f.register(await user());
    const before = await f.rows();
    const original = notifications.notify.bind(notifications);
    const spy = vi.spyOn(notifications, 'notify').mockImplementation(async (...args) => {
      await original(...args);
      throw new Error('OUTBOX_FAILURE');
    });
    try {
      await expect(f.cancel()).rejects.toThrow('OUTBOX_FAILURE');
    } finally {
      spy.mockRestore();
    }
    expect((await f.reload()).cancelledAt).toBeNull();
    expect(await f.rows()).toEqual(before);
    expect(await f.notices()).toHaveLength(0);
    expect(
      await prisma.auditLog.count({ where: { entityId: f.meeting.id, action: 'CANCELLED' } }),
    ).toBe(0);
  });
  it('suppresses queued registration/reschedule messages but delivers the cancellation reason', async () => {
    const f = await fixture(kind);
    const member = await user();
    await f.register(member);
    if (kind === 'events') await events.write(f.admin, { location: 'New place' }, f.meeting.id);
    else await days.write(f.admin, { location: 'New place' }, f.meeting.id);
    const old = await prisma.notification.findMany({
      where: { userId: member.id, status: 'QUEUED' },
    });
    await f.cancel();
    const send = vi.spyOn(app.get(TelegramService), 'send').mockResolvedValue(undefined);
    const mail = vi.spyOn(app.get(MailService), 'deliver').mockResolvedValue(undefined);
    try {
      for (const n of old)
        if (n.channel !== 'IN_APP') {
          await notifications.deliver(n.id, n.channel);
          expect(await prisma.notification.findUnique({ where: { id: n.id } })).toMatchObject({
            status: 'FAILED',
            lastError: 'SCHEDULE_OBSOLETE',
          });
        }
      expect(send).not.toHaveBeenCalled();
      expect(mail).not.toHaveBeenCalled();
      for (const n of await f.notices())
        if (n.channel !== 'IN_APP') await notifications.deliver(n.id, n.channel);
      expect(send).toHaveBeenCalledOnce();
      expect(mail).toHaveBeenCalledOnce();
      expect(send.mock.calls[0][1]).toContain('Причина: Организатор заболел');
      expect(mail.mock.calls[0][2]).toContain('Причина: Организатор заболел');
    } finally {
      send.mockRestore();
      mail.mockRestore();
    }
    // Ordinary edits retain cancellation and do not generate another reschedule notice.
    if (kind === 'events') await events.write(f.admin, { location: 'Another place' }, f.meeting.id);
    else await days.write(f.admin, { location: 'Another place' }, f.meeting.id);
    expect((await f.reload()).cancelledAt).not.toBeNull();
    expect(
      await prisma.notification.count({
        where: {
          userId: member.id,
          type: kind === 'events' ? 'EventRescheduled' : 'OpenDayRescheduled',
        },
      }),
    ).toBe(3);
  });
  it('enforces HTTP authentication, roles, reason validation and keeps empty cancelled meetings', async () => {
    const f = await fixture(kind);
    const path = `/api/v1/admin/${kind}/${f.meeting.id}/cancel`;
    expect(
      (await request(app.getHttpServer()).post(path).send({ cancelReason: 'Причина' })).status,
    ).toBe(401);
    const member = await user();
    const memberToken = await token(member);
    const adminToken = await token(f.admin);
    const post = (body: unknown, bearer = adminToken) =>
      request(app.getHttpServer())
        .post(path)
        .set('User-Agent', agent)
        .set('Authorization', `Bearer ${bearer}`)
        .send(body as object);
    expect((await post({ cancelReason: 'Причина' }, memberToken)).status).toBe(403);
    for (const body of [
      {},
      { cancelReason: '' },
      { cancelReason: '  ' },
      { cancelReason: null },
      { cancelReason: 'x'.repeat(2001) },
    ])
      expect((await post(body)).status).toBe(400);
    const success = await post({ cancelReason: '  Организатор заболел  ' });
    expect(success.status).toBe(200);
    expect(success.body).toMatchObject({
      cancelReason: 'Организатор заболел',
      cancelledAt: expect.any(String),
    });
    const deleted = await request(app.getHttpServer())
      .delete(`/api/v1/admin/${kind}/${f.meeting.id}`)
      .set('User-Agent', agent)
      .set('Authorization', `Bearer ${adminToken}`);
    expect(deleted.status).toBe(409);
    expect(await f.notices()).toEqual([]);
  });
});

it('excludes a cancelled past DOD from admission without erasing attendance or revoking existing roles', async () => {
  const f = await fixture('open-days', past());
  const member = await user('CANDIDATE');
  await prisma.openDayRegistration.create({
    data: { sessionId: f.meeting.id, userId: member.id, attended: true },
  });
  expect((await app.get(ApplicationsService).mine(member)).hasOpenDayAttended).toBe(true);
  await f.cancel();
  expect((await app.get(ApplicationsService).mine(member)).hasOpenDayAttended).toBe(false);
  expect((await f.rows())[0]).toMatchObject({ attended: true, cancelledAt: null });
});
it('ignores a cancelled DOD reminder both before enqueueing notifications and during delivery', async () => {
  const f = await fixture('open-days');
  const member = await user();
  await f.register(member);
  const data = {
    entity: 'openDay' as const,
    id: f.meeting.id,
    startsAt: f.meeting.startsAt.toISOString(),
    type: 'OpenDayReminder' as const,
    scheduledAt: f.meeting.startsAt.getTime() - 86400000,
  };
  await app.get(ReminderService).process(data, randomUUID());
  const queued = await prisma.notification.findMany({
    where: { userId: member.id, type: 'OpenDayReminder', status: 'QUEUED' },
  });
  expect(queued).toHaveLength(2);
  await f.cancel();
  await app.get(ReminderService).process(data, randomUUID());
  expect(
    await prisma.notification.count({ where: { userId: member.id, type: 'OpenDayReminder' } }),
  ).toBe(3);
  const send = vi.spyOn(app.get(TelegramService), 'send').mockResolvedValue(undefined);
  const mail = vi.spyOn(app.get(MailService), 'deliver').mockResolvedValue(undefined);
  try {
    for (const n of queued)
      if (n.channel !== 'IN_APP') {
        await notifications.deliver(n.id, n.channel);
        expect(await prisma.notification.findUnique({ where: { id: n.id } })).toMatchObject({
          status: 'FAILED',
          lastError: 'REMINDER_OBSOLETE',
        });
      }
    expect(send).not.toHaveBeenCalled();
    expect(mail).not.toHaveBeenCalled();
  } finally {
    send.mockRestore();
    mail.mockRestore();
  }
});

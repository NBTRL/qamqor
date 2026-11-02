import 'reflect-metadata';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { Test, type TestingModule } from '@nestjs/testing';
import { randomUUID } from 'node:crypto';
import { Queue } from 'bullmq';
import { GrammyError } from 'grammy';
import { AppModule } from '../dist/app.module.js';
import { PrismaService } from '../dist/prisma/prisma.service.js';
import { RedisService } from '../dist/common/redis.service.js';
import { AuditService } from '../dist/common/audit.service.js';
import { QueuesService } from '../dist/common/queues.service.js';
import { MailService } from '../dist/common/mail.service.js';
import { TelegramService } from '../dist/auth/telegram.service.js';
import { NotificationService } from '../dist/notifications/notification.service.js';
import { TripsService } from '../dist/club/trips.service.js';
import type { Actor } from '../dist/common/http.js';
import type { TripPatchDto } from '../dist/club/club.dto.js';
import { telegramFixture } from './helpers/telegram.js';

let module: TestingModule;
let prisma: PrismaService;
let notifications: NotificationService;
let trips: TripsService;
beforeAll(async () => {
  const url = new URL(process.env.DATABASE_URL ?? '');
  if (
    process.env.NODE_ENV !== 'test' ||
    !['localhost', '127.0.0.1'].includes(url.hostname) ||
    !url.pathname.startsWith('/club_test_')
  )
    throw new Error('Use an isolated local club_test_ database (pnpm test:e2e).');
  module = await Test.createTestingModule({
    imports: [AppModule.configure({ offline: true, workers: false, telegram: false })],
  }).compile();
  prisma = module.get(PrismaService);
  notifications = module.get(NotificationService);
  trips = module.get(TripsService);
});
afterAll(async () => {
  await module?.close();
});
async function user(role: 'VOLUNTEER' | 'ADMIN' | 'CANDIDATE' = 'VOLUNTEER') {
  const identity = randomUUID();
  const telegramId = BigInt('0x' + identity.replaceAll('-', '').slice(0, 12));
  const row = await prisma.user.create({
    data: {
      telegramId,
      chatId: telegramId,
      fullName: 'Synthetic notification participant',
      email: `${identity}@example.test`,
      emailVerifiedAt: new Date(),
      role,
    },
  });
  return { ...row, sessionId: randomUUID(), adminVerified: true } as Actor;
}
const notice = async (member: Actor) => {
  const dedupe = randomUUID();
  await prisma.$transaction((tx) =>
    notifications.notify(tx, [member.id], 'EventRegistered', { title: 'Тестовое событие' }, dedupe),
  );
  return prisma.notification.findFirstOrThrow({
    where: { dedupeKey: `${dedupe}:${member.id}:TELEGRAM` },
  });
};

describe('Telegram recovery', () => {
  it.each(['unblock', 'message', '/help', '/status'])(
    'restores delivery after 403 via %s without a website login',
    async (action) => {
      const member = await user();
      await prisma.notificationSetting.create({
        data: { userId: member.id, type: 'EventRegistered', telegram: true, email: false },
      });
      const first = await notice(member);
      const send = vi
        .spyOn(module.get(TelegramService), 'send')
        .mockRejectedValueOnce(
          new GrammyError(
            'Forbidden',
            { ok: false, error_code: 403, description: 'Forbidden' },
            'sendMessage',
            {},
          ),
        )
        .mockResolvedValue(undefined);
      try {
        await notifications.deliver(first.id, 'TELEGRAM');
        expect(
          (await prisma.user.findUniqueOrThrow({ where: { id: member.id } })).botBlockedAt,
        ).not.toBeNull();
        const bot = telegramFixture(prisma);
        await bot.handle(
          action === 'unblock'
            ? bot.membership(Number(member.telegramId), false)
            : bot.message(Number(member.telegramId), action),
        );
        const restored = await prisma.user.findUniqueOrThrow({ where: { id: member.id } });
        expect(restored.botBlockedAt).toBeNull();
        expect(restored.chatId).toBe(member.chatId);
        expect(
          await prisma.notificationSetting.findFirst({ where: { userId: member.id } }),
        ).toMatchObject({ telegram: true, email: false });
        const next = await notice(member);
        await notifications.deliver(next.id, 'TELEGRAM');
        expect(send).toHaveBeenCalledTimes(2);
        expect(await prisma.notification.findUnique({ where: { id: next.id } })).toMatchObject({
          status: 'SENT',
          attempts: 1,
        });
        expect(await prisma.notification.findUnique({ where: { id: first.id } })).toMatchObject({
          status: 'FAILED',
          lastError: 'BOT_BLOCKED',
        });
        expect(
          await prisma.notification.count({ where: { userId: member.id, channel: 'EMAIL' } }),
        ).toBe(1);
      } finally {
        send.mockRestore();
      }
    },
  );
  it('records private blocking and honors disabled preferences after unblocking', async () => {
    const member = await user();
    const bot = telegramFixture(prisma);
    await bot.handle(bot.membership(Number(member.telegramId), true));
    expect(
      (await prisma.user.findUniqueOrThrow({ where: { id: member.id } })).botBlockedAt,
    ).not.toBeNull();
    await prisma.notificationSetting.create({
      data: { userId: member.id, type: 'EventRegistered', telegram: false, email: false },
    });
    await bot.handle(bot.membership(Number(member.telegramId), false));
    expect(
      (await prisma.user.findUniqueOrThrow({ where: { id: member.id } })).botBlockedAt,
    ).toBeNull();
    await prisma.$transaction((tx) => notifications.notify(tx, [member.id], 'EventRegistered', {}));
    expect(
      (await prisma.notification.findMany({ where: { userId: member.id } })).map((r) => r.channel),
    ).toEqual(['IN_APP']);
  });
  it.each(['blocked account', 'different chat', 'group', 'unknown user'])(
    'does not rebind or reactivate %s',
    async (reason) => {
      const member = await user();
      const blockedAt = new Date('2020-01-01');
      await prisma.user.update({
        where: { id: member.id },
        data: {
          botBlockedAt: blockedAt,
          ...(reason === 'blocked account' ? { isBlocked: true } : {}),
          ...(reason === 'different chat' ? { chatId: member.chatId! + 1n } : {}),
        },
      });
      const bot = telegramFixture(prisma);
      const id = Number(member.telegramId) + (reason === 'unknown user' ? 1 : 0);
      const update = bot.membership(id, false);
      if (reason === 'group' && update.my_chat_member)
        update.my_chat_member.chat = { id, type: 'group', title: 'Test group' };
      const count = await prisma.user.count();
      await bot.handle(update);
      expect(await prisma.user.count()).toBe(count);
      expect(
        (await prisma.user.findUniqueOrThrow({ where: { id: member.id } })).botBlockedAt,
      ).toEqual(blockedAt);
    },
  );
});

describe('Outbox fairness with PostgreSQL and Redis', () => {
  it('reaches new mail and Telegram behind 201 delayed jobs, preserves backoff and recovers missing jobs', async () => {
    const member = await user();
    const redis = module.get(RedisService);
    const queue = new Queue(`notification-fairness-${randomUUID()}`, {
      connection: redis.connection,
      prefix: redis.prefix,
    });
    const service = new NotificationService(
      prisma,
      module.get(AuditService),
      module.get(QueuesService),
      module.get(TelegramService),
      module.get(MailService),
    );
    Object.assign(service, { telegramQueue: queue, emailQueue: queue });
    const old = Array.from({ length: 201 }, () => ({
      id: randomUUID(),
      userId: member.id,
      type: 'EventRegistered',
      payload: {},
      channel: 'TELEGRAM' as const,
      createdAt: new Date('2000-01-01'),
    }));
    await prisma.notification.createMany({ data: old });
    const newer = (['TELEGRAM', 'EMAIL'] as const).map((channel) => ({
      id: randomUUID(),
      userId: member.id,
      type: 'EventRegistered',
      payload: {},
      channel,
      createdAt: new Date('2001-01-01'),
    }));
    await prisma.notification.createMany({ data: newer });
    try {
      await queue.addBulk(
        old.map((row) => ({
          name: 'send',
          data: { id: row.id },
          opts: { jobId: `notification-${row.id}`, delay: 3600000 },
        })),
      );
      const before = await queue.getJob(`notification-${old[0].id}`);
      await service.dispatch();
      expect(await queue.getJob(`notification-${newer[0].id}`)).toBeUndefined();
      const lastId = old.map((row) => row.id).sort()[199];
      await prisma.notification.delete({ where: { id: lastId } });
      await service.dispatch();
      for (const row of newer)
        expect(await queue.getJobState(`notification-${row.id}`)).toBe('waiting');
      const after = await queue.getJob(`notification-${old[0].id}`);
      expect(after?.delay).toBe(3600000);
      expect(after?.timestamp).toBe(before?.timestamp);
      const recovered = old.find((row) => row.id !== lastId)!;
      await (await queue.getJob(`notification-${recovered.id}`))!.remove();
      const sweeps =
        Math.ceil((await prisma.notification.count({ where: { status: 'QUEUED' } })) / 200) + 2;
      for (let i = 0; i < sweeps; i++) await service.dispatch();
      expect(await queue.getJobState(`notification-${recovered.id}`)).toBe('waiting');
      for (const row of newer)
        expect((await queue.getJob(`notification-${row.id}`))?.data).toEqual({ id: row.id });
    } finally {
      await queue.obliterate({ force: true });
      await queue.close();
      await prisma.notification.deleteMany({ where: { userId: member.id } });
    }
  });
});

async function tripFixture() {
  const admin = await user('ADMIN');
  const region = await prisma.region.create({
    data: { name: 'Notification region', slug: randomUUID() },
  });
  const place = await prisma.place.create({
    data: {
      name: 'Notification place',
      slug: randomUUID(),
      type: 'ORPHANAGE',
      regionId: region.id,
      city: 'Test',
      address: 'Synthetic',
      description: '',
    },
  });
  const startsAt = new Date(Date.now() + 7 * 86400000);
  const trip = await prisma.trip.create({
    data: {
      title: 'Поездка',
      description: '',
      placeId: place.id,
      createdById: admin.id,
      status: 'OPEN',
      startsAt,
      endsAt: new Date(startsAt.getTime() + 3600000),
      meetingPoint: 'Старый вход',
      capacity: 30,
    },
  });
  const register = (
    member: Actor,
    status:
      | 'PENDING'
      | 'CONFIRMED'
      | 'WAITLIST'
      | 'CANCELLED'
      | 'REJECTED'
      | 'ATTENDED'
      | 'NO_SHOW' = 'CONFIRMED',
  ) => prisma.tripRegistration.create({ data: { tripId: trip.id, userId: member.id, status } });
  const save = (dto: TripPatchDto) => trips.update(admin, trip.id, dto);
  const rows = (userId?: string) =>
    prisma.notification.findMany({
      where: { type: 'TripRescheduled', userId, payload: { path: ['tripId'], equals: trip.id } },
    });
  return { admin, trip, register, save, rows };
}
describe('Trip schedule and meeting point notifications', () => {
  it.each(['meetingPoint', 'startsAt', 'endsAt'] as const)(
    'sends the complete schedule for a change to %s',
    async (field) => {
      const f = await tripFixture();
      const member = await user();
      await f.register(member);
      await f.save({
        [field]:
          field === 'meetingPoint'
            ? 'Северный вход'
            : new Date(f.trip[field].getTime() + 1800000).toISOString(),
      });
      const updated = await prisma.trip.findUniqueOrThrow({ where: { id: f.trip.id } });
      const rows = await f.rows(member.id);
      expect(rows.map((r) => r.channel).sort()).toEqual(['EMAIL', 'IN_APP', 'TELEGRAM']);
      for (const row of rows)
        expect(row.payload).toMatchObject({
          tripId: f.trip.id,
          startsAt: updated.startsAt.toISOString(),
          endsAt: updated.endsAt.toISOString(),
          meetingPoint: updated.meetingPoint,
        });
      const send = vi.spyOn(module.get(TelegramService), 'send').mockResolvedValue(undefined);
      const mail = vi.spyOn(module.get(MailService), 'deliver').mockResolvedValue(undefined);
      try {
        for (const row of rows)
          if (row.channel !== 'IN_APP') await notifications.deliver(row.id, row.channel);
        expect(send).toHaveBeenCalledOnce();
        expect(send.mock.calls[0][1]).toContain(updated.meetingPoint);
        expect(mail).toHaveBeenCalledOnce();
        expect(mail.mock.calls[0][2]).toContain(updated.meetingPoint);
      } finally {
        send.mockRestore();
        mail.mockRestore();
      }
    },
  );
  it('notifies active eligible statuses, honors settings and skips inactive participants', async () => {
    const f = await tripFixture();
    const expected: string[] = [];
    for (const status of [
      'PENDING',
      'CONFIRMED',
      'WAITLIST',
      'CANCELLED',
      'REJECTED',
      'ATTENDED',
      'NO_SHOW',
    ] as const) {
      const member = await user();
      await f.register(member, status);
      if (['PENDING', 'CONFIRMED', 'WAITLIST'].includes(status)) expected.push(member.id);
    }
    const admin = await user('ADMIN');
    await f.register(admin);
    expected.push(admin.id);
    await f.register(await user('CANDIDATE'));
    const blocked = await user();
    await f.register(blocked);
    await prisma.user.update({ where: { id: blocked.id }, data: { isBlocked: true } });
    await prisma.notificationSetting.create({
      data: { userId: admin.id, type: 'TripRescheduled', telegram: false, email: false },
    });
    await f.save({ meetingPoint: 'Новый вход' });
    expect(
      (await f.rows())
        .filter((r) => r.channel === 'IN_APP')
        .map((r) => r.userId)
        .sort(),
    ).toEqual(expected.sort());
    expect((await f.rows(admin.id)).map((r) => r.channel)).toEqual(['IN_APP']);
  });
  it('does not duplicate on identical concurrent saves or unrelated edits', async () => {
    const f = await tripFixture();
    const member = await user();
    await f.register(member);
    await Promise.all([
      f.save({ meetingPoint: 'Новый вход' }),
      f.save({ meetingPoint: 'Новый вход' }),
    ]);
    await f.save({
      title: 'Другое название',
      startsAt: f.trip.startsAt.toISOString().replace('Z', '+00:00'),
      capacity: 31,
    });
    expect(await f.rows(member.id)).toHaveLength(3);
  });
  it('rolls back the change, audit and outbox together on persistence failure', async () => {
    const f = await tripFixture();
    await f.register(await user());
    const original = notifications.notify.bind(notifications);
    const spy = vi.spyOn(notifications, 'notify').mockImplementation(async (...args) => {
      await original(...args);
      throw new Error('OUTBOX_FAILURE');
    });
    try {
      await expect(f.save({ meetingPoint: 'Новый вход' })).rejects.toThrow('OUTBOX_FAILURE');
    } finally {
      spy.mockRestore();
    }
    expect((await prisma.trip.findUniqueOrThrow({ where: { id: f.trip.id } })).meetingPoint).toBe(
      f.trip.meetingPoint,
    );
    expect(await f.rows()).toHaveLength(0);
    expect(await prisma.auditLog.count({ where: { entityId: f.trip.id } })).toBe(0);
  });
  it.each([
    'changed again',
    'cancelled trip',
    'cancelled registration',
    'demoted',
    'started',
  ] as const)(
    'skips obsolete external messages after %s while retaining history',
    async (reason) => {
      const f = await tripFixture();
      const member = await user();
      await f.register(member);
      await f.save({ meetingPoint: 'Первый вход' });
      const rows = await f.rows(member.id);
      if (reason === 'changed again') await f.save({ meetingPoint: 'Второй вход' });
      if (reason === 'cancelled trip')
        await prisma.trip.update({ where: { id: f.trip.id }, data: { status: 'CANCELLED' } });
      if (reason === 'cancelled registration')
        await prisma.tripRegistration.updateMany({
          where: { tripId: f.trip.id },
          data: { status: 'CANCELLED' },
        });
      if (reason === 'demoted')
        await prisma.user.update({ where: { id: member.id }, data: { role: 'CANDIDATE' } });
      if (reason === 'started')
        await prisma.trip.update({
          where: { id: f.trip.id },
          data: { startsAt: new Date(Date.now() - 1000) },
        });
      const send = vi.spyOn(module.get(TelegramService), 'send').mockResolvedValue(undefined);
      const mail = vi.spyOn(module.get(MailService), 'deliver').mockResolvedValue(undefined);
      try {
        for (const row of rows)
          if (row.channel !== 'IN_APP') {
            await notifications.deliver(row.id, row.channel);
            expect(await prisma.notification.findUnique({ where: { id: row.id } })).toMatchObject({
              status: 'FAILED',
              lastError: 'SCHEDULE_OBSOLETE',
              attempts: 0,
            });
          }
        expect(send).not.toHaveBeenCalled();
        expect(mail).not.toHaveBeenCalled();
        expect(
          await prisma.notification.findUnique({
            where: { id: rows.find((r) => r.channel === 'IN_APP')!.id },
          }),
        ).toMatchObject({ status: 'SENT' });
      } finally {
        send.mockRestore();
        mail.mockRestore();
      }
    },
  );
});

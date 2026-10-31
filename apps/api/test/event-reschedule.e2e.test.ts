import 'reflect-metadata';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { Test, type TestingModule } from '@nestjs/testing';
import { randomUUID } from 'node:crypto';
import { AppModule } from '../dist/app.module.js';
import { PrismaService } from '../dist/prisma/prisma.service.js';
import { EventsService, OpenDaysService } from '../dist/club/events.service.js';
import { NotificationService } from '../dist/notifications/notification.service.js';
import { AuditService } from '../dist/common/audit.service.js';
import { MailService } from '../dist/common/mail.service.js';
import { TelegramService } from '../dist/auth/telegram.service.js';
import { MyNotificationsController } from '../dist/notifications/notification.controller.js';
import type { EventPatchDto, OpenDayPatchDto } from '../dist/club/club.dto.js';
import type { Actor } from '../dist/common/http.js';

let module: TestingModule;
let prisma: PrismaService;
let events: EventsService;
let days: OpenDaysService;
let notifications: NotificationService;
type Kind = 'event' | 'openDay';
const future = (offset = 0) => new Date(Date.now() + (7 + offset) * 86400_000);

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
  events = module.get(EventsService);
  days = module.get(OpenDaysService);
  notifications = module.get(NotificationService);
});
afterAll(async () => {
  await module?.close();
});

async function user(role: 'CANDIDATE' | 'VOLUNTEER' | 'ADMIN' = 'VOLUNTEER', isBlocked = false) {
  const identity = randomUUID();
  const row = await prisma.user.create({
    data: {
      telegramId: BigInt('0x' + identity.replaceAll('-', '').slice(0, 14)),
      fullName: 'Reschedule test',
      phone: '+70000000001',
      email: `${identity}@example.test`,
      emailVerifiedAt: new Date(),
      chatId: BigInt(12345),
      role,
      isBlocked,
    },
  });
  return { ...row, sessionId: randomUUID(), adminVerified: true } as Actor;
}

async function fixture(kind: Kind) {
  const admin = await user('ADMIN');
  const startsAt = future();
  const endsAt = new Date(startsAt.getTime() + 2 * 3600_000);
  const row =
    kind === 'event'
      ? await prisma.event.create({
          data: {
            type: 'SEMINAR',
            title: 'Семинар',
            description: '',
            startsAt,
            endsAt,
            location: 'Старое место',
            capacity: 20,
            createdById: admin.id,
          },
        })
      : await prisma.openDaySession.create({
          data: { startsAt, location: 'Старое место', capacity: 20 },
        });
  const type = kind === 'event' ? 'EventRescheduled' : 'OpenDayRescheduled';
  const save = (patch: EventPatchDto & OpenDayPatchDto) =>
    kind === 'event' ? events.write(admin, patch, row.id) : days.write(admin, patch, row.id);
  const reload = () =>
    kind === 'event'
      ? prisma.event.findUniqueOrThrow({ where: { id: row.id } })
      : prisma.openDaySession.findUniqueOrThrow({ where: { id: row.id } });
  const register = async (
    member: Actor,
    status:
      | 'PENDING'
      | 'CONFIRMED'
      | 'WAITLIST'
      | 'CANCELLED'
      | 'REJECTED'
      | 'ATTENDED'
      | 'NO_SHOW' = 'CONFIRMED',
  ) => {
    if (kind === 'event')
      return prisma.eventRegistration.create({
        data: { eventId: row.id, userId: member.id, status },
      });
    return prisma.openDayRegistration.create({
      data: {
        sessionId: row.id,
        userId: member.id,
        attended: status === 'ATTENDED',
        cancelledAt: status === 'CANCELLED' ? new Date() : null,
      },
    });
  };
  const noticeRows = (userId?: string) =>
    prisma.notification.findMany({
      where: {
        type,
        userId,
        payload: { path: [kind === 'event' ? 'eventId' : 'sessionId'], equals: row.id },
      },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    });
  return { kind, admin, row, type, startsAt, endsAt, save, reload, register, noticeRows };
}

describe.each(['event', 'openDay'] as const)('%s rescheduling on PostgreSQL', (kind) => {
  it.each(
    kind === 'event'
      ? (['startsAt', 'endsAt', 'location'] as const)
      : (['startsAt', 'location'] as const),
  )('notifies participants after changing %s with a complete current schedule', async (field) => {
    const f = await fixture(kind);
    const member = await user(kind === 'openDay' ? 'CANDIDATE' : 'VOLUNTEER');
    await f.register(member);
    const value =
      field === 'location'
        ? 'Новое место'
        : field === 'startsAt'
          ? new Date(f.startsAt.getTime() + 3600_000).toISOString()
          : new Date(f.endsAt.getTime() + 3600_000).toISOString();
    await f.save({ [field]: value });
    const rows = await f.noticeRows(member.id);
    expect(rows.map((r) => r.channel).sort()).toEqual(['EMAIL', 'IN_APP', 'TELEGRAM']);
    const updated = await f.reload();
    expect(rows[0].payload).toMatchObject({
      [kind === 'event' ? 'eventId' : 'sessionId']: f.row.id,
      startsAt: updated.startsAt.toISOString(),
      location: updated.location,
      ...(kind === 'event' ? { endsAt: (updated as { endsAt: Date }).endsAt.toISOString() } : {}),
    });
    expect(rows.find((r) => r.channel === 'IN_APP')).toMatchObject({ status: 'SENT', attempts: 0 });
    expect(rows.find((r) => r.channel === 'EMAIL')).toMatchObject({
      status: 'QUEUED',
      attempts: 0,
    });
    expect(
      await prisma.auditLog.count({
        where: { entityId: f.row.id, actorId: f.admin.id, action: 'UPDATED' },
      }),
    ).toBe(1);
  });

  it('notifies only active registrations and active eligible accounts', async () => {
    const f = await fixture(kind);
    const statuses =
      kind === 'event'
        ? ([
            'PENDING',
            'CONFIRMED',
            'WAITLIST',
            'CANCELLED',
            'REJECTED',
            'ATTENDED',
            'NO_SHOW',
          ] as const)
        : (['CONFIRMED', 'CANCELLED', 'ATTENDED'] as const);
    const expected: string[] = [];
    for (const status of statuses) {
      const member = await user();
      await f.register(member, status);
      if (['PENDING', 'CONFIRMED', 'WAITLIST'].includes(status)) expected.push(member.id);
    }
    await f.register(await user('VOLUNTEER', true));
    const removed = await prisma.user.create({
      data: { fullName: 'Удаленный пользователь', anonymizedAt: new Date(), isBlocked: true },
    });
    await f.register({ ...removed, sessionId: randomUUID(), adminVerified: false } as Actor);
    if (kind === 'event') {
      await prisma.event.update({ where: { id: f.row.id }, data: { volunteersOnly: true } });
      await f.register(await user('CANDIDATE'));
    }
    await f.save({ location: 'Другой адрес' });
    expect(
      (await f.noticeRows())
        .filter((r) => r.channel === 'IN_APP')
        .map((r) => r.userId)
        .sort(),
    ).toEqual(expected.sort());
  });

  it('honors independent Telegram and email preferences and exposes the new setting', async () => {
    const f = await fixture(kind);
    const member = await user();
    await f.register(member);
    const controller = new MyNotificationsController(prisma);
    const settings = await controller.write(member, {
      items: [{ type: f.type, telegram: false, email: false }],
    });
    expect(settings.items).toContainEqual({ type: f.type, telegram: false, email: false });
    await f.save({ location: 'Первый адрес' });
    expect((await f.noticeRows(member.id)).map((r) => r.channel)).toEqual(['IN_APP']);
    await controller.write(member, { items: [{ type: f.type, telegram: true, email: false }] });
    await f.save({ location: 'Второй адрес' });
    expect((await f.noticeRows(member.id)).filter((r) => r.channel === 'TELEGRAM')).toHaveLength(1);
    expect((await f.noticeRows(member.id)).filter((r) => r.channel === 'EMAIL')).toHaveLength(0);
  });

  it('does not notify for other edits, no-op saves or an equivalent timezone representation', async () => {
    const f = await fixture(kind);
    await f.register(await user());
    await f.save(
      kind === 'event'
        ? { title: 'Другое название', description: 'Текст', capacity: 30 }
        : { notes: 'Текст', capacity: 30 },
    );
    const sameInstant = f.startsAt.toISOString().replace('Z', '+00:00');
    await f.save({ startsAt: sameInstant, location: f.row.location });
    await f.save({});
    expect(await f.noticeRows()).toHaveLength(0);
  });

  it('sends once for concurrent identical saves but sends again for a later actual change', async () => {
    const f = await fixture(kind);
    const member = await user();
    await f.register(member);
    await Promise.all([f.save({ location: 'Новый адрес' }), f.save({ location: 'Новый адрес' })]);
    expect((await f.noticeRows(member.id)).filter((r) => r.channel === 'IN_APP')).toHaveLength(1);
    await f.save({ location: f.row.location });
    expect((await f.noticeRows(member.id)).filter((r) => r.channel === 'IN_APP')).toHaveLength(2);
  });

  it('rolls back the schedule, audit and outbox together when persistence fails', async () => {
    const f = await fixture(kind);
    await f.register(await user());
    const original = notifications.notify.bind(notifications);
    const spy = vi.spyOn(notifications, 'notify').mockImplementation(async (...args) => {
      await original(...args);
      throw new Error('OUTBOX_FAILURE');
    });
    try {
      await expect(f.save({ location: 'Другой адрес' })).rejects.toThrow('OUTBOX_FAILURE');
    } finally {
      spy.mockRestore();
    }
    expect((await f.reload()).location).toBe(f.row.location);
    expect(await f.noticeRows()).toHaveLength(0);
    expect(await prisma.auditLog.count({ where: { entityId: f.row.id } })).toBe(0);
  });

  it('serializes registration behind a reschedule so its first notice contains the new date', async () => {
    const f = await fixture(kind);
    const member = await user();
    let entered!: () => void, release!: () => void;
    const held = new Promise<void>((r) => {
      entered = r;
    });
    const released = new Promise<void>((r) => {
      release = r;
    });
    const audit = module.get(AuditService),
      original = audit.record.bind(audit);
    const spy = vi.spyOn(audit, 'record').mockImplementation(async (...args) => {
      await original(...args);
      if (args[2] === 'UPDATED' && args[4] === f.row.id) {
        entered();
        await released;
      }
    });
    const next = new Date(f.startsAt.getTime() + 3600_000).toISOString();
    const save = f.save({ startsAt: next });
    let registration: Promise<unknown> | undefined;
    try {
      await held;
      registration =
        kind === 'event' ? events.register(member, f.row.id) : days.register(member, f.row.id);
      await vi.waitFor(
        async () => {
          const rows = await prisma.$queryRaw<
            Array<{ count: number }>
          >`SELECT count(*)::int AS count FROM pg_stat_activity WHERE datname=current_database() AND wait_event_type='Lock' AND query LIKE ${'%FROM "' + (kind === 'event' ? 'events' : 'open_day_sessions') + '"%FOR UPDATE%'}`;
          expect(rows[0].count).toBeGreaterThan(0);
        },
        { timeout: 3000, interval: 10 },
      );
    } finally {
      release();
      spy.mockRestore();
    }
    await save;
    await registration;
    const registered = await prisma.notification.findFirstOrThrow({
      where: {
        userId: member.id,
        type: kind === 'event' ? 'EventRegistered' : 'OpenDayRegistered',
      },
    });
    expect(registered.payload).toMatchObject({ startsAt: next });
    expect(await f.noticeRows(member.id)).toHaveLength(0);
  });

  it('delivers the current schedule through both providers using the shared template', async () => {
    const f = await fixture(kind);
    const member = await user();
    await f.register(member);
    await f.save({ location: 'Новый адрес доставки' });
    const mail = vi.spyOn(module.get(MailService), 'deliver').mockResolvedValue(undefined);
    const telegram = vi.spyOn(module.get(TelegramService), 'send').mockResolvedValue(undefined);
    try {
      for (const row of await f.noticeRows(member.id))
        if (row.channel !== 'IN_APP') await notifications.deliver(row.id, row.channel);
      expect(mail).toHaveBeenCalledOnce();
      expect(mail.mock.calls[0][2]).toContain('Новый адрес доставки');
      expect(telegram).toHaveBeenCalledOnce();
      expect(telegram.mock.calls[0][1]).toContain('Новый адрес доставки');
      expect((await f.noticeRows(member.id)).every((r) => r.status === 'SENT')).toBe(true);
    } finally {
      mail.mockRestore();
      telegram.mockRestore();
    }
  });

  it.each(['cancelled', 'rescheduled again'] as const)(
    'keeps history but suppresses external delivery after participation is %s',
    async (reason) => {
      const f = await fixture(kind);
      const member = await user();
      await f.register(member);
      await f.save({ location: 'Первый новый адрес' });
      const queued = (await f.noticeRows(member.id)).find((r) => r.channel === 'EMAIL')!;
      const history = (await f.noticeRows(member.id)).find((r) => r.channel === 'IN_APP')!;
      if (reason === 'cancelled') {
        if (kind === 'event') await events.cancel(member, f.row.id);
        else await days.cancel(member, f.row.id);
      } else await f.save({ location: 'Последний адрес' });
      const mail = vi.spyOn(module.get(MailService), 'deliver').mockResolvedValue(undefined);
      try {
        await notifications.deliver(queued.id, 'EMAIL');
        expect(mail).not.toHaveBeenCalled();
        expect(
          await prisma.notification.findUniqueOrThrow({ where: { id: queued.id } }),
        ).toMatchObject({ status: 'FAILED', lastError: 'SCHEDULE_OBSOLETE', attempts: 0 });
        expect(
          await prisma.notification.findUniqueOrThrow({ where: { id: history.id } }),
        ).toMatchObject({ status: 'SENT', payload: history.payload });
      } finally {
        mail.mockRestore();
      }
    },
  );
});

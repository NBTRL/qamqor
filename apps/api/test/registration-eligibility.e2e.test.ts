import 'reflect-metadata';
import { ApplicationStatus, RegistrationStatus, UserRole } from '@club/shared';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { Test, type TestingModule } from '@nestjs/testing';
import { randomUUID } from 'node:crypto';
import { AppModule } from '../dist/app.module.js';
import { PrismaService } from '../dist/prisma/prisma.service.js';
import { UsersService } from '../dist/admin/users.service.js';
import { ApplicationsService } from '../dist/club/applications.service.js';
import { TripsService } from '../dist/club/trips.service.js';
import { EventsService, OpenDaysService } from '../dist/club/events.service.js';
import { NotificationService } from '../dist/notifications/notification.service.js';

let module: TestingModule;
let prisma: PrismaService;
let users: UsersService;
let applications: ApplicationsService;
let trips: TripsService;
const future = () => new Date(Date.now() + 7 * 86400_000);
const past = () => new Date(Date.now() - 7 * 86400_000);

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
  users = module.get(UsersService);
  applications = module.get(ApplicationsService);
  trips = module.get(TripsService);
});
afterAll(async () => {
  await module?.close();
});

const user = (role: 'VOLUNTEER' | 'CANDIDATE' | 'ADMIN' = 'VOLUNTEER', isBlocked = false) =>
  prisma.user.create({
    data: {
      telegramId: BigInt('0x' + randomUUID().replaceAll('-', '').slice(0, 14)),
      phone: '+70000000001',
      fullName: 'Registration test',
      role,
      isBlocked,
    },
  });
const actor = (row: Awaited<ReturnType<typeof user>>) => ({
  ...row,
  sessionId: randomUUID(),
  adminVerified: true,
});

async function fixture(capacity = 1) {
  const admin = actor(await user('ADMIN'));
  const owner = await user();
  const region = await prisma.region.create({ data: { name: 'Test', slug: randomUUID() } });
  const place = await prisma.place.create({
    data: {
      name: 'Test place',
      slug: randomUUID(),
      type: 'ORPHANAGE',
      regionId: region.id,
      city: 'Test',
      description: '',
      address: 'Test',
    },
  });
  await prisma.placeCurator.create({ data: { placeId: place.id, userId: admin.id } });
  const trip = async (
    startsAt = future(),
    status: 'OPEN' | 'CLOSED' | 'CANCELLED' | 'DRAFT' = 'OPEN',
  ) =>
    prisma.trip.create({
      data: {
        placeId: place.id,
        createdById: admin.id,
        title: 'Test trip',
        description: '',
        startsAt,
        endsAt: new Date(startsAt.getTime() + 3600_000),
        meetingPoint: 'Test',
        capacity,
        status,
      },
    });
  const register = async (
    tripId: string,
    userId = owner.id,
    status:
      | 'CONFIRMED'
      | 'PENDING'
      | 'WAITLIST'
      | 'ATTENDED'
      | 'NO_SHOW'
      | 'CANCELLED'
      | 'REJECTED' = 'CONFIRMED',
    createdAt = new Date(),
  ) => prisma.tripRegistration.create({ data: { tripId, userId, status, createdAt } });
  const event = async (volunteersOnly: boolean, startsAt = future()) =>
    prisma.event.create({
      data: {
        type: 'SEMINAR',
        title: 'Test event',
        description: '',
        startsAt,
        endsAt: new Date(startsAt.getTime() + 3600_000),
        location: 'Test',
        capacity: 1,
        volunteersOnly,
        createdById: admin.id,
      },
    });
  return { admin, owner, place, trip, register, event };
}
const tripStatus = async (id: string) =>
  (await prisma.tripRegistration.findUniqueOrThrow({ where: { id } })).status;
const promotions = (userId: string) =>
  prisma.notification.count({
    where: { userId, type: 'RegistrationPromotedFromWaitlist', channel: 'IN_APP' },
  });

describe('Loss of registration eligibility (real database)', () => {
  it('blocking cancels all future active bookings, releases capacity and preserves history', async () => {
    const f = await fixture();
    const cancelled: string[] = [];
    for (const status of ['CONFIRMED', 'PENDING', 'WAITLIST'] as const)
      cancelled.push((await f.register((await f.trip()).id, f.owner.id, status)).id);
    const history = await f.register((await f.trip(past(), 'CLOSED')).id);
    const attended = await f.register((await f.trip()).id, f.owner.id, 'ATTENDED');
    const nextTrip = await f.trip();
    const released = await f.register(nextTrip.id);
    const waitingUser = await user();
    const waiting = await f.register(nextTrip.id, waitingUser.id, 'WAITLIST');
    const nextEvent = await f.event(false);
    const eventRow = await prisma.eventRegistration.create({
      data: { eventId: nextEvent.id, userId: f.owner.id },
    });
    const session = await prisma.openDaySession.create({
      data: { startsAt: future(), location: 'Test', capacity: 1 },
    });
    const day = await prisma.openDayRegistration.create({
      data: { sessionId: session.id, userId: f.owner.id },
    });

    await users.update(f.admin, f.owner.id, { isBlocked: true });
    expect(await Promise.all([...cancelled, released.id].map(tripStatus))).toEqual(
      Array(4).fill('CANCELLED'),
    );
    expect(await tripStatus(history.id)).toBe('CONFIRMED');
    expect(await tripStatus(attended.id)).toBe('ATTENDED');
    expect(await tripStatus(waiting.id)).toBe('PENDING');
    expect(
      (await prisma.eventRegistration.findUniqueOrThrow({ where: { id: eventRow.id } })).status,
    ).toBe('CANCELLED');
    expect(
      (await prisma.openDayRegistration.findUniqueOrThrow({ where: { id: day.id } })).cancelledAt,
    ).not.toBeNull();
    await expect(module.get(EventsService).register(f.admin, nextEvent.id)).resolves.toMatchObject({
      status: 'CONFIRMED',
    });
    await expect(module.get(OpenDaysService).register(f.admin, session.id)).resolves.toMatchObject({
      cancelledAt: null,
    });
    expect(await promotions(waitingUser.id)).toBe(1);
    await users.update(f.admin, f.owner.id, { isBlocked: true });
    await users.update(f.admin, f.owner.id, { isBlocked: false });
    expect(await tripStatus(released.id)).toBe('CANCELLED');
    expect(await promotions(waitingUser.id)).toBe(1);
  });

  it.each(['admin role change', 'accepted application rejection'] as const)(
    '%s cancels volunteer-only bookings but retains public events and open days',
    async (method) => {
      const f = await fixture();
      await prisma.placeCurator.create({ data: { userId: f.owner.id, placeId: f.place.id } });
      const trip = await f.trip();
      const released = await f.register(trip.id);
      const waiter = await user();
      const waiting = await f.register(trip.id, waiter.id, 'WAITLIST');
      const restricted = await f.event(true),
        open = await f.event(false);
      const restrictedRow = await prisma.eventRegistration.create({
        data: { eventId: restricted.id, userId: f.owner.id },
      });
      const openRow = await prisma.eventRegistration.create({
        data: { eventId: open.id, userId: f.owner.id },
      });
      const history = await f.register((await f.trip(past(), 'CLOSED')).id, f.owner.id, 'ATTENDED');
      const session = await prisma.openDaySession.create({
        data: { startsAt: future(), location: 'Test', capacity: 1 },
      });
      const day = await prisma.openDayRegistration.create({
        data: { sessionId: session.id, userId: f.owner.id },
      });
      if (method === 'admin role change')
        await users.update(f.admin, f.owner.id, { role: UserRole.CANDIDATE });
      else {
        const application = await prisma.candidateApplication.create({
          data: { userId: f.owner.id, status: 'ACCEPTED' },
        });
        await applications.decision(f.admin, application.id, {
          status: ApplicationStatus.REJECTED,
          comment: 'Membership withdrawn',
        });
      }
      expect((await prisma.user.findUniqueOrThrow({ where: { id: f.owner.id } })).role).toBe(
        'CANDIDATE',
      );
      expect(await prisma.placeCurator.count({ where: { userId: f.owner.id } })).toBe(0);
      expect(await tripStatus(released.id)).toBe('CANCELLED');
      expect(await tripStatus(waiting.id)).toBe('PENDING');
      expect(await tripStatus(history.id)).toBe('ATTENDED');
      expect(
        (await prisma.eventRegistration.findUniqueOrThrow({ where: { id: restrictedRow.id } }))
          .status,
      ).toBe('CANCELLED');
      expect(
        (await prisma.eventRegistration.findUniqueOrThrow({ where: { id: openRow.id } })).status,
      ).toBe('CONFIRMED');
      expect(
        (await prisma.openDayRegistration.findUniqueOrThrow({ where: { id: day.id } })).cancelledAt,
      ).toBeNull();
      expect(
        await prisma.notification.count({
          where: { userId: f.owner.id, type: 'RegistrationCancelled' },
        }),
      ).toBe(1);
      expect(await promotions(waiter.id)).toBe(1);
      expect(
        await prisma.auditLog.count({
          where: { entityId: released.id, actorId: f.admin.id, action: 'STATUS_CHANGED' },
        }),
      ).toBe(1);
    },
  );

  it('ordinary profile edits retain an eligible volunteer booking', async () => {
    const f = await fixture();
    const row = await f.register((await f.trip()).id);
    await users.update(f.admin, f.owner.id, { fullName: 'Updated volunteer' });
    expect(await tripStatus(row.id)).toBe('CONFIRMED');
  });

  it.each(['blocking', 'application rejection'] as const)(
    'rolls back %s together with cancellations, audit and notifications',
    async (method) => {
      const f = await fixture();
      const trip = await f.trip();
      const row = await f.register(trip.id);
      const waiter = await user();
      const waiting = await f.register(trip.id, waiter.id, 'WAITLIST');
      const application = await prisma.candidateApplication.create({
        data: { userId: f.owner.id, status: 'ACCEPTED' },
      });
      const service = module.get(NotificationService);
      const original = service.notify.bind(service);
      const spy = vi.spyOn(service, 'notify').mockImplementation(async (...args) => {
        await original(...args);
        if (args[2] === 'RegistrationPromotedFromWaitlist') throw new Error('OUTBOX_FAILURE');
      });
      try {
        await expect(
          method === 'blocking'
            ? users.update(f.admin, f.owner.id, { isBlocked: true })
            : applications.decision(f.admin, application.id, {
                status: ApplicationStatus.REJECTED,
                comment: 'Withdrawn',
              }),
        ).rejects.toThrow('OUTBOX_FAILURE');
      } finally {
        spy.mockRestore();
      }
      expect(await prisma.user.findUniqueOrThrow({ where: { id: f.owner.id } })).toMatchObject({
        role: 'VOLUNTEER',
        isBlocked: false,
      });
      expect(
        (await prisma.candidateApplication.findUniqueOrThrow({ where: { id: application.id } }))
          .status,
      ).toBe('ACCEPTED');
      expect(await tripStatus(row.id)).toBe('CONFIRMED');
      expect(await tripStatus(waiting.id)).toBe('WAITLIST');
      expect(await promotions(waiter.id)).toBe(0);
      expect(
        await prisma.auditLog.count({
          where: { entityId: { in: [row.id, f.owner.id, application.id] } },
        }),
      ).toBe(0);
    },
  );

  it('serializes concurrent loss of eligibility and a new registration without overbooking', async () => {
    const f = await fixture(2);
    const trip = await f.trip();
    const second = await user(),
      waiter = await user(),
      newcomer = await user();
    const a = await f.register(trip.id),
      b = await f.register(trip.id, second.id);
    const waiting = await f.register(trip.id, waiter.id, 'WAITLIST');
    await Promise.all([
      users.update(f.admin, f.owner.id, { isBlocked: true }),
      users.update(f.admin, second.id, { role: UserRole.CANDIDATE }),
      trips.register(actor(newcomer), trip.id),
    ]);
    expect(await tripStatus(a.id)).toBe('CANCELLED');
    expect(await tripStatus(b.id)).toBe('CANCELLED');
    expect(await tripStatus(waiting.id)).toBe('PENDING');
    expect(
      await prisma.tripRegistration.count({
        where: { tripId: trip.id, status: { in: ['CONFIRMED', 'PENDING'] } },
      }),
    ).toBe(2);
    expect(await promotions(waiter.id)).toBe(1);
  });
});

describe('Waitlist allocation (real database)', () => {
  it.each(['OPEN', 'CLOSED'] as const)(
    'a capacity increase in %s fills every available invitation in FIFO order, skipping ineligible users',
    async (status) => {
      const f = await fixture();
      const trip = await f.trip(future(), status);
      await f.register(trip.id);
      const blocked = await user('VOLUNTEER', true),
        candidate = await user('CANDIDATE');
      const removed = await prisma.user.create({
        data: {
          fullName: 'Удаленный пользователь',
          anonymizedAt: new Date(),
          role: UserRole.CANDIDATE,
          isBlocked: true,
        },
      });
      const base = Date.now() - 60_000;
      for (const invalid of [blocked, candidate, removed])
        await f.register(trip.id, invalid.id, 'WAITLIST', new Date(base - 1));
      const waiting = [];
      for (let i = 0; i < 3; i++)
        waiting.push(await f.register(trip.id, (await user()).id, 'WAITLIST', new Date(base)));
      waiting.sort((a, b) => a.id.localeCompare(b.id));
      await trips.update(f.admin, trip.id, { capacity: 3 });
      expect(await Promise.all(waiting.map((r) => tripStatus(r.id)))).toEqual([
        'PENDING',
        'PENDING',
        'WAITLIST',
      ]);
      expect(await promotions(waiting[0].userId)).toBe(1);
      expect(await promotions(waiting[1].userId)).toBe(1);
      await trips.update(f.admin, trip.id, { capacity: 3 });
      expect(await promotions(waiting[0].userId)).toBe(1);
      expect(await tripStatus(waiting[2].id)).toBe('WAITLIST');
      expect(
        await prisma.tripRegistration.count({ where: { tripId: trip.id, status: 'CONFIRMED' } }),
      ).toBe(1);
    },
  );

  it('rejecting or cancelling an invitation advances exactly the next waiter; newcomers cannot jump it', async () => {
    const f = await fixture();
    const trip = await f.trip();
    const invited = await f.register(trip.id, f.owner.id, 'PENDING');
    const first = await f.register(trip.id, (await user()).id, 'WAITLIST', new Date(1));
    const second = await f.register(trip.id, (await user()).id, 'WAITLIST', new Date(2));
    const third = await f.register(trip.id, (await user()).id, 'WAITLIST', new Date(3));
    await trips.changeRegistration(f.admin, invited.id, RegistrationStatus.REJECTED);
    expect(await tripStatus(first.id)).toBe('PENDING');
    expect(await tripStatus(second.id)).toBe('WAITLIST');
    const newcomer = await trips.register(actor(await user()), trip.id);
    expect(newcomer.status).toBe('WAITLIST');
    await trips.changeRegistration(f.admin, first.id, RegistrationStatus.CANCELLED);
    expect(await tripStatus(second.id)).toBe('PENDING');
    expect(await tripStatus(third.id)).toBe('WAITLIST');
    expect(await promotions(second.userId)).toBe(1);
  });

  it('honors existing pending invitations when expanding capacity', async () => {
    const f = await fixture();
    const trip = await f.trip();
    await f.register(trip.id, f.owner.id, 'PENDING');
    const first = await f.register(trip.id, (await user()).id, 'WAITLIST', new Date(1));
    const second = await f.register(trip.id, (await user()).id, 'WAITLIST', new Date(2));
    await trips.update(f.admin, trip.id, { capacity: 2 });
    expect(await tripStatus(first.id)).toBe('PENDING');
    expect(await tripStatus(second.id)).toBe('WAITLIST');
    expect((await trips.register(actor(await user()), trip.id)).status).toBe('WAITLIST');
  });

  it('manual promotion uses the same capacity and FIFO rules', async () => {
    const f = await fixture();
    const trip = await f.trip();
    const first = await f.register(trip.id, f.owner.id, 'WAITLIST', new Date(1));
    const second = await f.register(trip.id, (await user()).id, 'WAITLIST', new Date(2));
    await expect(
      trips.changeRegistration(f.admin, second.id, RegistrationStatus.PENDING),
    ).rejects.toThrow();
    expect(await tripStatus(second.id)).toBe('WAITLIST');
    await expect(
      trips.changeRegistration(f.admin, first.id, RegistrationStatus.PENDING),
    ).resolves.toMatchObject({
      status: 'PENDING',
    });
    await expect(
      trips.changeRegistration(f.admin, second.id, RegistrationStatus.PENDING),
    ).rejects.toThrow();
    expect(await promotions(f.owner.id)).toBe(1);
  });

  it('rolls back a capacity increase if promotion notifications cannot be persisted', async () => {
    const f = await fixture();
    const trip = await f.trip();
    await f.register(trip.id);
    const waiting = await f.register(trip.id, (await user()).id, 'WAITLIST');
    const spy = vi
      .spyOn(module.get(NotificationService), 'notify')
      .mockRejectedValueOnce(new Error('OUTBOX_FAILURE'));
    try {
      await expect(trips.update(f.admin, trip.id, { capacity: 2 })).rejects.toThrow(
        'OUTBOX_FAILURE',
      );
    } finally {
      spy.mockRestore();
    }
    expect((await prisma.trip.findUniqueOrThrow({ where: { id: trip.id } })).capacity).toBe(1);
    expect(await tripStatus(waiting.id)).toBe('WAITLIST');
    expect(await promotions(waiting.userId)).toBe(0);
    expect(await prisma.auditLog.count({ where: { entityId: trip.id } })).toBe(0);
  });

  it('reconciles older waiters before admitting a newcomer to a legacy free slot', async () => {
    const f = await fixture();
    const trip = await f.trip();
    const waiting = await f.register(trip.id, f.owner.id, 'WAITLIST');
    const newcomer = await trips.register(actor(await user()), trip.id);
    expect(await tripStatus(waiting.id)).toBe('PENDING');
    expect(newcomer.status).toBe('WAITLIST');
    expect(await promotions(f.owner.id)).toBe(1);
  });

  it('serializes a capacity increase and concurrent newcomers, preserving the queue', async () => {
    const f = await fixture();
    const trip = await f.trip();
    await f.register(trip.id);
    const waiting = await f.register(trip.id, (await user()).id, 'WAITLIST');
    const newcomers = await Promise.all([user(), user()]);
    await Promise.all([
      trips.update(f.admin, trip.id, { capacity: 2 }),
      ...newcomers.map((u) => trips.register(actor(u), trip.id)),
    ]);
    expect(await tripStatus(waiting.id)).toBe('PENDING');
    expect(
      await prisma.tripRegistration.count({ where: { tripId: trip.id, status: 'PENDING' } }),
    ).toBe(1);
    expect(
      await prisma.tripRegistration.count({ where: { tripId: trip.id, status: 'WAITLIST' } }),
    ).toBe(2);
    expect(await promotions(waiting.userId)).toBe(1);
  });

  it('skips a waiter losing eligibility concurrently with the current participant cancelling', async () => {
    const f = await fixture();
    const trip = await f.trip();
    await f.register(trip.id);
    const removed = await user(),
      next = await user();
    const removedRow = await f.register(trip.id, removed.id, 'WAITLIST', new Date(1));
    const nextRow = await f.register(trip.id, next.id, 'WAITLIST', new Date(2));
    await Promise.all([
      users.update(f.admin, removed.id, { role: UserRole.CANDIDATE }),
      trips.cancelOwn(actor(f.owner), trip.id),
    ]);
    expect(await tripStatus(removedRow.id)).toBe('CANCELLED');
    expect(await tripStatus(nextRow.id)).toBe('PENDING');
    expect(
      await prisma.tripRegistration.count({ where: { tripId: trip.id, status: 'PENDING' } }),
    ).toBe(1);
    expect(await promotions(next.id)).toBe(1);
  });

  it.each(['past', 'cancelled', 'draft'] as const)('does not promote a %s trip', async (kind) => {
    const f = await fixture();
    const trip = await f.trip(
      kind === 'past' ? past() : future(),
      kind === 'cancelled' ? 'CANCELLED' : kind === 'draft' ? 'DRAFT' : 'OPEN',
    );
    const row = await f.register(trip.id, f.owner.id, 'PENDING');
    const waiting = await f.register(trip.id, (await user()).id, 'WAITLIST');
    await trips.changeRegistration(f.admin, row.id, RegistrationStatus.REJECTED);
    expect(await tripStatus(waiting.id)).toBe('WAITLIST');
    expect(await promotions(waiting.userId)).toBe(0);
  });
});

describe('Capacity changes respect reserved trip invitations', () => {
  it.each(['DRAFT', 'OPEN', 'CLOSED'] as const)(
    '%s cannot shrink below confirmed participants plus eligible pending invitations',
    async (status) => {
      const f = await fixture(3);
      const trip = await f.trip(future(), status);
      const confirmed = await f.register(trip.id);
      const invited = await f.register(trip.id, (await user()).id, 'PENDING');
      const waiting = await f.register(trip.id, (await user()).id, 'WAITLIST');
      await expect(
        trips.update(f.admin, trip.id, { capacity: 1, title: 'Must roll back' }),
      ).rejects.toMatchObject({ code: 'TRIP_FULL', details: { occupiedPlaces: 2 } });
      expect(await prisma.trip.findUniqueOrThrow({ where: { id: trip.id } })).toMatchObject({
        capacity: 3,
        title: trip.title,
      });
      expect(await Promise.all([confirmed, invited, waiting].map((r) => tripStatus(r.id)))).toEqual(
        ['CONFIRMED', 'PENDING', 'WAITLIST'],
      );
      expect(await prisma.auditLog.count({ where: { entityId: trip.id } })).toBe(0);
      expect(await promotions(waiting.userId)).toBe(0);
      await trips.update(f.admin, trip.id, { capacity: 2 });
      expect((await prisma.trip.findUniqueOrThrow({ where: { id: trip.id } })).capacity).toBe(2);
      expect(await tripStatus(waiting.id)).toBe('WAITLIST');
      if (status !== 'DRAFT') {
        await trips.changeRegistration(f.admin, invited.id, RegistrationStatus.CONFIRMED);
        expect(await tripStatus(invited.id)).toBe('CONFIRMED');
      }
    },
  );

  it('ignores invalid invitations, waiters and terminal registrations but reserves an administrator invitation', async () => {
    const f = await fixture(10);
    const trip = await f.trip();
    await f.register(trip.id);
    await f.register(trip.id, f.admin.id, 'PENDING');
    for (const member of [await user('CANDIDATE'), await user('VOLUNTEER', true)])
      await f.register(trip.id, member.id, 'PENDING');
    const anonymized = await prisma.user.create({
      data: { fullName: 'Удаленный пользователь', anonymizedAt: new Date(), role: 'VOLUNTEER' },
    });
    await f.register(trip.id, anonymized.id, 'PENDING');
    for (const status of ['WAITLIST', 'ATTENDED', 'NO_SHOW', 'CANCELLED', 'REJECTED'] as const)
      await f.register(trip.id, (await user()).id, status);
    await expect(trips.update(f.admin, trip.id, { capacity: 1 })).rejects.toMatchObject({
      code: 'TRIP_FULL',
    });
    await expect(trips.update(f.admin, trip.id, { capacity: 2 })).resolves.toMatchObject({
      capacity: 2,
    });
  });

  it('serializes shrinking and a new invitation without overbooking', async () => {
    const f = await fixture(2);
    const trip = await f.trip();
    await f.register(trip.id);
    const [edit, newcomer] = await Promise.allSettled([
      trips.update(f.admin, trip.id, { capacity: 1 }),
      trips.register(actor(await user()), trip.id),
    ]);
    expect(newcomer.status).toBe('fulfilled');
    if (edit.status === 'rejected') expect(edit.reason).toMatchObject({ code: 'TRIP_FULL' });
    const saved = await prisma.trip.findUniqueOrThrow({ where: { id: trip.id } });
    const occupied = await prisma.tripRegistration.count({
      where: { tripId: trip.id, status: { in: ['CONFIRMED', 'PENDING'] } },
    });
    expect(occupied).toBeLessThanOrEqual(saved.capacity);
    if (newcomer.status === 'fulfilled')
      expect(newcomer.value.status).toBe(saved.capacity === 1 ? 'WAITLIST' : 'PENDING');
  });
});

const eventStatus = async (id: string) =>
  (await prisma.eventRegistration.findUniqueOrThrow({ where: { id } })).status;
const eventNotices = (eventId: string, type = 'EventCancelled') =>
  prisma.notification.findMany({
    where: { type, channel: 'IN_APP', payload: { path: ['eventId'], equals: eventId } },
  });

describe('Changing event access reconciles existing bookings atomically', () => {
  it('cancels active candidate registrations, preserves history and volunteer/admin access, and notifies once', async () => {
    const f = await fixture();
    const event = await f.event(false);
    await prisma.event.update({ where: { id: event.id }, data: { capacity: 10 } });
    const active = ['PENDING', 'CONFIRMED', 'WAITLIST'] as const;
    const cancelled = [];
    const preserved = [];
    for (const status of [...active, 'ATTENDED', 'NO_SHOW', 'CANCELLED', 'REJECTED'] as const) {
      const member = await user('CANDIDATE');
      const row = await prisma.eventRegistration.create({
        data: { eventId: event.id, userId: member.id, status },
      });
      if (active.some((value) => value === status)) cancelled.push(row);
      else preserved.push(row);
    }
    for (const role of ['VOLUNTEER', 'ADMIN'] as const)
      for (const status of active)
        preserved.push(
          await prisma.eventRegistration.create({
            data: { eventId: event.id, userId: (await user(role)).id, status },
          }),
        );
    const events = module.get(EventsService);
    await events.write(f.admin, { volunteersOnly: true }, event.id);
    for (const row of cancelled) {
      expect(await eventStatus(row.id)).toBe('CANCELLED');
      expect(
        await prisma.auditLog.findFirst({ where: { entityId: row.id, action: 'STATUS_CHANGED' } }),
      ).toMatchObject({
        actorId: f.admin.id,
        diff: { from: row.status, to: 'CANCELLED', reason: 'VOLUNTEERS_ONLY' },
      });
    }
    for (const row of preserved) expect(await eventStatus(row.id)).toBe(row.status);
    const notices = await eventNotices(event.id);
    expect(notices).toHaveLength(3);
    for (const notice of notices)
      expect(notice.payload).toMatchObject({
        reasonCode: 'VOLUNTEERS_ONLY',
        reason: expect.stringContaining('только волонтерам'),
        message: expect.stringContaining('Запись на'),
      });
    await events.write(f.admin, { volunteersOnly: true }, event.id);
    await events.write(f.admin, { volunteersOnly: false }, event.id);
    expect(await eventNotices(event.id)).toHaveLength(3);
    for (const row of cancelled) expect(await eventStatus(row.id)).toBe('CANCELLED');
  });

  it('checks the smaller capacity after candidate cancellations and does not reschedule cancelled participants', async () => {
    const f = await fixture();
    const event = await f.event(false);
    await prisma.event.update({ where: { id: event.id }, data: { capacity: 2 } });
    const candidate = await user('CANDIDATE');
    const candidateRow = await prisma.eventRegistration.create({
      data: { eventId: event.id, userId: candidate.id },
    });
    const volunteerRow = await prisma.eventRegistration.create({
      data: { eventId: event.id, userId: f.owner.id },
    });
    const events = module.get(EventsService);
    await events.write(
      f.admin,
      { volunteersOnly: true, capacity: 1, location: 'Новое место' },
      event.id,
    );
    expect(await eventStatus(candidateRow.id)).toBe('CANCELLED');
    expect(await eventStatus(volunteerRow.id)).toBe('CONFIRMED');
    expect((await eventNotices(event.id)).map((n) => n.userId)).toEqual([candidate.id]);
    expect((await eventNotices(event.id, 'EventRescheduled')).map((n) => n.userId)).toEqual([
      f.owner.id,
    ]);
    await expect(events.register(actor(await user('CANDIDATE')), event.id)).rejects.toMatchObject({
      code: 'EVENT_VOLUNTEERS_ONLY',
    });
    await expect(events.register(actor(await user()), event.id)).rejects.toMatchObject({
      code: 'EVENT_FULL',
    });
  });

  it('releases a candidate place for a new eligible registration without adding an event waitlist', async () => {
    const f = await fixture();
    const event = await f.event(false);
    const candidate = await user('CANDIDATE');
    await prisma.eventRegistration.create({ data: { eventId: event.id, userId: candidate.id } });
    const events = module.get(EventsService);
    await events.write(f.admin, { volunteersOnly: true }, event.id);
    await expect(events.register(actor(f.owner), event.id)).resolves.toMatchObject({
      status: 'CONFIRMED',
    });
  });

  it.each(['capacity', 'outbox'] as const)(
    'rolls back access, capacity, cancellations and history on %s failure',
    async (failure) => {
      const f = await fixture();
      const event = await f.event(false);
      await prisma.event.update({ where: { id: event.id }, data: { capacity: 3 } });
      const candidate = await user('CANDIDATE');
      const row = await prisma.eventRegistration.create({
        data: { eventId: event.id, userId: candidate.id },
      });
      for (const member of [f.owner, await user()])
        await prisma.eventRegistration.create({ data: { eventId: event.id, userId: member.id } });
      const notifications = module.get(NotificationService);
      const original = notifications.notify.bind(notifications);
      const spy =
        failure === 'outbox'
          ? vi.spyOn(notifications, 'notify').mockImplementation(async (...args) => {
              await original(...args);
              throw new Error('OUTBOX_FAILURE');
            })
          : null;
      try {
        await expect(
          module
            .get(EventsService)
            .write(
              f.admin,
              { volunteersOnly: true, capacity: failure === 'capacity' ? 1 : 2 },
              event.id,
            ),
        ).rejects.toMatchObject(
          failure === 'capacity' ? { code: 'EVENT_FULL' } : { message: 'OUTBOX_FAILURE' },
        );
      } finally {
        spy?.mockRestore();
      }
      expect(await prisma.event.findUniqueOrThrow({ where: { id: event.id } })).toMatchObject({
        capacity: 3,
        volunteersOnly: false,
      });
      expect(await eventStatus(row.id)).toBe('CONFIRMED');
      expect(await eventNotices(event.id)).toHaveLength(0);
      expect(await prisma.auditLog.count({ where: { entityId: { in: [event.id, row.id] } } })).toBe(
        0,
      );
    },
  );

  it('preserves past participation while reconciling legacy invalid bookings on future restricted events', async () => {
    const f = await fixture();
    const previous = await f.event(false, past());
    const upcoming = await f.event(true);
    const member = await user('CANDIDATE');
    const a = await prisma.eventRegistration.create({
      data: { eventId: previous.id, userId: member.id },
    });
    const b = await prisma.eventRegistration.create({
      data: { eventId: upcoming.id, userId: member.id },
    });
    const events = module.get(EventsService);
    await events.write(f.admin, { volunteersOnly: true }, previous.id);
    await events.write(f.admin, { title: 'Обновленное мероприятие' }, upcoming.id);
    expect(await eventStatus(a.id)).toBe('CONFIRMED');
    expect(await eventStatus(b.id)).toBe('CANCELLED');
    expect(await eventNotices(previous.id)).toHaveLength(0);
    expect(await eventNotices(upcoming.id)).toHaveLength(1);
  });

  it.each([RegistrationStatus.PENDING, RegistrationStatus.CONFIRMED] as const)(
    'rejects administrative admission to %s for a legacy candidate booking',
    async (status) => {
      const f = await fixture();
      const event = await f.event(true);
      const member = await user('CANDIDATE');
      const row = await prisma.eventRegistration.create({
        data: {
          eventId: event.id,
          userId: member.id,
          status: status === 'PENDING' ? 'WAITLIST' : 'PENDING',
        },
      });
      await expect(
        module.get(EventsService).registrationStatus(f.admin, row.id, status),
      ).rejects.toMatchObject({ code: 'EVENT_VOLUNTEERS_ONLY' });
      expect(await eventStatus(row.id)).toBe(row.status);
    },
  );

  it.each(['CANDIDATE', 'VOLUNTEER'] as const)(
    'serializes a new %s registration and access/capacity changes',
    async (role) => {
      const f = await fixture();
      const event = await f.event(false);
      await prisma.event.update({ where: { id: event.id }, data: { capacity: 2 } });
      const member = await user(role);
      const events = module.get(EventsService);
      const [edit, registration] = await Promise.allSettled([
        events.write(f.admin, { volunteersOnly: true, capacity: 1 }, event.id),
        events.register(actor(member), event.id),
      ]);
      expect(edit.status).toBe('fulfilled');
      const row = await prisma.eventRegistration.findUnique({
        where: { eventId_userId: { eventId: event.id, userId: member.id } },
      });
      if (role === 'VOLUNTEER') {
        expect(registration.status).toBe('fulfilled');
        expect(row?.status).toBe('CONFIRMED');
      } else if (registration.status === 'fulfilled') {
        expect(row?.status).toBe('CANCELLED');
        expect(await eventNotices(event.id)).toHaveLength(1);
      } else {
        expect(registration.reason).toMatchObject({ code: 'EVENT_VOLUNTEERS_ONLY' });
        expect(row).toBeNull();
      }
    },
  );

  it('does not duplicate a cancellation racing a volunteer demotion', async () => {
    const f = await fixture();
    const event = await f.event(false);
    const row = await prisma.eventRegistration.create({
      data: { eventId: event.id, userId: f.owner.id },
    });
    await Promise.all([
      module.get(EventsService).write(f.admin, { volunteersOnly: true }, event.id),
      users.update(f.admin, f.owner.id, { role: UserRole.CANDIDATE }),
    ]);
    expect(await eventStatus(row.id)).toBe('CANCELLED');
    expect(await eventNotices(event.id)).toHaveLength(1);
    expect(
      await prisma.auditLog.count({ where: { entityId: row.id, action: 'STATUS_CHANGED' } }),
    ).toBe(1);
  });
});

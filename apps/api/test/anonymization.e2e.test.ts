import 'reflect-metadata';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { Test, type TestingModule } from '@nestjs/testing';
import { randomUUID } from 'node:crypto';
import { AppModule } from '../dist/app.module.js';
import { PrismaService } from '../dist/prisma/prisma.service.js';
import { MeService } from '../dist/auth/me.service.js';
import { TripsService } from '../dist/club/trips.service.js';
import { EventsService, OpenDaysService } from '../dist/club/events.service.js';
import { NotificationService } from '../dist/notifications/notification.service.js';

let module: TestingModule;
let prisma: PrismaService;
let me: MeService;
let trips: TripsService;
let events: EventsService;
let days: OpenDaysService;
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
  me = module.get(MeService);
  trips = module.get(TripsService);
  events = module.get(EventsService);
  days = module.get(OpenDaysService);
});
afterAll(async () => {
  await module?.close();
});

const identity = () => ({
  telegramId: BigInt('0x' + randomUUID().replaceAll('-', '').slice(0, 14)),
  phone: '+70000000001',
});

async function fixture() {
  const owner = await prisma.user.create({
    data: { ...identity(), fullName: 'Deleting volunteer', role: 'VOLUNTEER' },
  });
  const admin = await prisma.user.create({
    data: { ...identity(), fullName: 'Curator', role: 'ADMIN' },
  });
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
  const trip = async (status: 'OPEN' | 'CLOSED' | 'CANCELLED' = 'OPEN', startsAt = future()) =>
    prisma.trip.create({
      data: {
        placeId: place.id,
        createdById: admin.id,
        title: 'Test trip',
        description: '',
        startsAt,
        endsAt: new Date(startsAt.getTime() + 3600_000),
        meetingPoint: 'Test',
        capacity: 1,
        status,
      },
    });
  const register = async (
    tripId: string,
    userId = owner.id,
    status:
      'CONFIRMED' | 'PENDING' | 'WAITLIST' | 'ATTENDED' | 'NO_SHOW' | 'CANCELLED' = 'CONFIRMED',
    createdAt = new Date(),
  ) =>
    prisma.tripRegistration.create({
      data: { tripId, userId, status, comment: 'personal', createdAt },
    });
  return { owner, admin, place, trip, register };
}

describe('Account anonymization registrations (real database)', () => {
  it('cancels future active trips, promotes one eligible waiting volunteer and audits/notifies atomically', async () => {
    const f = await fixture();
    const trip = await f.trip();
    const ownerRegistration = await f.register(trip.id);
    const blocked = await prisma.user.create({
      data: { ...identity(), fullName: 'Blocked', role: 'VOLUNTEER', isBlocked: true },
    });
    const candidate = await prisma.user.create({
      data: { ...identity(), fullName: 'Candidate', role: 'CANDIDATE' },
    });
    const first = await prisma.user.create({
      data: { ...identity(), fullName: 'First waiting', role: 'VOLUNTEER' },
    });
    const second = await prisma.user.create({
      data: { ...identity(), fullName: 'Second waiting', role: 'VOLUNTEER' },
    });
    const base = Date.now() - 60000;
    await f.register(trip.id, blocked.id, 'WAITLIST', new Date(base));
    await f.register(trip.id, candidate.id, 'WAITLIST', new Date(base + 1));
    const firstRow = await f.register(trip.id, first.id, 'WAITLIST', new Date(base + 2));
    const secondRow = await f.register(trip.id, second.id, 'WAITLIST', new Date(base + 3));
    await me.anonymize(f.owner, f.admin.id);
    expect(
      (await prisma.user.findUniqueOrThrow({ where: { id: f.owner.id } })).anonymizedAt,
    ).not.toBeNull();
    expect(
      await prisma.tripRegistration.findUnique({ where: { id: ownerRegistration.id } }),
    ).toMatchObject({ status: 'CANCELLED', comment: null });
    expect(
      (await prisma.tripRegistration.findUniqueOrThrow({ where: { id: firstRow.id } })).status,
    ).toBe('PENDING');
    expect(
      (await prisma.tripRegistration.findUniqueOrThrow({ where: { id: secondRow.id } })).status,
    ).toBe('WAITLIST');
    expect(
      await prisma.tripRegistration.count({ where: { tripId: trip.id, status: 'CONFIRMED' } }),
    ).toBe(0);
    expect(
      await prisma.notification.count({
        where: { userId: first.id, type: 'RegistrationPromotedFromWaitlist' },
      }),
    ).toBe(1);
    expect(
      await prisma.notification.count({
        where: { userId: f.admin.id, type: 'RegistrationPromotedFromWaitlist' },
      }),
    ).toBe(1);
    expect(await prisma.notification.count({ where: { userId: f.owner.id } })).toBe(0);
    expect(
      await prisma.auditLog.findFirst({
        where: { entityId: ownerRegistration.id, actorId: f.admin.id, action: 'STATUS_CHANGED' },
      }),
    ).not.toBeNull();
    await me.anonymize(f.owner, f.admin.id);
    expect(
      await prisma.notification.count({
        where: { userId: first.id, type: 'RegistrationPromotedFromWaitlist' },
      }),
    ).toBe(1);
    expect(
      (await prisma.tripRegistration.findUniqueOrThrow({ where: { id: secondRow.id } })).status,
    ).toBe('WAITLIST');
  });

  it('preserves history and advances a pending place only when capacity is free', async () => {
    const f = await fixture();
    const pastTrip = await f.trip('CLOSED', past());
    const history = await f.register(pastTrip.id, f.owner.id, 'ATTENDED');
    const pastConfirmed = await f.register((await f.trip('CLOSED', past())).id);
    const waitingIds: string[] = [];
    const cancelledIds: string[] = [];
    for (const status of ['PENDING', 'WAITLIST'] as const) {
      const trip = await f.trip();
      cancelledIds.push((await f.register(trip.id, f.owner.id, status)).id);
      const waiting = await f.register(trip.id, f.admin.id, 'WAITLIST');
      waitingIds.push(waiting.id);
    }
    await me.anonymize(f.owner);
    expect(
      await prisma.tripRegistration.count({
        where: { id: { in: cancelledIds }, status: 'CANCELLED' },
      }),
    ).toBe(2);
    expect(
      await prisma.tripRegistration.count({
        where: { id: waitingIds[1], status: 'WAITLIST' },
      }),
    ).toBe(1);
    expect(
      (await prisma.tripRegistration.findUniqueOrThrow({ where: { id: waitingIds[0] } })).status,
    ).toBe('PENDING');
    expect(await prisma.tripRegistration.findUnique({ where: { id: history.id } })).toMatchObject({
      status: 'ATTENDED',
      comment: null,
    });
    expect(
      (await prisma.tripRegistration.findUniqueOrThrow({ where: { id: pastConfirmed.id } })).status,
    ).toBe('CONFIRMED');
  });

  it('releases event and open-day capacity while preserving past participation', async () => {
    const f = await fixture();
    const event = async (startsAt: Date) =>
      prisma.event.create({
        data: {
          type: 'SEMINAR',
          title: 'Test',
          description: '',
          startsAt,
          endsAt: new Date(startsAt.getTime() + 3600_000),
          location: 'Test',
          capacity: 1,
          createdById: f.admin.id,
        },
      });
    const next = await event(future()),
      previous = await event(past());
    const upcoming = await prisma.eventRegistration.create({
      data: { eventId: next.id, userId: f.owner.id },
    });
    const attended = await prisma.eventRegistration.create({
      data: { eventId: previous.id, userId: f.owner.id, status: 'ATTENDED' },
    });
    const nextDay = await prisma.openDaySession.create({
      data: { startsAt: future(), location: 'Test', capacity: 1 },
    });
    const previousDay = await prisma.openDaySession.create({
      data: { startsAt: past(), location: 'Test', capacity: 1 },
    });
    const upcomingDay = await prisma.openDayRegistration.create({
      data: { sessionId: nextDay.id, userId: f.owner.id },
    });
    const history = await prisma.openDayRegistration.create({
      data: { sessionId: previousDay.id, userId: f.owner.id, attended: true },
    });
    await me.anonymize(f.owner);
    expect(
      (await prisma.eventRegistration.findUniqueOrThrow({ where: { id: upcoming.id } })).status,
    ).toBe('CANCELLED');
    expect(
      (await prisma.eventRegistration.findUniqueOrThrow({ where: { id: attended.id } })).status,
    ).toBe('ATTENDED');
    expect(
      (await prisma.openDayRegistration.findUniqueOrThrow({ where: { id: upcomingDay.id } }))
        .cancelledAt,
    ).not.toBeNull();
    expect(
      await prisma.openDayRegistration.findUnique({ where: { id: history.id } }),
    ).toMatchObject({ attended: true, cancelledAt: null });
    const actor = { ...f.admin, sessionId: randomUUID(), adminVerified: true };
    await expect(events.register(actor, next.id)).resolves.toMatchObject({ status: 'CONFIRMED' });
    await expect(days.register(actor, nextDay.id)).resolves.toMatchObject({ cancelledAt: null });
  });

  it('does not advance a pending cancellation when all places are confirmed', async () => {
    const f = await fixture();
    const trip = await f.trip();
    await f.register(trip.id, f.owner.id, 'PENDING');
    await f.register(trip.id, f.admin.id, 'CONFIRMED');
    const waitingUser = await prisma.user.create({
      data: { ...identity(), fullName: 'Waiting', role: 'VOLUNTEER' },
    });
    const waiting = await f.register(trip.id, waitingUser.id, 'WAITLIST');
    await me.anonymize(f.owner);
    expect(
      (await prisma.tripRegistration.findUniqueOrThrow({ where: { id: waiting.id } })).status,
    ).toBe('WAITLIST');
  });

  it('cancels a future open-day booking even if attendance was marked early and prevents restoration', async () => {
    const f = await fixture();
    const day = await prisma.openDaySession.create({
      data: { startsAt: future(), location: 'Test', capacity: 1 },
    });
    const registration = await prisma.openDayRegistration.create({
      data: { sessionId: day.id, userId: f.owner.id, attended: true },
    });
    await me.anonymize(f.owner);
    const row = await prisma.openDayRegistration.findUniqueOrThrow({
      where: { id: registration.id },
    });
    expect(row.cancelledAt).not.toBeNull();
    expect(row.attended).toBe(true);
    await expect(
      days.attendance({ ...f.admin, sessionId: randomUUID(), adminVerified: true }, row.id, true),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
    expect(
      (await prisma.openDayRegistration.findUniqueOrThrow({ where: { id: row.id } })).cancelledAt,
    ).not.toBeNull();
  });

  it('rolls back account deletion, cancellation and promotion if notification persistence fails', async () => {
    const f = await fixture();
    const trip = await f.trip();
    const registered = await f.register(trip.id);
    const waiting = await f.register(trip.id, f.admin.id, 'WAITLIST');
    const notify = vi
      .spyOn(module.get(NotificationService), 'notify')
      .mockRejectedValueOnce(new Error('synthetic persistence failure'));
    try {
      await expect(me.anonymize(f.owner)).rejects.toThrow('synthetic persistence failure');
    } finally {
      notify.mockRestore();
    }
    expect(
      (await prisma.user.findUniqueOrThrow({ where: { id: f.owner.id } })).anonymizedAt,
    ).toBeNull();
    expect(
      (await prisma.tripRegistration.findUniqueOrThrow({ where: { id: registered.id } })).status,
    ).toBe('CONFIRMED');
    expect(
      (await prisma.tripRegistration.findUniqueOrThrow({ where: { id: waiting.id } })).status,
    ).toBe('WAITLIST');
  });

  it('keeps the same queue behavior for ordinary cancellation and never promotes cancelled trips', async () => {
    const f = await fixture();
    const trip = await f.trip();
    await f.register(trip.id);
    const waiting = await f.register(trip.id, f.admin.id, 'WAITLIST');
    await trips.cancelOwn({ ...f.owner, sessionId: randomUUID(), adminVerified: false }, trip.id);
    expect(
      (await prisma.tripRegistration.findUniqueOrThrow({ where: { id: waiting.id } })).status,
    ).toBe('PENDING');
    const cancelledTrip = await f.trip('CANCELLED');
    await f.register(cancelledTrip.id);
    const cancelledWaiting = await f.register(cancelledTrip.id, f.admin.id, 'WAITLIST');
    await me.anonymize(f.owner);
    expect(
      (await prisma.tripRegistration.findUniqueOrThrow({ where: { id: cancelledWaiting.id } }))
        .status,
    ).toBe('WAITLIST');
  });
  it.skipIf(process.env.PGLITE_TEST === 'true')(
    'serializes account deletion with a concurrent new registration',
    async () => {
      const f = await fixture();
      const trip = await f.trip();
      await f.register(trip.id);
      await Promise.all([
        me.anonymize(f.owner),
        trips.register({ ...f.admin, sessionId: randomUUID(), adminVerified: true }, trip.id),
      ]);
      expect(
        await prisma.tripRegistration.findUnique({
          where: { tripId_userId: { tripId: trip.id, userId: f.owner.id } },
        }),
      ).toMatchObject({ status: 'CANCELLED' });
      expect(
        await prisma.tripRegistration.count({ where: { tripId: trip.id, status: 'CONFIRMED' } }),
      ).toBeLessThanOrEqual(1);
      expect(
        await prisma.tripRegistration.findUnique({
          where: { tripId_userId: { tripId: trip.id, userId: f.admin.id } },
        }),
      ).not.toBeNull();
    },
  );

  it.skipIf(process.env.PGLITE_TEST === 'true')(
    'handles simultaneous deletion of a confirmed participant and waiting curator',
    async () => {
      const f = await fixture();
      const trip = await f.trip();
      await f.register(trip.id);
      await f.register(trip.id, f.admin.id, 'WAITLIST', new Date(Date.now() - 60000));
      await prisma.placeCurator.create({ data: { placeId: f.place.id, userId: f.owner.id } });
      const survivor = await prisma.user.create({
        data: { ...identity(), fullName: 'Waiting survivor', role: 'VOLUNTEER' },
      });
      const waiting = await f.register(trip.id, survivor.id, 'WAITLIST');
      await Promise.all([me.anonymize(f.owner), me.anonymize(f.admin)]);
      expect(
        await prisma.tripRegistration.count({
          where: { tripId: trip.id, userId: { in: [f.owner.id, f.admin.id] }, status: 'CANCELLED' },
        }),
      ).toBe(2);
      expect(
        (await prisma.tripRegistration.findUniqueOrThrow({ where: { id: waiting.id } })).status,
      ).toBe('PENDING');
      expect(
        await prisma.notification.count({
          where: { userId: survivor.id, type: 'RegistrationPromotedFromWaitlist' },
        }),
      ).toBe(1);
    },
  );
});

import 'reflect-metadata';
import { beforeAll, afterAll, describe, expect, it } from 'vitest';
import { Test } from '@nestjs/testing';
import { JwtService } from '@nestjs/jwt';
import type { INestApplication } from '@nestjs/common';
import { createHash, randomUUID } from 'node:crypto';
import request from 'supertest';
import { CONSENT_VERSION, RegistrationStatus, TripStatus } from '@club/shared';
import { AppModule } from '../dist/app.module.js';
import { configureApp } from '../dist/openapi.js';
import { PrismaService } from '../dist/prisma/prisma.service.js';
import { RedisThrottlerStorage } from '../dist/common/throttle.service.js';

type Entry = {
  id: string;
  kind: 'EVENT' | 'TRIP' | 'OPEN_DAY';
  title: string;
  startsAt: Date;
  createdAt: Date;
};
type Registration = { id: string; kind: Entry['kind']; startsAt: string; title: string };
let app: INestApplication;
let prisma: PrismaService;
let userId: string;
let otherUserId: string;
let access: string;
let otherAccess: string;
let placeId: string;
let regionId: string;
let nearestId: string;
const dayIds: string[] = [];
const history: Entry[] = [];
const upcoming: Entry[] = [];
const hour = 3600000;
const future = Date.now() + 20 * 365 * 24 * hour;
const futureAt = (hours: number) => new Date(future + hours * hour);
const createdAt = new Date('2020-01-01T00:00:00Z');
const hash = () => createHash('sha256').update(randomUUID()).digest('hex');
const key = (entry: Pick<Entry, 'id' | 'kind'>) => `${entry.kind}:${entry.id}`;
const ascending = (a: Entry, b: Entry) =>
  a.startsAt.getTime() - b.startsAt.getTime() ||
  a.id.localeCompare(b.id) ||
  a.kind.localeCompare(b.kind);
const descendingHistory = (a: Entry, b: Entry) =>
  b.createdAt.getTime() - a.createdAt.getTime() ||
  a.id.localeCompare(b.id) ||
  a.kind.localeCompare(b.kind);

function get(query: Record<string, unknown> = {}, token = access) {
  return request(app.getHttpServer())
    .get('/api/v1/me/registrations')
    .set('Authorization', `Bearer ${token}`)
    .query(query);
}
async function event(
  title: string,
  startsAt: Date,
  status: RegistrationStatus = RegistrationStatus.CONFIRMED,
  options: { eligible?: boolean; owner?: string; id?: string; createdAt?: Date } = {},
) {
  const row = await prisma.event.create({
    data: {
      createdById: userId,
      type: 'CLUB_EVENT',
      title,
      description: '',
      location: 'Membership test event',
      startsAt,
      endsAt: new Date(startsAt.getTime() + hour),
    },
  });
  const registration = await prisma.eventRegistration.create({
    data: {
      id: options.id,
      eventId: row.id,
      userId: options.owner ?? userId,
      status,
      createdAt: options.createdAt ?? createdAt,
    },
  });
  const entry: Entry = {
    id: registration.id,
    kind: 'EVENT',
    title,
    startsAt,
    createdAt: registration.createdAt,
  };
  if (!options.owner || options.owner === userId) {
    history.push(entry);
    if (options.eligible ?? true) upcoming.push(entry);
  }
  return entry;
}
async function trip(
  title: string,
  startsAt: Date,
  status: RegistrationStatus,
  tripStatus: TripStatus,
  eligible = true,
) {
  const row = await prisma.trip.create({
    data: {
      createdById: userId,
      placeId,
      title,
      description: '',
      startsAt,
      endsAt: new Date(startsAt.getTime() + hour),
      meetingPoint: 'Membership test meeting',
      capacity: 20,
      status: tripStatus,
    },
  });
  const registration = await prisma.tripRegistration.create({
    data: { tripId: row.id, userId, status, createdAt },
  });
  const entry: Entry = {
    id: registration.id,
    kind: 'TRIP',
    title,
    startsAt,
    createdAt: registration.createdAt,
  };
  history.push(entry);
  if (eligible) upcoming.push(entry);
}
async function day(
  startsAt: Date,
  options: { cancelledAt?: Date; attended?: boolean } = {},
  eligible = true,
) {
  const session = await prisma.openDaySession.create({
    data: { startsAt, location: 'Membership test open day', capacity: 20 },
  });
  dayIds.push(session.id);
  const registration = await prisma.openDayRegistration.create({
    data: { sessionId: session.id, userId, createdAt, ...options },
  });
  const entry: Entry = {
    id: registration.id,
    kind: 'OPEN_DAY',
    title: 'День открытых дверей',
    startsAt,
    createdAt: registration.createdAt,
  };
  history.push(entry);
  if (eligible) upcoming.push(entry);
}

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
  async function member(fullName: string) {
    const user = await prisma.user.create({
      data: {
        fullName,
        telegramId: BigInt('0x' + randomUUID().replaceAll('-', '').slice(0, 12)),
        role: 'VOLUNTEER',
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
        expiresAt: new Date(Date.now() + hour),
      },
    });
    const token = await app
      .get(JwtService)
      .signAsync({ sub: user.id, sessionId: session.id, scope: 'access' }, { expiresIn: 3600 });
    return { id: user.id, token };
  }
  const member1 = await member('Upcoming membership tester');
  userId = member1.id;
  access = member1.token;
  const member2 = await member('Other upcoming membership tester');
  otherUserId = member2.id;
  otherAccess = member2.token;
  const region = await prisma.region.create({
    data: { name: 'Upcoming region', slug: randomUUID() },
  });
  regionId = region.id;
  const place = await prisma.place.create({
    data: {
      name: 'Upcoming place',
      slug: randomUUID(),
      type: 'ORPHANAGE',
      regionId,
      city: 'Test',
      description: '',
    },
  });
  placeId = place.id;

  nearestId = (
    await event('Needle nearest event', futureAt(1), RegistrationStatus.CONFIRMED, {
      createdAt: new Date('2010-01-01'),
    })
  ).id;
  await event('Pending event', futureAt(2), RegistrationStatus.PENDING);
  await day(futureAt(2.5));
  await trip('Pending trip', futureAt(3), RegistrationStatus.PENDING, TripStatus.OPEN);
  await event('Needle waitlist event', futureAt(4), RegistrationStatus.WAITLIST);
  await trip('Waitlist trip', futureAt(5), RegistrationStatus.WAITLIST, TripStatus.OPEN);
  await trip('Confirmed open trip', futureAt(6), RegistrationStatus.CONFIRMED, TripStatus.OPEN);
  await trip(
    'Needle confirmed closed trip',
    futureAt(7),
    RegistrationStatus.CONFIRMED,
    TripStatus.CLOSED,
  );
  await event('Tie event B', futureAt(8), RegistrationStatus.CONFIRMED, {
    id: '34fc52c6-47d7-44ca-a9a4-000000000002',
  });
  await event('Tie event A', futureAt(8), RegistrationStatus.CONFIRMED, {
    id: '34fc52c6-47d7-44ca-a9a4-000000000001',
  });

  for (const status of [
    RegistrationStatus.REJECTED,
    RegistrationStatus.CANCELLED,
    RegistrationStatus.ATTENDED,
    RegistrationStatus.NO_SHOW,
  ]) {
    await event(`Needle inactive event ${status}`, futureAt(0.1), status, { eligible: false });
    await trip(
      `Inactive trip registration ${status}`,
      futureAt(0.1),
      status,
      TripStatus.OPEN,
      false,
    );
  }
  for (const status of [
    TripStatus.DRAFT,
    TripStatus.DONE,
    TripStatus.REPORTED,
    TripStatus.CANCELLED,
  ]) {
    await trip(
      `Inactive trip ${status}`,
      futureAt(0.1),
      RegistrationStatus.CONFIRMED,
      status,
      false,
    );
  }
  await event('Past event', new Date('2000-01-01'), RegistrationStatus.CONFIRMED, {
    eligible: false,
  });
  await trip(
    'Past trip',
    new Date('2000-01-01'),
    RegistrationStatus.CONFIRMED,
    TripStatus.OPEN,
    false,
  );
  await day(new Date('2000-01-01'), {}, false);
  await day(futureAt(0.1), { cancelledAt: new Date() }, false);
  await day(futureAt(0.1), { attended: true }, false);
  await event('Just started event', new Date(), RegistrationStatus.CONFIRMED, { eligible: false });
  await event('Other member event', futureAt(0.05), RegistrationStatus.CONFIRMED, {
    owner: otherUserId,
  });

  const filler = Array.from({ length: 105 }, (_, i) => ({
    id: randomUUID(),
    type: 'CLUB_EVENT' as const,
    createdById: userId,
    title: `Later event ${i}`,
    description: '',
    location: 'Membership test filler',
    startsAt: futureAt(100 + i),
    endsAt: futureAt(101 + i),
  }));
  await prisma.event.createMany({ data: filler });
  const registrations = filler.map((row, i) => ({
    id: randomUUID(),
    eventId: row.id,
    userId,
    status: RegistrationStatus.CONFIRMED,
    createdAt: new Date(Date.UTC(2025, 0, 1, 0, i)),
  }));
  await prisma.eventRegistration.createMany({ data: registrations });
  for (let index = 0; index < filler.length; index++) {
    const row = filler[index]!;
    const registration = registrations[index]!;
    const entry: Entry = {
      id: registration.id,
      kind: 'EVENT',
      title: row.title,
      startsAt: row.startsAt,
      createdAt: registration.createdAt,
    };
    history.push(entry);
    upcoming.push(entry);
  }
  upcoming.sort(ascending);
  history.sort(descendingHistory);
});

afterAll(async () => {
  try {
    if (prisma && userId) {
      const members = [userId, otherUserId].filter(Boolean);
      await prisma.eventRegistration.deleteMany({ where: { userId: { in: members } } });
      await prisma.tripRegistration.deleteMany({ where: { userId: { in: members } } });
      await prisma.openDayRegistration.deleteMany({ where: { userId: { in: members } } });
      await prisma.event.deleteMany({ where: { createdById: userId } });
      await prisma.trip.deleteMany({ where: { createdById: userId } });
      await prisma.openDaySession.deleteMany({ where: { id: { in: dayIds } } });
      if (placeId) await prisma.place.delete({ where: { id: placeId } });
      if (regionId) await prisma.region.delete({ where: { id: regionId } });
      await prisma.refreshToken.deleteMany({ where: { userId: { in: members } } });
      await prisma.user.deleteMany({ where: { id: { in: members } } });
    }
  } finally {
    await app?.close();
  }
});

describe('Upcoming memberships', () => {
  it('selects the nearest six across event, trip and open day before limiting a history over 100 rows', async () => {
    const response = await get({ upcoming: true, limit: 6 });
    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({ total: upcoming.length, page: 1, limit: 6 });
    expect(response.body.items.map(key)).toEqual(upcoming.slice(0, 6).map(key));
    expect(response.body.items[0].id).toBe(nearestId);
    expect(new Set(response.body.items.map((entry: Registration) => entry.kind))).toEqual(
      new Set(['EVENT', 'TRIP', 'OPEN_DAY']),
    );
    expect(history.findIndex((entry) => entry.id === nearestId)).toBeGreaterThan(100);
    for (const entry of response.body.items) {
      expect(entry).not.toHaveProperty('active');
      expect(entry).not.toHaveProperty('eligible');
      expect(entry).not.toHaveProperty('searchTitle');
      expect(entry).not.toHaveProperty('tripStatus');
    }
  });

  it('returns only active future registrations with the same total on every page', async () => {
    const rows: Registration[] = [];
    for (const page of [1, 2, 3]) {
      const response = await get({ upcoming: true, limit: 100, page });
      expect(response.status).toBe(200);
      expect(response.body.total).toBe(upcoming.length);
      expect(response.body.items).toHaveLength(
        page === 1 ? 100 : page === 2 ? upcoming.length - 100 : 0,
      );
      rows.push(...response.body.items);
    }
    expect(rows.map(key)).toEqual(upcoming.map(key));
    expect(new Set(rows.map(key)).size).toBe(rows.length);
  });

  it('keeps same-time registration pages stable and reports the total beyond the last page', async () => {
    const first = await get({ upcoming: true, search: 'tie', page: 1, limit: 1 });
    const second = await get({ upcoming: true, search: 'tie', page: 2, limit: 1 });
    const beyond = await get({ upcoming: true, search: 'tie', page: 3, limit: 1 });
    for (const response of [first, second, beyond]) {
      expect(response.status).toBe(200);
      expect(response.body.total).toBe(2);
    }
    expect(first.body.items[0].id).toBe('34fc52c6-47d7-44ca-a9a4-000000000001');
    expect(second.body.items[0].id).toBe('34fc52c6-47d7-44ca-a9a4-000000000002');
    expect(beyond.body.items).toEqual([]);
  });

  it('applies case-insensitive search to eligible rows and their total across all kinds', async () => {
    for (const search of ['NEEDLE', 'ДЕНЬ ОТКРЫТЫХ ДВЕРЕЙ']) {
      const expected = upcoming.filter((entry) =>
        entry.title.toLowerCase().includes(search.toLowerCase()),
      );
      const response = await get({ upcoming: true, search, limit: 100 });
      expect(response.status).toBe(200);
      expect(response.body.total).toBe(expected.length);
      expect(response.body.items.map(key)).toEqual(expected.map(key));
    }
    const missing = await get({ upcoming: true, search: randomUUID() });
    expect(missing.status).toBe(200);
    expect(missing.body.total).toBe(0);
    expect(missing.body.items).toEqual([]);
  });

  it('preserves the complete history order and inactive rows for omitted and false upcoming', async () => {
    const expected = history.slice(0, 100).map(key);
    for (const query of [{ limit: 100 }, { limit: 100, upcoming: false }]) {
      const response = await get(query);
      expect(response.status).toBe(200);
      expect(response.body.total).toBe(history.length);
      expect(response.body.items.map(key)).toEqual(expected);
      expect(response.body.items.some((entry: Registration) => entry.id === nearestId)).toBe(false);
    }
    const response = await get({ upcoming: false, search: 'inactive', limit: 100 });
    const expectedInactive = history.filter((entry) =>
      entry.title.toLowerCase().includes('inactive'),
    );
    expect(response.status).toBe(200);
    expect(response.body.total).toBe(expectedInactive.length);
    expect(response.body.items.map(key)).toEqual(expectedInactive.map(key));
    const days = await get({ upcoming: false, search: 'День открытых дверей', limit: 100 });
    expect(days.status).toBe(200);
    expect(days.body.total).toBe(4);
    expect(days.body.items).toHaveLength(4);
  });

  it('isolates both the selected rows and total by the authenticated member', async () => {
    const response = await get({ upcoming: true, limit: 100 }, otherAccess);
    expect(response.status).toBe(200);
    expect(response.body.total).toBe(1);
    expect(response.body.items).toHaveLength(1);
    expect(response.body.items[0].title).toBe('Other member event');
    expect(
      response.body.items.some((entry: Registration) =>
        upcoming.some((own) => own.id === entry.id),
      ),
    ).toBe(false);
    const anonymous = await request(app.getHttpServer())
      .get('/api/v1/me/registrations')
      .query({ upcoming: true });
    expect(anonymous.status).toBe(401);
  });

  it.each(['yes', '1', 'TRUE', 'falsefalse'])(
    'rejects an invalid upcoming flag %s',
    async (upcoming) => {
      expect((await get({ upcoming })).status).toBe(400);
    },
  );

  it('rejects repeated upcoming flags and inherits pagination limits', async () => {
    expect((await get({ upcoming: ['true', 'false'] })).status).toBe(400);
    expect((await get({ upcoming: true, limit: 101 })).status).toBe(400);
  });
});

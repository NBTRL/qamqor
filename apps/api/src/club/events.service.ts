import { Injectable } from '@nestjs/common';
import { ErrorCode, EventType, RegistrationStatus } from '@club/shared';
import { Prisma } from '../generated/prisma/client.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { AuditService } from '../common/audit.service.js';
import { lockActiveUser } from '../common/active-user.js';
import { ApiException } from '../common/api-exception.js';
import type { Actor } from '../common/http.js';
import { hasPrivateAccess } from '../common/http.js';
import { pageArgs, pageResult, type PageQueryDto } from '../common/query.dto.js';
import { NotificationService } from '../notifications/notification.service.js';
import { assertDates, assertEventRegistration, assertEventType } from './rules.js';
import { projectPlace } from './places.service.js';
import type {
  CalendarQueryDto,
  EventPatchDto,
  EventQueryDto,
  EventWriteDto,
  OpenDayPatchDto,
  OpenDayWriteDto,
} from './club.dto.js';

@Injectable()
export class EventsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly notifications: NotificationService,
  ) {}
  async list(query: EventQueryDto) {
    const where: Prisma.EventWhereInput = {
      type: query.type,
      ...(query.search ? { title: { contains: query.search, mode: 'insensitive' } } : {}),
    };
    const [items, total] = await Promise.all([
      this.prisma.event.findMany({
        where,
        orderBy: [{ startsAt: 'asc' }, { id: 'asc' }],
        ...pageArgs(query),
      }),
      this.prisma.event.count({ where }),
    ]);
    return pageResult(
      items.map(({ createdById: _createdById, ...row }) => row),
      total,
      query,
    );
  }
  async detail(id: string) {
    const row = await this.prisma.event.findUnique({ where: { id } });
    if (!row) throw new ApiException(ErrorCode.NOT_FOUND);
    const { createdById: _createdById, ...data } = row;
    return data;
  }
  async write(actor: Actor, dto: EventWriteDto | EventPatchDto, id?: string) {
    return this.prisma.$transaction(async (tx) => {
      if (id) await tx.$queryRaw`SELECT "id" FROM "events" WHERE "id"=${id}::uuid FOR UPDATE`;
      const current = id ? await tx.event.findUniqueOrThrow({ where: { id } }) : null;
      const merged = { ...current, ...dto };
      assertEventType(merged.type!);
      const startsAt = new Date(merged.startsAt!),
        endsAt = new Date(merged.endsAt!);
      assertDates(startsAt, endsAt);
      if (
        id &&
        merged.capacity !== null &&
        merged.capacity !== undefined &&
        merged.capacity <
          (await tx.eventRegistration.count({ where: { eventId: id, status: 'CONFIRMED' } }))
      )
        throw new ApiException(ErrorCode.EVENT_FULL);
      const data = { ...dto, startsAt, endsAt };
      const row = id
        ? await tx.event.update({ where: { id }, data })
        : await tx.event.create({
            data: {
              ...data,
              type: merged.type!,
              title: merged.title!,
              description: merged.description!,
              location: merged.location!,
              createdById: actor.id,
            },
          });
      await this.audit.record(tx, actor.id, id ? 'UPDATED' : 'CREATED', 'Event', row.id, {
        fields: Object.keys(dto),
      });
      return row;
    });
  }
  async register(actor: Actor, id: string) {
    return this.prisma.$transaction(async (tx) => {
      const user = await lockActiveUser(tx, actor.id);
      await tx.$queryRaw`SELECT "id" FROM "events" WHERE "id"=${id}::uuid FOR UPDATE`;
      const event = await tx.event.findUnique({ where: { id } });
      if (!event) throw new ApiException(ErrorCode.NOT_FOUND);
      assertEventRegistration(user.role, event.volunteersOnly);
      if (event.startsAt.getTime() <= Date.now())
        throw new ApiException(ErrorCode.INVALID_TRANSITION);
      if (
        await tx.eventRegistration.findUnique({
          where: { eventId_userId: { eventId: id, userId: actor.id } },
        })
      )
        throw new ApiException(ErrorCode.EVENT_ALREADY_REGISTERED);
      if (
        event.capacity !== null &&
        (await tx.eventRegistration.count({ where: { eventId: id, status: 'CONFIRMED' } })) >=
          event.capacity
      )
        throw new ApiException(ErrorCode.EVENT_FULL);
      const row = await tx.eventRegistration.create({
        data: { eventId: id, userId: actor.id, status: 'CONFIRMED' },
      });
      await this.audit.record(tx, actor.id, 'CREATED', 'EventRegistration', row.id, {
        status: 'CONFIRMED',
      });
      await this.notifications.notify(tx, [actor.id], 'EventRegistered', {
        eventId: id,
        title: event.title,
        startsAt: event.startsAt.toISOString(),
      });
      return row;
    });
  }
  async cancel(actor: Actor, id: string) {
    return this.prisma.$transaction(async (tx) => {
      await lockActiveUser(tx, actor.id);
      await tx.$queryRaw`SELECT "id" FROM "events" WHERE "id"=${id}::uuid FOR UPDATE`;
      const row = await tx.eventRegistration.findUnique({
        where: { eventId_userId: { eventId: id, userId: actor.id } },
        include: { event: true },
      });
      if (!row) throw new ApiException(ErrorCode.NOT_FOUND);
      await this.audit.transition(
        tx,
        actor.id,
        'EventRegistration',
        row.id,
        'RegistrationStatus',
        row.status,
        'CANCELLED',
      );
      const result = await tx.eventRegistration.update({
        where: { id: row.id },
        data: { status: 'CANCELLED' },
      });
      await this.notifications.notify(tx, [actor.id], 'EventCancelled', {
        eventId: id,
        title: row.event.title,
        startsAt: row.event.startsAt.toISOString(),
      });
      return result;
    });
  }
  async registrationStatus(actor: Actor, id: string, status: RegistrationStatus) {
    return this.prisma.$transaction(async (tx) => {
      const initial = await tx.eventRegistration.findUniqueOrThrow({ where: { id } });
      await tx.$queryRaw`SELECT "id" FROM "events" WHERE "id"=${initial.eventId}::uuid FOR UPDATE`;
      const row = await tx.eventRegistration.findUniqueOrThrow({
        where: { id },
        include: { event: true },
      });
      this.audit.assertTransition('RegistrationStatus', row.status, status);
      if (
        (status === 'ATTENDED' || status === 'NO_SHOW') &&
        row.event.startsAt.getTime() > Date.now()
      )
        throw new ApiException(ErrorCode.INVALID_TRANSITION);
      if (
        status === 'CONFIRMED' &&
        row.event.capacity !== null &&
        (await tx.eventRegistration.count({
          where: { eventId: row.eventId, status: 'CONFIRMED' },
        })) >= row.event.capacity
      )
        throw new ApiException(ErrorCode.EVENT_FULL);
      await this.audit.transition(
        tx,
        actor.id,
        'EventRegistration',
        id,
        'RegistrationStatus',
        row.status,
        status,
      );
      return tx.eventRegistration.update({ where: { id }, data: { status } });
    });
  }
  async calendar(query: CalendarQueryDto, actor?: Actor) {
    const from = query.from ? new Date(query.from) : new Date(),
      to = query.to ? new Date(query.to) : new Date(from.getTime() + 90 * 86400_000);
    if (to <= from || to.getTime() - from.getTime() > 366 * 86400_000)
      throw new ApiException(ErrorCode.VALIDATION_ERROR, {
        reason: 'Диапазон календаря — до 366 дней.',
      });
    const date = { gte: from, lte: to };
    const page = await this.prisma.$queryRaw<
      Array<{ id: string; kind: string; startsAt: Date }>
    >(Prisma.sql`
      SELECT * FROM (
        SELECT "id", 'TRIP' AS kind, "startsAt" FROM "trips" WHERE "startsAt">=${from} AND "startsAt"<=${to} AND status IN ('OPEN','CLOSED','DONE','REPORTED')
        UNION ALL SELECT "id", 'EVENT', "startsAt" FROM "events" WHERE "startsAt">=${from} AND "startsAt"<=${to} ${actor ? Prisma.empty : Prisma.sql`AND "isPublic"=true`}
      ) calendar ORDER BY "startsAt", "id" LIMIT ${query.limit} OFFSET ${(query.page - 1) * query.limit}`);
    const [trips, events] = await Promise.all([
      this.prisma.trip.findMany({
        where: { id: { in: page.filter((row) => row.kind === 'TRIP').map((row) => row.id) } },
        include: { place: { include: { region: true } } },
        orderBy: [{ startsAt: 'asc' }, { id: 'asc' }],
      }),
      this.prisma.event.findMany({
        where: { id: { in: page.filter((row) => row.kind === 'EVENT').map((row) => row.id) } },
        orderBy: [{ startsAt: 'asc' }, { id: 'asc' }],
      }),
    ]);
    const rows = [
      ...trips.map((trip) => ({
        id: trip.id,
        type: EventType.TRIP,
        title: actor ? trip.title : 'Поездка',
        startsAt: trip.startsAt,
        region: {
          id: trip.place.region.id,
          name: trip.place.region.name,
          slug: trip.place.region.slug,
        },
        ...(actor
          ? {
              endsAt: trip.endsAt,
              place: projectPlace(trip.place, hasPrivateAccess(actor)),
              ...(hasPrivateAccess(actor) ? { meetingPoint: trip.meetingPoint } : {}),
            }
          : {}),
      })),
      ...events.map((event) => ({
        id: event.id,
        type: event.type,
        title: event.title,
        startsAt: event.startsAt,
        endsAt: event.endsAt,
        location: event.location,
      })),
    ].sort((a, b) => a.startsAt.getTime() - b.startsAt.getTime() || a.id.localeCompare(b.id));
    const counts = await Promise.all([
      this.prisma.trip.count({
        where: { startsAt: date, status: { in: ['OPEN', 'CLOSED', 'DONE', 'REPORTED'] } },
      }),
      this.prisma.event.count({ where: { startsAt: date, ...(!actor ? { isPublic: true } : {}) } }),
    ]);
    return pageResult(rows, counts[0] + counts[1], query);
  }
}

@Injectable()
export class OpenDaysService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly notifications: NotificationService,
  ) {}
  async list(query: PageQueryDto, admin = false) {
    const where: Prisma.OpenDaySessionWhereInput = {
      ...(admin ? {} : { startsAt: { gte: new Date() } }),
      ...(query.search ? { location: { contains: query.search, mode: 'insensitive' } } : {}),
    };
    const [items, total] = await Promise.all([
      this.prisma.openDaySession.findMany({
        where,
        orderBy: [{ startsAt: 'asc' }, { id: 'asc' }],
        ...pageArgs(query),
      }),
      this.prisma.openDaySession.count({ where }),
    ]);
    return pageResult(items, total, query);
  }
  async write(actor: Actor, dto: OpenDayWriteDto | OpenDayPatchDto, id?: string) {
    return this.prisma.$transaction(async (tx) => {
      if (id) {
        await tx.$queryRaw`SELECT "id" FROM "open_day_sessions" WHERE "id"=${id}::uuid FOR UPDATE`;
        if (
          dto.capacity !== undefined &&
          dto.capacity <
            (await tx.openDayRegistration.count({ where: { sessionId: id, cancelledAt: null } }))
        )
          throw new ApiException(ErrorCode.OPEN_DAY_FULL);
      }
      const row = id
        ? await tx.openDaySession.update({ where: { id }, data: dto })
        : await tx.openDaySession.create({ data: dto as OpenDayWriteDto });
      await this.audit.record(tx, actor.id, id ? 'UPDATED' : 'CREATED', 'OpenDaySession', row.id, {
        fields: Object.keys(dto),
      });
      return row;
    });
  }
  async register(actor: Actor, id: string) {
    return this.prisma.$transaction(async (tx) => {
      await lockActiveUser(tx, actor.id);
      await tx.$queryRaw`SELECT "id" FROM "open_day_sessions" WHERE "id"=${id}::uuid FOR UPDATE`;
      const session = await tx.openDaySession.findUnique({ where: { id } });
      if (!session) throw new ApiException(ErrorCode.NOT_FOUND);
      if (session.startsAt <= new Date()) throw new ApiException(ErrorCode.INVALID_TRANSITION);
      const existing = await tx.openDayRegistration.findUnique({
        where: { sessionId_userId: { sessionId: id, userId: actor.id } },
      });
      if (existing && !existing.cancelledAt)
        throw new ApiException(ErrorCode.OPEN_DAY_ALREADY_REGISTERED);
      if (
        (await tx.openDayRegistration.count({ where: { sessionId: id, cancelledAt: null } })) >=
        session.capacity
      )
        throw new ApiException(ErrorCode.OPEN_DAY_FULL);
      const row = await tx.openDayRegistration.upsert({
        where: { sessionId_userId: { sessionId: id, userId: actor.id } },
        create: { sessionId: id, userId: actor.id },
        update: { cancelledAt: null },
      });
      await this.audit.record(tx, actor.id, 'REGISTERED', 'OpenDayRegistration', row.id);
      await this.notifications.notify(tx, [actor.id], 'OpenDayRegistered', {
        sessionId: id,
        title: 'День открытых дверей',
        startsAt: session.startsAt.toISOString(),
      });
      return row;
    });
  }
  async cancel(actor: Actor, id: string) {
    return this.prisma.$transaction(async (tx) => {
      await lockActiveUser(tx, actor.id);
      await tx.$queryRaw`SELECT "id" FROM "open_day_sessions" WHERE "id"=${id}::uuid FOR UPDATE`;
      const row = await tx.openDayRegistration.findUniqueOrThrow({
        where: { sessionId_userId: { sessionId: id, userId: actor.id } },
      });
      if (row.attended) throw new ApiException(ErrorCode.INVALID_TRANSITION);
      await this.audit.record(tx, actor.id, 'CANCELLED', 'OpenDayRegistration', row.id);
      return tx.openDayRegistration.update({
        where: { id: row.id },
        data: { cancelledAt: new Date() },
      });
    });
  }
  async attendance(actor: Actor, registrationId: string, attended: boolean) {
    return this.prisma.$transaction(async (tx) => {
      const row = await tx.openDayRegistration.update({
        where: { id: registrationId },
        data: { attended, ...(attended ? { cancelledAt: null } : {}) },
      });
      await this.audit.record(
        tx,
        actor.id,
        'ATTENDANCE_MARKED',
        'OpenDayRegistration',
        registrationId,
        { attended },
      );
      return row;
    });
  }
}

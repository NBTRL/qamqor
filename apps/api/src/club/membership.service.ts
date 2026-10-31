import { Injectable } from '@nestjs/common';
import { Prisma } from '../generated/prisma/client.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { pageResult } from '../common/query.dto.js';
import { hasPrivateAccess, type Actor } from '../common/http.js';
import { projectPlace } from './places.service.js';
import type { MeRegistrationQueryDto } from './club.dto.js';

@Injectable()
export class MembershipService {
  constructor(private readonly prisma: PrismaService) {}
  async list(actor: Actor, query: MeRegistrationQueryDto) {
    const now = new Date();
    const entries = Prisma.sql`
      SELECT r."id", r."tripId" AS "entityId", 'TRIP' AS kind,
        r."status"::text AS status, r."createdAt", t."title" AS "searchTitle", t."startsAt",
        (r."status"::text IN ('PENDING', 'CONFIRMED', 'WAITLIST') AND t."status"::text IN ('OPEN', 'CLOSED')) AS active
      FROM "trip_registrations" r JOIN "trips" t ON t."id"=r."tripId"
      WHERE r."userId"=${actor.id}::uuid
      UNION ALL
      SELECT r."id", r."eventId", 'EVENT', r."status"::text, r."createdAt", e."title", e."startsAt",
        r."status"::text IN ('PENDING', 'CONFIRMED', 'WAITLIST')
      FROM "event_registrations" r JOIN "events" e ON e."id"=r."eventId"
      WHERE r."userId"=${actor.id}::uuid
      UNION ALL
      SELECT r."id", r."sessionId", 'OPEN_DAY', NULL::text, r."createdAt", 'День открытых дверей', d."startsAt",
        r."cancelledAt" IS NULL AND NOT r.attended
      FROM "open_day_registrations" r JOIN "open_day_sessions" d ON d."id"=r."sessionId"
      WHERE r."userId"=${actor.id}::uuid`;
    const filtered = Prisma.sql`FROM (${entries}) entries
      WHERE strpos(lower("searchTitle"),lower(${query.search ?? ''}))>0
      ${query.upcoming ? Prisma.sql`AND active AND "startsAt">${now}` : Prisma.empty}`;
    const order = query.upcoming
      ? Prisma.sql`"startsAt" ASC, "id" ASC, kind ASC`
      : Prisma.sql`"createdAt" DESC, "id" ASC, kind ASC`;
    const [rows, counts] = await Promise.all([
      this.prisma.$queryRaw<
        Array<{
          id: string;
          entityId: string;
          kind: 'TRIP' | 'EVENT' | 'OPEN_DAY';
          status: string | null;
          createdAt: Date;
        }>
      >(Prisma.sql`SELECT "id","entityId",kind,status,"createdAt" ${filtered}
        ORDER BY ${order} LIMIT ${query.limit} OFFSET ${(query.page - 1) * query.limit}`),
      this.prisma.$queryRaw<Array<{ total: number }>>(
        Prisma.sql`SELECT COUNT(*)::integer AS total ${filtered}`,
      ),
    ]);
    const items = await Promise.all(
      rows.map(async (row) => {
        if (row.kind === 'TRIP') {
          const trip = await this.prisma.trip.findUniqueOrThrow({
            where: { id: row.entityId },
            include: { place: { include: { region: true } } },
          });
          return {
            ...row,
            title: trip.title,
            startsAt: trip.startsAt,
            place: projectPlace(trip.place, hasPrivateAccess(actor)),
            ...(hasPrivateAccess(actor) ? { meetingPoint: trip.meetingPoint } : {}),
          };
        }
        if (row.kind === 'EVENT') {
          const event = await this.prisma.event.findUniqueOrThrow({ where: { id: row.entityId } });
          return { ...row, title: event.title, startsAt: event.startsAt, location: event.location };
        }
        const day = await this.prisma.openDayRegistration.findUniqueOrThrow({
          where: { id: row.id },
          include: { session: true },
        });
        return {
          ...row,
          title: 'День открытых дверей',
          startsAt: day.session.startsAt,
          location: day.session.location,
          attended: day.attended,
          cancelledAt: day.cancelledAt,
        };
      }),
    );
    return pageResult(items, counts[0]!.total, query);
  }
}

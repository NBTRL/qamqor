import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';
import { pageResult, type PageQueryDto } from '../common/query.dto.js';
import { hasPrivateAccess, type Actor } from '../common/http.js';
import { projectPlace } from './places.service.js';

@Injectable()
export class MembershipService {
  constructor(private readonly prisma: PrismaService) {}
  async list(actor: Actor, query: PageQueryDto) {
    const rows = await this.prisma.$queryRaw<
      Array<{
        id: string;
        entityId: string;
        kind: 'TRIP' | 'EVENT' | 'OPEN_DAY';
        status: string | null;
        createdAt: Date;
      }>
    >`
      SELECT "id","entityId",kind,status,"createdAt" FROM (
        SELECT r."id",r."tripId" AS "entityId",'TRIP' AS kind,r."status"::text AS status,r."createdAt",t."title" AS "searchTitle" FROM "trip_registrations" r JOIN "trips" t ON t."id"=r."tripId" WHERE r."userId"=${actor.id}::uuid
        UNION ALL SELECT r."id",r."eventId",'EVENT',r."status"::text,r."createdAt",e."title" FROM "event_registrations" r JOIN "events" e ON e."id"=r."eventId" WHERE r."userId"=${actor.id}::uuid
        UNION ALL SELECT "id","sessionId",'OPEN_DAY',NULL::text,"createdAt",'День открытых дверей' FROM "open_day_registrations" WHERE "userId"=${actor.id}::uuid
      ) entries WHERE strpos(lower("searchTitle"),lower(${query.search ?? ''}))>0 ORDER BY "createdAt" DESC,"id" ASC LIMIT ${query.limit} OFFSET ${(query.page - 1) * query.limit}`;
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
    const counts = await Promise.all([
      this.prisma.tripRegistration.count({
        where: {
          userId: actor.id,
          ...(query.search
            ? { trip: { title: { contains: query.search, mode: 'insensitive' } } }
            : {}),
        },
      }),
      this.prisma.eventRegistration.count({
        where: {
          userId: actor.id,
          ...(query.search
            ? { event: { title: { contains: query.search, mode: 'insensitive' } } }
            : {}),
        },
      }),
      'День открытых дверей'
        .toLocaleLowerCase('ru-RU')
        .includes((query.search ?? '').toLocaleLowerCase('ru-RU'))
        ? this.prisma.openDayRegistration.count({ where: { userId: actor.id } })
        : Promise.resolve(0),
    ]);
    return pageResult(
      items,
      counts.reduce((sum, n) => sum + n, 0),
      query,
    );
  }
}

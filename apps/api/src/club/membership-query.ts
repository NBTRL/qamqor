import { Prisma } from '../generated/prisma/client.js';
import type { PrismaService } from '../prisma/prisma.service.js';
import type { MeRegistrationQueryDto } from './club.dto.js';

// Shared selection, eligibility and ordering for the cabinet and Telegram.
export async function membershipEntries(
  prisma: PrismaService,
  userId: string,
  query: MeRegistrationQueryDto,
) {
  const now = new Date();
  const entries = Prisma.sql`
      SELECT r."id", r."tripId" AS "entityId", 'TRIP' AS kind,
        r."status"::text AS status, r."createdAt", t."title" AS "searchTitle", t."startsAt",
        (r."status"::text IN ('PENDING', 'CONFIRMED', 'WAITLIST') AND t."status"::text IN ('OPEN', 'CLOSED')) AS active
      FROM "trip_registrations" r JOIN "trips" t ON t."id"=r."tripId"
      WHERE r."userId"=${userId}::uuid
      UNION ALL
      SELECT r."id", r."eventId", 'EVENT', r."status"::text, r."createdAt", e."title", e."startsAt",
        r."status"::text IN ('PENDING', 'CONFIRMED', 'WAITLIST')
      FROM "event_registrations" r JOIN "events" e ON e."id"=r."eventId"
      WHERE r."userId"=${userId}::uuid
      UNION ALL
      SELECT r."id", r."sessionId", 'OPEN_DAY', NULL::text, r."createdAt", 'День открытых дверей', d."startsAt",
        r."cancelledAt" IS NULL AND NOT r.attended
      FROM "open_day_registrations" r JOIN "open_day_sessions" d ON d."id"=r."sessionId"
      WHERE r."userId"=${userId}::uuid`;
  const filtered = Prisma.sql`FROM (${entries}) entries
      WHERE strpos(lower("searchTitle"),lower(${query.search ?? ''}))>0
      ${query.upcoming ? Prisma.sql`AND active AND "startsAt">${now}` : Prisma.empty}`;
  const order = query.upcoming
    ? Prisma.sql`"startsAt" ASC, "id" ASC, kind ASC`
    : Prisma.sql`"createdAt" DESC, "id" ASC, kind ASC`;
  const [rows, counts] = await Promise.all([
    prisma.$queryRaw<
      Array<{
        id: string;
        entityId: string;
        kind: 'TRIP' | 'EVENT' | 'OPEN_DAY';
        status: string | null;
        createdAt: Date;
        title: string;
        startsAt: Date;
      }>
    >(Prisma.sql`SELECT "id","entityId",kind,status,"createdAt","searchTitle" AS title,"startsAt" ${filtered}
        ORDER BY ${order} LIMIT ${query.limit} OFFSET ${(query.page - 1) * query.limit}`),
    prisma.$queryRaw<Array<{ total: number }>>(
      Prisma.sql`SELECT COUNT(*)::integer AS total ${filtered}`,
    ),
  ]);
  return { rows, total: counts[0]!.total };
}

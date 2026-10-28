import { Injectable } from '@nestjs/common';
import { STAT_KEYS } from '@club/shared';
import { PrismaService } from '../prisma/prisma.service.js';
import { RedisService } from '../common/redis.service.js';
import { AuditService } from '../common/audit.service.js';
import type { Actor } from '../common/http.js';

type Stats = Record<(typeof STAT_KEYS)[number], number>;
@Injectable()
export class StatsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
    private readonly audit: AuditService,
  ) {}
  async get(): Promise<Stats> {
    const key = this.redis.key('public-stats');
    const cached = await this.redis.client.get(key);
    const base = cached ? (JSON.parse(cached) as Stats) : await this.compute();
    if (!cached) await this.redis.client.set(key, JSON.stringify(base), 'EX', 600);
    // Переопределения читаются после кэша: параллельный расчет не восстановит старые значения.
    const overrides = await this.prisma.statOverride.findMany();
    const result = { ...base };
    for (const override of overrides)
      if ((STAT_KEYS as readonly string[]).includes(override.key))
        result[override.key as keyof Stats] = override.value;
    return result;
  }
  private async compute(): Promise<Stats> {
    const now = new Date(),
      from = new Date(now);
    from.setUTCFullYear(from.getUTCFullYear() - 1);
    const [places, curators, events, classes, beneficiaries, trips, participants] =
      await Promise.all([
        this.prisma.place.count({ where: { isActive: true } }),
        this.prisma.placeCurator.groupBy({
          by: ['userId'],
          where: {
            user: { role: 'VOLUNTEER', isBlocked: false, anonymizedAt: null },
            place: { isActive: true },
          },
        }),
        this.prisma.event.count({ where: { startsAt: { gte: from, lte: now } } }),
        this.prisma.event.count({
          where: { type: 'MASTER_CLASS', startsAt: { gte: from, lte: now } },
        }),
        this.prisma.place.aggregate({
          where: { isActive: true },
          _sum: { beneficiariesCount: true },
        }),
        this.prisma.trip.count({ where: { status: { in: ['DONE', 'REPORTED'] } } }),
        this.prisma.$queryRaw<
          Array<{ total: bigint }>
        >`SELECT COUNT(DISTINCT "userId") AS total FROM (
        SELECT r."userId" FROM "trip_registrations" r JOIN "trips" t ON t.id=r."tripId" WHERE r.status='ATTENDED' AND t."startsAt">=${from} AND t."startsAt"<=${now}
        UNION SELECT r."userId" FROM "event_registrations" r JOIN "events" e ON e.id=r."eventId" WHERE r.status='ATTENDED' AND e."startsAt">=${from} AND e."startsAt"<=${now}
      ) participants`,
      ]);
    return {
      places,
      curators: curators.length,
      events12Months: events,
      masterClasses12Months: classes,
      uniqueParticipants12Months: Number(participants[0]?.total ?? 0n),
      beneficiaries: beneficiaries._sum.beneficiariesCount ?? 0,
      trips,
    };
  }
  async overrides() {
    const items = await this.prisma.statOverride.findMany({ orderBy: { key: 'asc' } });
    return { items, total: items.length, page: 1, limit: STAT_KEYS.length };
  }
  async write(
    actor: Actor,
    items: Array<{ key: (typeof STAT_KEYS)[number]; value: number | null }>,
  ) {
    await this.prisma.$transaction(async (tx) => {
      for (const item of items) {
        if (item.value === null) await tx.statOverride.deleteMany({ where: { key: item.key } });
        else
          await tx.statOverride.upsert({
            where: { key: item.key },
            create: { key: item.key, value: item.value },
            update: { value: item.value },
          });
      }
      await this.audit.record(tx, actor.id, 'STATS_OVERRIDDEN', 'StatOverride', 'club', {
        keys: items.map((item) => item.key),
      });
    });
    await this.redis.client.del(this.redis.key('public-stats'));
    return this.overrides();
  }
}

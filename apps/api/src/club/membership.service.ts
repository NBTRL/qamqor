import { Injectable } from '@nestjs/common';
import { membershipEntries } from './membership-query.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { pageResult } from '../common/query.dto.js';
import { hasPrivateAccess, type Actor } from '../common/http.js';
import { projectPlace } from './places.service.js';
import type { MeRegistrationQueryDto } from './club.dto.js';

@Injectable()
export class MembershipService {
  constructor(private readonly prisma: PrismaService) {}
  async list(actor: Actor, query: MeRegistrationQueryDto) {
    const { rows, total } = await membershipEntries(this.prisma, actor.id, query);
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
          return {
            ...row,
            title: event.title,
            startsAt: event.startsAt,
            location: event.location,
            entityCancelledAt: event.cancelledAt,
            cancelReason: event.cancelReason,
          };
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
          entityCancelledAt: day.session.cancelledAt,
          cancelReason: day.session.cancelReason,
          attended: day.attended,
          cancelledAt: day.cancelledAt,
        };
      }),
    );
    return pageResult(items, total, query);
  }
}

import type { Prisma, Trip } from '../generated/prisma/client.js';
import type { AuditService, Tx } from '../common/audit.service.js';
import type { NotificationService } from '../notifications/notification.service.js';

const eligibleUser = {
  isBlocked: false,
  anonymizedAt: null,
  role: { in: ['VOLUNTEER', 'ADMIN'] },
} satisfies Prisma.UserWhereInput;

/** Pending invitations reserve admission; confirmation still needs a curator's decision. */
export function occupiedTripPlaces(tx: Tx, tripId: string): Promise<number> {
  return tx.tripRegistration.count({
    where: {
      tripId,
      OR: [{ status: 'CONFIRMED' }, { status: 'PENDING', user: eligibleUser }],
    },
  });
}

/** The caller must hold the Trip row lock for the entire allocation/promotion. */
export async function promoteTripWaitlist(
  tx: Tx,
  audit: AuditService,
  notifications: NotificationService,
  trip: Pick<Trip, 'id' | 'placeId' | 'title' | 'startsAt' | 'status' | 'capacity'>,
  now = new Date(),
): Promise<void> {
  if (!['OPEN', 'CLOSED'].includes(trip.status) || trip.startsAt <= now) return;
  const available = trip.capacity - (await occupiedTripPlaces(tx, trip.id));
  if (available <= 0) return;
  const waiting = await tx.tripRegistration.findMany({
    where: {
      tripId: trip.id,
      status: 'WAITLIST',
      user: eligibleUser,
    },
    orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    take: available,
  });
  if (!waiting.length) return;
  const curators = await tx.placeCurator.findMany({
    where: { placeId: trip.placeId, user: eligibleUser },
    select: { userId: true },
  });
  for (const row of waiting) {
    await audit.transition(
      tx,
      null,
      'TripRegistration',
      row.id,
      'RegistrationStatus',
      'WAITLIST',
      'PENDING',
    );
    await tx.tripRegistration.update({ where: { id: row.id }, data: { status: 'PENDING' } });
    await notifications.notify(
      tx,
      [row.userId, ...curators.map((curator) => curator.userId)],
      'RegistrationPromotedFromWaitlist',
      { tripId: trip.id, title: trip.title, startsAt: trip.startsAt.toISOString() },
    );
  }
}

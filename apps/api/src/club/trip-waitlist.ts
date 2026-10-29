import type { Trip } from '../generated/prisma/client.js';
import type { AuditService, Tx } from '../common/audit.service.js';
import type { NotificationService } from '../notifications/notification.service.js';

/** The caller must hold the Trip row lock for the entire cancellation/promotion. */
export async function promoteTripWaitlist(
  tx: Tx,
  audit: AuditService,
  notifications: NotificationService,
  trip: Pick<Trip, 'id' | 'placeId' | 'title' | 'startsAt' | 'status' | 'capacity'>,
  now = new Date(),
): Promise<void> {
  if (
    !['OPEN', 'CLOSED'].includes(trip.status) ||
    trip.startsAt <= now ||
    (await tx.tripRegistration.count({ where: { tripId: trip.id, status: 'CONFIRMED' } })) >=
      trip.capacity
  )
    return;
  const waiting = await tx.tripRegistration.findFirst({
    where: {
      tripId: trip.id,
      status: 'WAITLIST',
      user: { isBlocked: false, anonymizedAt: null, role: { in: ['VOLUNTEER', 'ADMIN'] } },
    },
    orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
  });
  if (!waiting) return;
  await audit.transition(
    tx,
    null,
    'TripRegistration',
    waiting.id,
    'RegistrationStatus',
    'WAITLIST',
    'PENDING',
  );
  await tx.tripRegistration.update({ where: { id: waiting.id }, data: { status: 'PENDING' } });
  const curators = await tx.placeCurator.findMany({
    where: { placeId: trip.placeId },
    select: { userId: true },
  });
  await notifications.notify(
    tx,
    [waiting.userId, ...curators.map((row) => row.userId)],
    'RegistrationPromotedFromWaitlist',
    { tripId: trip.id, title: trip.title, startsAt: trip.startsAt.toISOString() },
  );
}

import type { AuditService, Tx } from '../common/audit.service.js';
import type { NotificationService } from '../notifications/notification.service.js';
import { promoteTripWaitlist } from './trip-waitlist.js';

const active = ['PENDING', 'CONFIRMED', 'WAITLIST'] as const;

/** Called after locking the User and updating their eligibility in the same transaction. */
export async function cancelFutureRegistrations(
  tx: Tx,
  audit: AuditService,
  notifications: NotificationService,
  userId: string,
  actorId: string,
  now: Date,
  scope: 'ALL' | 'VOLUNTEER_ONLY' = 'ALL',
): Promise<void> {
  // Match registration's parent locks, and use stable order for multi-row cleanup.
  const trips = await tx.tripRegistration.findMany({
    where: { userId, status: { in: [...active] }, trip: { startsAt: { gt: now } } },
    orderBy: { tripId: 'asc' },
  });
  for (const initial of trips) {
    await tx.$queryRaw`SELECT "id" FROM "trips" WHERE "id"=${initial.tripId}::uuid FOR UPDATE`;
    const row = await tx.tripRegistration.findUniqueOrThrow({
      where: { id: initial.id },
      include: { trip: true },
    });
    // Re-read after the lock: a cancellation or date change may have committed.
    if (row.trip.startsAt <= now || !active.some((status) => status === row.status)) continue;
    await audit.transition(
      tx,
      actorId,
      'TripRegistration',
      row.id,
      'RegistrationStatus',
      row.status,
      'CANCELLED',
    );
    await tx.tripRegistration.update({ where: { id: row.id }, data: { status: 'CANCELLED' } });
    await notifications.notify(tx, [userId], 'RegistrationCancelled', {
      tripId: row.trip.id,
      title: row.trip.title,
      startsAt: row.trip.startsAt.toISOString(),
    });
    if (row.status === 'CONFIRMED' || row.status === 'PENDING')
      await promoteTripWaitlist(tx, audit, notifications, row.trip, now);
  }

  const events = await tx.eventRegistration.findMany({
    where: { userId, status: { in: [...active] }, event: { startsAt: { gt: now } } },
    orderBy: { eventId: 'asc' },
  });
  for (const initial of events) {
    await tx.$queryRaw`SELECT "id" FROM "events" WHERE "id"=${initial.eventId}::uuid FOR UPDATE`;
    const row = await tx.eventRegistration.findUniqueOrThrow({
      where: { id: initial.id },
      include: { event: true },
    });
    if (
      row.event.startsAt <= now ||
      !active.some((status) => status === row.status) ||
      (scope === 'VOLUNTEER_ONLY' && !row.event.volunteersOnly)
    )
      continue;
    await audit.transition(
      tx,
      actorId,
      'EventRegistration',
      row.id,
      'RegistrationStatus',
      row.status,
      'CANCELLED',
    );
    await tx.eventRegistration.update({ where: { id: row.id }, data: { status: 'CANCELLED' } });
    await notifications.notify(tx, [userId], 'EventCancelled', {
      eventId: row.event.id,
      title: row.event.title,
      startsAt: row.event.startsAt.toISOString(),
    });
  }

  if (scope === 'VOLUNTEER_ONLY') return;
  const days = await tx.openDayRegistration.findMany({
    where: { userId, cancelledAt: null, session: { startsAt: { gt: now } } },
    orderBy: { sessionId: 'asc' },
  });
  for (const initial of days) {
    await tx.$queryRaw`SELECT "id" FROM "open_day_sessions" WHERE "id"=${initial.sessionId}::uuid FOR UPDATE`;
    const row = await tx.openDayRegistration.findUniqueOrThrow({
      where: { id: initial.id },
      include: { session: true },
    });
    if (row.session.startsAt <= now || row.cancelledAt) continue;
    await audit.record(tx, actorId, 'CANCELLED', 'OpenDayRegistration', row.id);
    await tx.openDayRegistration.update({ where: { id: row.id }, data: { cancelledAt: now } });
  }
}

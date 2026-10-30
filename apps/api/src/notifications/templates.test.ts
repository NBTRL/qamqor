import { describe, expect, it } from 'vitest';
import { NOTIFICATION_TYPES } from '@club/shared';
import { notificationMessage } from './templates.js';

const origin = 'https://club.example.test';

describe('Notification destinations', () => {
  it('opens the application for a decision notification', () => {
    const message = notificationMessage(
      'ApplicationStatusChanged',
      { title: 'Заявка', statusLabel: 'Принята' },
      origin,
    );
    expect(message.text).toContain(`Подробнее: ${origin}/cabinet/application`);
    expect(message.text).toContain('Новый статус: Принята.');
  });

  it.each(['OpenDayRegistered', 'OpenDayReminder'] as const)(
    '%s opens the existing registrations page',
    (type) => {
      const message = notificationMessage(
        type,
        { sessionId: 'synthetic-session', title: 'День открытых дверей' },
        origin,
      );
      expect(message.text).toContain(`Подробнее: ${origin}/cabinet/registrations`);
    },
  );

  it('preserves trip and event detail links', () => {
    expect(
      notificationMessage('TripRescheduled', { tripId: 'synthetic-trip' }, origin).text,
    ).toContain(`Подробнее: ${origin}/trips/synthetic-trip`);
    expect(
      notificationMessage('EventRegistered', { eventId: 'synthetic-event' }, origin).text,
    ).toContain(`Подробнее: ${origin}/events/synthetic-event`);
  });

  it.each(NOTIFICATION_TYPES)('%s always has a valid fallback within the cabinet', (type) => {
    const message = notificationMessage(type, {}, origin);
    const path = new URL(message.text.split('Подробнее: ')[1]!).pathname;
    expect(['/cabinet/application', '/cabinet/registrations', '/cabinet/notifications']).toContain(
      path,
    );
    expect(message.subject).toBeTruthy();
  });
});

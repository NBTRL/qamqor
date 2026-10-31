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

  it.each(['OpenDayRegistered', 'OpenDayReminder', 'OpenDayRescheduled'] as const)(
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

  it.each(['EventRescheduled', 'OpenDayRescheduled'] as const)(
    '%s includes the current schedule and location in Moscow time',
    (type) => {
      const message = notificationMessage(
        type,
        {
          eventId: 'synthetic-event',
          sessionId: 'synthetic-session',
          title: 'Перенесённое событие',
          startsAt: '2026-11-01T10:00:00Z',
          location: 'Новый адрес',
          ...(type === 'EventRescheduled' ? { endsAt: '2026-11-01T11:00:00Z' } : {}),
        },
        origin,
      );
      expect(message.subject).toMatch(/Изменились время или место/);
      expect(message.text).toContain('Перенесённое событие');
      expect(message.text).toContain('13:00 (Москва)');
      expect(message.text).toContain('Место: Новый адрес');
      if (type === 'EventRescheduled') {
        expect(message.text).toMatch(/Окончание:.*14:00 \(Москва\)/);
        expect(message.text).toContain(`${origin}/events/synthetic-event`);
      } else {
        expect(message.text).not.toContain('Окончание:');
        expect(message.text).toContain(`${origin}/cabinet/registrations`);
      }
    },
  );

  it('ignores missing or invalid optional schedule fields', () => {
    const message = notificationMessage(
      'EventRescheduled',
      { startsAt: 'invalid', endsAt: {}, location: null },
      origin,
    );
    expect(message.text).not.toMatch(/Invalid|invalid|Окончание:|Место:/);
    expect(message.subject).toBeTruthy();
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

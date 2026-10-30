import { describe, expect, it } from 'vitest';
import { schemaFor } from './form-schema';

const event = {
  type: 'CLUB_EVENT',
  title: 'Учебное мероприятие',
  description: 'Описание',
  location: 'Учебная площадка',
  startsAt: '2026-11-01T12:00:00+03:00',
  endsAt: '2026-11-01T13:00:00+03:00',
};
const day = { startsAt: event.startsAt, location: event.location };

describe('Generated event and open-day form constraints', () => {
  it.each([0, 1.5, 1001])('rejects invalid capacity %s before sending either form', (capacity) => {
    expect(schemaFor('EventWriteDto').safeParse({ ...event, capacity }).success).toBe(false);
    expect(schemaFor('OpenDayWriteDto').safeParse({ ...day, capacity }).success).toBe(false);
    expect(schemaFor('EventPatchDto').safeParse({ capacity }).success).toBe(false);
    expect(schemaFor('OpenDayPatchDto').safeParse({ capacity }).success).toBe(false);
  });
  it.each([1, 1000])('accepts capacity boundary %s', (capacity) => {
    expect(schemaFor('EventWriteDto').safeParse({ ...event, capacity }).success).toBe(true);
    expect(schemaFor('OpenDayWriteDto').safeParse({ ...day, capacity }).success).toBe(true);
  });
  it('preserves optional and unlimited event capacity while requiring it for open days', () => {
    expect(schemaFor('EventWriteDto').safeParse(event).success).toBe(true);
    expect(schemaFor('EventWriteDto').safeParse({ ...event, capacity: null }).success).toBe(true);
    expect(schemaFor('OpenDayWriteDto').safeParse(day).success).toBe(false);
  });
  it.each(['x', 'x'.repeat(201)])('rejects an invalid event title length', (title) => {
    expect(schemaFor('EventWriteDto').safeParse({ ...event, title }).success).toBe(false);
  });
  it.each(['x', 'x'.repeat(501)])(
    'rejects an invalid location length in both forms',
    (location) => {
      expect(schemaFor('EventWriteDto').safeParse({ ...event, location }).success).toBe(false);
      expect(
        schemaFor('OpenDayWriteDto').safeParse({ ...day, capacity: 1, location }).success,
      ).toBe(false);
    },
  );
  it.each(['2026-11-01T12:00:00+03:00', '2026-11-01T11:59:00+03:00'])(
    'points an invalid time range at the end field',
    (endsAt) => {
      const result = schemaFor('EventWriteDto').safeParse({ ...event, endsAt });
      expect(result.success).toBe(false);
      if (!result.success)
        expect(result.error.issues).toContainEqual(
          expect.objectContaining({
            path: ['endsAt'],
            message: 'Время окончания должно быть позже начала.',
          }),
        );
      expect(
        schemaFor('EventPatchDto').safeParse({ startsAt: event.startsAt, endsAt }).success,
      ).toBe(false);
    },
  );
  it('compares instants across offsets and converts Moscow datetime inputs before validation', () => {
    expect(
      schemaFor('EventWriteDto').safeParse({ ...event, endsAt: '2026-11-01T11:00:00Z' }).success,
    ).toBe(true);
    const parsed = schemaFor('EventWriteDto').parse({
      ...event,
      startsAt: '2026-11-01T12:00',
      endsAt: '2026-11-01T13:00',
    });
    expect(Date.parse(parsed.endsAt) - Date.parse(parsed.startsAt)).toBe(3600000);
    expect(schemaFor('EventPatchDto').safeParse({ endsAt: event.endsAt }).success).toBe(true);
  });
});

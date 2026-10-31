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

describe('Remaining administrative form constraints', () => {
  const partner = { slug: 'test-partner', name: 'Партнёр' };
  it('validates slugs, HTTP URLs, names and integer sort order', () => {
    for (const update of [
      { slug: 'Bad slug' },
      { name: 'x' },
      { name: 'x'.repeat(201) },
      { logoUrl: 'https://' },
      { websiteUrl: 'mailto:a@example.test' },
      { sortOrder: 0.5 },
      { sortOrder: -1 },
      { sortOrder: 100001 },
      { sortOrder: '' },
    ])
      expect(schemaFor('PartnerWriteDto').safeParse({ ...partner, ...update }).success).toBe(false);
    expect(
      schemaFor('PartnerWriteDto').safeParse({ ...partner, sortOrder: '0', logoUrl: null }).success,
    ).toBe(true);
  });
  it('validates user identity, email and profile field limits', () => {
    for (const telegramId of ['0', 'abc', '9223372036854775808'])
      expect(schemaFor('UserCreateDto').safeParse({ telegramId, fullName: 'Тест' }).success).toBe(
        false,
      );
    for (const update of [
      { fullName: 'x' },
      { email: 'invalid' },
      { nickname: 'x'.repeat(101) },
      { city: 'x'.repeat(161) },
    ])
      expect(schemaFor('UserPatchDto').safeParse(update).success).toBe(false);
  });
  it('validates amounts as decimal strings and requires a valid year', () => {
    for (const amount of ['0', '-1', '1.001', '1e3', '1000000000000', ''])
      expect(
        schemaFor('DonationWriteDto').safeParse({ amount, receivedAt: event.startsAt }).success,
      ).toBe(false);
    expect(
      schemaFor('DonationWriteDto').safeParse({
        amount: '999999999999.99',
        receivedAt: event.startsAt,
      }).success,
    ).toBe(true);
    for (const year of ['', 1899, 2201, 2026.5])
      expect(
        schemaFor('ClubReportWriteDto').safeParse({
          title: 'Отчёт',
          year,
          fileUrl: 'https://example.test/report.pdf',
        }).success,
      ).toBe(false);
  });
  it.each([
    '2026-02-31T12:00',
    '2026-02-29T12:00',
    '2026-04-31T12:00',
    '2026-13-01T12:00',
    '2026-11-01T25:00',
  ])('rejects invalid local date %s without normalizing it or throwing', (startsAt) => {
    expect(() =>
      schemaFor('OpenDayWriteDto').safeParse({ ...day, startsAt, capacity: 1 }),
    ).not.toThrow();
    expect(schemaFor('OpenDayWriteDto').safeParse({ ...day, startsAt, capacity: 1 }).success).toBe(
      false,
    );
    expect(
      schemaFor('NewsWriteDto').safeParse({
        slug: 'test',
        title: 'Тест',
        bodyHtml: '',
        excerpt: '',
        publishedAt: startsAt,
      }).success,
    ).toBe(false);
  });
  it('accepts a real local leap day and checks nested list limits', () => {
    expect(
      schemaFor('OpenDayWriteDto').safeParse({ ...day, startsAt: '2028-02-29T12:00', capacity: 1 })
        .success,
    ).toBe(true);
    expect(
      schemaFor('NeedsWriteDto').safeParse({
        items: Array.from({ length: 101 }, () => ({ title: 'Нужда', description: '' })),
      }).success,
    ).toBe(false);
    expect(
      schemaFor('NeedsWriteDto').safeParse({ items: [{ title: 'x', description: '' }] }).success,
    ).toBe(false);
  });
});

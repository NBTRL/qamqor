import 'reflect-metadata';
import { describe, expect, it } from 'vitest';
import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';
import {
  CalendarQueryDto,
  EventWriteDto,
  OpenDayWriteDto,
  TripCreateDto,
  TripQueryDto,
  EventPatchDto,
} from '../club/club.dto.js';
import {
  AlbumWriteDto,
  ClubReportWriteDto,
  DonationWriteDto,
  InterviewWriteDto,
  NewsWriteDto,
  PressWriteDto,
  PartnerWriteDto,
} from '../content/content.dto.js';

const dateFields = [
  [TripCreateDto, 'startsAt'],
  [TripCreateDto, 'endsAt'],
  [EventWriteDto, 'startsAt'],
  [EventWriteDto, 'endsAt'],
  [OpenDayWriteDto, 'startsAt'],
  [TripQueryDto, 'dateFrom'],
  [TripQueryDto, 'dateTo'],
  [CalendarQueryDto, 'from'],
  [CalendarQueryDto, 'to'],
  [NewsWriteDto, 'publishedAt'],
  [InterviewWriteDto, 'publishedAt'],
  [AlbumWriteDto, 'publishedAt'],
  [ClubReportWriteDto, 'publishedAt'],
  [PressWriteDto, 'publishedAt'],
  [DonationWriteDto, 'receivedAt'],
] as const;
describe('Administrative API date validation', () => {
  for (const [Dto, field] of dateFields) {
    it(`${Dto.name}.${field} rejects calendar overflow and accepts leap days and offsets`, () => {
      const errors = (value: string) =>
        validateSync(plainToInstance(Dto as new () => object, { [field]: value })).filter(
          (error) => error.property === field,
        );
      for (const value of [
        '2026-02-31T12:00:00Z',
        '2026-02-29T12:00:00+03:00',
        '2100-02-29T12:00:00Z',
        '2026-04-31T12:00:00Z',
        '2026-13-01T12:00:00Z',
        '2026-11-01T25:00:00Z',
        '2026-02-28',
        '2026-02-28T12:00:00',
        '2026-02-28T12:00Z',
      ])
        expect(errors(value), value).not.toHaveLength(0);
      for (const value of [
        '2028-02-29T12:00:00Z',
        '2000-02-29T12:00:00+03:00',
        '2026-11-01T12:00:00.123-05:00',
      ])
        expect(errors(value), value).toHaveLength(0);
    });
  }
  it('rejects malformed HTTP URLs instead of accepting only a protocol prefix', () => {
    for (const logoUrl of [
      'https://',
      'https://[invalid',
      'javascript:alert(1)',
      'mailto:a@example.test',
    ])
      expect(
        validateSync(plainToInstance(PartnerWriteDto, { slug: 'test', name: 'Test', logoUrl })),
      ).not.toHaveLength(0);
  });
  it('allows an omitted PATCH date while rejecting explicit null for required fields', () => {
    expect(validateSync(plainToInstance(EventPatchDto, {}))).toHaveLength(0);
    for (const body of [{ startsAt: null }, { title: null }, { isPublic: null }])
      expect(validateSync(plainToInstance(EventPatchDto, body))).not.toHaveLength(0);
    expect(validateSync(plainToInstance(EventPatchDto, { capacity: null }))).toHaveLength(0);
  });
});

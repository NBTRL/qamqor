import 'reflect-metadata';
import { describe, expect, it } from 'vitest';
import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';
import { MeRegistrationQueryDto } from './club.dto.js';

const parse = (upcoming?: unknown) =>
  plainToInstance(MeRegistrationQueryDto, upcoming === undefined ? {} : { upcoming });

describe('Membership history and upcoming query', () => {
  it('keeps the complete history as the default', () => {
    const query = parse();
    expect(query).toMatchObject({ page: 1, limit: 20, upcoming: false });
    expect(validateSync(query)).toEqual([]);
  });

  it('accepts true and false without treating the false query string as truthy', () => {
    for (const value of [true, false, 'true', 'false']) {
      const query = parse(value);
      expect(query.upcoming).toBe(value === true || value === 'true');
      expect(validateSync(query)).toEqual([]);
    }
  });

  it('rejects malformed flags rather than silently choosing a different view', () => {
    for (const value of ['TRUE', 'yes', '1', '', 1, ['true'], { value: true }]) {
      expect(validateSync(parse(value))).toEqual(
        expect.arrayContaining([expect.objectContaining({ property: 'upcoming' })]),
      );
    }
  });
});

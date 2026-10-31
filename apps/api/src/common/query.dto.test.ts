import 'reflect-metadata';
import { describe, expect, it } from 'vitest';
import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';
import { paginationSchema } from '@club/shared';
import { CalendarQueryDto } from '../club/club.dto.js';
import { PageQueryDto, pageArgs } from './query.dto.js';

const maxPage = Math.floor(2_147_483_647 / 100) + 1;

describe('Pagination bounds', () => {
  it.each([
    { page: String(maxPage + 1) },
    { page: '2147483647' },
    { page: String(Number.MAX_SAFE_INTEGER) },
    { page: '100000000000000000000' },
    { page: '1e309' },
    { page: 'Infinity' },
    { page: 'NaN' },
    { page: '1.5' },
    { page: '0' },
    { page: '-1' },
    { limit: '101' },
    { limit: '0' },
    { limit: '1.5' },
  ])('rejects invalid pagination %j in API DTOs and the shared schema', (input) => {
    for (const Dto of [PageQueryDto, CalendarQueryDto])
      expect(validateSync(plainToInstance(Dto, input))).not.toHaveLength(0);
    expect(paginationSchema.safeParse(input).success).toBe(false);
  });

  it('keeps defaults and the maximum page valid with a signed 32-bit offset at every allowed limit', () => {
    expect(plainToInstance(PageQueryDto, {})).toMatchObject({ page: 1, limit: 20 });
    expect(paginationSchema.parse({})).toEqual({ page: 1, limit: 20 });
    for (let limit = 1; limit <= 100; limit++) {
      const input = { page: String(maxPage), limit: String(limit) };
      const query = plainToInstance(PageQueryDto, input);
      expect(validateSync(query)).toHaveLength(0);
      expect(paginationSchema.parse(input)).toEqual({ page: maxPage, limit });
      const { skip } = pageArgs(query);
      expect(Number.isSafeInteger(skip)).toBe(true);
      expect(skip).toBeLessThanOrEqual(2_147_483_647);
    }
  });
});

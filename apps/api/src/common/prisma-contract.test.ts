import { describe, expect, it } from 'vitest';
import * as shared from '@club/shared';
import * as databaseEnums from '../generated/prisma/enums.js';
import { readFileSync } from 'node:fs';

describe('Модель данных', () => {
  it('сохраняет общие значения всех бизнес-enum в PostgreSQL', () => {
    for (const name of [
      'UserRole',
      'PlaceType',
      'ApplicationStatus',
      'TripStatus',
      'RegistrationStatus',
      'EventType',
      'NewsStatus',
      'ContactRequestStatus',
      'NotificationChannel',
      'NotificationStatus',
      'LoginTokenStatus',
    ] as const)
      expect(Object.values(databaseEnums[name])).toEqual(Object.values(shared[name]));
  });
  it('не делает телефон уникальным и фиксирует ограничения анонимизации/вместимости в SQL', () => {
    const sql = readFileSync(
      new URL('../../prisma/migrations/20261027010000_backend/migration.sql', import.meta.url),
      'utf8',
    );
    expect(sql).toContain('users_identity_check');
    expect(sql).toContain('trips_capacity_dates_check');
    expect(sql).toContain('places_location_check');
    expect(sql).toContain('CREATE INDEX "users_phone_idx"');
    expect(sql).not.toContain('CREATE UNIQUE INDEX "users_phone');
    expect(sql).toContain('RENAME COLUMN "code" TO "slug"');
  });
});

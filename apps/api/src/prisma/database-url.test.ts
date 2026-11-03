import { describe, expect, it } from 'vitest';
import pg from 'pg';
import { databaseUrlForPg } from './database-url.js';

describe('PostgreSQL certificate verification', () => {
  it.each(['prefer', 'require', 'verify-ca'])('pins the legacy %s alias to verify-full', (mode) => {
    const input = `postgresql://user:p%40ss@db.example/app?sslmode=${mode}&channel_binding=require`;
    const result = new URL(databaseUrlForPg(input));
    expect(result.searchParams.get('sslmode')).toBe('verify-full');
    expect(result.password).toBe('p%40ss');
    expect(result.searchParams.get('channel_binding')).toBe('require');
    const client = new pg.Client({ connectionString: result.href });
    expect(client.ssl).not.toBe(false);
    expect(client.ssl).not.toHaveProperty('rejectUnauthorized', false);
    expect(client.ssl).not.toHaveProperty('checkServerIdentity');
  });

  it.each(['', '?sslmode=disable', '?sslmode=verify-full', '?sslmode=require&uselibpqcompat=true'])(
    'preserves explicit non-legacy settings %s',
    (query) => {
      const input = `postgresql://user:password@localhost/app${query}`;
      expect(databaseUrlForPg(input)).toBe(input);
    },
  );
});

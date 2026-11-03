import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { deployMigrations } from './deploy-migrations.mjs';

test('migration failure, timeout and missing configuration block publication without leaking output', () => {
  const env = { VERCEL_ENV: 'production', DATABASE_URL: 'postgresql://test/pooled' };
  for (const status of [1, null]) {
    assert.throws(() => deployMigrations(env, () => ({ status, stderr: 'secret' })), {
      message: 'DATABASE_MIGRATION_FAILED',
    });
  }
  assert.throws(() => deployMigrations({ VERCEL_ENV: 'production' }), /DATABASE_URL is required/);
});
test('production and preview migrate using the direct URL before the web build', () => {
  for (const VERCEL_ENV of ['production', 'preview']) {
    let calls = 0;
    deployMigrations(
      { VERCEL_ENV, DATABASE_URL: 'pooled', DATABASE_URL_UNPOOLED: 'direct' },
      (_node, args, options) => {
        calls++;
        assert.deepEqual(args.slice(1), ['migrate', 'deploy']);
        assert.equal(options.env.DATABASE_URL, 'direct');
        assert.equal(options.timeout, 180000);
        return { status: 0 };
      },
    );
    assert.equal(calls, 1);
  }
  const config = JSON.parse(readFileSync(new URL('../vercel.json', import.meta.url)));
  assert.match(
    config.services.web.buildCommand,
    /^node ..\/..\/scripts\/deploy-migrations.mjs && /,
  );
});
test('local builds do not modify the database', () => {
  deployMigrations({}, () => {
    throw new Error('must not run');
  });
});

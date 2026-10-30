import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { createHash, randomBytes } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { config } from 'dotenv';

const root = fileURLToPath(new URL('../', import.meta.url));
config({ path: new URL('../.env', import.meta.url), quiet: true });
if (!process.env.npm_execpath) throw new Error('Запустите pnpm test:e2e из корня.');
const requireApi = createRequire(new URL('../apps/api/package.json', import.meta.url));
const { Client } = requireApi('pg');
const { Redis } = requireApi('ioredis');
const url = new URL(process.env.DATABASE_URL ?? '');
if (!['localhost', '127.0.0.1', '[::1]'].includes(url.hostname))
  throw new Error('Автотесты создают временную БД только на локальном PostgreSQL.');
const name = `club_test_${Date.now()}_${randomBytes(5).toString('hex')}`;
if (!/^club_test_[0-9]+_[a-f0-9]+$/.test(name)) throw new Error('Некорректное имя временной БД.');
const adminUrl = new URL(url);
adminUrl.pathname = '/postgres';
adminUrl.searchParams.delete('schema');
const admin = new Client({ connectionString: adminUrl.href });
await admin.connect();
let created = false;
async function pnpm(args) {
  await new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [process.env.npm_execpath, ...args], {
      cwd: root,
      env: process.env,
      stdio: 'inherit',
      windowsHide: true,
    });
    child.once('error', reject);
    child.once('exit', (code) =>
      code === 0 ? resolve() : reject(new Error(`Проверка завершилась с кодом ${code}`)),
    );
  });
}
try {
  await admin.query(`CREATE DATABASE "${name}"`);
  created = true;
  url.pathname = `/${name}`;
  process.env.DATABASE_URL = url.href;
  process.env.NODE_ENV = 'test';
  process.env.DEV_FAKE_TELEGRAM = 'true';
  process.env.TELEGRAM_BOT_TOKEN = '';
  await pnpm(['--filter', '@club/shared', 'build']);
  await pnpm(['--filter', '@club/api', 'db:deploy']);
  await pnpm(['--filter', '@club/api', 'build']);
  await pnpm(['exec', 'vitest', 'run', '--config', 'apps/api/vitest.e2e.config.ts']);
  if (process.env.TEST_BROWSER === 'true')
    await pnpm(['exec', 'node', 'scripts/check-user-flow.mjs']);
} catch (error) {
  console.error(error instanceof Error ? error.message : 'E2E не завершены.');
  process.exitCode = 1;
} finally {
  try {
    if (created) {
      const redis = new Redis(process.env.REDIS_URL, { maxRetriesPerRequest: 1 });
      redis.on('error', () => {});
      const prefix = `club-test-${createHash('sha256').update(url.pathname).digest('hex').slice(0, 12)}:`;
      try {
        let cursor = '0';
        do {
          const result = await redis.scan(cursor, 'MATCH', `${prefix}*`, 'COUNT', 500);
          cursor = result[0];
          if (result[1].length) await redis.unlink(...result[1]);
        } while (cursor !== '0');
      } finally {
        redis.disconnect();
        await admin.query(`DROP DATABASE "${name}" WITH (FORCE)`);
      }
    }
  } finally {
    await admin.end();
  }
}

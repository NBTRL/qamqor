import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createServer } from 'node:net';
import { resolve, join } from 'node:path';
import { randomBytes } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';

// Use the real production entrypoint with unavailable infrastructure and a fake bot.
// In CI this also runs with Docker --network none, so readiness cannot depend on getMe.
const root = resolve(process.argv[2] ?? 'apps/api');
const probe = createServer();
await new Promise((resolve) => probe.listen(0, '127.0.0.1', resolve));
const port = probe.address().port;
await new Promise((resolve) => probe.close(resolve));
const started = performance.now();
let output = '';
const child = spawn(process.execPath, [join(root, 'dist/scripts/start-vercel.js')], {
  cwd: root,
  windowsHide: true,
  stdio: ['ignore', 'pipe', 'pipe'],
  env: {
    ...process.env,
    NODE_ENV: 'production',
    VERCEL_ENV: 'production',
    PORT: String(port),
    DATABASE_URL: 'postgresql://startup:startup@127.0.0.1:1/startup',
    DATABASE_URL_UNPOOLED: 'postgresql://startup:startup@127.0.0.1:1/startup',
    REDIS_URL: 'redis://127.0.0.1:1',
    JWT_SECRET: randomBytes(48).toString('hex'),
    WEB_URL: 'http://127.0.0.1',
    PUBLIC_API_URL: 'https://startup.example.test',
    S3_ENDPOINT: 'http://127.0.0.1:1',
    S3_BUCKET: 'startup-test',
    S3_REGION: 'auto',
    S3_ACCESS_KEY: 'startup-test',
    S3_SECRET_KEY: randomBytes(24).toString('hex'),
    DEV_FAKE_TELEGRAM: 'false',
    TELEGRAM_MODE: 'webhook',
    TELEGRAM_BOT_TOKEN: '123456:synthetic_test_token',
    TELEGRAM_BOT_USERNAME: 'test_bot',
    TELEGRAM_WEBHOOK_SECRET: 'synthetic_webhook_secret',
    SMTP_HOST: '',
  },
});
child.stdout.on('data', (data) => {
  output += data;
});
child.stderr.on('data', () => {});
const exited = new Promise((resolve) => child.once('exit', resolve));
try {
  let ready = false;
  while (performance.now() - started < 15000 && child.exitCode === null) {
    try {
      const response = await fetch(`http://127.0.0.1:${port}/api/v1/health`, {
        signal: AbortSignal.timeout(500),
      });
      ready = response.status === 200 && (await response.json()).status === 'ok';
      if (ready) break;
    } catch {
      /* The port is not listening yet. */
    }
    await delay(100);
  }
  assert(ready, 'Production entrypoint must serve health within 15s without external services');
  assert(!output.includes('Database migrations applied'), 'Cold starts must not run migrations');
  console.log(
    JSON.stringify({
      result: 'PASS',
      coldStartMs: Math.round(performance.now() - started),
      health: 200,
      migrationsAtRuntime: false,
      telegramRequiredAtStartup: false,
    }),
  );
} finally {
  child.kill('SIGKILL');
  await exited;
}

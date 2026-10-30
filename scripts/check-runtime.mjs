import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { readdir, realpath, access } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { spawnSync } from 'node:child_process';
import { resolve, join, relative, isAbsolute } from 'node:path';
import { pathToFileURL } from 'node:url';

const root = await realpath(resolve(process.argv[2] ?? ''));
assert.ok(process.argv[2], 'Pass the standalone runtime directory.');
const inside = (path) => {
  const local = relative(root, path);
  return !isAbsolute(local) && local !== '..' && !local.startsWith('../');
};
let links = 0;
async function checkLinks(directory) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isSymbolicLink()) {
      assert.ok(inside(await realpath(path)), `Runtime dependency escapes its directory: ${path}`);
      links++;
    } else if (entry.isDirectory()) await checkLinks(path);
  }
}
await checkLinks(root);
await access(join(root, 'dist/worker.js'));
await access(join(root, 'dist/scripts/start-vercel.js'));
await access(join(root, 'prisma/schema.prisma'));
await access(join(root, 'prisma.config.ts'));
const migrations = await readdir(join(root, 'prisma/migrations'));
assert.ok(migrations.includes('20261030030000_educational_demo'));

// The smoke test runs offline and never reads production configuration.
Object.assign(process.env, {
  NODE_ENV: 'test',
  DATABASE_URL: 'postgresql://runtime:runtime@127.0.0.1:1/runtime',
  REDIS_URL: 'redis://127.0.0.1:1',
  JWT_SECRET: randomBytes(48).toString('hex'),
  WEB_URL: 'http://127.0.0.1',
  PUBLIC_API_URL: 'http://127.0.0.1',
  S3_ENDPOINT: 'http://127.0.0.1:1',
  S3_BUCKET: 'runtime-smoke',
  S3_ACCESS_KEY: 'runtime-smoke',
  S3_SECRET_KEY: randomBytes(24).toString('hex'),
  DEV_FAKE_TELEGRAM: 'false',
  TELEGRAM_BOT_TOKEN: '',
  SMTP_HOST: '',
});
const require = createRequire(join(root, 'package.json'));
const prisma = spawnSync(
  process.execPath,
  [require.resolve('prisma/build/index.js'), '--version'],
  {
    cwd: root,
    env: { ...process.env, CHECKPOINT_DISABLE: '1', PRISMA_HIDE_UPDATE_MESSAGE: '1' },
    encoding: 'utf8',
    timeout: 20000,
  },
);
assert.equal(
  prisma.status,
  0,
  `Packaged Prisma CLI and schema engine must execute offline. ${prisma.stderr?.slice(-2000) ?? ''}`,
);
assert.match(prisma.stdout, /Schema Engine\s*:\s*schema-engine-cli\s+\S+/);
require('reflect-metadata');
const { NestFactory } = require('@nestjs/core');
const { AppModule } = await import(pathToFileURL(join(root, 'dist/app.module.js')).href);
const { configureApp, createOpenApiDocument } = await import(
  pathToFileURL(join(root, 'dist/openapi.js')).href
);
const app = await NestFactory.create(
  AppModule.configure({ offline: true, workers: false, telegram: false }),
  { logger: false },
);
try {
  configureApp(app);
  await app.listen(0, '127.0.0.1');
  const response = await fetch(`${await app.getUrl()}/api/v1/health`);
  assert.equal(response.status, 200);
  assert.equal((await response.json()).status, 'ok');
  assert.ok(createOpenApiDocument(app).paths['/api/v1/events/{id}/register']);
  console.log(
    JSON.stringify({ result: 'PASS', standalone: true, links, prisma: true, health: 200 }),
  );
} finally {
  await app.close();
}

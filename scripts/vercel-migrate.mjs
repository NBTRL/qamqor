import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

if (!['production', 'preview'].includes(process.env.VERCEL_ENV)) process.exit(0);
const databaseUrl = process.env.DATABASE_URL_UNPOOLED ?? process.env.DATABASE_URL;
if (!databaseUrl) throw new Error('DATABASE_URL is required for deployment migrations.');
const result = spawnSync('pnpm', ['--filter', '@club/api', 'exec', 'prisma', 'migrate', 'deploy'], {
  cwd: fileURLToPath(new URL('../', import.meta.url)),
  env: { ...process.env, DATABASE_URL: databaseUrl },
  encoding: 'utf8',
  shell: process.platform === 'win32',
});
if (result.status !== 0) {
  // Prisma output can include connection details; keep deployment logs free of secrets.
  console.error('Database migration failed. Inspect database connectivity and migration history.');
  process.exit(1);
}
console.log('Database migrations applied.');

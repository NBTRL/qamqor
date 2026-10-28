import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

if (['production', 'preview'].includes(process.env.VERCEL_ENV ?? '')) {
  const databaseUrl = process.env.DATABASE_URL_UNPOOLED ?? process.env.DATABASE_URL;
  if (!databaseUrl) throw new Error('DATABASE_URL is required for deployment migrations.');
  const require = createRequire(import.meta.url);
  const result = spawnSync(
    process.execPath,
    [require.resolve('prisma/build/index.js'), 'migrate', 'deploy'],
    {
      cwd: fileURLToPath(new URL('../../', import.meta.url)),
      env: { ...process.env, DATABASE_URL: databaseUrl },
      encoding: 'utf8',
    },
  );
  if (result.status !== 0) {
    // Migration output can contain connection details; never copy it into runtime logs.
    console.error('DATABASE_MIGRATION_FAILED');
    process.exit(1);
  }
  console.log('Database migrations applied.');
}

// The HTTP container delegates all background jobs to the separately deployed daemon.
process.env.VERCEL = '1';
await import('../main.js');

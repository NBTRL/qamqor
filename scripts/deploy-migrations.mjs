import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';

export function deployMigrations(environment = process.env, run = spawnSync) {
  if (!['production', 'preview'].includes(environment.VERCEL_ENV ?? '')) return;
  const databaseUrl = environment.DATABASE_URL_UNPOOLED ?? environment.DATABASE_URL;
  if (!databaseUrl) throw new Error('DATABASE_URL is required for deployment migrations.');
  const cwd = fileURLToPath(new URL('../apps/api/', import.meta.url));
  const require = createRequire(new URL('../apps/api/package.json', import.meta.url));
  const result = run(
    process.execPath,
    [require.resolve('prisma/build/index.js'), 'migrate', 'deploy'],
    {
      cwd,
      env: { ...environment, DATABASE_URL: databaseUrl },
      encoding: 'utf8',
      timeout: 180000,
      windowsHide: true,
    },
  );
  // Prisma output may contain credentials. Fail the build without printing it.
  if (result.status !== 0) throw new Error('DATABASE_MIGRATION_FAILED');
  console.log('Database migrations applied before deployment.');
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    deployMigrations();
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}

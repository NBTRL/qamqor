import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { config } from 'dotenv';

const root = fileURLToPath(new URL('../', import.meta.url));
config({ path: fileURLToPath(new URL('../.env', import.meta.url)), quiet: true });
const command = process.argv[2];
if (['build', 'start'].includes(command)) process.env.NODE_ENV = 'production';
if (command === 'test') process.env.NODE_ENV = 'test';

async function pnpm(args) {
  if (!process.env.npm_execpath)
    throw new Error('Запускайте команды через pnpm из корня репозитория.');
  const child = spawn(process.execPath, [process.env.npm_execpath, ...args], {
    cwd: root,
    stdio: 'inherit',
    env: process.env,
    windowsHide: true,
  });
  const stop = () => {
    if (!child.pid) return;
    if (process.platform === 'win32')
      spawn('taskkill.exe', ['/PID', String(child.pid), '/T', '/F'], {
        windowsHide: true,
        stdio: 'ignore',
      });
    else child.kill('SIGTERM');
  };
  process.once('SIGINT', stop);
  process.once('SIGTERM', stop);
  try {
    await new Promise((resolve, reject) => {
      child.once('error', reject);
      child.once('exit', (code) =>
        code === 0
          ? resolve()
          : reject(new Error(`Команда pnpm ${args.join(' ')} завершилась с кодом ${code}`)),
      );
    });
  } finally {
    process.removeListener('SIGINT', stop);
    process.removeListener('SIGTERM', stop);
  }
}

try {
  if (
    [
      'prepare',
      'dev',
      'test',
      'typecheck',
      'gen:api',
      'db:seed',
      'telegram:setup',
      'telegram:info',
    ].includes(command)
  )
    await pnpm(['--filter', '@club/shared', 'build']);
  // При build shared еще может отсутствовать; приложения проверят окружение после его сборки.
  if (!['prepare', 'build'].includes(command)) {
    const { assertProductionSafety } = await import('../packages/shared/dist/server.js');
    assertProductionSafety(process.env);
  }
  switch (command) {
    case 'prepare':
      await pnpm(['--filter', '@club/api', 'prisma:generate']);
      break;
    case 'dev':
      await pnpm([
        '-r',
        '--parallel',
        '--filter',
        '@club/shared',
        '--filter',
        '@club/api',
        '--filter',
        '@club/web',
        'dev',
      ]);
      break;
    case 'start':
      await pnpm(['-r', '--parallel', '--filter', '@club/api', '--filter', '@club/web', 'start']);
      break;
    case 'build':
      await pnpm(['-r', 'build']);
      break;
    case 'test':
      await pnpm(['exec', 'vitest', 'run']);
      await pnpm(['--filter', '@club/web', 'test']);
      break;
    case 'typecheck':
      await pnpm(['-r', 'typecheck']);
      break;
    case 'gen:api':
      await pnpm(['--filter', '@club/api', 'build']);
      await pnpm(['--filter', '@club/api', 'export:openapi']);
      await pnpm(['--filter', '@club/web', 'gen:api']);
      break;
    case 'db:deploy':
    case 'db:migrate':
      await pnpm(['--filter', '@club/api', command]);
      break;
    case 'db:seed':
    case 'telegram:setup':
    case 'telegram:info':
      await pnpm(['--filter', '@club/api', 'build']);
      await pnpm(['--filter', '@club/api', command]);
      break;
    default:
      throw new Error(`Неизвестная команда ${command}`);
  }
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
}

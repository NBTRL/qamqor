import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import { fileURLToPath } from 'node:url';

const destination = fileURLToPath(new URL('../.env', import.meta.url));
if (!existsSync(destination) && !process.env.CI && process.env.NODE_ENV !== 'production') {
  const template = readFileSync(new URL('../.env.example', import.meta.url), 'utf8')
    .replace(/^JWT_SECRET=.*$/m, `JWT_SECRET=${randomBytes(48).toString('hex')}`)
    .replace(/^S3_SECRET_KEY=.*$/m, `S3_SECRET_KEY=${randomBytes(32).toString('hex')}`);
  writeFileSync(destination, template, { mode: 0o600, flag: 'wx' });
  console.log('Создан локальный .env со случайными секретами. Существующий .env не изменяется.');
}

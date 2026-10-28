import { z } from 'zod';
import { emailSchema, telegramIdSchema } from './schemas.js';

export function assertProductionSafety(environment: Record<string, string | undefined>): void {
  if (
    environment.NODE_ENV === 'production' &&
    environment.DEV_FAKE_TELEGRAM?.trim().toLowerCase() === 'true'
  )
    throw new Error('DEV_FAKE_TELEGRAM=true запрещен при NODE_ENV=production.');
}

export const serverEnvironmentSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  DATABASE_URL: z.url(),
  REDIS_URL: z.url(),
  JWT_SECRET: z.string().min(32),
  WEB_URL: z.url(),
  PUBLIC_API_URL: z.url(),
  S3_ENDPOINT: z.url(),
  S3_REGION: z.string().min(1).default('us-east-1'),
  S3_BUCKET: z.string().min(3),
  S3_ACCESS_KEY: z.string().min(3),
  S3_SECRET_KEY: z.string().min(8),
  SMTP_HOST: z.string().default(''),
  SMTP_PORT: z.coerce.number().int().min(1).max(65535).default(587),
  SMTP_USER: z.string().default(''),
  SMTP_PASS: z.string().default(''),
  MAIL_FROM: z.string().default(''),
  TELEGRAM_BOT_TOKEN: z.string().default(''),
  TELEGRAM_BOT_USERNAME: z
    .string()
    .regex(/^[A-Za-z0-9_]*$/, 'Укажите username без @.')
    .default(''),
  TELEGRAM_WEBHOOK_SECRET: z.string().default(''),
  TELEGRAM_MODE: z.enum(['polling', 'webhook']).default('polling'),
  DEV_FAKE_TELEGRAM: z
    .enum(['true', 'false'])
    .default('false')
    .transform((value) => value === 'true'),
  ADMIN_TELEGRAM_ID: z.union([z.literal(''), telegramIdSchema]).default(''),
  ADMIN_EMAIL: z.union([z.literal(''), emailSchema]).default(''),
});
export type ServerEnvironment = z.infer<typeof serverEnvironmentSchema>;
export function parseServerEnvironment(
  environment: Record<string, string | undefined>,
): ServerEnvironment {
  assertProductionSafety(environment);
  const tigris = Boolean(environment.TIGRIS_STORAGE_BUCKET);
  const parsed = serverEnvironmentSchema.safeParse({
    ...environment,
    S3_ENDPOINT: environment.S3_ENDPOINT ?? (tigris ? 'https://t3.storage.dev' : undefined),
    S3_REGION: environment.S3_REGION ?? (tigris ? 'auto' : undefined),
    S3_BUCKET: environment.S3_BUCKET ?? environment.TIGRIS_STORAGE_BUCKET,
    S3_ACCESS_KEY: environment.S3_ACCESS_KEY ?? environment.TIGRIS_STORAGE_ACCESS_KEY_ID,
    S3_SECRET_KEY: environment.S3_SECRET_KEY ?? environment.TIGRIS_STORAGE_SECRET_ACCESS_KEY,
  });
  if (!parsed.success)
    throw new Error(
      `Некорректные переменные окружения: ${parsed.error.issues.map((issue) => issue.path.join('.')).join(', ')}`,
    );
  return parsed.data;
}

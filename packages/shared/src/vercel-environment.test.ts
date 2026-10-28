import { describe, expect, it } from 'vitest';
import { parseServerEnvironment } from './server.js';

const deployment = {
  NODE_ENV: 'production',
  DATABASE_URL: 'postgresql://user:password@database.example/club',
  REDIS_URL: 'rediss://user:password@redis.example:6379',
  JWT_SECRET: 'a'.repeat(48),
  WEB_URL: 'https://club.example',
  PUBLIC_API_URL: 'https://club.example',
  TIGRIS_STORAGE_BUCKET: 'club-files',
  TIGRIS_STORAGE_ACCESS_KEY_ID: 'test-access-key',
  TIGRIS_STORAGE_SECRET_ACCESS_KEY: 'test-secret-key',
};

describe('Vercel integration environment', () => {
  it('accepts Tigris integration keys without copying secrets to another env variable', () => {
    const env = parseServerEnvironment(deployment);
    expect(env.S3_ENDPOINT).toBe('https://t3.storage.dev');
    expect(env.S3_REGION).toBe('auto');
    expect(env.S3_BUCKET).toBe('club-files');
    expect(env.S3_ACCESS_KEY).toBe(deployment.TIGRIS_STORAGE_ACCESS_KEY_ID);
    expect(env.S3_SECRET_KEY).toBe(deployment.TIGRIS_STORAGE_SECRET_ACCESS_KEY);
    expect(env.SMTP_HOST).toBe('');
  });

  it('preserves explicitly configured S3 providers', () => {
    const env = parseServerEnvironment({
      ...deployment,
      S3_ENDPOINT: 'https://s3.example',
      S3_REGION: 'custom-region',
      S3_BUCKET: 'custom-bucket',
      S3_ACCESS_KEY: 'custom-access',
      S3_SECRET_KEY: 'custom-secret',
    });
    expect(env.S3_ENDPOINT).toBe('https://s3.example');
    expect(env.S3_REGION).toBe('custom-region');
    expect(env.S3_BUCKET).toBe('custom-bucket');
    expect(env.S3_ACCESS_KEY).toBe('custom-access');
    expect(env.S3_SECRET_KEY).toBe('custom-secret');
  });

  it('still rejects missing storage credentials and production fake login', () => {
    expect(() =>
      parseServerEnvironment({ ...deployment, TIGRIS_STORAGE_SECRET_ACCESS_KEY: '' }),
    ).toThrow('S3_SECRET_KEY');
    expect(() => parseServerEnvironment({ ...deployment, DEV_FAKE_TELEGRAM: 'true' })).toThrow(
      'DEV_FAKE_TELEGRAM=true',
    );
  });
});

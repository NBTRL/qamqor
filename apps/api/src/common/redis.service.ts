import { Inject, Injectable, type OnApplicationShutdown } from '@nestjs/common';
import { Redis } from 'ioredis';
import { getEnvironment } from '../config/environment.js';
import { RUNTIME, type RuntimeOptions } from './runtime.module.js';
import { ErrorCode } from '@club/shared';
import { ApiException } from './api-exception.js';
import { createHash } from 'node:crypto';

@Injectable()
export class RedisService implements OnApplicationShutdown {
  readonly connection: {
    host: string;
    port: number;
    username?: string;
    password?: string;
    db: number;
    tls?: object;
    maxRetriesPerRequest: null;
  };
  readonly prefix: string;
  private readonly instance?: Redis;
  constructor(@Inject(RUNTIME) runtime: RuntimeOptions) {
    const env = getEnvironment();
    const url = new URL(env.REDIS_URL);
    this.connection = {
      host: url.hostname,
      port: Number(url.port || 6379),
      username: url.username ? decodeURIComponent(url.username) : undefined,
      password: url.password ? decodeURIComponent(url.password) : undefined,
      db: Number(url.pathname.slice(1) || 0),
      tls: url.protocol === 'rediss:' ? {} : undefined,
      maxRetriesPerRequest: null,
    };
    this.prefix =
      env.NODE_ENV === 'test'
        ? `club-test-${createHash('sha256').update(new URL(env.DATABASE_URL).pathname).digest('hex').slice(0, 12)}`
        : process.env.VERCEL_ENV === 'preview'
          ? `club-preview-${createHash('sha256')
              .update(
                process.env.VERCEL_GIT_COMMIT_REF ??
                  process.env.VERCEL_BRANCH_URL ??
                  process.env.VERCEL_URL ??
                  'preview',
              )
              .digest('hex')
              .slice(0, 12)}`
          : 'club';
    if (!runtime.offline) {
      this.instance = new Redis({ ...this.connection, maxRetriesPerRequest: 2 });
      // Никогда не печатаем объект ошибки подключения с URL/учетными данными.
      this.instance.on('error', () => {});
    }
  }
  get client(): Redis {
    if (!this.instance) throw new Error('Redis недоступен при offline-экспорте.');
    return this.instance;
  }
  key(key: string): string {
    return `${this.prefix}:${key}`;
  }
  async limit(key: string, limit: number, ttlMs: number): Promise<void> {
    const hits = await this.client.eval(
      "local n=redis.call('INCR',KEYS[1]); if n==1 then redis.call('PEXPIRE',KEYS[1],ARGV[1]) end; return n",
      1,
      this.key(key),
      ttlMs,
    );
    if (Number(hits) > limit) throw new ApiException(ErrorCode.RATE_LIMITED);
  }
  async onApplicationShutdown(): Promise<void> {
    await this.instance?.quit();
  }
}

import { Module, type DynamicModule } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { LoggerModule } from 'nestjs-pino';
import { randomUUID } from 'node:crypto';
import { HealthController } from './health/health.controller.js';
import { InfrastructureModule } from './common/infrastructure.module.js';
import { RuntimeModule, type RuntimeOptions } from './common/runtime.module.js';
import { RedisThrottlerStorage } from './common/throttle.service.js';
import { AuthModule } from './auth/auth.module.js';
import { JwtAuthGuard, OnboardingGuard, RolesGuard } from './auth/guards.js';
import { ClubModule } from './club/club.module.js';
import { AdminModule } from './admin/admin.module.js';
import { ContentModule } from './content/content.module.js';

@Module({
  imports: [
    InfrastructureModule,
    AuthModule,
    ClubModule,
    AdminModule,
    ContentModule,
    ThrottlerModule.forRootAsync({
      inject: [RedisThrottlerStorage],
      useFactory: (storage: RedisThrottlerStorage) => ({
        storage,
        throttlers: [{ name: 'default', ttl: 60000, limit: 100 }],
      }),
    }),
    LoggerModule.forRoot({
      pinoHttp: {
        base: undefined,
        autoLogging: process.env.NODE_ENV !== 'test',
        genReqId: () => randomUUID(),
        serializers: {
          req: (req: { id?: string; method?: string }) => ({ id: req.id, method: req.method }),
          res: (res: { statusCode?: number }) => ({ statusCode: res.statusCode }),
          err: () => ({ type: 'RequestError' }),
        },
        redact: {
          paths: [
            'req.headers',
            'req.body',
            'req.query',
            'req.url',
            'res.headers',
            'err.message',
            'err.stack',
          ],
          remove: true,
        },
        customSuccessMessage: () => 'HTTP_REQUEST_COMPLETED',
        customErrorMessage: () => 'HTTP_REQUEST_FAILED',
      },
    }),
  ],
  controllers: [HealthController],
  providers: [
    { provide: APP_GUARD, useClass: ThrottlerGuard },
    { provide: APP_GUARD, useExisting: JwtAuthGuard },
    { provide: APP_GUARD, useExisting: OnboardingGuard },
    { provide: APP_GUARD, useExisting: RolesGuard },
  ],
})
export class AppModule {
  static configure(options: Partial<RuntimeOptions> = {}): DynamicModule {
    return { module: AppModule, imports: [RuntimeModule.configure(options)] };
  }
}

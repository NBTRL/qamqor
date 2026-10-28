import { Global, Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module.js';
import { CryptoService } from './crypto.service.js';
import { RedisService } from './redis.service.js';
import { AuditService } from './audit.service.js';
import { QueuesService } from './queues.service.js';
import { MailService, AuthMailService } from './mail.service.js';
import { RedisThrottlerStorage } from './throttle.service.js';

@Global()
@Module({
  imports: [PrismaModule],
  providers: [
    CryptoService,
    RedisService,
    AuditService,
    QueuesService,
    MailService,
    AuthMailService,
    RedisThrottlerStorage,
  ],
  exports: [
    PrismaModule,
    CryptoService,
    RedisService,
    AuditService,
    QueuesService,
    MailService,
    AuthMailService,
    RedisThrottlerStorage,
  ],
})
export class InfrastructureModule {}

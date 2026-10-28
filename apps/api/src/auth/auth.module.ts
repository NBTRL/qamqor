import { Global, Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { getEnvironment } from '../config/environment.js';
import { AuthService } from './auth.service.js';
import { AuthController, FakeTelegramController } from './auth.controller.js';
import { MeController } from './me.controller.js';
import { MeService } from './me.service.js';
import { TelegramService } from './telegram.service.js';
import { TelegramController, TelegramWebhookGuard } from './telegram.controller.js';
import {
  CuratorOfPlaceGuard,
  JwtAuthGuard,
  OnboardingGuard,
  OptionalJwtGuard,
  RolesGuard,
} from './guards.js';

@Global()
@Module({
  imports: [
    JwtModule.registerAsync({
      useFactory: () => ({
        secret: getEnvironment().JWT_SECRET,
        signOptions: { algorithm: 'HS256' },
        verifyOptions: { algorithms: ['HS256'] },
      }),
    }),
  ],
  controllers: [AuthController, FakeTelegramController, MeController, TelegramController],
  providers: [
    AuthService,
    MeService,
    TelegramService,
    TelegramWebhookGuard,
    JwtAuthGuard,
    OptionalJwtGuard,
    OnboardingGuard,
    RolesGuard,
    CuratorOfPlaceGuard,
  ],
  exports: [
    AuthService,
    MeService,
    TelegramService,
    JwtAuthGuard,
    OptionalJwtGuard,
    OnboardingGuard,
    RolesGuard,
    CuratorOfPlaceGuard,
  ],
})
export class AuthModule {}

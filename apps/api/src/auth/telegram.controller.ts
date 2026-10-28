import {
  Body,
  Controller,
  HttpCode,
  Injectable,
  Post,
  UseGuards,
  type CanActivate,
  type ExecutionContext,
} from '@nestjs/common';
import {
  ApiDefaultResponse,
  ApiHeader,
  ApiOkResponse,
  ApiProperty,
  ApiPropertyOptional,
  ApiTags,
} from '@nestjs/swagger';
import { SkipThrottle } from '@nestjs/throttler';
import { Allow, IsInt, Min } from 'class-validator';
import type { Update } from 'grammy/types';
import type { Request } from 'express';
import { TelegramService } from './telegram.service.js';
import { Public } from '../common/http.js';
import { ApiErrorDto } from '../common/dto.js';
import { OkDto } from '../common/query.dto.js';

class TelegramUpdateDto {
  @ApiProperty() @IsInt() @Min(0) update_id!: number;
  @ApiPropertyOptional({ type: 'object', additionalProperties: true }) @Allow() message?: unknown;
  @ApiPropertyOptional({ type: 'object', additionalProperties: true })
  @Allow()
  callback_query?: unknown;
}
@Injectable()
export class TelegramWebhookGuard implements CanActivate {
  constructor(private readonly telegram: TelegramService) {}
  canActivate(context: ExecutionContext): boolean {
    const value = context.switchToHttp().getRequest<Request>().headers[
      'x-telegram-bot-api-secret-token'
    ];
    this.telegram.verifyWebhook(typeof value === 'string' ? value : undefined);
    return true;
  }
}
@ApiTags('telegram')
@Public()
@SkipThrottle()
@UseGuards(TelegramWebhookGuard)
@Controller('telegram')
export class TelegramController {
  constructor(private readonly telegram: TelegramService) {}
  @Post('webhook')
  @HttpCode(200)
  @ApiHeader({ name: 'X-Telegram-Bot-Api-Secret-Token', required: true })
  @ApiOkResponse({ type: OkDto })
  @ApiDefaultResponse({ type: ApiErrorDto })
  webhook(@Body() body: TelegramUpdateDto) {
    return this.telegram.handleUpdate(body as unknown as Update);
  }
}

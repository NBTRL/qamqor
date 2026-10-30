import { Body, Controller, Get, Headers, HttpCode, Post, Query, Req, Res } from '@nestjs/common';
import { ApiBody, ApiDefaultResponse, ApiHeader, ApiOkResponse, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import type { Request, Response, CookieOptions } from 'express';
import {
  ADMIN_CHALLENGE_COOKIE_NAME,
  REFRESH_COOKIE_NAME,
  REFRESH_TOKEN_TTL_SECONDS,
  ErrorCode,
} from '@club/shared';
import { AuthService } from './auth.service.js';
import {
  CodeDto,
  EmailDto,
  EmailVerifyDto,
  EmptyDto,
  FakeTelegramDto,
  LoginStatusQueryDto,
  SessionResponseDto,
  TelegramStartResponseDto,
  VerifyEmailQueryDto,
} from './auth.dto.js';
import { Public } from '../common/http.js';
import { ApiException } from '../common/api-exception.js';
import { ApiErrorDto } from '../common/dto.js';
import { OkDto } from '../common/query.dto.js';
import { getEnvironment } from '../config/environment.js';

const cookieOptions: CookieOptions = {
  httpOnly: true,
  secure: true,
  sameSite: 'lax',
  path: '/',
};
export const requestDevice = (req: Request) => ({
  ip: req.ip ?? '127.0.0.1',
  userAgent: req.headers['user-agent'] ?? '',
});
const cookie = (req: Request, name: string): string => {
  const value: unknown = (req.cookies as Record<string, unknown> | undefined)?.[name];
  return typeof value === 'string' ? value : '';
};
function checkOrigin(req: Request): void {
  const origin = req.headers.origin;
  if (origin !== getEnvironment().WEB_URL) throw new ApiException(ErrorCode.FORBIDDEN);
}
function sessionReply<T extends { refreshToken: string }>(session: T, res: Response) {
  res.cookie(REFRESH_COOKIE_NAME, session.refreshToken, {
    ...cookieOptions,
    maxAge: REFRESH_TOKEN_TTL_SECONDS * 1000,
  });
  const { refreshToken: _refreshToken, ...body } = session;
  return body;
}
@ApiTags('auth')
@ApiDefaultResponse({ type: ApiErrorDto })
@Public()
@Controller('auth')
export class AuthController {
  constructor(private readonly auth: AuthService) {}
  @Post('telegram/start')
  @HttpCode(200)
  @Throttle({ default: { limit: 3, ttl: 60000 } })
  @ApiBody({ type: EmptyDto, required: false })
  @ApiOkResponse({ type: TelegramStartResponseDto })
  start(@Req() req: Request, @Body() _body: EmptyDto) {
    return this.auth.start(requestDevice(req));
  }

  @Get('telegram/status')
  @ApiHeader({ name: 'X-Poll-Secret', required: true })
  @ApiOkResponse({ type: SessionResponseDto })
  async status(
    @Query() query: LoginStatusQueryDto,
    @Headers('x-poll-secret') secret: string | undefined,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    if (secret && secret.length > 512) throw new ApiException(ErrorCode.LOGIN_TOKEN_INVALID);
    const result = await this.auth.status(query.token, secret ?? '', requestDevice(req));
    if ('preliminaryToken' in result) {
      res.cookie(ADMIN_CHALLENGE_COOKIE_NAME, result.preliminaryToken, {
        ...cookieOptions,
        expires: result.expiresAt,
      });
      const { preliminaryToken: _preliminaryToken, mail: _mail, ...body } = result;
      return body;
    }
    if ('refreshToken' in result) return sessionReply(result, res);
    return result;
  }
  @Post('admin/verify-code')
  @HttpCode(200)
  @Throttle({ default: { limit: 10, ttl: 60000 } })
  @ApiOkResponse({ type: SessionResponseDto })
  async admin(
    @Body() body: CodeDto,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    checkOrigin(req);
    const session = await this.auth.verifyAdmin(
      cookie(req, ADMIN_CHALLENGE_COOKIE_NAME),
      body.code,
      requestDevice(req),
    );
    res.clearCookie(ADMIN_CHALLENGE_COOKIE_NAME, cookieOptions);
    return sessionReply(session, res);
  }
  @Post('refresh')
  @HttpCode(200)
  @ApiOkResponse({ type: SessionResponseDto })
  async refresh(
    @Body() _body: EmptyDto,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    checkOrigin(req);
    return sessionReply(
      await this.auth.refresh(cookie(req, REFRESH_COOKIE_NAME), requestDevice(req).userAgent),
      res,
    );
  }
  @Post('logout')
  @HttpCode(200)
  @ApiOkResponse({ type: OkDto })
  async logout(@Req() req: Request, @Res({ passthrough: true }) res: Response) {
    checkOrigin(req);
    await this.auth.logout(
      cookie(req, REFRESH_COOKIE_NAME),
      cookie(req, ADMIN_CHALLENGE_COOKIE_NAME),
    );
    res.clearCookie(REFRESH_COOKIE_NAME, cookieOptions);
    res.clearCookie(ADMIN_CHALLENGE_COOKIE_NAME, cookieOptions);
    return { ok: true };
  }
  @Post('email/login-code')
  @HttpCode(200)
  @Throttle({ default: { limit: 3, ttl: 900000 } })
  @ApiOkResponse({ type: OkDto })
  emailStart(@Body() body: EmailDto) {
    return this.auth.emailLoginStart(body.email);
  }
  @Post('email/verify')
  @HttpCode(200)
  @Throttle({ default: { limit: 10, ttl: 60000 } })
  @ApiOkResponse({ type: SessionResponseDto })
  async emailVerify(
    @Body() body: EmailVerifyDto,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    checkOrigin(req);
    return sessionReply(
      await this.auth.emailLoginVerify(body.email, body.code, requestDevice(req).userAgent),
      res,
    );
  }
  @Get('verify-email')
  @ApiOkResponse({ type: OkDto })
  verifyEmail(@Query() query: VerifyEmailQueryDto) {
    return this.auth.verifyEmail(query.token);
  }
}

@ApiTags('dev')
@ApiDefaultResponse({ type: ApiErrorDto })
@Public()
@Controller('dev/telegram')
export class FakeTelegramController {
  constructor(private readonly auth: AuthService) {}
  @Post('confirm')
  @HttpCode(200)
  @ApiOkResponse({ type: SessionResponseDto })
  async confirm(@Body() body: FakeTelegramDto) {
    const env = getEnvironment();
    if (!env.DEV_FAKE_TELEGRAM || env.NODE_ENV === 'production')
      throw new ApiException(ErrorCode.NOT_FOUND);
    await this.auth.bindChat(body.token, body.telegramId);
    const token = await this.auth.receiveContact({
      telegramId: body.telegramId,
      contactUserId: body.contactUserId ?? body.telegramId,
      chatId: body.telegramId,
      phone: body.phone,
      fullName: body.fullName,
      username: body.telegramUsername,
    });
    if (!body.contactOnly)
      await this.auth.confirmDevice(token.id, body.telegramId, body.confirm !== false);
    return {
      status: body.contactOnly
        ? 'CONTACT_RECEIVED'
        : body.confirm === false
          ? 'DECLINED'
          : 'CONFIRMED',
      expiresAt: token.expiresAt,
    };
  }
}

import { Injectable } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { randomUUID } from 'node:crypto';
import { isIP } from 'node:net';
import {
  ACCESS_TOKEN_TTL_SECONDS,
  ADMIN_CODE_TTL_SECONDS,
  EMAIL_CODE_TTL_SECONDS,
  LOGIN_TOKEN_TTL_SECONDS,
  REFRESH_TOKEN_TTL_SECONDS,
  ErrorCode,
  LoginTokenStatus,
  telegramIdSchema,
  emailSchema,
} from '@club/shared';
import { PrismaService } from '../prisma/prisma.service.js';
import { CryptoService } from '../common/crypto.service.js';
import { RedisService } from '../common/redis.service.js';
import { AuditService, type Tx } from '../common/audit.service.js';
import { AuthMailService } from '../common/mail.service.js';
import { ApiException } from '../common/api-exception.js';
import { getEnvironment } from '../config/environment.js';
import type { LoginToken, User } from '../generated/prisma/client.js';
import type { Actor } from '../common/http.js';

type Failure = { error: ErrorCode; details?: Record<string, unknown> };
type Session = {
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
  tokenType: 'Bearer';
  status: LoginTokenStatus.USED;
};
type Exchange =
  | Session
  | { status: LoginTokenStatus.PENDING | LoginTokenStatus.CONTACT_RECEIVED; expiresAt: Date }
  | {
      status: LoginTokenStatus.CONFIRMED;
      nextStep: 'ADMIN_EMAIL_CODE';
      expiresAt: Date;
      preliminaryToken: string;
      mail: { email: string; code: string; userId: string };
    };
export interface TelegramContact {
  telegramId: string;
  contactUserId: string;
  chatId: string;
  phone: string;
  fullName: string;
  username?: string;
}
export interface RequestDevice {
  ip: string;
  userAgent: string;
}
const failure = (error: ErrorCode, details?: Record<string, unknown>): Failure => ({
  error,
  ...(details ? { details } : {}),
});
const isFailure = (value: object): value is Failure => 'error' in value;

@Injectable()
export class AuthService {
  private readonly env = getEnvironment();
  constructor(
    private readonly prisma: PrismaService,
    private readonly crypto: CryptoService,
    private readonly redis: RedisService,
    private readonly audit: AuditService,
    private readonly jwt: JwtService,
    private readonly mail: AuthMailService,
  ) {}

  async start(device: RequestDevice) {
    if (!this.env.TELEGRAM_BOT_TOKEN && !this.env.DEV_FAKE_TELEGRAM)
      throw new ApiException(ErrorCode.TELEGRAM_UNAVAILABLE);
    const token = this.crypto.random(),
      pollSecret = this.crypto.random();
    const expiresAt = new Date(Date.now() + LOGIN_TOKEN_TTL_SECONDS * 1000);
    await this.prisma.loginToken.create({
      data: {
        tokenHash: this.crypto.hash(token),
        pollSecretHash: this.crypto.hash(pollSecret),
        expiresAt,
        createdIp: isIP(device.ip) ? device.ip : '0.0.0.0',
        createdUserAgent: device.userAgent.slice(0, 512),
      },
    });
    return {
      token,
      pollSecret,
      expiresAt,
      deepLink: `https://t.me/${this.env.TELEGRAM_BOT_USERNAME || 'club_dev_bot'}?start=login_${token}`,
    };
  }

  private async lockLogin(tx: Tx, tokenHash: string): Promise<LoginToken | null> {
    await tx.$queryRaw`SELECT "id" FROM "login_tokens" WHERE "tokenHash"=${tokenHash} FOR UPDATE`;
    return tx.loginToken.findUnique({ where: { tokenHash } });
  }
  private async expiry(tx: Tx, token: LoginToken): Promise<Failure | null> {
    if (token.expiresAt.getTime() > Date.now()) return null;
    if (token.status === 'PENDING' || token.status === 'CONTACT_RECEIVED') {
      await this.audit.transition(
        tx,
        token.userId,
        'LoginToken',
        token.id,
        'LoginTokenStatus',
        token.status,
        'EXPIRED',
      );
      await tx.loginToken.update({ where: { id: token.id }, data: { status: 'EXPIRED' } });
    }
    return failure(ErrorCode.LOGIN_TOKEN_EXPIRED);
  }
  async bindChat(token: string, chatId: string): Promise<string> {
    const record = await this.prisma.loginToken.findUnique({
      where: { tokenHash: this.crypto.hash(token) },
    });
    if (!record || record.status !== 'PENDING')
      throw new ApiException(ErrorCode.LOGIN_TOKEN_INVALID);
    if (record.expiresAt.getTime() <= Date.now())
      throw new ApiException(ErrorCode.LOGIN_TOKEN_EXPIRED);
    await this.redis.client.set(
      this.redis.key(`login-chat:${this.crypto.hash(chatId)}`),
      record.id,
      'PX',
      Math.max(1, record.expiresAt.getTime() - Date.now()),
    );
    return record.id;
  }
  async receiveContact(contact: TelegramContact): Promise<LoginToken> {
    if (contact.telegramId !== contact.contactUserId)
      throw new ApiException(ErrorCode.TELEGRAM_CONTACT_MISMATCH);
    const telegramId = BigInt(telegramIdSchema.parse(contact.telegramId));
    const chatId = BigInt(telegramIdSchema.parse(contact.chatId));
    const tokenId = await this.redis.client.get(
      this.redis.key(`login-chat:${this.crypto.hash(contact.chatId)}`),
    );
    if (!tokenId) throw new ApiException(ErrorCode.TELEGRAM_CONTACT_MISMATCH);
    const result = await this.prisma.$transaction(async (tx): Promise<LoginToken | Failure> => {
      await tx.$queryRaw`SELECT "id" FROM "login_tokens" WHERE "id"=${tokenId}::uuid FOR UPDATE`;
      const token = await tx.loginToken.findUnique({ where: { id: tokenId } });
      if (!token) return failure(ErrorCode.LOGIN_TOKEN_INVALID);
      const expired = await this.expiry(tx, token);
      if (expired) return expired;
      // Повтор webhook/контакта после ошибки отправки кнопок не должен ломать начатый вход.
      if (token.status === 'CONTACT_RECEIVED' && token.telegramId === telegramId && token.userId) {
        const owner = await tx.user.findUnique({ where: { id: token.userId } });
        if (!owner || owner.isBlocked || owner.anonymizedAt)
          return failure(ErrorCode.ACCOUNT_BLOCKED);
        return token;
      }
      if (token.status !== 'PENDING') return failure(ErrorCode.LOGIN_TOKEN_INVALID);
      const phone = `+${contact.phone.replace(/\D/g, '')}`;
      if (!/^\+[1-9]\d{6,14}$/.test(phone)) return failure(ErrorCode.VALIDATION_ERROR);
      const user = await tx.user.upsert({
        where: { telegramId },
        create: {
          telegramId,
          chatId,
          phone,
          fullName: contact.fullName.trim().slice(0, 160) || 'Пользователь Telegram',
          telegramUsername: contact.username?.slice(0, 100) ?? null,
          role: 'CANDIDATE',
        },
        update: {
          chatId,
          phone,
          telegramUsername: contact.username?.slice(0, 100) ?? null,
          botBlockedAt: null,
        },
      });
      if (user.isBlocked || user.anonymizedAt) return failure(ErrorCode.ACCOUNT_BLOCKED);
      await this.audit.transition(
        tx,
        user.id,
        'LoginToken',
        token.id,
        'LoginTokenStatus',
        token.status,
        'CONTACT_RECEIVED',
      );
      return tx.loginToken.update({
        where: { id: token.id },
        data: { userId: user.id, telegramId, status: 'CONTACT_RECEIVED' },
      });
    });
    if (isFailure(result)) throw new ApiException(result.error);
    return result;
  }
  async confirmDevice(id: string, telegramId: string, accepted: boolean): Promise<void> {
    const result = await this.prisma.$transaction(async (tx): Promise<Failure | { ok: true }> => {
      await tx.$queryRaw`SELECT "id" FROM "login_tokens" WHERE "id"=${id}::uuid FOR UPDATE`;
      const token = await tx.loginToken.findUnique({ where: { id } });
      if (!token || token.telegramId?.toString() !== telegramId)
        return failure(ErrorCode.LOGIN_TOKEN_INVALID);
      const expired = await this.expiry(tx, token);
      if (expired) return expired;
      if (token.status !== 'CONTACT_RECEIVED') return failure(ErrorCode.LOGIN_TOKEN_INVALID);
      const status = accepted ? 'CONFIRMED' : 'DECLINED';
      await this.audit.transition(
        tx,
        token.userId,
        'LoginToken',
        id,
        'LoginTokenStatus',
        token.status,
        status,
      );
      await tx.loginToken.update({ where: { id }, data: { status } });
      return { ok: true };
    });
    if (isFailure(result)) throw new ApiException(result.error);
  }
  async status(rawToken: string, pollSecret: string, device: RequestDevice): Promise<Exchange> {
    const tokenHash = this.crypto.hash(rawToken);
    await this.redis.limit(`poll-total:${tokenHash}`, 200, LOGIN_TOKEN_TTL_SECONDS * 1000);
    await this.redis.limit(`poll-second:${tokenHash}`, 1, 1000);
    const result = await this.prisma.$transaction(async (tx): Promise<Exchange | Failure> => {
      const token = await this.lockLogin(tx, tokenHash);
      if (!token) return failure(ErrorCode.LOGIN_TOKEN_INVALID);
      const expired = await this.expiry(tx, token);
      if (expired) return expired;
      if (token.attempts >= 5 || token.status === 'USED')
        return failure(ErrorCode.LOGIN_TOKEN_INVALID);
      if (!this.crypto.equal(this.crypto.hash(pollSecret), token.pollSecretHash)) {
        await tx.loginToken.update({
          where: { id: token.id },
          data: { attempts: { increment: 1 } },
        });
        return failure(ErrorCode.LOGIN_TOKEN_INVALID);
      }
      if (token.status === 'DECLINED')
        return failure(ErrorCode.LOGIN_TOKEN_INVALID, { status: LoginTokenStatus.DECLINED });
      if (token.status === 'PENDING' || token.status === 'CONTACT_RECEIVED')
        return {
          status: token.status as LoginTokenStatus.PENDING | LoginTokenStatus.CONTACT_RECEIVED,
          expiresAt: token.expiresAt,
        };
      if (token.status !== 'CONFIRMED' || !token.userId)
        return failure(ErrorCode.LOGIN_TOKEN_INVALID);
      await tx.$queryRaw`SELECT "id" FROM "users" WHERE "id"=${token.userId}::uuid FOR UPDATE`;
      const user = await tx.user.findUniqueOrThrow({ where: { id: token.userId } });
      if (user.isBlocked || user.anonymizedAt) return failure(ErrorCode.ACCOUNT_BLOCKED);
      if (user.role === 'ADMIN' && (!user.email || !user.emailVerifiedAt))
        return failure(ErrorCode.ADMIN_EMAIL_REQUIRED);
      await this.audit.transition(
        tx,
        user.id,
        'LoginToken',
        token.id,
        'LoginTokenStatus',
        token.status,
        'USED',
      );
      await tx.loginToken.update({ where: { id: token.id }, data: { status: 'USED' } });
      if (user.role === 'ADMIN') {
        const id = randomUUID(),
          code = this.crypto.code();
        const expiresAt = new Date(Date.now() + ADMIN_CODE_TTL_SECONDS * 1000);
        await tx.adminLoginCode.create({
          data: {
            id,
            userId: user.id,
            codeHash: this.crypto.hash(`admin:${id}:${code}`),
            deviceHash: this.crypto.hash(device.userAgent),
            expiresAt,
          },
        });
        return {
          status: LoginTokenStatus.CONFIRMED,
          nextStep: 'ADMIN_EMAIL_CODE',
          expiresAt,
          preliminaryToken: await this.jwt.signAsync(
            { sub: user.id, challengeId: id, scope: 'admin-prelim' },
            { expiresIn: ADMIN_CODE_TTL_SECONDS },
          ),
          mail: { email: user.email!, code, userId: user.id },
        };
      }
      return this.issue(tx, user, device.userAgent, false);
    });
    if (isFailure(result)) throw new ApiException(result.error, result.details);
    if ('mail' in result)
      await this.mail.send(
        result.mail.email,
        'Код входа администратора',
        `Код входа в Клуб волонтеров: ${result.mail.code}. Действует 10 минут. Никому не сообщайте код.`,
        result.mail.userId,
        ADMIN_CODE_TTL_SECONDS,
      );
    return result;
  }
  private async issue(
    tx: Tx,
    user: User,
    userAgent: string,
    adminVerified: boolean,
    familyId: string = randomUUID(),
  ): Promise<Session> {
    await tx.$queryRaw`SELECT "id" FROM "users" WHERE "id"=${user.id}::uuid FOR UPDATE`;
    user = await tx.user.findUniqueOrThrow({ where: { id: user.id } });
    if (user.isBlocked || user.anonymizedAt) throw new ApiException(ErrorCode.ACCOUNT_BLOCKED);
    if (user.role === 'ADMIN' && (!adminVerified || !user.email || !user.emailVerifiedAt))
      throw new ApiException(ErrorCode.ADMIN_EMAIL_REQUIRED);
    const raw = this.crypto.random();
    const refresh = await tx.refreshToken.create({
      data: {
        userId: user.id,
        familyId,
        tokenHash: this.crypto.hash(raw),
        deviceHash: this.crypto.hash(userAgent),
        adminVerified,
        expiresAt: new Date(Date.now() + REFRESH_TOKEN_TTL_SECONDS * 1000),
      },
    });
    await tx.user.update({ where: { id: user.id }, data: { lastLoginAt: new Date() } });
    return {
      status: LoginTokenStatus.USED,
      refreshToken: raw,
      accessToken: await this.jwt.signAsync(
        { sub: user.id, sessionId: refresh.id, scope: 'access' },
        { expiresIn: ACCESS_TOKEN_TTL_SECONDS },
      ),
      expiresIn: ACCESS_TOKEN_TTL_SECONDS,
      tokenType: 'Bearer',
    };
  }
  async verifyAdmin(preliminary: string, code: string, device: RequestDevice): Promise<Session> {
    let claims: { sub: string; challengeId: string; scope: string };
    try {
      claims = await this.jwt.verifyAsync(preliminary);
    } catch {
      throw new ApiException(ErrorCode.ADMIN_CODE_INVALID);
    }
    if (claims.scope !== 'admin-prelim' || !claims.challengeId || !claims.sub)
      throw new ApiException(ErrorCode.ADMIN_CODE_INVALID);
    const result = await this.prisma.$transaction(async (tx): Promise<Session | Failure> => {
      await tx.$queryRaw`SELECT "id" FROM "users" WHERE "id"=${claims.sub}::uuid FOR UPDATE`;
      await tx.$queryRaw`SELECT "id" FROM "admin_login_codes" WHERE "id"=${claims.challengeId}::uuid FOR UPDATE`;
      const record = await tx.adminLoginCode.findUnique({
        where: { id: claims.challengeId },
        include: { user: true },
      });
      if (
        !record ||
        record.userId !== claims.sub ||
        record.usedAt ||
        record.expiresAt.getTime() <= Date.now() ||
        record.attempts >= 5 ||
        record.deviceHash !== this.crypto.hash(device.userAgent)
      )
        return failure(ErrorCode.ADMIN_CODE_INVALID);
      if (!this.crypto.equal(record.codeHash, this.crypto.hash(`admin:${record.id}:${code}`))) {
        await tx.adminLoginCode.update({
          where: { id: record.id },
          data: { attempts: { increment: 1 } },
        });
        return failure(ErrorCode.ADMIN_CODE_INVALID);
      }
      if (record.user.isBlocked || record.user.anonymizedAt)
        return failure(ErrorCode.ACCOUNT_BLOCKED);
      if (record.user.role !== 'ADMIN' || !record.user.emailVerifiedAt)
        return failure(ErrorCode.ADMIN_EMAIL_REQUIRED);
      await tx.adminLoginCode.update({ where: { id: record.id }, data: { usedAt: new Date() } });
      return this.issue(tx, record.user, device.userAgent, true);
    });
    if (isFailure(result)) throw new ApiException(result.error);
    return result;
  }
  async refresh(raw: string, userAgent: string): Promise<Session> {
    const hash = this.crypto.hash(raw);
    const result = await this.prisma.$transaction(async (tx): Promise<Session | Failure> => {
      const initial = await tx.refreshToken.findUnique({ where: { tokenHash: hash } });
      if (!initial) return failure(ErrorCode.UNAUTHORIZED);
      await tx.$queryRaw`SELECT "id" FROM "users" WHERE "id"=${initial.userId}::uuid FOR UPDATE`;
      // Корневая строка семейства сериализует ротацию, отзыв и повторное использование.
      await tx.$queryRaw`SELECT "id" FROM "refresh_tokens" WHERE "familyId"=${initial.familyId}::uuid ORDER BY "createdAt", "id" LIMIT 1 FOR UPDATE`;
      await tx.$queryRaw`SELECT "id" FROM "refresh_tokens" WHERE "tokenHash"=${hash} FOR UPDATE`;
      const token = await tx.refreshToken.findUnique({
        where: { tokenHash: hash },
        include: { user: true },
      });
      if (!token) return failure(ErrorCode.UNAUTHORIZED);
      if (token.usedAt || token.revokedAt || token.deviceHash !== this.crypto.hash(userAgent)) {
        await tx.refreshToken.updateMany({
          where: { familyId: token.familyId },
          data: { revokedAt: new Date() },
        });
        return failure(ErrorCode.UNAUTHORIZED);
      }
      if (
        token.expiresAt.getTime() <= Date.now() ||
        token.user.isBlocked ||
        token.user.anonymizedAt
      )
        return failure(ErrorCode.UNAUTHORIZED);
      if (token.user.role === 'ADMIN' && (!token.adminVerified || !token.user.emailVerifiedAt))
        return failure(ErrorCode.ADMIN_EMAIL_REQUIRED);
      await tx.refreshToken.update({ where: { id: token.id }, data: { usedAt: new Date() } });
      return this.issue(tx, token.user, userAgent, token.adminVerified, token.familyId);
    });
    if (isFailure(result)) throw new ApiException(result.error);
    return result;
  }
  async logout(raw: string, preliminary?: string): Promise<void> {
    await this.prisma.$transaction(async (tx) => {
      const token = await tx.refreshToken.findUnique({
        where: { tokenHash: this.crypto.hash(raw) },
      });
      if (!token) return;
      await tx.$queryRaw`SELECT "id" FROM "users" WHERE "id"=${token.userId}::uuid FOR UPDATE`;
      await tx.$queryRaw`SELECT "id" FROM "refresh_tokens" WHERE "familyId"=${token.familyId}::uuid ORDER BY "createdAt", "id" LIMIT 1 FOR UPDATE`;
      await tx.refreshToken.updateMany({
        where: { familyId: token.familyId },
        data: { revokedAt: new Date() },
      });
    });
    if (!preliminary) return;
    let claims: { sub: string; challengeId: string; scope: string };
    try {
      claims = await this.jwt.verifyAsync(preliminary);
    } catch {
      return;
    }
    if (claims.scope !== 'admin-prelim' || !claims.sub || !claims.challengeId) return;
    await this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT "id" FROM "users" WHERE "id"=${claims.sub}::uuid FOR UPDATE`;
      await tx.adminLoginCode.updateMany({
        where: { id: claims.challengeId, userId: claims.sub, usedAt: null },
        data: { usedAt: new Date() },
      });
    });
  }
  async authenticate(access: string): Promise<Actor> {
    let claims: { sub: string; sessionId: string; scope: string };
    try {
      claims = await this.jwt.verifyAsync(access);
    } catch {
      throw new ApiException(ErrorCode.UNAUTHORIZED);
    }
    if (claims.scope !== 'access' || !claims.sessionId)
      throw new ApiException(ErrorCode.UNAUTHORIZED);
    const token = await this.prisma.refreshToken.findUnique({
      where: { id: claims.sessionId },
      include: { user: true },
    });
    if (
      !token ||
      token.userId !== claims.sub ||
      token.revokedAt ||
      token.expiresAt.getTime() <= Date.now() ||
      token.user.isBlocked ||
      token.user.anonymizedAt
    )
      throw new ApiException(ErrorCode.UNAUTHORIZED);
    if (token.user.role === 'ADMIN' && (!token.adminVerified || !token.user.emailVerifiedAt))
      throw new ApiException(ErrorCode.UNAUTHORIZED);
    return { ...token.user, sessionId: token.id, adminVerified: token.adminVerified };
  }
  async emailLoginStart(rawEmail: string): Promise<{ ok: true }> {
    const email = emailSchema.parse(rawEmail);
    await this.redis.limit(`email-login:${this.crypto.hash(email)}`, 3, 15 * 60_000);
    const user = await this.prisma.user.findUnique({ where: { email } });
    if (
      !user ||
      user.role === 'ADMIN' ||
      !user.emailVerifiedAt ||
      user.isBlocked ||
      user.anonymizedAt
    )
      return { ok: true };
    const id = randomUUID(),
      code = this.crypto.code();
    const active = await this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT "id" FROM "users" WHERE "id"=${user.id}::uuid FOR UPDATE`;
      const fresh = await tx.user.findUniqueOrThrow({ where: { id: user.id } });
      if (
        fresh.isBlocked ||
        fresh.anonymizedAt ||
        fresh.role === 'ADMIN' ||
        fresh.email !== email ||
        !fresh.emailVerifiedAt
      )
        return false;
      await tx.emailLoginCode.updateMany({
        where: { userId: user.id, usedAt: null },
        data: { usedAt: new Date() },
      });
      await tx.emailLoginCode.create({
        data: {
          id,
          userId: user.id,
          codeHash: this.crypto.hash(`email:${id}:${code}`),
          expiresAt: new Date(Date.now() + EMAIL_CODE_TTL_SECONDS * 1000),
        },
      });
      return true;
    });
    if (!active) return { ok: true };
    await this.mail.send(
      email,
      'Код входа в Клуб волонтеров',
      `Код входа: ${code}. Действует 5 минут. Никому не сообщайте код.`,
      user.id,
    );
    return { ok: true };
  }
  async emailLoginVerify(email: string, code: string, userAgent: string): Promise<Session> {
    const result = await this.prisma.$transaction(async (tx): Promise<Session | Failure> => {
      const initial = await tx.user.findUnique({ where: { email } });
      if (!initial) return failure(ErrorCode.UNAUTHORIZED);
      await tx.$queryRaw`SELECT "id" FROM "users" WHERE "id"=${initial.id}::uuid FOR UPDATE`;
      const user = await tx.user.findUnique({ where: { email } });
      if (
        !user ||
        user.role === 'ADMIN' ||
        !user.emailVerifiedAt ||
        user.isBlocked ||
        user.anonymizedAt
      )
        return failure(ErrorCode.UNAUTHORIZED);
      const rows = await tx.$queryRaw<
        Array<{ id: string }>
      >`SELECT "id" FROM "email_login_codes" WHERE "userId"=${user.id}::uuid ORDER BY "createdAt" DESC LIMIT 1 FOR UPDATE`;
      const record = rows[0]
        ? await tx.emailLoginCode.findUnique({ where: { id: rows[0].id } })
        : null;
      if (
        !record ||
        record.usedAt ||
        record.attempts >= 5 ||
        record.expiresAt.getTime() <= Date.now()
      )
        return failure(ErrorCode.UNAUTHORIZED);
      if (!this.crypto.equal(record.codeHash, this.crypto.hash(`email:${record.id}:${code}`))) {
        await tx.emailLoginCode.update({
          where: { id: record.id },
          data: { attempts: { increment: 1 } },
        });
        return failure(ErrorCode.UNAUTHORIZED);
      }
      await tx.emailLoginCode.update({ where: { id: record.id }, data: { usedAt: new Date() } });
      return this.issue(tx, user, userAgent, false);
    });
    if (isFailure(result)) throw new ApiException(result.error);
    return result;
  }
  async requestEmail(user: User, email: string): Promise<{ ok: true }> {
    const existing = await this.prisma.user.findUnique({ where: { email } });
    if (existing && existing.id !== user.id) throw new ApiException(ErrorCode.EMAIL_ALREADY_USED);
    const raw = this.crypto.random();
    await this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT "id" FROM "users" WHERE "id"=${user.id}::uuid FOR UPDATE`;
      const fresh = await tx.user.findUniqueOrThrow({ where: { id: user.id } });
      if (fresh.isBlocked || fresh.anonymizedAt) throw new ApiException(ErrorCode.ACCOUNT_BLOCKED);
      await tx.emailToken.updateMany({
        where: { userId: user.id, usedAt: null },
        data: { usedAt: new Date() },
      });
      await tx.emailToken.create({
        data: {
          userId: user.id,
          email,
          tokenHash: this.crypto.hash(raw),
          expiresAt: new Date(Date.now() + 24 * 60 * 60_000),
        },
      });
    });
    await this.mail.send(
      email,
      'Подтвердите e-mail Клуба волонтеров',
      `Для подтверждения e-mail откройте ссылку: ${this.env.WEB_URL}/verify-email?token=${raw}`,
      user.id,
      24 * 60 * 60,
    );
    return { ok: true };
  }
  async verifyEmail(raw: string): Promise<{ ok: true }> {
    const hash = this.crypto.hash(raw);
    const result = await this.prisma.$transaction(async (tx): Promise<{ ok: true } | Failure> => {
      const initial = await tx.emailToken.findUnique({ where: { tokenHash: hash } });
      if (!initial) return failure(ErrorCode.LOGIN_TOKEN_INVALID);
      await tx.$queryRaw`SELECT "id" FROM "users" WHERE "id"=${initial.userId}::uuid FOR UPDATE`;
      await tx.$queryRaw`SELECT "id" FROM "email_tokens" WHERE "tokenHash"=${hash} FOR UPDATE`;
      const token = await tx.emailToken.findUnique({
        where: { tokenHash: hash },
        include: { user: true },
      });
      if (
        !token ||
        token.usedAt ||
        token.expiresAt.getTime() <= Date.now() ||
        token.user.anonymizedAt ||
        token.user.isBlocked
      )
        return failure(ErrorCode.LOGIN_TOKEN_INVALID);
      const duplicate = await tx.user.findUnique({ where: { email: token.email } });
      if (duplicate && duplicate.id !== token.userId) return failure(ErrorCode.EMAIL_ALREADY_USED);
      await tx.user.update({
        where: { id: token.userId },
        data: { email: token.email, emailVerifiedAt: new Date() },
      });
      await tx.emailToken.update({ where: { id: token.id }, data: { usedAt: new Date() } });
      await tx.emailLoginCode.updateMany({
        where: { userId: token.userId, usedAt: null },
        data: { usedAt: new Date() },
      });
      await tx.adminLoginCode.updateMany({
        where: { userId: token.userId, usedAt: null },
        data: { usedAt: new Date() },
      });
      if (token.user.role === 'ADMIN' && token.user.email !== token.email)
        await tx.refreshToken.updateMany({
          where: { userId: token.userId, revokedAt: null },
          data: { revokedAt: new Date() },
        });
      await this.audit.record(tx, token.userId, 'EMAIL_VERIFIED', 'User', token.userId);
      return { ok: true };
    });
    if (isFailure(result)) throw new ApiException(result.error);
    return result;
  }
}

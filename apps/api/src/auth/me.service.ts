import { Injectable } from '@nestjs/common';
import { ErrorCode, onboardingSchema, UserRole } from '@club/shared';
import { Prisma } from '../generated/prisma/client.js';
import type { User } from '../generated/prisma/client.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { AuditService } from '../common/audit.service.js';
import { lockActiveUser } from '../common/active-user.js';
import { getEnvironment } from '../config/environment.js';
import { ApiException } from '../common/api-exception.js';
import type { MePatchDto, OnboardingDto } from './auth.dto.js';
import { StorageService } from '../storage/storage.service.js';

@Injectable()
export class MeService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly storage: StorageService,
  ) {}
  async me(user: User) {
    const curators = await this.prisma.placeCurator.findMany({
      where: { userId: user.id },
      select: { placeId: true },
    });
    return {
      id: user.id,
      telegramId: user.telegramId?.toString() ?? null,
      telegramUsername: user.telegramUsername,
      phone: user.phone,
      fullName: user.fullName,
      nickname: user.nickname,
      avatarUrl: await this.storage.avatarUrl(user.id, user.avatarUrl),
      city: user.city,
      role: user.role,
      email: user.email,
      emailVerifiedAt: user.emailVerifiedAt,
      birthDate: user.birthDate?.toISOString().slice(0, 10) ?? null,
      consentAt: user.consentAt,
      consentVersion: user.consentVersion,
      botBlockedAt: user.botBlockedAt,
      onboardingCompleted: Boolean(user.birthDate && user.consentAt && user.consentVersion),
      curatorPlaceIds: curators.map((item) => item.placeId),
    };
  }
  async patch(user: User, dto: MePatchDto) {
    if (
      dto.fullName !== undefined &&
      (typeof dto.fullName !== 'string' || dto.fullName.trim().length < 2)
    )
      throw new ApiException(ErrorCode.VALIDATION_ERROR);
    if (dto.avatarUrl) {
      try {
        const url = new URL(dto.avatarUrl);
        if (!['http:', 'https:'].includes(url.protocol)) throw new Error();
      } catch {
        throw new ApiException(ErrorCode.VALIDATION_ERROR);
      }
      await this.storage.verifyAvatar(user.id, dto.avatarUrl);
    }
    const updated = await this.prisma.$transaction(async (tx) => {
      await lockActiveUser(tx, user.id);
      const row = await tx.user.update({
        where: { id: user.id },
        data: { ...dto, fullName: dto.fullName?.trim() },
      });
      await this.audit.record(tx, user.id, 'PROFILE_UPDATED', 'User', user.id, {
        fields: Object.keys(dto),
      });
      return row;
    });
    return this.me(updated);
  }
  async onboarding(user: User, dto: OnboardingDto) {
    const parsed = onboardingSchema.safeParse(dto);
    if (!parsed.success) {
      const underage = parsed.error.issues.some(
        (issue) => issue.code === 'custom' && issue.params?.code === ErrorCode.UNDERAGE,
      );
      throw new ApiException(underage ? ErrorCode.UNDERAGE : ErrorCode.VALIDATION_ERROR);
    }
    const updated = await this.prisma.$transaction(async (tx) => {
      await lockActiveUser(tx, user.id);
      const row = await tx.user.update({
        where: { id: user.id },
        data: {
          birthDate: new Date(`${parsed.data.birthDate}T00:00:00Z`),
          consentAt: new Date(),
          consentVersion: parsed.data.consentVersion,
        },
      });
      await this.audit.record(tx, user.id, 'ONBOARDING_COMPLETED', 'User', user.id, {
        consentVersion: parsed.data.consentVersion,
      });
      return row;
    });
    return this.me(updated);
  }
  async removeEmail(user: User): Promise<{ ok: true }> {
    if (user.role === UserRole.ADMIN) throw new ApiException(ErrorCode.ADMIN_EMAIL_REQUIRED);
    await this.prisma.$transaction(async (tx) => {
      const fresh = await lockActiveUser(tx, user.id);
      if (fresh.role === UserRole.ADMIN) throw new ApiException(ErrorCode.ADMIN_EMAIL_REQUIRED);
      await tx.user.update({
        where: { id: user.id },
        data: { email: null, emailVerifiedAt: null },
      });
      await tx.emailToken.deleteMany({ where: { userId: user.id } });
      await tx.emailLoginCode.deleteMany({ where: { userId: user.id } });
      await this.audit.record(tx, user.id, 'EMAIL_REMOVED', 'User', user.id);
    });
    return { ok: true };
  }
  async anonymize(user: User, actorId: string = user.id): Promise<{ ok: true }> {
    await this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT "id" FROM "users" WHERE "id"=${user.id}::uuid FOR UPDATE`;
      await tx.user.update({
        where: { id: user.id },
        data: {
          telegramId: null,
          telegramUsername: null,
          chatId: null,
          phone: null,
          fullName: 'Удаленный пользователь',
          nickname: null,
          avatarUrl: null,
          city: null,
          email: null,
          emailVerifiedAt: null,
          birthDate: null,
          consentAt: null,
          consentVersion: null,
          botBlockedAt: null,
          lastLoginAt: null,
          anonymizedAt: new Date(),
          isBlocked: true,
          role: 'CANDIDATE',
        },
      });
      await tx.refreshToken.updateMany({
        where: { userId: user.id },
        data: { revokedAt: new Date() },
      });
      await tx.placeCurator.deleteMany({ where: { userId: user.id } });
      await tx.tripRegistration.updateMany({ where: { userId: user.id }, data: { comment: null } });
      const application = await tx.candidateApplication.findUnique({ where: { userId: user.id } });
      if (application) {
        await tx.candidateApplication.update({
          where: { id: application.id },
          data: { questionnaire: Prisma.DbNull, adminComment: null },
        });
        await tx.applicationHistory.updateMany({
          where: { applicationId: application.id },
          data: { comment: null },
        });
      }
      const uploads = await tx.uploadAsset.findMany({
        where: { userId: user.id },
        select: { key: true },
      });
      await tx.reportPhoto.deleteMany({
        where: {
          OR: [
            { report: { authorId: user.id } },
            {
              url: {
                in: uploads.map((asset) => `s3://${getEnvironment().S3_BUCKET}/${asset.key}`),
              },
            },
          ],
        },
      });
      await tx.report.updateMany({
        where: { authorId: user.id },
        data: { text: 'Отчет удаленного пользователя. Статистические данные сохранены.' },
      });
      await tx.uploadAsset.updateMany({
        where: { userId: user.id },
        data: { deletedAt: new Date() },
      });
      await tx.notification.deleteMany({ where: { userId: user.id } });
      await tx.notificationSetting.deleteMany({ where: { userId: user.id } });
      await this.audit.record(tx, actorId, 'ACCOUNT_ANONYMIZED', 'User', user.id);
    });
    // После отзыва доступа удаляем challenges отдельно, не меняя порядок блокировок входа.
    await this.prisma.$transaction([
      this.prisma.loginToken.deleteMany({ where: { userId: user.id } }),
      this.prisma.emailToken.deleteMany({ where: { userId: user.id } }),
      this.prisma.emailLoginCode.deleteMany({ where: { userId: user.id } }),
      this.prisma.adminLoginCode.deleteMany({ where: { userId: user.id } }),
    ]);
    return { ok: true };
  }
}

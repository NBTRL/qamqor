import { Injectable } from '@nestjs/common';
import { ErrorCode, telegramIdSchema } from '@club/shared';
import type { Prisma, User } from '../generated/prisma/client.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { AuditService } from '../common/audit.service.js';
import { ApiException } from '../common/api-exception.js';
import { MeService } from '../auth/me.service.js';
import { pageArgs, pageResult, type PageQueryDto } from '../common/query.dto.js';
import type { Actor } from '../common/http.js';
import type { CuratorAssignDto, UserCreateDto, UserPatchDto, UserQueryDto } from './admin.dto.js';

@Injectable()
export class UsersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly me: MeService,
  ) {}
  private async project(user: User) {
    return {
      ...(await this.me.me(user)),
      isBlocked: user.isBlocked,
      anonymizedAt: user.anonymizedAt,
      createdAt: user.createdAt,
      lastLoginAt: user.lastLoginAt,
    };
  }
  async list(query: UserQueryDto) {
    const where: Prisma.UserWhereInput = {
      role: query.role,
      isBlocked: query.isBlocked,
      ...(query.search
        ? {
            OR: [
              { fullName: { contains: query.search, mode: 'insensitive' } },
              { email: { contains: query.search, mode: 'insensitive' } },
              { phone: { contains: query.search } },
            ],
          }
        : {}),
    };
    const [rows, total] = await Promise.all([
      this.prisma.user.findMany({
        where,
        orderBy: [{ createdAt: 'desc' }, { id: 'asc' }],
        ...pageArgs(query),
      }),
      this.prisma.user.count({ where }),
    ]);
    return pageResult(await Promise.all(rows.map((row) => this.project(row))), total, query);
  }
  async detail(id: string) {
    return this.project(await this.prisma.user.findUniqueOrThrow({ where: { id } }));
  }
  async create(actor: Actor, dto: UserCreateDto) {
    if (dto.role === 'ADMIN') throw new ApiException(ErrorCode.ADMIN_EMAIL_REQUIRED);
    const row = await this.prisma.$transaction(async (tx) => {
      const user = await tx.user.create({
        data: {
          telegramId: BigInt(telegramIdSchema.parse(dto.telegramId)),
          fullName: dto.fullName,
          email: dto.email,
          role: dto.role ?? 'CANDIDATE',
        },
      });
      await this.audit.record(tx, actor.id, 'CREATED', 'User', user.id, { role: user.role });
      return user;
    });
    return this.project(row);
  }
  async update(actor: Actor, id: string, dto: UserPatchDto) {
    const row = await this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT "id" FROM "users" WHERE "id"=${id}::uuid FOR UPDATE`;
      const user = await tx.user.findUniqueOrThrow({ where: { id } });
      if (user.anonymizedAt) throw new ApiException(ErrorCode.FORBIDDEN);
      const emailChanged = dto.email !== undefined && dto.email !== user.email;
      if (
        (dto.role === 'ADMIN' || user.role === 'ADMIN') &&
        (!user.emailVerifiedAt || !user.email || emailChanged)
      )
        throw new ApiException(ErrorCode.ADMIN_EMAIL_REQUIRED);
      const updated = await tx.user.update({
        where: { id },
        data: { ...dto, ...(emailChanged ? { emailVerifiedAt: null } : {}) },
      });
      if (dto.role && dto.role !== user.role) {
        if (dto.role !== 'VOLUNTEER') await tx.placeCurator.deleteMany({ where: { userId: id } });
        await this.audit.record(tx, actor.id, 'ROLE_CHANGED', 'User', id, {
          from: user.role,
          to: dto.role,
        });
      }
      if (dto.isBlocked)
        await tx.refreshToken.updateMany({
          where: { userId: id },
          data: { revokedAt: new Date() },
        });
      await this.audit.record(tx, actor.id, 'UPDATED', 'User', id, { fields: Object.keys(dto) });
      return updated;
    });
    return this.project(row);
  }
  async remove(actor: Actor, id: string) {
    return this.me.anonymize(await this.prisma.user.findUniqueOrThrow({ where: { id } }), actor.id);
  }
  async curators(query: PageQueryDto) {
    const where = query.search
      ? {
          OR: [
            { user: { fullName: { contains: query.search, mode: 'insensitive' as const } } },
            { place: { name: { contains: query.search, mode: 'insensitive' as const } } },
          ],
        }
      : {};
    const [items, total] = await Promise.all([
      this.prisma.placeCurator.findMany({ where, orderBy: { id: 'asc' }, ...pageArgs(query) }),
      this.prisma.placeCurator.count({ where }),
    ]);
    return pageResult(items, total, query);
  }
  async assign(actor: Actor, dto: CuratorAssignDto) {
    return this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT "id" FROM "users" WHERE "id"=${dto.userId}::uuid FOR UPDATE`;
      const user = await tx.user.findUniqueOrThrow({ where: { id: dto.userId } });
      if (user.role !== 'VOLUNTEER' || user.isBlocked || user.anonymizedAt)
        throw new ApiException(ErrorCode.FORBIDDEN_PLACE);
      const row = await tx.placeCurator.upsert({
        where: { userId_placeId: dto },
        create: dto,
        update: {},
      });
      await this.audit.record(tx, actor.id, 'CURATOR_ASSIGNED', 'PlaceCurator', row.id, {
        placeId: dto.placeId,
        userId: dto.userId,
      });
      return row;
    });
  }
  async unassign(actor: Actor, id: string) {
    return this.prisma.$transaction(async (tx) => {
      await tx.placeCurator.delete({ where: { id } });
      await this.audit.record(tx, actor.id, 'CURATOR_REMOVED', 'PlaceCurator', id);
      return { ok: true };
    });
  }
}

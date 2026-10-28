import { Body, Controller, Get, Param, ParseUUIDPipe, Patch, Put, Query } from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiDefaultResponse,
  ApiOkResponse,
  ApiProperty,
  ApiPropertyOptional,
  ApiTags,
} from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayUnique,
  IsArray,
  IsBoolean,
  IsEnum,
  IsIn,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  ValidateNested,
} from 'class-validator';
import {
  NOTIFICATION_TYPES,
  notificationTypeLabels,
  NotificationChannel,
  NotificationStatus,
  UserRole,
} from '@club/shared';
import { PrismaService } from '../prisma/prisma.service.js';
import { CurrentUser, Roles, type Actor } from '../common/http.js';
import { ApiErrorDto } from '../common/dto.js';
import { ApiPage, OkDto, PageQueryDto, pageArgs, pageResult } from '../common/query.dto.js';
import { ApiException } from '../common/api-exception.js';
import { ErrorCode } from '@club/shared';

export class NotificationQueryDto extends PageQueryDto {
  @ApiPropertyOptional({ enum: NotificationStatus })
  @IsOptional()
  @IsEnum(NotificationStatus)
  status?: NotificationStatus;
  @ApiPropertyOptional({ enum: NotificationChannel })
  @IsOptional()
  @IsEnum(NotificationChannel)
  channel?: NotificationChannel;
  @ApiPropertyOptional({ format: 'uuid' }) @IsOptional() @IsUUID() userId?: string;
}
export class NotificationResponseDto {
  @ApiProperty({ format: 'uuid' }) id!: string;
  @ApiProperty({ enum: NOTIFICATION_TYPES, enumName: 'NotificationType' }) type!: string;
  @ApiProperty({ type: 'object', additionalProperties: true }) payload!: Record<string, unknown>;
  @ApiProperty({ enum: NotificationChannel }) channel!: NotificationChannel;
  @ApiProperty({ enum: NotificationStatus }) status!: NotificationStatus;
  @ApiProperty() attempts!: number;
  @ApiProperty({ nullable: true, type: String }) lastError!: string | null;
  @ApiProperty({ nullable: true, type: String, format: 'date-time' }) readAt!: Date | null;
  @ApiProperty({ nullable: true, type: String, format: 'date-time' }) sentAt!: Date | null;
  @ApiProperty({ format: 'date-time' }) createdAt!: Date;
}
class SettingDto {
  @ApiProperty({ enum: NOTIFICATION_TYPES, enumName: 'NotificationType' })
  @IsIn(NOTIFICATION_TYPES)
  type!: string;
  @ApiProperty() @IsBoolean() telegram!: boolean;
  @ApiProperty() @IsBoolean() email!: boolean;
}
class SettingsWriteDto {
  @ApiProperty({ type: [SettingDto] })
  @IsArray()
  @ArrayMaxSize(NOTIFICATION_TYPES.length)
  @ArrayUnique((item: SettingDto) => item.type)
  @ValidateNested({ each: true })
  @Type(() => SettingDto)
  items!: SettingDto[];
}
class AuditQueryDto extends PageQueryDto {
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(100) entity?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(100) entityId?: string;
  @ApiPropertyOptional({ format: 'uuid' }) @IsOptional() @IsUUID() actorId?: string;
}
class AuditResponseDto {
  @ApiProperty({ format: 'uuid' }) id!: string;
  @ApiProperty({ nullable: true, type: String, format: 'uuid' }) actorId!: string | null;
  @ApiProperty() action!: string;
  @ApiProperty() entity!: string;
  @ApiProperty() entityId!: string;
  @ApiProperty({ type: 'object', additionalProperties: true }) diff!: Record<string, unknown>;
  @ApiProperty({ format: 'date-time' }) createdAt!: Date;
}
@ApiTags('notifications')
@ApiBearerAuth()
@ApiDefaultResponse({ type: ApiErrorDto })
@Controller('me')
export class MyNotificationsController {
  constructor(private readonly prisma: PrismaService) {}
  @Get('notifications')
  @ApiPage(NotificationResponseDto)
  async list(@CurrentUser() actor: Actor, @Query() query: PageQueryDto) {
    const where = {
      userId: actor.id,
      channel: 'IN_APP' as const,
      ...(query.search
        ? {
            OR: [
              { type: { contains: query.search, mode: 'insensitive' as const } },
              {
                type: {
                  in: NOTIFICATION_TYPES.filter((type) =>
                    notificationTypeLabels[type]
                      .toLocaleLowerCase('ru-RU')
                      .includes(query.search!.toLocaleLowerCase('ru-RU')),
                  ),
                },
              },
            ],
          }
        : {}),
    };
    const [items, total] = await Promise.all([
      this.prisma.notification.findMany({
        where,
        orderBy: [{ createdAt: 'desc' }, { id: 'asc' }],
        ...pageArgs(query),
      }),
      this.prisma.notification.count({ where }),
    ]);
    return pageResult(
      items.map(({ userId: _userId, dedupeKey: _dedupeKey, ...row }) => row),
      total,
      query,
    );
  }
  @Patch('notifications/:id/read')
  @ApiOkResponse({ type: OkDto })
  async read(@CurrentUser() actor: Actor, @Param('id', ParseUUIDPipe) id: string) {
    const result = await this.prisma.notification.updateMany({
      where: { id, userId: actor.id, channel: 'IN_APP' },
      data: { readAt: new Date() },
    });
    if (!result.count) throw new ApiException(ErrorCode.NOT_FOUND);
    return { ok: true };
  }
  @Get('notification-settings')
  @ApiPage(SettingDto)
  async settings(@CurrentUser() actor: Actor) {
    const rows = await this.prisma.notificationSetting.findMany({ where: { userId: actor.id } });
    const items = NOTIFICATION_TYPES.map((type) => {
      const row = rows.find((item) => item.type === type);
      return { type, telegram: row?.telegram ?? true, email: row?.email ?? true };
    });
    return { items, total: items.length, page: 1, limit: items.length };
  }
  @Put('notification-settings')
  @ApiPage(SettingDto)
  async write(@CurrentUser() actor: Actor, @Body() dto: SettingsWriteDto) {
    await this.prisma.$transaction(
      dto.items.map((item) =>
        this.prisma.notificationSetting.upsert({
          where: { userId_type: { userId: actor.id, type: item.type } },
          create: { ...item, userId: actor.id },
          update: { telegram: item.telegram, email: item.email },
        }),
      ),
    );
    return this.settings(actor);
  }
}
@ApiTags('admin')
@ApiBearerAuth()
@Roles(UserRole.ADMIN)
@ApiDefaultResponse({ type: ApiErrorDto })
@Controller('admin')
export class AdminNotificationsController {
  constructor(private readonly prisma: PrismaService) {}
  @Get('notifications')
  @ApiPage(NotificationResponseDto)
  async notifications(@Query() query: NotificationQueryDto) {
    const where = {
      status: query.status,
      channel: query.channel,
      userId: query.userId,
      ...(query.search
        ? {
            OR: [
              { type: { contains: query.search, mode: 'insensitive' as const } },
              { lastError: { contains: query.search, mode: 'insensitive' as const } },
            ],
          }
        : {}),
    };
    const [items, total] = await Promise.all([
      this.prisma.notification.findMany({
        where,
        orderBy: [{ createdAt: 'desc' }, { id: 'asc' }],
        ...pageArgs(query),
      }),
      this.prisma.notification.count({ where }),
    ]);
    return pageResult(items, total, query);
  }
  @Get('audit-log')
  @ApiPage(AuditResponseDto)
  async audit(@Query() query: AuditQueryDto) {
    const where = {
      entity: query.entity,
      entityId: query.entityId,
      actorId: query.actorId,
      ...(query.search
        ? {
            OR: [
              { entity: { contains: query.search, mode: 'insensitive' as const } },
              { action: { contains: query.search, mode: 'insensitive' as const } },
            ],
          }
        : {}),
    };
    const [items, total] = await Promise.all([
      this.prisma.auditLog.findMany({
        where,
        orderBy: [{ createdAt: 'desc' }, { id: 'asc' }],
        ...pageArgs(query),
      }),
      this.prisma.auditLog.count({ where }),
    ]);
    return pageResult(items, total, query);
  }
}

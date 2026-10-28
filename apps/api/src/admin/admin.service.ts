import { Injectable } from '@nestjs/common';
import { ErrorCode } from '@club/shared';
import { PrismaService } from '../prisma/prisma.service.js';
import { AuditService } from '../common/audit.service.js';
import { ApiException } from '../common/api-exception.js';
import type { Actor } from '../common/http.js';
import { pageArgs, pageResult, type PageQueryDto } from '../common/query.dto.js';
import type { PlaceQueryDto, RegionDto, RegionPatchDto } from '../club/club.dto.js';
@Injectable()
export class AdminService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}
  async regions(query: PageQueryDto) {
    const where = query.search
      ? { name: { contains: query.search, mode: 'insensitive' as const } }
      : {};
    const [items, total] = await Promise.all([
      this.prisma.region.findMany({
        where,
        orderBy: [{ name: 'asc' }, { id: 'asc' }],
        ...pageArgs(query),
      }),
      this.prisma.region.count({ where }),
    ]);
    return pageResult(items, total, query);
  }
  async region(id: string) {
    return this.prisma.region.findUniqueOrThrow({ where: { id } });
  }
  async regionWrite(actor: Actor, dto: RegionDto | RegionPatchDto, id?: string) {
    return this.prisma.$transaction(async (tx) => {
      const row = id
        ? await tx.region.update({ where: { id }, data: dto })
        : await tx.region.create({ data: dto as RegionDto });
      await this.audit.record(tx, actor.id, id ? 'UPDATED' : 'CREATED', 'Region', row.id, {
        fields: Object.keys(dto),
      });
      return row;
    });
  }
  async regionDelete(actor: Actor, id: string) {
    return this.prisma.$transaction(async (tx) => {
      if (await tx.place.count({ where: { regionId: id } }))
        throw new ApiException(ErrorCode.CONFLICT);
      await tx.region.delete({ where: { id } });
      await this.audit.record(tx, actor.id, 'DELETED', 'Region', id);
      return { ok: true };
    });
  }
  async places(query: PlaceQueryDto) {
    const where = {
      regionId: query.regionId,
      type: query.placeType,
      ...(query.search ? { name: { contains: query.search, mode: 'insensitive' as const } } : {}),
    };
    const [items, total] = await Promise.all([
      this.prisma.place.findMany({
        where,
        include: { region: true },
        orderBy: { id: 'asc' },
        ...pageArgs(query),
      }),
      this.prisma.place.count({ where }),
    ]);
    return pageResult(items, total, query);
  }
  async place(id: string) {
    return this.prisma.place.findUniqueOrThrow({ where: { id }, include: { region: true } });
  }
  async placeDelete(actor: Actor, id: string) {
    return this.prisma.$transaction(async (tx) => {
      await tx.place.update({ where: { id }, data: { isActive: false } });
      await this.audit.record(tx, actor.id, 'DEACTIVATED', 'Place', id);
      return { ok: true };
    });
  }
  async eventDelete(actor: Actor, id: string) {
    return this.prisma.$transaction(async (tx) => {
      if (await tx.eventRegistration.count({ where: { eventId: id } }))
        throw new ApiException(ErrorCode.CONFLICT, {
          reason: 'Мероприятие с историей участников нельзя удалить.',
        });
      await tx.event.delete({ where: { id } });
      await this.audit.record(tx, actor.id, 'DELETED', 'Event', id);
      return { ok: true };
    });
  }
  async eventRegistrations(id: string, query: PageQueryDto) {
    const where = {
      eventId: id,
      ...(query.search
        ? { user: { fullName: { contains: query.search, mode: 'insensitive' as const } } }
        : {}),
    };
    const [items, total] = await Promise.all([
      this.prisma.eventRegistration.findMany({ where, orderBy: { id: 'asc' }, ...pageArgs(query) }),
      this.prisma.eventRegistration.count({ where }),
    ]);
    return pageResult(items, total, query);
  }
  async day(id: string) {
    return this.prisma.openDaySession.findUniqueOrThrow({ where: { id } });
  }
  async dayDelete(actor: Actor, id: string) {
    return this.prisma.$transaction(async (tx) => {
      if (await tx.openDayRegistration.count({ where: { sessionId: id } }))
        throw new ApiException(ErrorCode.CONFLICT, {
          reason: 'Сессию с историей посещений нельзя удалить.',
        });
      await tx.openDaySession.delete({ where: { id } });
      await this.audit.record(tx, actor.id, 'DELETED', 'OpenDaySession', id);
      return { ok: true };
    });
  }
  async dayRegistrations(id: string, query: PageQueryDto) {
    const where = {
      sessionId: id,
      ...(query.search
        ? { user: { fullName: { contains: query.search, mode: 'insensitive' as const } } }
        : {}),
    };
    const [items, total] = await Promise.all([
      this.prisma.openDayRegistration.findMany({
        where,
        orderBy: { id: 'asc' },
        ...pageArgs(query),
      }),
      this.prisma.openDayRegistration.count({ where }),
    ]);
    return pageResult(items, total, query);
  }
  async markAttendance(actor: Actor, id: string, userId: string, attended: boolean) {
    return this.prisma.$transaction(async (tx) => {
      const row = await tx.openDayRegistration.upsert({
        where: { sessionId_userId: { sessionId: id, userId } },
        create: { sessionId: id, userId, attended },
        update: { attended, ...(attended ? { cancelledAt: null } : {}) },
      });
      await this.audit.record(tx, actor.id, 'ATTENDANCE_MARKED', 'OpenDayRegistration', row.id, {
        attended,
      });
      return row;
    });
  }
}

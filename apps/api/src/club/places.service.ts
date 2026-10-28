import { Injectable } from '@nestjs/common';
import { ErrorCode, PlaceType } from '@club/shared';
import type { Place, Region, Prisma } from '../generated/prisma/client.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { AuditService, type Tx } from '../common/audit.service.js';
import { ApiException } from '../common/api-exception.js';
import { hasPrivateAccess, type Actor } from '../common/http.js';
import { pageArgs, pageResult, type PageQueryDto } from '../common/query.dto.js';
import type { NeedsWriteDto, PlacePatchDto, PlaceQueryDto, PlaceWriteDto } from './club.dto.js';
import { StorageService } from '../storage/storage.service.js';

export function projectPlace(place: Place & { region: Region }, privateAccess: boolean) {
  return {
    id: place.id,
    slug: place.slug,
    name: place.name,
    type: place.type,
    region: { id: place.region.id, slug: place.region.slug, name: place.region.name },
    city: place.city,
    ...(place.type === 'YARD_PROGRAM' ? { district: place.district } : {}),
    description: place.description,
    coverImage: place.coverImageUrl,
    beneficiariesCount: place.beneficiariesCount,
    ...(privateAccess ? { address: place.address, privateNotes: place.privateNotes } : {}),
  };
}
export async function assertCurator(tx: Tx, actor: Actor, placeId: string): Promise<void> {
  const user = await tx.user.findUnique({ where: { id: actor.id } });
  if (!user || user.isBlocked || user.anonymizedAt)
    throw new ApiException(ErrorCode.ACCOUNT_BLOCKED);
  if (user.role === 'ADMIN' && actor.adminVerified) return;
  if (
    user.role !== 'VOLUNTEER' ||
    !(await tx.placeCurator.findUnique({
      where: { userId_placeId: { userId: actor.id, placeId } },
    }))
  )
    throw new ApiException(ErrorCode.FORBIDDEN_PLACE);
}
@Injectable()
export class PlacesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly storage: StorageService,
  ) {}
  async regions(query: PageQueryDto) {
    const [items, total] = await Promise.all([
      this.prisma.region.findMany({
        orderBy: [{ name: 'asc' }, { id: 'asc' }],
        ...pageArgs(query),
      }),
      this.prisma.region.count(),
    ]);
    return pageResult(items, total, query);
  }
  async curatorPlaces(actor: Actor, query: PageQueryDto) {
    const where: Prisma.PlaceWhereInput =
      actor.role === 'ADMIN' ? {} : { curators: { some: { userId: actor.id } } };
    const [rows, total] = await Promise.all([
      this.prisma.place.findMany({
        where,
        include: { region: true },
        orderBy: { name: 'asc' },
        ...pageArgs(query),
      }),
      this.prisma.place.count({ where }),
    ]);
    return pageResult(
      rows.map((row) => projectPlace(row, true)),
      total,
      query,
    );
  }
  async ownNeeds(actor: Actor, placeId: string, query: PageQueryDto) {
    await assertCurator(this.prisma, actor, placeId);
    const where = { placeId };
    const [items, total] = await Promise.all([
      this.prisma.needItem.findMany({ where, orderBy: { id: 'asc' }, ...pageArgs(query) }),
      this.prisma.needItem.count({ where }),
    ]);
    return pageResult(items, total, query);
  }
  async list(query: PlaceQueryDto, actor?: Actor) {
    const where: Prisma.PlaceWhereInput = {
      isActive: true,
      regionId: query.regionId,
      type: query.placeType,
      ...(query.search ? { name: { contains: query.search, mode: 'insensitive' as const } } : {}),
    };
    const [rows, total] = await Promise.all([
      this.prisma.place.findMany({
        where,
        include: { region: true },
        orderBy: [{ name: 'asc' }, { id: 'asc' }],
        ...pageArgs(query),
      }),
      this.prisma.place.count({ where }),
    ]);
    return pageResult(
      rows.map((row) => projectPlace(row, hasPrivateAccess(actor))),
      total,
      query,
    );
  }
  async detail(slug: string, actor?: Actor) {
    const row = await this.prisma.place.findUnique({ where: { slug }, include: { region: true } });
    if (!row || (!row.isActive && actor?.role !== 'ADMIN'))
      throw new ApiException(ErrorCode.NOT_FOUND);
    return projectPlace(row, hasPrivateAccess(actor));
  }
  async write(actor: Actor, dto: PlaceWriteDto | PlacePatchDto, id?: string) {
    if (dto.coverImageUrl) await this.storage.verifyPublicUrl(dto.coverImageUrl, 'CONTENT');
    const current = id ? await this.prisma.place.findUniqueOrThrow({ where: { id } }) : null;
    const merged = { ...current, ...dto };
    if (merged.type === PlaceType.YARD_PROGRAM ? !merged.district?.trim() : !merged.address?.trim())
      throw new ApiException(ErrorCode.VALIDATION_ERROR, {
        reason:
          merged.type === PlaceType.YARD_PROGRAM
            ? 'Укажите район дворовой программы.'
            : 'Укажите адрес учреждения.',
      });
    return this.prisma.$transaction(async (tx) => {
      const data = { ...dto };
      const row = id
        ? await tx.place.update({ where: { id }, data })
        : await tx.place.create({ data: data as PlaceWriteDto });
      await this.audit.record(tx, actor.id, id ? 'UPDATED' : 'CREATED', 'Place', row.id, {
        fields: Object.keys(dto),
      });
      return row;
    });
  }
  async needs(actor: Actor, placeId: string, dto: NeedsWriteDto) {
    return this.prisma.$transaction(async (tx) => {
      await assertCurator(tx, actor, placeId);
      await tx.$queryRaw`SELECT "id" FROM "places" WHERE "id"=${placeId}::uuid FOR UPDATE`;
      for (const item of dto.items) {
        if (item.id) {
          const existing = await tx.needItem.findUnique({ where: { id: item.id } });
          if (!existing || existing.placeId !== placeId)
            throw new ApiException(ErrorCode.FORBIDDEN_PLACE);
        }
      }
      for (const item of dto.items) {
        const { id, ...data } = item;
        if (id) await tx.needItem.update({ where: { id }, data });
        else await tx.needItem.create({ data: { ...data, placeId } });
      }
      await this.audit.record(tx, actor.id, 'NEEDS_UPDATED', 'Place', placeId, {
        count: dto.items.length,
      });
      const items = await tx.needItem.findMany({
        where: { placeId },
        orderBy: { id: 'asc' },
        take: 100,
      });
      return { items, total: await tx.needItem.count({ where: { placeId } }), page: 1, limit: 100 };
    });
  }
  async publicNeeds(query: PageQueryDto) {
    const where = { isActive: true, place: { isActive: true } };
    const [items, total] = await Promise.all([
      this.prisma.needItem.findMany({ where, orderBy: { id: 'asc' }, ...pageArgs(query) }),
      this.prisma.needItem.count({ where }),
    ]);
    return pageResult(items, total, query);
  }
}

import { Injectable } from '@nestjs/common';
import { ErrorCode, contactRequestSchema } from '@club/shared';
import { PrismaService } from '../prisma/prisma.service.js';
import { AuditService } from '../common/audit.service.js';
import { ApiException } from '../common/api-exception.js';
import { pageArgs, pageResult, type PageQueryDto } from '../common/query.dto.js';
import { StorageService } from '../storage/storage.service.js';
import type { Actor } from '../common/http.js';
import type { ContactCreateDto, ContactPatchDto, ContentQueryDto } from './content.dto.js';

@Injectable()
export class PublicContentService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly storage: StorageService,
  ) {}
  async news(query: PageQueryDto) {
    const where = { status: 'PUBLISHED' as const, publishedAt: { lte: new Date() } };
    const [rows, total] = await Promise.all([
      this.prisma.newsPost.findMany({
        where,
        orderBy: [{ publishedAt: 'desc' }, { id: 'asc' }],
        ...pageArgs(query),
      }),
      this.prisma.newsPost.count({ where }),
    ]);
    return pageResult(
      rows.map(({ authorId: _authorId, ...row }) => row),
      total,
      query,
    );
  }
  async newsDetail(slug: string) {
    const row = await this.prisma.newsPost.findFirst({
      where: { slug, status: 'PUBLISHED', publishedAt: { lte: new Date() } },
    });
    if (!row) throw new ApiException(ErrorCode.NOT_FOUND);
    const { authorId: _authorId, ...data } = row;
    return data;
  }
  async page(slug: string) {
    return this.prisma.page.findUniqueOrThrow({ where: { slug } });
  }
  async albums(query: PageQueryDto) {
    const where = { publishedAt: { lte: new Date() } };
    const [items, total] = await Promise.all([
      this.prisma.mediaAlbum.findMany({
        where,
        orderBy: [{ publishedAt: 'desc' }, { id: 'asc' }],
        ...pageArgs(query),
      }),
      this.prisma.mediaAlbum.count({ where }),
    ]);
    return pageResult(items, total, query);
  }
  async album(slug: string) {
    const row = await this.prisma.mediaAlbum.findFirst({
      where: { slug, publishedAt: { lte: new Date() } },
      include: {
        items: { where: { isPublic: true }, orderBy: [{ sortOrder: 'asc' }, { id: 'asc' }] },
      },
    });
    if (!row) throw new ApiException(ErrorCode.NOT_FOUND);
    return row;
  }
  async videos(query: PageQueryDto) {
    const where = {
      type: 'VIDEO' as const,
      isPublic: true,
      album: { publishedAt: { lte: new Date() } },
    };
    const [items, total] = await Promise.all([
      this.prisma.mediaItem.findMany({
        where,
        orderBy: [{ sortOrder: 'asc' }, { id: 'asc' }],
        ...pageArgs(query),
      }),
      this.prisma.mediaItem.count({ where }),
    ]);
    return pageResult(items, total, query);
  }
  async interviews(query: PageQueryDto) {
    const where = { publishedAt: { lte: new Date() } };
    const [items, total] = await Promise.all([
      this.prisma.interview.findMany({
        where,
        orderBy: [{ publishedAt: 'desc' }, { id: 'asc' }],
        ...pageArgs(query),
      }),
      this.prisma.interview.count({ where }),
    ]);
    return pageResult(items, total, query);
  }
  async interview(slug: string) {
    return this.prisma.interview.findFirstOrThrow({
      where: { slug, publishedAt: { lte: new Date() } },
    });
  }
  async projects(query: PageQueryDto) {
    const where = { isActive: true };
    const [items, total] = await Promise.all([
      this.prisma.project.findMany({ where, orderBy: { id: 'asc' }, ...pageArgs(query) }),
      this.prisma.project.count({ where }),
    ]);
    return pageResult(items, total, query);
  }
  async partners(query: PageQueryDto) {
    const where = { isActive: true };
    const [items, total] = await Promise.all([
      this.prisma.partner.findMany({
        where,
        orderBy: [{ sortOrder: 'asc' }, { id: 'asc' }],
        ...pageArgs(query),
      }),
      this.prisma.partner.count({ where }),
    ]);
    return pageResult(items, total, query);
  }
  async press(query: PageQueryDto) {
    const where = { publishedAt: { lte: new Date() } };
    const [items, total] = await Promise.all([
      this.prisma.pressMention.findMany({
        where,
        orderBy: [{ publishedAt: 'desc' }, { id: 'asc' }],
        ...pageArgs(query),
      }),
      this.prisma.pressMention.count({ where }),
    ]);
    return pageResult(items, total, query);
  }
  async reports(query: PageQueryDto) {
    const now = new Date();
    const rows = await this.prisma.$queryRaw<
      Array<{ id: string; kind: 'CLUB' | 'TRIP'; publishedAt: Date }>
    >`
      SELECT * FROM (
        SELECT "id",'CLUB' AS kind,"publishedAt" FROM "club_reports" WHERE "publishedAt"<=${now}
        UNION ALL SELECT "id",'TRIP',"publishedAt" FROM "reports" WHERE "publishedAt"<=${now}
      ) feed ORDER BY "publishedAt" DESC,"id" ASC LIMIT ${query.limit} OFFSET ${(query.page - 1) * query.limit}`;
    const items = await Promise.all(
      rows.map(async (row) => {
        if (row.kind === 'CLUB') {
          const report = await this.prisma.clubReport.findUniqueOrThrow({ where: { id: row.id } });
          return { ...report, kind: row.kind };
        }
        const report = await this.prisma.report.findUniqueOrThrow({
          where: { id: row.id },
          include: { photos: { where: { isPublic: true } }, trip: { select: { title: true } } },
        });
        return {
          id: report.id,
          kind: row.kind,
          tripId: report.tripId,
          title: report.trip.title,
          text: report.text,
          hoursSpent: report.hoursSpent.toString(),
          publishedAt: report.publishedAt,
          photos: await Promise.all(
            report.photos.map(async (photo) => ({
              id: photo.id,
              url: await this.storage.url(photo.url),
              isPublic: true,
            })),
          ),
        };
      }),
    );
    const counts = await Promise.all([
      this.prisma.clubReport.count({ where: { publishedAt: { lte: now } } }),
      this.prisma.report.count({ where: { publishedAt: { lte: now } } }),
    ]);
    return pageResult(items, counts[0] + counts[1], query);
  }
  async contact(input: ContactCreateDto) {
    const dto = contactRequestSchema.parse(input);
    const row = await this.prisma.contactRequest.create({
      data: {
        name: dto.name,
        contact: dto.contact,
        message: dto.message,
        status: 'NEW',
        consentVersion: dto.consentVersion,
      },
    });
    return { id: row.id, status: row.status };
  }
  async contacts(query: ContentQueryDto) {
    if (query.status && !['NEW', 'IN_PROGRESS', 'DONE'].includes(query.status))
      throw new ApiException(ErrorCode.VALIDATION_ERROR);
    const where = {
      ...(query.status ? { status: query.status as 'NEW' | 'IN_PROGRESS' | 'DONE' } : {}),
      ...(query.search
        ? {
            OR: [
              { name: { contains: query.search, mode: 'insensitive' as const } },
              { contact: { contains: query.search, mode: 'insensitive' as const } },
              { message: { contains: query.search, mode: 'insensitive' as const } },
            ],
          }
        : {}),
    };
    const [items, total] = await Promise.all([
      this.prisma.contactRequest.findMany({
        where,
        orderBy: [{ createdAt: 'desc' }, { id: 'asc' }],
        ...pageArgs(query),
      }),
      this.prisma.contactRequest.count({ where }),
    ]);
    return pageResult(items, total, query);
  }
  async contactUpdate(actor: Actor, id: string, dto: ContactPatchDto) {
    return this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT "id" FROM "contact_requests" WHERE "id"=${id}::uuid FOR UPDATE`;
      const row = await tx.contactRequest.findUniqueOrThrow({ where: { id } });
      if (dto.status && dto.status !== row.status)
        await this.audit.transition(
          tx,
          actor.id,
          'ContactRequest',
          id,
          'ContactRequestStatus',
          row.status,
          dto.status,
        );
      const updated = await tx.contactRequest.update({ where: { id }, data: dto });
      await this.audit.record(tx, actor.id, 'UPDATED', 'ContactRequest', id, {
        fields: Object.keys(dto),
      });
      return updated;
    });
  }
}

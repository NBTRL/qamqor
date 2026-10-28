import { Injectable } from '@nestjs/common';
import sanitizeHtml from 'sanitize-html';
import { ErrorCode } from '@club/shared';
import { Prisma } from '../generated/prisma/client.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { AuditService, type Tx } from '../common/audit.service.js';
import { ApiException } from '../common/api-exception.js';
import type { Actor } from '../common/http.js';
import { pageArgs, pageResult } from '../common/query.dto.js';
import { StorageService } from '../storage/storage.service.js';
import type { ContentQueryDto } from './content.dto.js';

interface ResourceDefinition {
  model: string;
  search: string;
  html?: boolean;
  author?: 'authorId' | 'createdById';
  status?: 'NewsStatus';
  assetFields?: string[];
}
export const resources = {
  news: {
    model: 'newsPost',
    search: 'title',
    html: true,
    author: 'authorId',
    status: 'NewsStatus',
    assetFields: ['coverUrl'],
  },
  pages: { model: 'page', search: 'title', html: true },
  albums: { model: 'mediaAlbum', search: 'title', assetFields: ['coverUrl'] },
  'media-items': { model: 'mediaItem', search: 'caption', assetFields: ['url'] },
  interviews: { model: 'interview', search: 'title', html: true, assetFields: ['coverUrl'] },
  projects: { model: 'project', search: 'title', html: true, assetFields: ['coverUrl'] },
  partners: { model: 'partner', search: 'name', assetFields: ['logoUrl'] },
  press: { model: 'pressMention', search: 'title' },
  'club-reports': { model: 'clubReport', search: 'title', assetFields: ['fileUrl'] },
  donations: { model: 'donation', search: 'donorName', author: 'createdById' },
} as const satisfies Record<string, ResourceDefinition>;
export type ResourceName = keyof typeof resources;
type Row = Record<string, unknown> & { id: string };
interface Delegate {
  findUnique(args: object): Promise<Row | null>;
  findMany(args: object): Promise<Row[]>;
  count(args?: object): Promise<number>;
  create(args: object): Promise<Row>;
  update(args: object): Promise<Row>;
  delete(args: object): Promise<Row>;
}
export function cleanHtml(html: string): string {
  return sanitizeHtml(html, {
    allowedTags: sanitizeHtml.defaults.allowedTags.concat(['img']),
    allowedAttributes: {
      ...sanitizeHtml.defaults.allowedAttributes,
      img: ['src', 'alt', 'width', 'height'],
      a: ['href', 'target', 'rel', 'title'],
    },
    allowedSchemes: ['http', 'https', 'mailto'],
    allowProtocolRelative: false,
    transformTags: { a: sanitizeHtml.simpleTransform('a', { rel: 'noopener noreferrer' }) },
  });
}
@Injectable()
export class ContentService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly storage: StorageService,
  ) {}
  private config(name: ResourceName): ResourceDefinition {
    return resources[name];
  }
  // Закрытый реестр моделей: пользователь не выбирает delegate или SQL-идентификаторы.
  private model(tx: Tx, name: ResourceName): Delegate {
    return (tx as unknown as Record<string, Delegate>)[this.config(name).model]!;
  }
  async list(name: ResourceName, query: ContentQueryDto) {
    const config = this.config(name);
    const where: Record<string, unknown> = {};
    if (query.search) where[config.search] = { contains: query.search, mode: 'insensitive' };
    if (query.status) {
      if (!config.status || !['DRAFT', 'PUBLISHED', 'ARCHIVED'].includes(query.status))
        throw new ApiException(ErrorCode.VALIDATION_ERROR);
      where.status = query.status;
    }
    if (query.year) {
      if (name !== 'club-reports') throw new ApiException(ErrorCode.VALIDATION_ERROR);
      where.year = query.year;
    }
    const model = this.model(this.prisma, name);
    const [items, total] = await Promise.all([
      model.findMany({ where, orderBy: { id: 'asc' }, ...pageArgs(query) }),
      model.count({ where }),
    ]);
    return pageResult(items, total, query);
  }
  async get(name: ResourceName, id: string) {
    const row = await this.model(this.prisma, name).findUnique({ where: { id } });
    if (!row) throw new ApiException(ErrorCode.NOT_FOUND);
    return row;
  }
  async write(actor: Actor, name: ResourceName, input: Record<string, unknown>, id?: string) {
    const config = this.config(name),
      data = { ...input };
    if (config.html && typeof data.bodyHtml === 'string') data.bodyHtml = cleanHtml(data.bodyHtml);
    for (const field of config.assetFields ?? [])
      if (typeof data[field] === 'string')
        await this.storage.verifyPublicUrl(
          data[field] as string,
          name === 'club-reports' ? 'CLUB_REPORT' : 'CONTENT',
        );
    if (name === 'donations' && data.amount !== undefined) {
      try {
        if (typeof data.amount !== 'string') throw new Error();
        const amount = new Prisma.Decimal(data.amount);
        if (!amount.gt(0) || amount.gt('999999999999.99')) throw new Error();
        data.amount = amount;
      } catch {
        throw new ApiException(ErrorCode.VALIDATION_ERROR);
      }
    }
    return this.prisma.$transaction(async (tx) => {
      if (id && name === 'news')
        await tx.$queryRaw`SELECT "id" FROM "news_posts" WHERE "id"=${id}::uuid FOR UPDATE`;
      const model = this.model(tx, name);
      const current = id ? await model.findUnique({ where: { id } }) : null;
      if (id && !current) throw new ApiException(ErrorCode.NOT_FOUND);
      if (
        config.status &&
        data.status !== undefined &&
        data.status !== (current?.status ?? 'DRAFT')
      ) {
        this.audit.assertTransition(
          config.status,
          String(current?.status ?? 'DRAFT'),
          String(data.status),
        );
        if (data.status === 'PUBLISHED' && !data.publishedAt) data.publishedAt = new Date();
      }
      if (config.author && !id) data[config.author] = actor.id;
      if (
        name === 'news' &&
        (data.status ?? current?.status) === 'PUBLISHED' &&
        !(data.publishedAt ?? current?.publishedAt)
      )
        data.publishedAt = new Date();
      const row = id ? await model.update({ where: { id }, data }) : await model.create({ data });
      if (
        config.status &&
        data.status !== undefined &&
        data.status !== (current?.status ?? 'DRAFT')
      )
        await this.audit.transition(
          tx,
          actor.id,
          config.model,
          row.id,
          config.status,
          String(current?.status ?? 'DRAFT'),
          String(data.status),
        );
      await this.audit.record(tx, actor.id, id ? 'UPDATED' : 'CREATED', config.model, row.id, {
        fields: Object.keys(input),
      });
      return row;
    });
  }
  async remove(actor: Actor, name: ResourceName, id: string) {
    return this.prisma.$transaction(async (tx) => {
      if (name === 'albums') await tx.mediaItem.deleteMany({ where: { albumId: id } });
      await this.model(tx, name).delete({ where: { id } });
      await this.audit.record(tx, actor.id, 'DELETED', this.config(name).model, id);
      return { ok: true };
    });
  }
}

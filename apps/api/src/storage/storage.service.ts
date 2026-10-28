import {
  Injectable,
  Logger,
  type OnModuleInit,
  type OnModuleDestroy,
  type OnApplicationShutdown,
} from '@nestjs/common';
import {
  DeleteObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import { createPresignedPost } from '@aws-sdk/s3-presigned-post';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import type { Queue } from 'bullmq';
import { randomUUID } from 'node:crypto';
import {
  ErrorCode,
  UPLOAD_IMAGE_MAX_BYTES,
  UPLOAD_IMAGE_TYPES,
  UPLOAD_PDF_MAX_BYTES,
} from '@club/shared';
import { getEnvironment } from '../config/environment.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { QueuesService } from '../common/queues.service.js';
import { ApiException } from '../common/api-exception.js';
import type { Actor } from '../common/http.js';
import type { PresignDto } from './storage.controller.js';
import { isUUID } from 'class-validator';
import { isCmsFilePublic } from './cms-file-access.js';

@Injectable()
export class StorageService implements OnModuleInit, OnModuleDestroy, OnApplicationShutdown {
  private readonly env = getEnvironment();
  private readonly client = new S3Client({
    endpoint: this.env.S3_ENDPOINT,
    region: 'us-east-1',
    forcePathStyle: true,
    credentials: { accessKeyId: this.env.S3_ACCESS_KEY, secretAccessKey: this.env.S3_SECRET_KEY },
    maxAttempts: 3,
  });
  private queue?: Queue<{ id: string }>;
  private timer?: ReturnType<typeof setInterval>;
  private cleaning?: Promise<void>;
  private readonly logger = new Logger(StorageService.name);
  constructor(
    private readonly prisma: PrismaService,
    private readonly queues: QueuesService,
  ) {}
  uri(key: string): string {
    return `s3://${this.env.S3_BUCKET}/${key}`;
  }
  private key(uri: string): string {
    const prefix = `s3://${this.env.S3_BUCKET}/`;
    if (!uri.startsWith(prefix) || uri.slice(prefix.length).includes('..'))
      throw new ApiException(ErrorCode.VALIDATION_ERROR);
    return uri.slice(prefix.length);
  }
  async url(uri: string): Promise<string> {
    if (!uri.startsWith('s3://')) return uri;
    return getSignedUrl(
      this.client,
      new GetObjectCommand({ Bucket: this.env.S3_BUCKET, Key: this.key(uri) }),
      { expiresIn: 300 },
    );
  }
  async presign(actor: Actor, dto: PresignDto) {
    const isImage = (UPLOAD_IMAGE_TYPES as readonly string[]).includes(dto.contentType);
    const isPdf = dto.contentType === 'application/pdf';
    const maxSize = dto.purpose === 'CLUB_REPORT' ? UPLOAD_PDF_MAX_BYTES : UPLOAD_IMAGE_MAX_BYTES;
    if ((dto.purpose === 'CLUB_REPORT' ? !isPdf : !isImage) || dto.sizeBytes > maxSize)
      throw new ApiException(ErrorCode.VALIDATION_ERROR, {
        reason: 'Недопустимый тип или размер файла.',
      });
    if (dto.purpose === 'REPORT_PHOTO') {
      if (!dto.tripId) throw new ApiException(ErrorCode.VALIDATION_ERROR);
      const trip = await this.prisma.trip.findUnique({
        where: { id: dto.tripId },
        include: { place: { include: { curators: { where: { userId: actor.id } } } } },
      });
      if (!trip) throw new ApiException(ErrorCode.NOT_FOUND);
      if (actor.role !== 'ADMIN' && (actor.role !== 'VOLUNTEER' || !trip.place.curators.length))
        throw new ApiException(ErrorCode.FORBIDDEN_PLACE);
    } else if (dto.purpose !== 'AVATAR' && actor.role !== 'ADMIN')
      throw new ApiException(ErrorCode.FORBIDDEN);
    const ext: Record<string, string> = {
      'image/jpeg': 'jpg',
      'image/png': 'png',
      'image/webp': 'webp',
      'application/pdf': 'pdf',
    };
    const folder =
      dto.purpose === 'REPORT_PHOTO'
        ? 'private/report-photos'
        : dto.purpose === 'AVATAR'
          ? 'private/avatars'
          : 'public/content';
    const key = `${folder}/${randomUUID()}.${ext[dto.contentType]}`;
    const upload = await this.prisma.uploadAsset.create({
      data: {
        userId: actor.id,
        key,
        contentType: dto.contentType,
        sizeBytes: dto.sizeBytes,
        purpose: dto.purpose,
        tripId: dto.tripId,
      },
    });
    const signed = await createPresignedPost(this.client, {
      Bucket: this.env.S3_BUCKET,
      Key: key,
      Expires: 300,
      Fields: { 'Content-Type': dto.contentType },
      Conditions: [
        ['eq', '$Content-Type', dto.contentType],
        ['content-length-range', dto.sizeBytes, dto.sizeBytes],
      ],
    });
    return {
      ...signed,
      uploadId: upload.id,
      fileUrl: `${this.env.WEB_URL}/api/v1/files/${upload.id}`,
      expiresAt: new Date(Date.now() + 300000),
      maxSizeBytes: maxSize,
    };
  }
  async validateReportPhotos(tripId: string, ids: string[]): Promise<Map<string, string>> {
    if (new Set(ids).size !== ids.length) throw new ApiException(ErrorCode.VALIDATION_ERROR);
    const rows = await this.prisma.uploadAsset.findMany({
      where: { id: { in: ids }, tripId, purpose: 'REPORT_PHOTO', deletedAt: null },
    });
    if (rows.length !== ids.length) throw new ApiException(ErrorCode.FORBIDDEN_PLACE);
    for (const row of rows) await this.verifyObject(row.key, row.contentType, row.sizeBytes);
    return new Map(rows.map((row) => [row.id, this.uri(row.key)]));
  }
  async verifyPublicUrl(value: string, purpose?: 'CONTENT' | 'CLUB_REPORT'): Promise<void> {
    if (!value.startsWith('s3://')) {
      let parsed: URL;
      try {
        parsed = new URL(value);
        if (!['http:', 'https:'].includes(parsed.protocol)) throw new Error();
      } catch {
        throw new ApiException(ErrorCode.VALIDATION_ERROR);
      }
      const id = parsed.pathname.startsWith('/api/v1/files/')
        ? parsed.pathname.slice('/api/v1/files/'.length)
        : null;
      if (
        id &&
        [new URL(this.env.WEB_URL).origin, new URL(this.env.PUBLIC_API_URL).origin].includes(
          parsed.origin,
        )
      ) {
        const asset = await this.prisma.uploadAsset.findUnique({ where: { id } });
        if (
          !asset ||
          asset.deletedAt ||
          ['REPORT_PHOTO', 'AVATAR'].includes(asset.purpose) ||
          (purpose && asset.purpose !== purpose)
        )
          throw new ApiException(ErrorCode.VALIDATION_ERROR);
        await this.verifyObject(asset.key, asset.contentType, asset.sizeBytes);
      }
      return;
    }
    const row = await this.prisma.uploadAsset.findUnique({ where: { key: this.key(value) } });
    if (
      !row ||
      row.deletedAt ||
      ['REPORT_PHOTO', 'AVATAR'].includes(row.purpose) ||
      (purpose && row.purpose !== purpose)
    )
      throw new ApiException(ErrorCode.VALIDATION_ERROR, {
        reason: 'Публичный контент требует загрузку соответствующего назначения.',
      });
    await this.verifyObject(row.key, row.contentType, row.sizeBytes);
  }
  async reportReference(tripId: string, value: string) {
    const row = await this.prisma.uploadAsset.findFirst({
      where: { tripId, key: this.key(value), purpose: 'REPORT_PHOTO', deletedAt: null },
      select: { id: true },
    });
    return row?.id;
  }
  private async verifyObject(key: string, contentType: string, sizeBytes: number): Promise<void> {
    try {
      const object = await this.client.send(
        new HeadObjectCommand({ Bucket: this.env.S3_BUCKET, Key: key }),
      );
      if (object.ContentLength !== sizeBytes || object.ContentType !== contentType)
        throw new Error();
      const sample = await this.client.send(
        new GetObjectCommand({ Bucket: this.env.S3_BUCKET, Key: key, Range: 'bytes=0-15' }),
      );
      const bytes = Buffer.from(await sample.Body!.transformToByteArray());
      const valid =
        contentType === 'image/png'
          ? bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
          : contentType === 'image/jpeg'
            ? bytes.subarray(0, 3).equals(Buffer.from([255, 216, 255]))
            : contentType === 'image/webp'
              ? bytes.subarray(0, 4).toString() === 'RIFF' &&
                bytes.subarray(8, 12).toString() === 'WEBP'
              : contentType === 'application/pdf' && bytes.subarray(0, 5).toString() === '%PDF-';
      if (!valid) throw new Error();
    } catch {
      throw new ApiException(ErrorCode.VALIDATION_ERROR, {
        reason: 'Загрузка не завершена или параметры файла не совпадают.',
      });
    }
  }
  async download(id: string, actor?: Actor): Promise<string> {
    const asset = await this.prisma.uploadAsset.findUnique({ where: { id } });
    if (!asset || asset.deletedAt) throw new ApiException(ErrorCode.NOT_FOUND);
    if (
      ['CONTENT', 'CLUB_REPORT'].includes(asset.purpose) &&
      actor?.role !== 'ADMIN' &&
      !(await isCmsFilePublic(this.prisma, asset, this.env))
    )
      throw new ApiException(ErrorCode.FORBIDDEN);
    if (asset.purpose === 'AVATAR' && actor?.id !== asset.userId && actor?.role !== 'ADMIN')
      throw new ApiException(ErrorCode.FORBIDDEN);
    if (
      asset.purpose === 'REPORT_PHOTO' &&
      actor?.role !== 'ADMIN' &&
      actor?.role !== 'VOLUNTEER'
    ) {
      const published = await this.prisma.reportPhoto.count({
        where: { url: this.uri(asset.key), isPublic: true, report: { publishedAt: { not: null } } },
      });
      if (!published) throw new ApiException(ErrorCode.FORBIDDEN);
    }
    return this.url(this.uri(asset.key));
  }
  private async avatarAsset(userId: string, value: string) {
    const parsed = new URL(value);
    if (
      ![new URL(this.env.WEB_URL).origin, new URL(this.env.PUBLIC_API_URL).origin].includes(
        parsed.origin,
      ) ||
      !parsed.pathname.startsWith('/api/v1/files/')
    )
      return null;
    const id = parsed.pathname.slice('/api/v1/files/'.length);
    if (!isUUID(id)) throw new ApiException(ErrorCode.VALIDATION_ERROR);
    const asset = await this.prisma.uploadAsset.findUnique({ where: { id } });
    if (!asset || asset.deletedAt || asset.userId !== userId || asset.purpose !== 'AVATAR')
      throw new ApiException(ErrorCode.FORBIDDEN);
    return asset;
  }
  async verifyAvatar(userId: string, value: string): Promise<void> {
    const asset = await this.avatarAsset(userId, value);
    if (asset) await this.verifyObject(asset.key, asset.contentType, asset.sizeBytes);
  }
  async avatarUrl(userId: string, value: string | null): Promise<string | null> {
    if (!value) return null;
    try {
      const asset = await this.avatarAsset(userId, value);
      return asset ? this.url(this.uri(asset.key)) : value;
    } catch {
      return null;
    }
  }
  onModuleInit(): void {
    if (this.queues.runtime.offline) return;
    this.queue = this.queues.queue('storage-cleanup');
    this.queues.worker<{ id: string }>(
      'storage-cleanup',
      async (job) => {
        const asset = await this.prisma.uploadAsset.findUnique({ where: { id: job.data.id } });
        if (!asset?.deletedAt) return;
        await this.client.send(
          new DeleteObjectCommand({ Bucket: this.env.S3_BUCKET, Key: asset.key }),
        );
        await this.prisma.uploadAsset.deleteMany({
          where: { id: asset.id, deletedAt: { not: null } },
        });
      },
      { concurrency: 3 },
    );
    if (this.queues.runtime.workers) {
      const tick = () => {
        if (!this.cleaning)
          this.cleaning = this.cleanup()
            .catch(() => {
              this.logger.warn('STORAGE_CLEANUP_FAILED');
            })
            .finally(() => {
              this.cleaning = undefined;
            });
      };
      this.timer = setInterval(tick, 30000);
      this.timer.unref();
      tick();
    }
  }
  private async cleanup(): Promise<void> {
    const rows = await this.prisma.uploadAsset.findMany({
      where: { deletedAt: { not: null } },
      take: 100,
    });
    for (const row of rows) {
      const jobId = `delete-${row.id}`;
      const old = await this.queue?.getJob(jobId);
      if (old && (await old.getState()) === 'failed') await old.remove();
      await this.queue?.add('delete', { id: row.id }, { jobId });
    }
  }
  async onModuleDestroy(): Promise<void> {
    if (this.timer) clearInterval(this.timer);
    await this.cleaning;
  }
  onApplicationShutdown(): void {
    this.client.destroy();
  }
}

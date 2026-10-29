import { getEnvironment } from '../config/environment.js';
import { lockFileReferences, retainFileReferences } from '../storage/file-references.js';
import { Injectable, Logger } from '@nestjs/common';
import { promoteTripWaitlist } from './trip-waitlist.js';
import { ErrorCode, RegistrationStatus, TripStatus, type NotificationType } from '@club/shared';
import { Prisma } from '../generated/prisma/client.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { AuditService, type Tx } from '../common/audit.service.js';
import { lockActiveUser } from '../common/active-user.js';
import { ApiException } from '../common/api-exception.js';
import { hasPrivateAccess, type Actor } from '../common/http.js';
import { pageArgs, pageResult, type PageQueryDto } from '../common/query.dto.js';
import { NotificationService } from '../notifications/notification.service.js';
import { ReminderService } from '../notifications/reminder.service.js';
import { StorageService } from '../storage/storage.service.js';
import { assertCurator, projectPlace } from './places.service.js';
import {
  assertDates,
  assertFreePlace,
  assertTripRegistration,
  initialTripRegistration,
} from './rules.js';
import type { ReportWriteDto, TripCreateDto, TripPatchDto, TripQueryDto } from './club.dto.js';

const tripInclude = {
  place: { include: { region: true } },
  _count: { select: { registrations: { where: { status: 'CONFIRMED' } } } },
} satisfies Prisma.TripInclude;
type ListedTrip = Prisma.TripGetPayload<{ include: typeof tripInclude }>;
const active = ['PENDING', 'CONFIRMED', 'WAITLIST'] as const;
@Injectable()
export class TripsService {
  private readonly logger = new Logger(TripsService.name);
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly notifications: NotificationService,
    private readonly reminders: ReminderService,
    private readonly storage: StorageService,
  ) {}
  private project(row: ListedTrip, actor: Actor) {
    return {
      id: row.id,
      title: row.title,
      description: row.description,
      place: projectPlace(row.place, hasPrivateAccess(actor)),
      startsAt: row.startsAt,
      endsAt: row.endsAt,
      capacity: row.capacity,
      status: row.status,
      cancelReason: row.cancelReason,
      confirmedCount: row._count.registrations,
      ...(hasPrivateAccess(actor) ? { meetingPoint: row.meetingPoint } : {}),
    };
  }
  async list(actor: Actor, query: TripQueryDto, own = false) {
    if (query.dateFrom && query.dateTo && new Date(query.dateFrom) > new Date(query.dateTo))
      throw new ApiException(ErrorCode.VALIDATION_ERROR);
    const visibility: Prisma.TripWhereInput =
      actor.role === 'ADMIN'
        ? {}
        : {
            OR: [
              { status: { not: 'DRAFT' } },
              ...(actor.role === 'VOLUNTEER'
                ? [{ place: { curators: { some: { userId: actor.id } } } }]
                : []),
            ],
          };
    const where: Prisma.TripWhereInput = {
      AND: [
        visibility,
        ...(own && actor.role !== 'ADMIN'
          ? [{ place: { curators: { some: { userId: actor.id } } } }]
          : []),
        {
          status: query.status,
          place: { regionId: query.regionId, type: query.placeType },
          startsAt: {
            gte: query.dateFrom ? new Date(query.dateFrom) : undefined,
            lte: query.dateTo ? new Date(query.dateTo) : undefined,
          },
          ...(query.search ? { title: { contains: query.search, mode: 'insensitive' } } : {}),
        },
      ],
    };
    const [rows, total] = await Promise.all([
      this.prisma.trip.findMany({
        where,
        include: tripInclude,
        orderBy: [{ startsAt: 'asc' }, { id: 'asc' }],
        ...pageArgs(query),
      }),
      this.prisma.trip.count({ where }),
    ]);
    return pageResult(
      rows.map((row) => this.project(row, actor)),
      total,
      query,
    );
  }
  async detail(actor: Actor, id: string) {
    const row = await this.prisma.trip.findUnique({ where: { id }, include: tripInclude });
    if (!row) throw new ApiException(ErrorCode.NOT_FOUND);
    if (row.status === 'DRAFT') await assertCurator(this.prisma, actor, row.placeId);
    const report = await this.prisma.report.findUnique({
      where: { tripId: id },
      include: { photos: true },
    });
    return {
      ...this.project(row, actor),
      report: report?.publishedAt
        ? {
            id: report.id,
            tripId: id,
            text: report.text,
            hoursSpent: report.hoursSpent.toString(),
            publishedAt: report.publishedAt,
            photos: await Promise.all(
              report.photos
                .filter((photo) => photo.isPublic || hasPrivateAccess(actor))
                .map(async (photo) => ({
                  id: photo.id,
                  url: await this.storage.url(photo.url),
                  isPublic: photo.isPublic,
                  uploadId: await this.storage.reportReference(id, photo.url),
                })),
            ),
          }
        : null,
    };
  }
  async create(actor: Actor, dto: TripCreateDto) {
    assertDates(new Date(dto.startsAt), new Date(dto.endsAt));
    const row = await this.prisma.$transaction(async (tx) => {
      await lockActiveUser(tx, actor.id);
      await assertCurator(tx, actor, dto.placeId);
      const place = await tx.place.findUnique({ where: { id: dto.placeId } });
      if (!place?.isActive) throw new ApiException(ErrorCode.NOT_FOUND);
      const trip = await tx.trip.create({
        data: {
          ...dto,
          startsAt: new Date(dto.startsAt),
          endsAt: new Date(dto.endsAt),
          createdById: actor.id,
          status: 'DRAFT',
        },
      });
      await this.audit.record(tx, actor.id, 'CREATED', 'Trip', trip.id, { status: 'DRAFT' });
      return trip;
    });
    return this.detail(actor, row.id);
  }
  private async lock(tx: Tx, id: string) {
    await tx.$queryRaw`SELECT "id" FROM "trips" WHERE "id"=${id}::uuid FOR UPDATE`;
    const trip = await tx.trip.findUnique({ where: { id } });
    if (!trip) throw new ApiException(ErrorCode.NOT_FOUND);
    return trip;
  }
  private async schedule(id: string): Promise<void> {
    await this.reminders
      .scheduleTrip(id)
      .catch(() => this.logger.warn('TRIP_SCHEDULE_RECONCILE_REQUIRED'));
  }
  async update(actor: Actor, id: string, dto: TripPatchDto) {
    await this.prisma.$transaction(async (tx) => {
      await lockActiveUser(tx, actor.id);
      const trip = await this.lock(tx, id);
      await assertCurator(tx, actor, trip.placeId);
      if (dto.placeId && dto.placeId !== trip.placeId)
        throw new ApiException(ErrorCode.FORBIDDEN_PLACE);
      const startsAt = dto.startsAt ? new Date(dto.startsAt) : trip.startsAt,
        endsAt = dto.endsAt ? new Date(dto.endsAt) : trip.endsAt;
      assertDates(startsAt, endsAt);
      if (
        (dto.startsAt || dto.endsAt || dto.capacity !== undefined) &&
        !['DRAFT', 'OPEN', 'CLOSED'].includes(trip.status)
      )
        throw new ApiException(ErrorCode.INVALID_TRANSITION);
      if (
        dto.capacity !== undefined &&
        dto.capacity <
          (await tx.tripRegistration.count({ where: { tripId: id, status: 'CONFIRMED' } }))
      )
        throw new ApiException(ErrorCode.TRIP_FULL);
      await tx.trip.update({ where: { id }, data: { ...dto, startsAt, endsAt } });
      await this.audit.record(tx, actor.id, 'UPDATED', 'Trip', id, { fields: Object.keys(dto) });
      if (
        startsAt.getTime() !== trip.startsAt.getTime() ||
        endsAt.getTime() !== trip.endsAt.getTime()
      ) {
        const registrations = await tx.tripRegistration.findMany({
          where: { tripId: id, status: { in: [...active] } },
          select: { userId: true },
        });
        await this.notifications.notify(
          tx,
          registrations.map((row) => row.userId),
          'TripRescheduled',
          { tripId: id, title: dto.title ?? trip.title, startsAt: startsAt.toISOString() },
        );
      }
    });
    await this.schedule(id);
    return this.detail(actor, id);
  }
  async changeStatus(actor: Actor, id: string, status: TripStatus, cancelReason?: string) {
    await this.prisma.$transaction(async (tx) => {
      await lockActiveUser(tx, actor.id);
      const trip = await this.lock(tx, id);
      await assertCurator(tx, actor, trip.placeId);
      if (status === 'REPORTED') throw new ApiException(ErrorCode.INVALID_TRANSITION);
      this.audit.assertTransition('TripStatus', trip.status, status);
      if (status === 'OPEN' && trip.startsAt.getTime() <= Date.now())
        throw new ApiException(ErrorCode.TRIP_NOT_OPEN);
      if (status === 'CANCELLED' && !cancelReason?.trim())
        throw new ApiException(ErrorCode.VALIDATION_ERROR, { reason: 'Укажите причину отмены.' });
      if (status === 'DONE') {
        if (
          trip.startsAt.getTime() > Date.now() ||
          (await tx.tripRegistration.count({ where: { tripId: id, status: 'CONFIRMED' } }))
        )
          throw new ApiException(ErrorCode.INVALID_TRANSITION);
      }
      if (status === 'CANCELLED' || status === 'DONE') {
        const registrations = await tx.tripRegistration.findMany({
          where: {
            tripId: id,
            status: { in: status === 'DONE' ? ['PENDING', 'WAITLIST'] : [...active] },
          },
        });
        for (const row of registrations) {
          await this.audit.transition(
            tx,
            actor.id,
            'TripRegistration',
            row.id,
            'RegistrationStatus',
            row.status,
            'CANCELLED',
          );
          await tx.tripRegistration.update({
            where: { id: row.id },
            data: { status: 'CANCELLED' },
          });
        }
        await this.notifications.notify(
          tx,
          registrations.map((row) => row.userId),
          status === 'CANCELLED' ? 'TripCancelled' : 'RegistrationCancelled',
          { tripId: id, title: trip.title, startsAt: trip.startsAt.toISOString() },
        );
      }
      await this.audit.transition(tx, actor.id, 'Trip', id, 'TripStatus', trip.status, status);
      await tx.trip.update({
        where: { id },
        data: { status, ...(status === 'CANCELLED' ? { cancelReason } : {}) },
      });
    });
    await this.schedule(id);
    return this.detail(actor, id);
  }
  async register(actor: Actor, id: string, comment?: string) {
    return this.prisma.$transaction(async (tx) => {
      const user = await lockActiveUser(tx, actor.id);
      const trip = await this.lock(tx, id);
      const existing = await tx.tripRegistration.findUnique({
        where: { tripId_userId: { tripId: id, userId: actor.id } },
      });
      assertTripRegistration(user.role, trip.status, trip.startsAt, Boolean(existing));
      const confirmed = await tx.tripRegistration.count({
        where: { tripId: id, status: 'CONFIRMED' },
      });
      const status = initialTripRegistration(confirmed, trip.capacity);
      const row = await tx.tripRegistration.create({
        data: { tripId: id, userId: actor.id, status, comment },
      });
      await this.audit.record(tx, actor.id, 'CREATED', 'TripRegistration', row.id, { status });
      if (status === 'WAITLIST')
        await this.notifications.notify(tx, [actor.id], 'RegistrationWaitlisted', {
          tripId: id,
          title: trip.title,
          startsAt: trip.startsAt.toISOString(),
        });
      const curators = await tx.placeCurator.findMany({
        where: { placeId: trip.placeId, user: { role: 'VOLUNTEER', isBlocked: false } },
        select: { userId: true },
      });
      await this.notifications.notify(
        tx,
        curators.map((item) => item.userId),
        'NewRegistrationForCurator',
        { tripId: id, title: trip.title, startsAt: trip.startsAt.toISOString() },
      );
      return { id: row.id, status: row.status, createdAt: row.createdAt };
    });
  }
  async changeRegistration(actor: Actor, id: string, status: RegistrationStatus, self = false) {
    return this.prisma.$transaction(async (tx) => {
      await lockActiveUser(tx, actor.id);
      const initial = await tx.tripRegistration.findUnique({ where: { id } });
      if (!initial) throw new ApiException(ErrorCode.NOT_FOUND);
      const trip = await this.lock(tx, initial.tripId);
      if (self) {
        if (initial.userId !== actor.id || status !== 'CANCELLED')
          throw new ApiException(ErrorCode.FORBIDDEN);
      } else await assertCurator(tx, actor, trip.placeId);
      const row = await tx.tripRegistration.findUniqueOrThrow({ where: { id } });
      this.audit.assertTransition('RegistrationStatus', row.status, status);
      if (status === 'CONFIRMED') {
        if (!['OPEN', 'CLOSED'].includes(trip.status))
          throw new ApiException(ErrorCode.TRIP_NOT_OPEN);
        const user = await tx.user.findUniqueOrThrow({ where: { id: row.userId } });
        if (!['VOLUNTEER', 'ADMIN'].includes(user.role) || user.isBlocked || user.anonymizedAt)
          throw new ApiException(ErrorCode.FORBIDDEN);
        assertFreePlace(
          await tx.tripRegistration.count({ where: { tripId: trip.id, status: 'CONFIRMED' } }),
          trip.capacity,
        );
      }
      if ((status === 'ATTENDED' || status === 'NO_SHOW') && trip.startsAt.getTime() > Date.now())
        throw new ApiException(ErrorCode.INVALID_TRANSITION);
      await this.audit.transition(
        tx,
        actor.id,
        'TripRegistration',
        id,
        'RegistrationStatus',
        row.status,
        status,
      );
      const updated = await tx.tripRegistration.update({ where: { id }, data: { status } });
      const type: NotificationType | undefined =
        status === 'CONFIRMED'
          ? 'RegistrationConfirmed'
          : status === 'REJECTED'
            ? 'RegistrationRejected'
            : status === 'CANCELLED'
              ? 'RegistrationCancelled'
              : undefined;
      if (type)
        await this.notifications.notify(tx, [row.userId], type, {
          tripId: trip.id,
          title: trip.title,
          startsAt: trip.startsAt.toISOString(),
        });
      if (['CONFIRMED', 'PENDING'].includes(row.status) && status === 'CANCELLED')
        await promoteTripWaitlist(tx, this.audit, this.notifications, trip);
      return { id: updated.id, status: updated.status, createdAt: updated.createdAt };
    });
  }
  async cancelOwn(actor: Actor, tripId: string) {
    const row = await this.prisma.tripRegistration.findUnique({
      where: { tripId_userId: { tripId, userId: actor.id } },
    });
    if (!row) throw new ApiException(ErrorCode.NOT_FOUND);
    return this.changeRegistration(actor, row.id, RegistrationStatus.CANCELLED, true);
  }
  async participants(actor: Actor, id: string, query: PageQueryDto) {
    const trip = await this.prisma.trip.findUniqueOrThrow({ where: { id } });
    await assertCurator(this.prisma, actor, trip.placeId);
    const where = {
      tripId: id,
      status: { in: [...active] },
      ...(query.search
        ? { user: { fullName: { contains: query.search, mode: 'insensitive' as const } } }
        : {}),
    };
    const rows = await this.prisma.tripRegistration.findMany({
      where,
      select: {
        id: true,
        status: true,
        createdAt: true,
        user: { select: { fullName: true, nickname: true, phone: true } },
      },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
      ...pageArgs(query),
    });
    return pageResult(
      rows.map(({ user, ...row }) => ({ ...row, ...user })),
      await this.prisma.tripRegistration.count({ where }),
      query,
    );
  }
  async report(actor: Actor, id: string, dto: ReportWriteDto) {
    const initial = await this.prisma.trip.findUniqueOrThrow({ where: { id } });
    await assertCurator(this.prisma, actor, initial.placeId);
    const photos = await this.storage.validateReportPhotos(
      id,
      dto.photos.map((photo) => photo.uploadId),
    );
    await this.prisma.$transaction(async (tx) => {
      await lockFileReferences(tx);
      await lockActiveUser(tx, actor.id);
      const trip = await this.lock(tx, id);
      await assertCurator(tx, actor, trip.placeId);
      if (trip.status !== 'DONE' && trip.status !== 'REPORTED')
        throw new ApiException(ErrorCode.INVALID_TRANSITION);
      const assets = await tx.uploadAsset.count({
        where: {
          id: { in: dto.photos.map((photo) => photo.uploadId) },
          deletedAt: null,
          tripId: id,
          purpose: 'REPORT_PHOTO',
        },
      });
      if (assets !== dto.photos.length) throw new ApiException(ErrorCode.VALIDATION_ERROR);
      const existingReport = await tx.report.findUnique({
        where: { tripId: id },
        select: { publishedAt: true },
      });
      const report = await tx.report.upsert({
        where: { tripId: id },
        create: {
          tripId: id,
          authorId: actor.id,
          text: dto.text,
          hoursSpent: new Prisma.Decimal(dto.hoursSpent),
          publishedAt: new Date(),
        },
        update: {
          text: dto.text,
          hoursSpent: new Prisma.Decimal(dto.hoursSpent),
          publishedAt: existingReport?.publishedAt ?? new Date(),
        },
      });
      await tx.reportPhoto.deleteMany({ where: { reportId: report.id } });
      if (dto.photos.length)
        await tx.reportPhoto.createMany({
          data: dto.photos.map((photo) => ({
            reportId: report.id,
            url: photos.get(photo.uploadId)!,
            isPublic: photo.isPublic ?? false,
          })),
        });
      await retainFileReferences(tx, [...photos.values()], getEnvironment());
      if (trip.status === 'DONE') {
        await this.audit.transition(tx, actor.id, 'Trip', id, 'TripStatus', 'DONE', 'REPORTED');
        await tx.trip.update({ where: { id }, data: { status: 'REPORTED' } });
      }
      await this.audit.record(tx, actor.id, 'REPORT_PUBLISHED', 'Report', report.id, {
        photoCount: dto.photos.length,
      });
    });
    return (await this.detail(actor, id)).report;
  }
}

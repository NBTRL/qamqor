import { Injectable, Logger, type OnModuleInit, type OnModuleDestroy } from '@nestjs/common';
import { GrammyError } from 'grammy';
import { type Queue } from 'bullmq';
import { NotificationChannel, type NotificationType } from '@club/shared';
import type { Prisma, Notification } from '../generated/prisma/client.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { AuditService, type Tx } from '../common/audit.service.js';
import { QueuesService } from '../common/queues.service.js';
import { MailService } from '../common/mail.service.js';
import { TelegramService } from '../auth/telegram.service.js';
import { getEnvironment } from '../config/environment.js';
import { notificationMessage } from './templates.js';
import { randomUUID } from 'node:crypto';
import { isUUID } from 'class-validator';

type NotificationJob = { id: string };
class RetryDelivery extends Error {
  constructor(readonly retryAfterMs: number) {
    super('NOTIFICATION_DELIVERY_RETRY');
  }
}
@Injectable()
export class NotificationService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(NotificationService.name);
  private readonly env = getEnvironment();
  private telegramQueue?: Queue<NotificationJob>;
  private emailQueue?: Queue<NotificationJob>;
  private timer?: ReturnType<typeof setInterval>;
  private dispatching?: Promise<void>;
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly queues: QueuesService,
    private readonly telegram: TelegramService,
    private readonly mail: MailService,
  ) {}
  async notify(
    tx: Tx,
    userIds: string[],
    type: NotificationType,
    payload: Prisma.InputJsonObject,
    dedupe: string = randomUUID(),
  ): Promise<void> {
    const users = await tx.user.findMany({
      where: { id: { in: [...new Set(userIds)] }, isBlocked: false, anonymizedAt: null },
      include: { notificationSettings: { where: { type } } },
    });
    const rows: Prisma.NotificationCreateManyInput[] = [];
    for (const user of users) {
      const setting = user.notificationSettings[0];
      const common = { userId: user.id, type, payload };
      rows.push({
        ...common,
        channel: 'IN_APP',
        status: 'SENT',
        sentAt: new Date(),
        dedupeKey: `${dedupe}:${user.id}:IN_APP`,
      });
      if ((setting?.telegram ?? true) && user.chatId)
        rows.push({
          ...common,
          channel: 'TELEGRAM',
          status: 'QUEUED',
          dedupeKey: `${dedupe}:${user.id}:TELEGRAM`,
        });
      if ((setting?.email ?? true) && user.email && user.emailVerifiedAt)
        rows.push({
          ...common,
          channel: 'EMAIL',
          status: 'QUEUED',
          dedupeKey: `${dedupe}:${user.id}:EMAIL`,
        });
    }
    if (rows.length) await tx.notification.createMany({ data: rows, skipDuplicates: true });
  }
  onModuleInit(): void {
    if (this.queues.runtime.offline) return;
    this.telegramQueue = this.queues.queue('notifications-telegram');
    this.emailQueue = this.queues.queue('notifications-email');
    this.queues.worker<NotificationJob>(
      'notifications-telegram',
      (job) => this.deliver(job.data.id, 'TELEGRAM'),
      {
        concurrency: 10,
        limiter: { max: 25, duration: 1000 },
        settings: {
          backoffStrategy: (attempt, _type, error) =>
            error instanceof RetryDelivery ? error.retryAfterMs : 1000 * 2 ** (attempt - 1),
        },
      },
    );
    this.queues.worker<NotificationJob>(
      'notifications-email',
      (job) => this.deliver(job.data.id, 'EMAIL'),
      { concurrency: 5 },
    );
    if (this.queues.runtime.workers) {
      const tick = () => {
        if (!this.dispatching)
          this.dispatching = this.dispatch()
            .catch(() => {
              this.logger.warn('NOTIFICATION_DISPATCH_FAILED');
            })
            .finally(() => {
              this.dispatching = undefined;
            });
      };
      this.timer = setInterval(tick, this.queues.runtime.backgroundIntervalMs ?? 3000);
      this.timer.unref();
      tick();
    }
  }
  async dispatch(): Promise<void> {
    const rows = await this.prisma.notification.findMany({
      where: { status: 'QUEUED', channel: { in: ['TELEGRAM', 'EMAIL'] } },
      orderBy: { createdAt: 'asc' },
      take: 200,
    });
    for (const row of rows) {
      const queue = row.channel === 'TELEGRAM' ? this.telegramQueue : this.emailQueue;
      if (!queue) continue;
      const id = `notification-${row.id}`;
      const existing = await queue.getJob(id);
      if (existing && (await existing.getState()) === 'failed') await existing.remove();
      await queue.add(
        'send',
        { id: row.id },
        { jobId: id, ...(row.channel === 'TELEGRAM' ? { backoff: { type: 'telegram' } } : {}) },
      );
    }
  }
  private async finish(
    row: Notification,
    status: 'SENT' | 'FAILED',
    error: string | null,
  ): Promise<void> {
    await this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT "id" FROM "notifications" WHERE "id"=${row.id}::uuid FOR UPDATE`;
      const current = await tx.notification.findUnique({ where: { id: row.id } });
      if (!current || current.status !== 'QUEUED') return;
      await this.audit.transition(
        tx,
        null,
        'Notification',
        row.id,
        'NotificationStatus',
        current.status,
        status,
      );
      await tx.notification.update({
        where: { id: row.id },
        data: { status, lastError: error, sentAt: status === 'SENT' ? new Date() : null },
      });
    });
  }
  async deliver(id: string, channel: 'TELEGRAM' | 'EMAIL'): Promise<void> {
    const row = await this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT "id" FROM "notifications" WHERE "id"=${id}::uuid FOR UPDATE`;
      const current = await tx.notification.findUnique({ where: { id }, include: { user: true } });
      if (!current || current.status !== 'QUEUED' || current.channel !== channel) return null;
      if (current.user.isBlocked || current.user.anonymizedAt || current.attempts >= 5) {
        await this.audit.transition(
          tx,
          null,
          'Notification',
          id,
          'NotificationStatus',
          'QUEUED',
          'FAILED',
        );
        await tx.notification.update({
          where: { id },
          data: {
            status: 'FAILED',
            lastError: current.attempts >= 5 ? 'ATTEMPTS_EXHAUSTED' : 'RECIPIENT_INACTIVE',
          },
        });
        return null;
      }
      const obsolete = !(await this.rescheduleCurrent(tx, current))
        ? 'SCHEDULE_OBSOLETE'
        : !(await this.reminderCurrent(tx, current))
          ? 'REMINDER_OBSOLETE'
          : null;
      if (obsolete) {
        await this.audit.transition(
          tx,
          null,
          'Notification',
          id,
          'NotificationStatus',
          current.status,
          'FAILED',
        );
        await tx.notification.update({
          where: { id },
          data: { status: 'FAILED', lastError: obsolete },
        });
        return null;
      }
      return tx.notification.update({
        where: { id },
        data: { attempts: { increment: 1 } },
        include: { user: true },
      });
    });
    if (!row) return;
    const message = notificationMessage(
      row.type as NotificationType,
      row.payload,
      this.env.WEB_URL,
    );
    try {
      if (channel === 'TELEGRAM') {
        if (!row.user.chatId || row.user.botBlockedAt) {
          await this.blocked(row);
          return;
        }
        await this.telegram.send(row.user.chatId.toString(), message.text);
      } else {
        if (!row.user.email || !row.user.emailVerifiedAt) {
          await this.finish(row, 'FAILED', 'EMAIL_NOT_VERIFIED');
          return;
        }
        await this.mail.deliver(row.user.email, message.subject, message.text);
      }
      await this.finish(row, 'SENT', null);
    } catch (error) {
      const code = error instanceof GrammyError ? error.error_code : undefined;
      if (channel === 'TELEGRAM' && code === 403) {
        await this.blocked(row);
        return;
      }
      const safeError = code
        ? `TELEGRAM_${code}`
        : channel === 'TELEGRAM'
          ? 'TELEGRAM_DELIVERY_FAILED'
          : 'EMAIL_DELIVERY_FAILED';
      if (row.attempts >= 5) await this.finish(row, 'FAILED', safeError);
      else
        await this.prisma.notification.updateMany({
          where: { id, status: 'QUEUED' },
          data: { lastError: safeError },
        });
      const retry =
        error instanceof GrammyError ? Number(error.parameters.retry_after ?? 0) * 1000 : 0;
      throw new RetryDelivery(Math.max(retry, 1000 * 2 ** (row.attempts - 1)));
    }
  }
  private async rescheduleCurrent(
    tx: Tx,
    row: Notification & { user: { role: string } },
  ): Promise<boolean> {
    if (row.type !== 'EventRescheduled' && row.type !== 'OpenDayRescheduled') return true;
    const data = row.payload;
    if (!data || typeof data !== 'object' || Array.isArray(data)) return false;
    if (row.type === 'EventRescheduled') {
      if (typeof data.eventId !== 'string' || !isUUID(data.eventId)) return false;
      const registration = await tx.eventRegistration.findUnique({
        where: { eventId_userId: { eventId: data.eventId, userId: row.userId } },
        include: { event: true },
      });
      return Boolean(
        registration &&
        ['PENDING', 'CONFIRMED', 'WAITLIST'].includes(registration.status) &&
        (!registration.event.volunteersOnly || ['VOLUNTEER', 'ADMIN'].includes(row.user.role)) &&
        registration.event.startsAt.toISOString() === data.startsAt &&
        registration.event.endsAt.toISOString() === data.endsAt &&
        registration.event.location === data.location,
      );
    }
    if (typeof data.sessionId !== 'string' || !isUUID(data.sessionId)) return false;
    const registration = await tx.openDayRegistration.findUnique({
      where: { sessionId_userId: { sessionId: data.sessionId, userId: row.userId } },
      include: { session: true },
    });
    return Boolean(
      registration &&
      !registration.cancelledAt &&
      !registration.attended &&
      registration.session.startsAt.toISOString() === data.startsAt &&
      registration.session.location === data.location,
    );
  }
  private async reminderCurrent(tx: Tx, row: Notification): Promise<boolean> {
    const tripReminder = row.type === 'TripReminder24h' || row.type === 'TripReminder3h';
    const reportReminder = row.type === 'ReportRequestedFromCurator';
    const openDayReminder = row.type === 'OpenDayReminder';
    if (!tripReminder && !reportReminder && !openDayReminder) return true;
    const data = row.payload;
    if (
      !data ||
      typeof data !== 'object' ||
      Array.isArray(data) ||
      typeof data.startsAt !== 'string'
    )
      return false;
    if (openDayReminder) {
      if (typeof data.sessionId !== 'string' || !isUUID(data.sessionId)) return false;
      const registration = await tx.openDayRegistration.findUnique({
        where: { sessionId_userId: { sessionId: data.sessionId, userId: row.userId } },
        include: { session: true },
      });
      return Boolean(
        registration &&
        !registration.cancelledAt &&
        !registration.attended &&
        registration.session.startsAt > new Date() &&
        registration.session.startsAt.toISOString() === data.startsAt,
      );
    }
    if (typeof data.tripId !== 'string' || !isUUID(data.tripId)) return false;
    const trip = await tx.trip.findUnique({
      where: { id: data.tripId },
      include: { report: { select: { publishedAt: true } } },
    });
    if (
      !trip ||
      trip.startsAt.toISOString() !== data.startsAt ||
      ['DRAFT', 'CANCELLED', 'REPORTED'].includes(trip.status)
    )
      return false;
    if (reportReminder) {
      const scheduledAt = trip.endsAt.getTime() + 24 * 3600000;
      return (
        !trip.report?.publishedAt &&
        data.scheduledAt === scheduledAt &&
        Date.now() >= scheduledAt &&
        Boolean(
          await tx.placeCurator.findUnique({
            where: { userId_placeId: { userId: row.userId, placeId: trip.placeId } },
          }),
        )
      );
    }
    if (!['OPEN', 'CLOSED'].includes(trip.status) || trip.startsAt <= new Date()) return false;
    const registration = await tx.tripRegistration.findUnique({
      where: { tripId_userId: { tripId: trip.id, userId: row.userId } },
    });
    return registration?.status === 'CONFIRMED';
  }
  private async blocked(
    row: Notification & {
      user: { id: string; email: string | null; emailVerifiedAt: Date | null };
    },
  ): Promise<void> {
    await this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT "id" FROM "users" WHERE "id"=${row.userId}::uuid FOR UPDATE`;
      await tx.$queryRaw`SELECT "id" FROM "notifications" WHERE "id"=${row.id}::uuid FOR UPDATE`;
      const current = await tx.notification.findUnique({ where: { id: row.id } });
      const user = await tx.user.findUnique({ where: { id: row.userId } });
      if (!current || current.status !== 'QUEUED' || !user || user.isBlocked || user.anonymizedAt)
        return;
      await tx.user.update({ where: { id: row.userId }, data: { botBlockedAt: new Date() } });
      await this.audit.transition(
        tx,
        null,
        'Notification',
        row.id,
        'NotificationStatus',
        current.status,
        'FAILED',
      );
      await tx.notification.updateMany({
        where: { id: row.id, status: 'QUEUED' },
        data: { status: 'FAILED', lastError: 'BOT_BLOCKED' },
      });
      // Критический fallback при 403 — исключение из обычных предпочтений каналов.
      if (user.email && user.emailVerifiedAt) {
        const dedupeKey = row.dedupeKey?.replace(/:TELEGRAM$/, ':EMAIL') ?? `fallback:${row.id}`;
        await tx.notification.createMany({
          data: [
            {
              userId: row.userId,
              type: row.type,
              payload: row.payload as Prisma.InputJsonObject,
              channel: NotificationChannel.EMAIL,
              status: 'QUEUED',
              dedupeKey,
            },
          ],
          skipDuplicates: true,
        });
      }
    });
  }
  async onModuleDestroy(): Promise<void> {
    if (this.timer) clearInterval(this.timer);
    await this.dispatching;
  }
}

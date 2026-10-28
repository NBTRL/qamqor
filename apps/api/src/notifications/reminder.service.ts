import { Injectable, Logger, type OnModuleInit, type OnModuleDestroy } from '@nestjs/common';
import type { Queue } from 'bullmq';
import { PrismaService } from '../prisma/prisma.service.js';
import { QueuesService } from '../common/queues.service.js';
import { NotificationService } from './notification.service.js';
import type { NotificationType } from '@club/shared';

type ReminderJob = {
  entity: 'trip' | 'openDay';
  id: string;
  startsAt: string;
  type: NotificationType;
  scheduledAt: number;
};
@Injectable()
export class ReminderService implements OnModuleInit, OnModuleDestroy {
  private queue?: Queue<ReminderJob>;
  private timer?: ReturnType<typeof setInterval>;
  private running?: Promise<void>;
  private readonly logger = new Logger(ReminderService.name);
  constructor(
    private readonly prisma: PrismaService,
    private readonly queues: QueuesService,
    private readonly notifications: NotificationService,
  ) {}
  onModuleInit(): void {
    if (this.queues.runtime.offline) return;
    this.queue = this.queues.queue('reminders');
    this.queues.worker<ReminderJob>('reminders', (job) => this.process(job.data, job.id ?? ''), {
      concurrency: 5,
    });
    if (this.queues.runtime.workers) {
      const tick = () => {
        if (!this.running)
          this.running = this.reconcile()
            .catch(() => {
              this.logger.warn('REMINDER_RECONCILE_FAILED');
            })
            .finally(() => {
              this.running = undefined;
            });
      };
      this.timer = setInterval(tick, this.queues.runtime.backgroundIntervalMs ?? 30000);
      this.timer.unref();
      tick();
    }
  }
  async reconcile(): Promise<void> {
    const lower = new Date(Date.now() - 48 * 3600_000);
    const trips = await this.prisma.trip.findMany({
      where: { status: { in: ['OPEN', 'CLOSED', 'DONE'] }, endsAt: { gte: lower } },
      select: { id: true, startsAt: true, endsAt: true, status: true },
    });
    for (const trip of trips) await this.scheduleTrip(trip.id);
    const days = await this.prisma.openDaySession.findMany({
      where: { startsAt: { gte: new Date() } },
      select: { id: true, startsAt: true },
    });
    for (const day of days)
      await this.enqueue(
        {
          entity: 'openDay',
          id: day.id,
          startsAt: day.startsAt.toISOString(),
          type: 'OpenDayReminder',
        },
        day.startsAt.getTime() - 24 * 3600_000,
      );
  }
  async scheduleTrip(id: string): Promise<void> {
    const trip = await this.prisma.trip.findUnique({ where: { id } });
    if (!trip || ['DRAFT', 'CANCELLED', 'REPORTED'].includes(trip.status)) return;
    const base = { entity: 'trip' as const, id, startsAt: trip.startsAt.toISOString() };
    if (trip.status !== 'DONE') {
      await this.enqueue(
        { ...base, type: 'TripReminder24h' },
        trip.startsAt.getTime() - 24 * 3600_000,
      );
      await this.enqueue(
        { ...base, type: 'TripReminder3h' },
        trip.startsAt.getTime() - 3 * 3600_000,
      );
    }
    await this.enqueue(
      { ...base, type: 'ReportRequestedFromCurator' },
      trip.endsAt.getTime() + 24 * 3600_000,
    );
  }
  private async enqueue(data: Omit<ReminderJob, 'scheduledAt'>, at: number): Promise<void> {
    if (!this.queue) return;
    if (at < Date.now() - 15 * 60000 && data.type !== 'ReportRequestedFromCurator') return;
    const jobId = `${data.type}-${data.id}-${new Date(data.startsAt).getTime()}-${at}`;
    const old = await this.queue.getJob(jobId);
    if (old && (await old.getState()) === 'failed') await old.remove();
    await this.queue.add(
      'remind',
      { ...data, scheduledAt: at },
      { jobId, delay: Math.max(0, at - Date.now()) },
    );
  }
  async process(data: ReminderJob, jobId: string): Promise<void> {
    await this.prisma.$transaction(async (tx) => {
      if (data.entity === 'trip') {
        await tx.$queryRaw`SELECT "id" FROM "trips" WHERE "id"=${data.id}::uuid FOR UPDATE`;
        const trip = await tx.trip.findUnique({
          where: { id: data.id },
          include: {
            place: { include: { curators: true } },
            registrations: { where: { status: 'CONFIRMED' } },
            report: true,
          },
        });
        if (
          !trip ||
          trip.startsAt.toISOString() !== data.startsAt ||
          ['DRAFT', 'CANCELLED', 'REPORTED'].includes(trip.status)
        )
          return;
        const expectedAt =
          data.type === 'ReportRequestedFromCurator'
            ? trip.endsAt.getTime() + 24 * 3600_000
            : trip.startsAt.getTime() - (data.type === 'TripReminder24h' ? 24 : 3) * 3600_000;
        if (data.scheduledAt !== expectedAt) return;
        if (data.type === 'ReportRequestedFromCurator') {
          if (trip.report?.publishedAt || Date.now() < trip.endsAt.getTime() + 24 * 3600_000)
            return;
          await this.notifications.notify(
            tx,
            trip.place.curators.map((item) => item.userId),
            data.type,
            {
              tripId: trip.id,
              title: trip.title,
              startsAt: data.startsAt,
              scheduledAt: data.scheduledAt,
            },
            jobId,
          );
        } else {
          if (trip.startsAt.getTime() <= Date.now()) return;
          await this.notifications.notify(
            tx,
            trip.registrations.map((item) => item.userId),
            data.type,
            {
              tripId: trip.id,
              title: trip.title,
              startsAt: data.startsAt,
              scheduledAt: data.scheduledAt,
            },
            jobId,
          );
        }
      } else {
        await tx.$queryRaw`SELECT "id" FROM "open_day_sessions" WHERE "id"=${data.id}::uuid FOR UPDATE`;
        const day = await tx.openDaySession.findUnique({
          where: { id: data.id },
          include: { registrations: { where: { cancelledAt: null } } },
        });
        if (
          !day ||
          day.startsAt.toISOString() !== data.startsAt ||
          day.startsAt.getTime() <= Date.now()
        )
          return;
        if (data.scheduledAt !== day.startsAt.getTime() - 24 * 3600_000) return;
        await this.notifications.notify(
          tx,
          day.registrations.map((item) => item.userId),
          'OpenDayReminder',
          {
            sessionId: day.id,
            title: 'День открытых дверей',
            startsAt: data.startsAt,
            scheduledAt: data.scheduledAt,
          },
          jobId,
        );
      }
    });
  }
  async onModuleDestroy(): Promise<void> {
    if (this.timer) clearInterval(this.timer);
    await this.running;
  }
}

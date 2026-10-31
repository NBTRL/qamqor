import 'reflect-metadata';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { Test, type TestingModule } from '@nestjs/testing';
import { randomUUID } from 'node:crypto';
import { AppModule } from '../dist/app.module.js';
import { PrismaService } from '../dist/prisma/prisma.service.js';
import { MeService } from '../dist/auth/me.service.js';
import { MyNotificationsController } from '../dist/notifications/notification.controller.js';
import { AuditService } from '../dist/common/audit.service.js';
import type { Tx } from '../dist/common/audit.service.js';
import type { Actor } from '../dist/common/http.js';

let module: TestingModule,
  prisma: PrismaService,
  me: MeService,
  controller: MyNotificationsController;
const items = [{ type: 'TripReminder24h', telegram: false, email: true }];
const deferred = () => {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
};
beforeAll(async () => {
  const url = new URL(process.env.DATABASE_URL ?? '');
  if (
    process.env.NODE_ENV !== 'test' ||
    !['localhost', '127.0.0.1'].includes(url.hostname) ||
    !url.pathname.startsWith('/club_test_')
  )
    throw new Error('Use an isolated local club_test_ database.');
  module = await Test.createTestingModule({
    imports: [AppModule.configure({ offline: true, workers: false, telegram: false })],
  }).compile();
  prisma = module.get(PrismaService);
  me = module.get(MeService);
  controller = new MyNotificationsController(prisma);
});
afterAll(async () => {
  await module?.close();
});
async function user() {
  const row = await prisma.user.create({
    data: {
      fullName: 'Settings concurrency fixture',
      role: 'CANDIDATE',
      telegramId: BigInt('0x' + randomUUID().replaceAll('-', '').slice(0, 14)),
      phone: '+70000000001',
    },
  });
  return { ...row, sessionId: randomUUID(), adminVerified: false } as Actor;
}
async function expectWaiting(lock: 'FOR UPDATE' | 'FOR NO KEY UPDATE') {
  await vi.waitFor(
    async () => {
      const rows = await prisma.$queryRaw<
        Array<{ count: number }>
      >`SELECT count(*)::int AS count FROM pg_stat_activity WHERE datname=current_database() AND wait_event_type='Lock' AND query LIKE ${'%' + lock + '%'}`;
      expect(rows[0].count).toBeGreaterThan(0);
    },
    { timeout: 3000, interval: 10 },
  );
}
describe('Notification settings and anonymization on PostgreSQL', () => {
  it('returns the committed settings and rejects stale actors for GET, PUT and an empty PUT after deletion', async () => {
    const actor = await user();
    const result = await controller.write(actor, { items });
    expect(result.items).toContainEqual(items[0]);
    await me.anonymize(actor);
    for (const call of [
      () => controller.settings(actor),
      () => controller.write(actor, { items }),
      () => controller.write(actor, { items: [] }),
    ])
      await expect(call()).rejects.toMatchObject({ code: 'ACCOUNT_BLOCKED' });
    expect(await prisma.notificationSetting.count({ where: { userId: actor.id } })).toBe(0);
  });
  it('rejects a request waiting behind deletion without recreating settings', async () => {
    const actor = await user();
    await controller.write(actor, { items });
    const entered = deferred(),
      release = deferred();
    const audit = module.get(AuditService),
      original = audit.record.bind(audit);
    const spy = vi.spyOn(audit, 'record').mockImplementation(async (...args) => {
      await original(...args);
      if (args[2] === 'ACCOUNT_ANONYMIZED' && args[4] === actor.id) {
        entered.resolve();
        await release.promise;
      }
    });
    const deletion = me.anonymize(actor);
    let write: Promise<unknown> | undefined;
    try {
      await entered.promise;
      write = controller.write(actor, { items }).catch((error: unknown) => error);
      await expectWaiting('FOR NO KEY UPDATE');
    } finally {
      release.resolve();
      spy.mockRestore();
    }
    await deletion;
    expect(await write).toMatchObject({ code: 'ACCOUNT_BLOCKED' });
    expect(await prisma.notificationSetting.count({ where: { userId: actor.id } })).toBe(0);
  });
  it('lets a prior save finish and then deletes its rows atomically', async () => {
    const actor = await user();
    const entered = deferred(),
      release = deferred();
    const delayedController = new MyNotificationsController({
      $transaction: (callback: (tx: Tx) => Promise<unknown>) =>
        prisma.$transaction(async (tx) => {
          const result = await callback(tx);
          entered.resolve();
          await release.promise;
          return result;
        }),
    } as unknown as PrismaService);
    const write = delayedController.write(actor, { items });
    let deletion: Promise<unknown> | undefined;
    try {
      await entered.promise;
      deletion = me.anonymize(actor);
      await expectWaiting('FOR UPDATE');
    } finally {
      release.resolve();
    }
    expect((await write).items).toContainEqual(items[0]);
    await deletion;
    expect(await prisma.notificationSetting.count({ where: { userId: actor.id } })).toBe(0);
  });
});

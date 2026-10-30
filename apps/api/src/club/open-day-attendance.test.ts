import { describe, expect, it, vi } from 'vitest';
import { AdminService } from '../admin/admin.service.js';
import { OpenDaysService } from './events.service.js';
import type { PrismaService } from '../prisma/prisma.service.js';
import type { AuditService, Tx } from '../common/audit.service.js';
import type { NotificationService } from '../notifications/notification.service.js';
import type { Actor } from '../common/http.js';

function fixture({ inactive = false, full = false, cancelled = true, historical = false } = {}) {
  const row = {
    id: 'registration',
    sessionId: 'session',
    userId: 'participant',
    attended: false,
    cancelledAt: cancelled ? new Date() : null,
  };
  const operations: string[] = [];
  const upsert = vi.fn().mockResolvedValue({ ...row, attended: true, cancelledAt: null });
  const record = vi.fn();
  const tx = {
    $queryRaw: vi.fn(async (sql: TemplateStringsArray) => {
      operations.push(sql.join('?'));
      return [];
    }),
    user: {
      findUniqueOrThrow: vi.fn(async () => {
        operations.push('read-user');
        return { isBlocked: inactive, anonymizedAt: inactive ? new Date() : null };
      }),
    },
    openDaySession: {
      findUniqueOrThrow: vi.fn().mockResolvedValue({
        capacity: 1,
        startsAt: new Date(Date.now() + (historical ? -1 : 1) * 86400_000),
      }),
    },
    openDayRegistration: {
      findUnique: vi.fn<() => Promise<typeof row | null>>().mockResolvedValue(row),
      findUniqueOrThrow: vi.fn().mockResolvedValue(row),
      count: vi.fn().mockResolvedValue(full ? 1 : 0),
      upsert,
    },
  };
  const prisma = {
    openDayRegistration: tx.openDayRegistration,
    $transaction: (operation: (tx: Tx) => Promise<unknown>) => operation(tx as unknown as Tx),
  } as unknown as PrismaService;
  const audit = { record } as unknown as AuditService;
  const days = new OpenDaysService(prisma, audit, {} as NotificationService);
  const admin = new AdminService(prisma, audit, days);
  const actor = { id: 'admin' } as Actor;
  const mark = (mode: 'POST' | 'PATCH') =>
    mode === 'POST'
      ? admin.markAttendance(actor, row.sessionId, row.userId, true)
      : days.attendance(actor, row.id, true);
  return { mark, days, actor, tx, row, record, upsert, operations };
}

describe('Shared administrative open-day attendance', () => {
  it.each(['POST', 'PATCH'] as const)(
    '%s rejects restoring an inactive future participant',
    async (mode) => {
      const f = fixture({ inactive: true });
      await expect(f.mark(mode)).rejects.toMatchObject({ code: 'FORBIDDEN' });
      expect(f.upsert).not.toHaveBeenCalled();
      expect(f.record).not.toHaveBeenCalled();
    },
  );

  it.each(['POST', 'PATCH'] as const)(
    '%s rejects restoration when no future place remains',
    async (mode) => {
      const f = fixture({ full: true });
      await expect(f.mark(mode)).rejects.toMatchObject({ code: 'OPEN_DAY_FULL' });
      expect(f.upsert).not.toHaveBeenCalled();
      expect(f.record).not.toHaveBeenCalled();
    },
  );

  it.each(['POST', 'PATCH'] as const)(
    '%s preserves early attendance for an already reserved place',
    async (mode) => {
      const f = fixture({ full: true, cancelled: false });
      await expect(f.mark(mode)).resolves.toMatchObject({ attended: true, cancelledAt: null });
      expect(f.record).toHaveBeenCalledOnce();
    },
  );

  it('permits recording historical attendance without a prior booking, even above former capacity', async () => {
    const f = fixture({ inactive: true, historical: true, full: true });
    f.tx.openDayRegistration.findUnique.mockResolvedValue(null);
    await expect(
      f.days.markAttendance(f.actor, 'session', 'participant', true),
    ).resolves.toMatchObject({
      attended: true,
    });
    expect(f.upsert).toHaveBeenCalledOnce();
  });

  it('locks the participant before the session and reads current eligibility after both locks', async () => {
    const f = fixture();
    await f.mark('POST');
    expect(f.operations[0]).toContain('FROM "users"');
    expect(f.operations[0]).toContain('FOR NO KEY UPDATE');
    expect(f.operations[1]).toContain('FROM "open_day_sessions"');
    expect(f.operations[1]).toContain('FOR UPDATE');
    expect(f.operations[2]).toBe('read-user');
  });
});

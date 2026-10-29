import 'reflect-metadata';
import { beforeAll, afterAll, expect, it } from 'vitest';
import { PrismaService } from '../dist/prisma/prisma.service.js';
import { retryTransaction } from '../dist/common/transaction-retry.js';
let prisma: PrismaService;
beforeAll(() => {
  const url = new URL(process.env.DATABASE_URL ?? '');
  if (
    process.env.NODE_ENV !== 'test' ||
    !['localhost', '127.0.0.1'].includes(url.hostname) ||
    !url.pathname.startsWith('/club_test_')
  )
    throw new Error('Use an isolated local club_test_ database.');
  prisma = new PrismaService();
});
afterAll(async () => {
  await prisma?.$disconnect();
});
it('retries a real adapter-wrapped PostgreSQL deadlock and commits both operations', async () => {
  let first!: () => void, second!: () => void;
  const a = new Promise<void>((resolve) => {
    first = resolve;
  });
  const b = new Promise<void>((resolve) => {
    second = resolve;
  });
  const attempts = [0, 0];
  const operation = (index: number, left: number, right: number) =>
    retryTransaction(() =>
      prisma.$transaction(
        async (tx) => {
          const initial = attempts[index]++ === 0;
          await tx.$queryRaw`SELECT 1::int AS locked FROM pg_advisory_xact_lock(94320, ${left}::int)`;
          if (initial) {
            if (index === 0) first();
            else second();
            await Promise.all([a, b]);
          }
          await tx.$queryRaw`SELECT 1::int AS locked FROM pg_advisory_xact_lock(94320, ${right}::int)`;
          return 'committed';
        },
        { timeout: 15000 },
      ),
    );
  await expect(Promise.all([operation(0, 1, 2), operation(1, 2, 1)])).resolves.toEqual([
    'committed',
    'committed',
  ]);
  expect(attempts[0] + attempts[1]).toBe(3);
});

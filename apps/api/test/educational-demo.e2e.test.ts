import { readFile } from 'node:fs/promises';
import { Client } from 'pg';
import { afterAll, beforeAll, expect, it } from 'vitest';

let client: Client;
let migration: string;
const author = 'd30e0000-0000-4000-8000-000000000002';
const tables = [
  'regions',
  'users',
  'places',
  'need_items',
  'events',
  'trips',
  'open_day_sessions',
  'news_posts',
];
beforeAll(async () => {
  const url = new URL(process.env.DATABASE_URL ?? '');
  if (
    process.env.NODE_ENV !== 'test' ||
    !['localhost', '127.0.0.1'].includes(url.hostname) ||
    !url.pathname.startsWith('/club_test_')
  )
    throw new Error('Use an isolated local club_test_ database.');
  client = new Client({ connectionString: url.href });
  await client.connect();
  migration = await readFile(
    new URL('../prisma/migrations/20261030030000_educational_demo/migration.sql', import.meta.url),
    'utf8',
  );
});
afterAll(async () => {
  await client?.end();
});
async function snapshot() {
  const rows: Record<string, unknown[]> = {};
  for (const table of tables)
    rows[table] = (await client.query(`SELECT * FROM "${table}" ORDER BY id`)).rows;
  return rows;
}
it('deploys clearly fictional content without an administrator or usable author identity', async () => {
  const user = (await client.query('SELECT * FROM users WHERE id = $1', [author])).rows[0];
  expect(user).toMatchObject({
    role: 'CANDIDATE',
    isBlocked: true,
    telegramId: null,
    telegramUsername: null,
    chatId: null,
    phone: null,
    email: null,
    emailVerifiedAt: null,
    birthDate: null,
    consentAt: null,
  });
  expect(user.anonymizedAt).not.toBeNull();
  expect(
    (await client.query('SELECT count(*)::int AS n FROM places WHERE slug LIKE $1', ['edu-%']))
      .rows[0].n,
  ).toBe(4);
  expect(
    (
      await client.query('SELECT count(*)::int AS n FROM need_items WHERE id::text LIKE $1', [
        'd30e0000-%',
      ])
    ).rows[0].n,
  ).toBe(12);
  const events = (
    await client.query('SELECT * FROM events WHERE "createdById" = $1 ORDER BY "startsAt"', [
      author,
    ])
  ).rows;
  expect(events).toHaveLength(3);
  expect(
    events.every(
      (row) => row.title.startsWith('Демо:') && row.isPublic && row.startsAt < row.endsAt,
    ),
  ).toBe(true);
  expect(events.map((row) => row.volunteersOnly)).toEqual([false, false, true]);
  expect(
    (await client.query('SELECT count(*)::int AS n FROM trips WHERE "createdById" = $1', [author]))
      .rows[0].n,
  ).toBe(1);
  expect(
    (
      await client.query(
        'SELECT count(*)::int AS n FROM open_day_sessions WHERE id::text LIKE $1',
        ['d30e0000-%'],
      )
    ).rows[0].n,
  ).toBe(2);
  expect(
    (
      await client.query('SELECT count(*)::int AS n FROM news_posts WHERE "authorId" = $1', [
        author,
      ])
    ).rows[0].n,
  ).toBe(2);
});
it('reapplies atomically without duplicates, overwriting edits, or moving scheduled dates', async () => {
  await client.query('BEGIN');
  try {
    for (const table of tables)
      await client.query(
        `CREATE TEMP TABLE "${table}" (LIKE public."${table}" INCLUDING ALL) ON COMMIT DROP`,
      );
    await client.query(migration);
    await client.query('UPDATE places SET name = $1, "isActive" = false WHERE slug = $2', [
      'Правка администратора',
      'edu-solnechny',
    ]);
    await client.query('UPDATE need_items SET "isActive" = false WHERE id = $1', [
      'd30e0000-0000-4000-8000-000000000201',
    ]);
    await client.query(
      'UPDATE events SET title = $1, "startsAt" = $2, "endsAt" = $3 WHERE id = $4',
      [
        'Отредактированное событие',
        '2038-01-01T09:00:00Z',
        '2038-01-01T10:00:00Z',
        'd30e0000-0000-4000-8000-000000000301',
      ],
    );
    await client.query('UPDATE news_posts SET status = $1 WHERE slug = $2', [
      'ARCHIVED',
      'edu-demo-guide',
    ]);
    const edited = await snapshot();
    await client.query(migration);
    expect(await snapshot()).toEqual(edited);
  } finally {
    await client.query('ROLLBACK');
  }
});

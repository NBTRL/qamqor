import { readFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { Client } from 'pg';
import { afterAll, beforeAll, expect, it } from 'vitest';

let client: Client;
let migration: string;
const slugs = ['policy', 'kontakty', 'donation'];
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
    new URL(
      '../prisma/migrations/20261030020000_educational_public_pages/migration.sql',
      import.meta.url,
    ),
    'utf8',
  );
});
afterAll(async () => {
  await client?.end();
});
async function shadow(run: () => Promise<void>) {
  await client.query('BEGIN');
  try {
    await client.query('CREATE TEMP TABLE pages (LIKE public.pages INCLUDING ALL) ON COMMIT DROP');
    await run();
  } finally {
    await client.query('ROLLBACK');
  }
}
it('creates the three educational CMS pages and safely reapplies the initial content', async () => {
  const deployed = await client.query(
    'SELECT slug FROM public.pages WHERE slug = ANY($1::text[]) ORDER BY slug',
    [slugs],
  );
  expect(deployed.rows.map((row) => row.slug)).toEqual([...slugs].sort());
  await shadow(async () => {
    await client.query(migration);
    const first = await client.query('SELECT * FROM pages ORDER BY slug');
    expect(first.rows.map((row) => row.slug)).toEqual([...slugs].sort());
    expect(first.rows.find((row) => row.slug === 'policy').bodyHtml).toContain(
      'При подтверждённом входе через Telegram',
    );
    expect(first.rows.find((row) => row.slug === 'kontakty').bodyHtml).toContain(
      'qamqor@example.invalid',
    );
    expect(first.rows.find((row) => row.slug === 'donation').bodyHtml).toContain(
      'Реальный сбор денег не проводится.',
    );
    await client.query(migration);
    expect((await client.query('SELECT * FROM pages ORDER BY slug')).rows).toEqual(first.rows);
  });
});
it('preserves an existing CMS document while inserting the missing educational pages', async () => {
  await shadow(async () => {
    const existing = {
      id: randomUUID(),
      title: 'Отредактированная страница',
      bodyHtml: '<p>Сохранённый текст администратора.</p>',
    };
    await client.query('INSERT INTO pages (id, slug, title, "bodyHtml") VALUES ($1, $2, $3, $4)', [
      existing.id,
      'policy',
      existing.title,
      existing.bodyHtml,
    ]);
    await client.query(migration);
    const rows = (await client.query('SELECT * FROM pages ORDER BY slug')).rows;
    expect(rows).toHaveLength(3);
    expect(rows.find((row) => row.slug === 'policy')).toEqual({ ...existing, slug: 'policy' });
  });
});

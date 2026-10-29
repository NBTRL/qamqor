import { expect, test } from '@playwright/test';

test('two tabs serialize refresh, survive reload and reject a logged-out session (API mocks)', async ({
  page,
  context,
  baseURL,
}) => {
  let current = 'refresh-0';
  let rotation = 0;
  let active = 0;
  let concurrent = 0;
  let revoked = false;
  let expiredThrough = -1;
  const presented: string[] = [];
  await context.addCookies([{ name: 'club_refresh', value: current, url: baseURL! }]);
  await context.route('**/api/v1/**', async (route) => {
    const request = route.request();
    const path = new URL(request.url()).pathname;
    if (path.endsWith('/auth/refresh')) {
      const cookie = (await request.allHeaders()).cookie ?? '';
      const raw = cookie.match(/(?:^|;\s*)club_refresh=([^;]+)/)?.[1] ?? '';
      presented.push(raw);
      concurrent = Math.max(concurrent, ++active);
      // Both uncoordinated tabs would send the same one-use cookie before this reply.
      await new Promise((resolve) => setTimeout(resolve, 150));
      active--;
      if (revoked || raw !== current) {
        revoked = true;
        await route.fulfill({ status: 401, json: { code: 'UNAUTHORIZED' } });
        return;
      }
      current = `refresh-${++rotation}`;
      await route.fulfill({
        json: { status: 'USED', accessToken: `access-${rotation}` },
        headers: { 'set-cookie': `club_refresh=${current}; Path=/; HttpOnly; SameSite=Lax` },
      });
      return;
    }
    if (path.endsWith('/auth/logout')) {
      revoked = true;
      await route.fulfill({
        json: { ok: true },
        headers: { 'set-cookie': 'club_refresh=; Path=/; HttpOnly; Max-Age=0; SameSite=Lax' },
      });
      return;
    }
    const accessVersion = Number(
      request.headers().authorization?.match(/^Bearer access-(\d+)$/)?.[1],
    );
    if (revoked || accessVersion <= expiredThrough) {
      await route.fulfill({ status: 401, json: { code: 'UNAUTHORIZED' } });
      return;
    }
    let body: unknown = { items: [], total: 0, page: 1, limit: 20 };
    if (path === '/api/v1/me')
      body = {
        id: 'c8dc53c7-6548-4334-8bc9-e2a75fd0dacc',
        fullName: 'Тестовый участник',
        role: 'CANDIDATE',
        onboardingCompleted: true,
        curatorPlaceIds: [],
      };
    else if (path === '/api/v1/me/application')
      body = { status: 'NEW', questionnaire: null, history: [], hasOpenDayAttended: false };
    await route.fulfill({ json: body });
  });
  const second = await context.newPage();
  const greeting = 'Здравствуйте, Тестовый участник';
  await Promise.all([page.goto('/cabinet'), second.goto('/cabinet')]);
  expect(await page.evaluate(() => 'locks' in navigator)).toBe(true);
  await expect(page.getByRole('heading', { name: greeting })).toBeVisible();
  await expect(second.getByRole('heading', { name: greeting })).toBeVisible();
  expect(concurrent).toBe(1);
  expect(new Set(presented).size).toBe(presented.length);
  expect(revoked).toBe(false);

  await Promise.all([page.reload(), second.reload()]);
  await expect(page.getByRole('heading', { name: greeting })).toBeVisible();
  await expect(second.getByRole('heading', { name: greeting })).toBeVisible();
  expect(concurrent).toBe(1);
  expect(new Set(presented).size).toBe(presented.length);
  expect(revoked).toBe(false);

  // Expire both in-memory access tokens and exercise simultaneous 401 retries.
  expiredThrough = rotation;
  const beforeRetry = rotation;
  await Promise.all([
    page.getByRole('link', { name: 'Мои записи', exact: true }).click(),
    second.getByRole('link', { name: 'Мои записи', exact: true }).click(),
  ]);
  await expect(page).toHaveURL(baseURL! + '/cabinet/registrations');
  await expect(second).toHaveURL(baseURL! + '/cabinet/registrations');
  await expect.poll(() => rotation).toBe(beforeRetry + 2);
  await expect(page.getByRole('heading', { name: 'Мои записи', exact: true })).toBeVisible();
  await expect(second.getByRole('heading', { name: 'Мои записи', exact: true })).toBeVisible();
  expect(concurrent).toBe(1);
  expect(new Set(presented).size).toBe(presented.length);
  expect(revoked).toBe(false);

  await page.getByRole('button', { name: 'Выйти', exact: true }).click();
  await expect(page).toHaveURL(baseURL! + '/');
  await second.reload();
  await expect(second).toHaveURL(/\/login\?next=/);
  expect(revoked).toBe(true);
  await second.close();
});

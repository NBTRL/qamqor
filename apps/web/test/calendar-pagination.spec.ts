import { expect, test } from '@playwright/test';
const fixture = 'http://127.0.0.1:4200';
test.beforeEach(async ({ page, request }) => {
  await request.post(fixture + '/__scenario', { data: { total: 205, failNextPage: false } });
  await page.route('**/api/v1/**', async (route) => {
    const url = new URL(route.request().url());
    const response = await request.fetch(fixture + url.pathname + url.search, {
      method: route.request().method(),
      headers: route.request().headers(),
      data: route.request().postData() ?? undefined,
    });
    await route.fulfill({ response });
  });
});
test('guest loads all 205 events in order on a mobile screen', async ({ page }) => {
  const requests: URL[] = [];
  page.on('request', (req) => {
    const url = new URL(req.url());
    if (url.pathname === '/api/v1/public/calendar') requests.push(url);
  });
  await page.setViewportSize({ width: 320, height: 900 });
  await page.goto('/kalendar');
  await expect(
    page.getByRole('region', { name: 'События календаря' }).getByText('Показано 100 из 205'),
  ).toBeVisible();
  await page.getByRole('button', { name: 'Загрузить ещё' }).click();
  await expect(
    page.getByRole('region', { name: 'События календаря' }).getByText('Показано 200 из 205'),
  ).toBeVisible();
  await page.getByRole('button', { name: 'Загрузить ещё' }).click();
  await expect(
    page.getByRole('region', { name: 'События календаря' }).getByText('Показано 205 из 205'),
  ).toBeVisible();
  await expect(
    page.getByRole('region', { name: 'События календаря' }).locator('.calendar-item'),
  ).toHaveCount(205);
  expect(
    await page
      .getByRole('region', { name: 'События календаря' })
      .locator('.calendar-item h2')
      .allTextContents(),
  ).toEqual(Array.from({ length: 205 }, (_, i) => `Событие ${i + 1}`));
  await expect(page.getByRole('button', { name: 'Загрузить ещё' })).toHaveCount(0);
  expect(requests.map((url) => url.searchParams.get('page'))).toEqual(['2', '3']);
  expect(
    new Set(requests.map((url) => url.searchParams.get('from') + '/' + url.searchParams.get('to')))
      .size,
  ).toBe(1);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});
test('a failed next page keeps the first 100 events and can be retried', async ({
  page,
  request,
}) => {
  await request.post(fixture + '/__scenario', { data: { failNextPage: true } });
  await page.goto('/kalendar');
  await page.getByRole('button', { name: 'Загрузить ещё' }).click();
  await expect(page.getByRole('button', { name: 'Повторить загрузку' })).toBeVisible();
  await expect(
    page.getByRole('region', { name: 'События календаря' }).locator('.calendar-item'),
  ).toHaveCount(100);
  await expect(page.getByText('Ближайших событий пока нет.')).toHaveCount(0);
  await request.post(fixture + '/__scenario', { data: { failNextPage: false } });
  await page.getByRole('button', { name: 'Повторить загрузку' }).click();
  await expect(
    page.getByRole('region', { name: 'События календаря' }).getByText('Показано 200 из 205'),
  ).toBeVisible();
});
test('a signed-in participant receives the private calendar and detail links', async ({ page }) => {
  await page
    .context()
    .addCookies([
      { name: 'club_refresh', value: 'test-only-cookie', domain: 'localhost', path: '/' },
    ]);
  await page.goto('/kalendar');
  await expect(page.getByRole('link', { name: 'Закрытое событие', exact: true })).toBeVisible();
  await expect(
    page.getByRole('region', { name: 'События календаря' }).getByText('Показано 100 из 206'),
  ).toBeVisible();
  await page.getByRole('button', { name: 'Загрузить ещё' }).click();
  await expect(
    page.getByRole('region', { name: 'События календаря' }).getByText('Показано 200 из 206'),
  ).toBeVisible();
});
test('an empty calendar has no pagination controls', async ({ page, request }) => {
  await request.post(fixture + '/__scenario', { data: { total: 0 } });
  await page.goto('/kalendar');
  await expect(page.getByText('Ближайших событий пока нет.')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Загрузить ещё' })).toHaveCount(0);
});
test.describe('server-rendered calendar', () => {
  test('the first page uses server data without a client calendar request', async ({ page }) => {
    let requests = 0;
    await page.route('**/api/v1/public/calendar*', (route) => {
      requests++;
      return route.abort();
    });
    await page.goto('/kalendar');
    await expect(
      page.getByRole('region', { name: 'События календаря' }).locator('.calendar-item'),
    ).toHaveCount(100);
    await expect(page.getByRole('heading', { name: 'Событие 100', exact: true })).toBeVisible();
    await expect(
      page.getByRole('region', { name: 'События календаря' }).getByText('Показано 100 из 205'),
    ).toBeVisible();
    expect(requests).toBe(0);
  });
});

test.describe('calendar without JavaScript', () => {
  test.use({ javaScriptEnabled: false });
  test('the first 100 public events are visible without hydration', async ({ page }) => {
    await page.setViewportSize({ width: 320, height: 900 });
    await page.goto('/kalendar');
    const calendar = page.getByRole('region', { name: 'События календаря' });
    await expect(calendar.getByRole('heading', { name: 'Событие 100', exact: true })).toBeVisible();
    await expect(calendar.getByText('Показано 100 из 205')).toBeVisible();
    await expect(calendar.getByRole('link', { name: 'Закрытое событие', exact: true })).toHaveCount(
      0,
    );
    await expect(calendar.getByRole('button', { name: 'Загрузить ещё' })).toBeHidden();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
  });
  test('an empty server calendar does not remain on a loading message', async ({
    page,
    request,
  }) => {
    await request.post(fixture + '/__scenario', { data: { total: 0 } });
    await page.goto('/kalendar');
    const calendar = page.getByRole('region', { name: 'События календаря' });
    await expect(calendar.getByText('Ближайших событий пока нет.')).toBeVisible();
    await expect(calendar.getByText('Загрузка…')).toHaveCount(0);
  });
});

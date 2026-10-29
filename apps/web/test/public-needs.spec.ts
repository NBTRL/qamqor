import { expect, test } from '@playwright/test';

test.beforeEach(async ({ page, request }) => {
  // The same fixture backs server-side rendering and client requests.
  await page.route('**/api/v1/**', async (route) => {
    const url = new URL(route.request().url());
    const response = await request.get('http://127.0.0.1:4100' + url.pathname + url.search);
    await route.fulfill({ response });
  });
});

test('a guest opens card needs and loads the complete list on a mobile screen', async ({
  page,
}) => {
  await page.setViewportSize({ width: 320, height: 900 });
  await page.goto('/uchrezhdeniya');
  const card = page
    .locator('article.card')
    .filter({ has: page.getByRole('heading', { name: 'Тестовое учреждение', exact: true }) });
  await expect(card.getByText('Нужда 3', { exact: true })).toBeVisible();
  await expect(card.getByText('Нужда 4', { exact: true })).toHaveCount(0);
  await card.getByRole('link', { name: 'Все нужды (25)' }).click();
  await expect(page).toHaveURL(/\/uchrezhdeniya\/test-place#needs$/);
  await expect(page.locator('#needs li')).toHaveCount(20);
  await page.getByRole('button', { name: 'Загрузить ещё' }).click();
  await expect(page.locator('#needs li')).toHaveCount(25);
  await expect(page.getByRole('button', { name: 'Загрузить ещё' })).toHaveCount(0);
  await expect(page.getByText('Показано 25 из 25')).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});

test('an institution with no needs has a clear empty state', async ({ page }) => {
  await page.goto('/uchrezhdeniya/empty-place#needs');
  await expect(page.getByText('Сейчас у учреждения нет опубликованных нужд.')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Загрузить ещё' })).toHaveCount(0);
});

test.describe('server-rendered public needs', () => {
  test.use({ javaScriptEnabled: false });
  test('the first page is visible without JavaScript or sign-in', async ({ page }) => {
    await page.goto('/uchrezhdeniya/test-place#needs');
    await expect(page.getByRole('heading', { name: 'Нужда 20', exact: true })).toBeVisible();
    await expect(page.locator('#needs li')).toHaveCount(20);
    await expect(
      page.getByRole('link', { name: 'Связаться с Клубом по поводу помощи' }),
    ).toBeVisible();
  });
});

import { expect, test } from '@playwright/test';
import { randomUUID } from 'node:crypto';
const fixture = 'http://127.0.0.1:4400';
test.beforeEach(async ({ request, page }) => {
  // Separate Next fetch-cache entries for each synthetic CMS scenario.
  await page
    .context()
    .addCookies([{ name: 'qa_cms_fixture', value: randomUUID(), domain: 'localhost', path: '/' }]);
  await request.post(fixture + '/__scenario', { data: { mode: 'ready' } });
});
for (const slug of ['policy', 'donation', 'kontakty']) {
  test(`CMS content is visible on ${slug}`, async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 900 });
    await page.goto('/' + slug);
    await expect(page.getByRole('main').getByText('Содержимое CMS для ' + slug)).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Документ готовится' })).toHaveCount(0);
    await expect(page.getByRole('heading', { name: 'Реквизиты — заглушка' })).toHaveCount(0);
    if (slug === 'kontakty')
      await expect(page.getByRole('button', { name: 'Отправить сообщение' })).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
  });
}
test('an unavailable CMS shows a loading error instead of a missing-policy placeholder', async ({
  page,
  request,
}) => {
  await request.post(fixture + '/__scenario', { data: { mode: 'error' } });
  await page.goto('/policy');
  await expect(page.getByRole('main').getByRole('alert')).toHaveText(
    'Не удалось загрузить содержимое страницы. Обновите страницу и повторите попытку.',
  );
  await expect(page.getByRole('heading', { name: 'Документ готовится' })).toHaveCount(0);
});

test.describe('CMS pages without JavaScript', () => {
  test.use({ javaScriptEnabled: false });
  for (const slug of ['policy', 'donation', 'kontakty']) {
    test(`CMS text on ${slug} is readable without JavaScript`, async ({ page }) => {
      await page.setViewportSize({ width: 320, height: 900 });
      await page.goto('/' + slug);
      await expect(page.getByRole('main').getByText('Содержимое CMS для ' + slug)).toBeVisible();
      // Playwright text selectors skip noscript; inspect the visible fallback directly.
      await expect(page.locator('noscript > .notice')).toBeVisible();
      await expect(page.locator('noscript > .notice')).toContainText('JavaScript отключён.');
      await expect(page.getByRole('navigation', { name: 'Основная навигация' })).toBeVisible();
      if (slug === 'kontakty') await expect(page.getByLabel('Ваше имя')).toBeDisabled();
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
        true,
      );
    });
  }
});

test('contact fields stay disabled when application scripts cannot load', async ({ page }) => {
  await page.route('**/_next/**/*.js*', (route) => route.abort());
  await page.goto('/kontakty');
  await expect(page.getByRole('main').getByText('Содержимое CMS для kontakty')).toBeVisible();
  await expect(page.getByLabel('Ваше имя')).toBeDisabled();
  await expect(page.getByLabel('E-mail или телефон для ответа')).toBeDisabled();
  await expect(page.getByRole('button', { name: 'Отправить сообщение' })).toBeDisabled();
  expect(new URL(page.url()).search).toBe('');
});

test('the contact form becomes usable after hydration and sends JSON without URL parameters', async ({
  page,
}) => {
  let saved: Record<string, unknown> | undefined;
  await page.route('**/api/v1/contact-requests', async (route) => {
    expect(route.request().method()).toBe('POST');
    saved = route.request().postDataJSON();
    await route.fulfill({ status: 201, json: { id: 'test-contact' } });
  });
  await page.goto('/kontakty');
  await expect(page.getByLabel('Ваше имя')).toBeEnabled();
  await page.getByLabel('Ваше имя').fill('Тестовый посетитель');
  await page.getByLabel('E-mail или телефон для ответа').fill('visitor@example.test');
  await page.getByLabel('Сообщение', { exact: true }).fill('Хочу согласовать помощь учреждению.');
  await page.getByRole('checkbox').check();
  await page.getByRole('button', { name: 'Отправить сообщение' }).click();
  await expect(page.getByText('Спасибо! Ваше обращение принято.')).toBeVisible();
  expect(saved).toMatchObject({
    name: 'Тестовый посетитель',
    contact: 'visitor@example.test',
    personalDataConsent: true,
  });
  expect(new URL(page.url()).search).toBe('');
});

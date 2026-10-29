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

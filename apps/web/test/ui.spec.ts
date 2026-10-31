import { NOTIFICATION_TYPES, STAT_KEYS } from '@club/shared';
import { test, expect, type Page } from '@playwright/test';
import { randomUUID } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
test.beforeEach(async ({ page }) => {
  await page
    .context()
    .addCookies([
      { name: 'qa_shell_fixture', value: randomUUID(), domain: 'localhost', path: '/' },
    ]);
});
const placeId = '9d65a6ee-76cc-4b74-bccc-fcf3d43c6f21';
test.describe('public shell without JavaScript', () => {
  test.use({ javaScriptEnabled: false });
  test('the homepage and mobile navigation remain readable without hydration', async ({ page }) => {
    await page.setViewportSize({ width: 320, height: 900 });
    await page.goto('/');
    await expect(page.getByRole('heading', { name: 'Миссия Клуба', exact: true })).toBeVisible();
    await expect(
      page.getByRole('link', { name: 'Новость для публичного чтения', exact: true }),
    ).toBeVisible();
    const navigation = page.getByRole('navigation', { name: 'Основная навигация' });
    await expect(navigation).toBeVisible();
    await expect(page.getByRole('button', { name: 'Меню', exact: true })).toBeHidden();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
    await navigation.getByRole('link', { name: 'Календарь', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Календарь', exact: true })).toBeVisible();
  });
  test('private areas still redirect a guest without relying on JavaScript', async ({ page }) => {
    for (const path of ['/cabinet', '/admin', '/curator', '/trips', '/events', '/onboarding']) {
      await page.goto(path);
      const url = new URL(page.url());
      expect(url.pathname).toBe('/login');
      expect(url.searchParams.get('next')).toBe(path);
      await expect(page.getByRole('navigation', { name: 'Личный раздел' })).toHaveCount(0);
    }
  });
  test('a cookie alone does not expose admin content before authentication', async ({ page }) => {
    await page
      .context()
      .addCookies([
        { name: 'club_refresh', value: 'invalid-test-cookie', domain: 'localhost', path: '/' },
      ]);
    await page.goto('/admin');
    await expect(page.getByRole('heading', { name: 'Управление Клубом' })).toHaveCount(0);
    await expect(page.getByRole('navigation', { name: 'Личный раздел' })).toHaveCount(0);
    await expect(page.locator('noscript > .notice')).toBeVisible();
    await expect(page.locator('noscript > .notice')).toContainText('JavaScript отключён.');
  });
});
test('the normal homepage hydrates and keeps the interactive mobile menu', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.setViewportSize({ width: 320, height: 900 });
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Миссия Клуба', exact: true })).toBeVisible();
  await expect(
    page.getByRole('button', { name: 'Новость для публичного чтения', exact: true }),
  ).toBeVisible();
  await expect(page.locator('noscript > .notice')).toBeHidden();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.getByRole('button', { name: 'Меню', exact: true }).click();
  await expect(page.getByRole('navigation', { name: 'Основная навигация' })).toBeVisible();
  expect(errors).toEqual([]);
});
const me = {
  id: 'c8dc53c7-6548-4334-8bc9-e2a75fd0dacc',
  telegramId: '90000000001',
  fullName: 'Тестовый участник',
  role: 'ADMIN',
  onboardingCompleted: true,
  curatorPlaceIds: [],
  phone: '+70000000001',
  email: null,
  emailVerifiedAt: null,
};
async function mockApi(page: Page, role = 'ADMIN') {
  await page
    .context()
    .addCookies([
      { name: 'club_refresh', value: 'test-only-cookie', domain: 'localhost', path: '/' },
    ]);
  await page.route('**/api/v1/**', async (route) => {
    const path = new URL(route.request().url()).pathname;
    let body: unknown = { ok: true };
    if (path.endsWith('/auth/refresh')) body = { status: 'USED', accessToken: 'test-only-access' };
    else if (path === '/api/v1/me')
      body = { ...me, role, curatorPlaceIds: role === 'VOLUNTEER' ? [placeId] : [] };
    else if (path === '/api/v1/curator/places')
      body = {
        items: [
          {
            id: placeId,
            name: 'Свое учреждение',
            slug: 'own',
            type: 'ORPHANAGE',
            region: { id: placeId, name: 'Регион', slug: 'region' },
            city: 'Город',
            description: '',
            coverImage: null,
            beneficiariesCount: 1,
          },
        ],
        total: 1,
        page: 1,
        limit: 100,
      };
    else if (path === '/api/v1/me/application')
      body = {
        id: placeId,
        status: 'NEW',
        questionnaire: null,
        history: [],
        hasOpenDayAttended: false,
      };
    else body = { items: [], total: 0, page: 1, limit: 20 };
    await route.fulfill({ status: 200, json: body });
  });
}
for (const role of ['CANDIDATE', 'VOLUNTEER'] as const) {
  test(`fast ${role} identity keeps delayed protected route HTML hydratable`, async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', (error) => errors.push(error.message));
    page.on('console', (entry) => {
      if (entry.type() === 'error' && /hydrat|React error #418/i.test(entry.text()))
        errors.push(entry.text());
    });
    await page.setViewportSize({ width: 320, height: 900 });
    await mockApi(page, role);
    await page.route('**/api/v1/me', (route) =>
      route.fulfill({ json: { ...me, role, curatorPlaceIds: [] } }),
    );
    // Keep identity responses immediate while delaying the route code. This
    // exercises hydration of server children after their surrounding providers.
    await page.route('**/_next/static/chunks/app/curator/**', async (route) => {
      await delay(75);
      await route.continue();
    });
    for (let pass = 0; pass < 4; pass++) {
      for (const path of ['/admin', '/curator', '/curator']) {
        await page.goto(path);
        await expect(page.getByRole('heading', { name: 'Нет доступа', exact: true })).toBeVisible();
        await expect(page.getByRole('navigation', { name: 'Личный раздел' })).toHaveCount(0);
        expect(errors).toEqual([]);
      }
    }
  });
}
test('CMS news form sends TipTap HTML and shared status (isolated API mocks)', async ({ page }) => {
  await mockApi(page);
  let saved: Record<string, unknown> | undefined;
  await page.route('**/api/v1/admin/news', async (route) => {
    if (route.request().method() === 'POST') {
      saved = route.request().postDataJSON();
      await route.fulfill({ status: 201, json: { id: placeId, ...saved } });
    } else await route.fulfill({ json: { items: [], total: 0, page: 1, limit: 20 } });
  });
  await page.goto('/admin/news');
  await page.getByRole('button', { name: 'Добавить', exact: true }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByLabel('Адрес страницы (латиницей)').fill('test-news');
  await dialog.getByLabel('Название', { exact: true }).fill('Новость Клуба');
  await dialog.locator('[contenteditable=true]').fill('Содержимое новой новости Клуба.');
  await dialog.getByLabel('Краткое описание').fill('Анонс новой новости');
  await dialog.getByLabel('Статус', { exact: true }).selectOption('PUBLISHED');
  await dialog.getByLabel('Дата публикации (МСК)').fill('2026-10-28T12:00');
  await dialog.getByRole('button', { name: 'Сохранить', exact: true }).click();
  await expect(dialog).toHaveCount(0);
  expect(saved).toMatchObject({
    slug: 'test-news',
    title: 'Новость Клуба',
    status: 'PUBLISHED',
    publishedAt: '2026-10-28T09:00:00.000Z',
  });
  expect(saved?.bodyHtml).toContain('<p>');
});
test('curator creates a trip only with an assigned place and Moscow dates', async ({ page }) => {
  await mockApi(page, 'VOLUNTEER');
  let saved: Record<string, unknown> | undefined;
  await page.route('**/api/v1/curator/trips', async (route) => {
    saved = route.request().postDataJSON();
    await route.fulfill({ status: 201, json: { id: placeId, ...saved } });
  });
  await page.route('**/api/v1/trips/' + placeId, async (route) =>
    route.fulfill({
      json: {
        id: placeId,
        ...saved,
        status: 'DRAFT',
        confirmedCount: 0,
        place: {
          id: placeId,
          slug: 'own',
          name: 'Свое учреждение',
          type: 'ORPHANAGE',
          region: { id: placeId, name: 'Регион', slug: 'region' },
          city: 'Город',
          description: '',
          coverImage: null,
          beneficiariesCount: 1,
        },
        report: null,
      },
    }),
  );
  await page.goto('/curator/trips/new');
  await page.getByLabel('Учреждение', { exact: true }).selectOption(placeId);
  await page.getByLabel('Название', { exact: true }).fill('Поездка команды');
  await page.getByLabel('Описание', { exact: true }).fill('Совместные занятия и общение');
  await page.getByLabel('Начало (МСК)').fill('2026-12-10T12:00');
  await page.getByLabel('Окончание (МСК)').fill('2026-12-10T15:00');
  await page.getByLabel('Место сбора').fill('У входа');
  await page.getByLabel('Количество мест').fill('5');
  await page.getByRole('button', { name: 'Сохранить', exact: true }).click();
  await expect(page).toHaveURL(`/curator/trips/${placeId}`);
  await expect(page.getByRole('heading', { name: 'Редактирование поездки' })).toBeVisible();
  expect(saved).toMatchObject({ placeId, capacity: 5, startsAt: '2026-12-10T09:00:00.000Z' });
});
test('candidate gets no-access page in admin layout', async ({ page }) => {
  await mockApi(page, 'CANDIDATE');
  await page.goto('/admin');
  await expect(page.getByRole('heading', { name: 'Нет доступа' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Управление Клубом' })).toHaveCount(0);
});
test('unfinished questionnaire draft survives reload without requiring final validity', async ({
  page,
}) => {
  await mockApi(page, 'CANDIDATE');
  await page.goto('/cabinet/application');
  await page.getByLabel('Почему хотите стать волонтером?').fill('Пока думаю');
  await expect(page.getByText('Черновик сохранён в этой вкладке.')).toBeVisible();
  await page.reload();
  await expect(page.getByLabel('Почему хотите стать волонтером?')).toHaveValue('Пока думаю');
});

test('unverified email stays disabled while notification settings can be saved', async ({
  page,
}) => {
  await mockApi(page, 'CANDIDATE');
  let saved: { items: { type: string; telegram: boolean; email: boolean }[] } | undefined;
  await page.route('**/api/v1/me/notification-settings', async (route) => {
    if (route.request().method() === 'PUT') {
      saved = route.request().postDataJSON();
      await route.fulfill({ json: { items: saved?.items, total: 16, page: 1, limit: 16 } });
    } else
      await route.fulfill({
        json: {
          items: NOTIFICATION_TYPES.map((type) => ({ type, telegram: true, email: true })),
          total: 16,
          page: 1,
          limit: 16,
        },
      });
  });
  await page.goto('/cabinet/notifications');
  const email = page.getByRole('checkbox', { name: 'Статус анкеты: e-mail', exact: true });
  await expect(email).toBeDisabled();
  await expect(email).not.toBeChecked();
  await page.getByRole('button', { name: 'Сохранить настройки' }).click();
  await expect(page.getByText('Настройки сохранены.')).toBeVisible();
  expect(saved?.items).toHaveLength(NOTIFICATION_TYPES.length);
  expect(saved?.items.every((item) => item.email === false && item.telegram === true)).toBe(true);
});

test('saved notification preferences survive navigation and a second save', async ({ page }) => {
  const errors: string[] = [];
  const documents: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('console', (entry) => {
    if (entry.type() === 'error' && /hydrat|React error #418/i.test(entry.text()))
      errors.push(entry.text());
  });
  page.on('request', (request) => {
    if (request.isNavigationRequest() && request.frame() === page.mainFrame())
      documents.push(new URL(request.url()).pathname);
  });
  type Setting = { type: (typeof NOTIFICATION_TYPES)[number]; telegram: boolean; email: boolean };
  let stored: Setting[] = NOTIFICATION_TYPES.map((type) => ({ type, telegram: true, email: true }));
  const submissions: Setting[][] = [];
  await mockApi(page, 'CANDIDATE');
  await page.route('**/api/v1/me/notification-settings', async (route) => {
    if (route.request().method() === 'PUT') {
      const body = route.request().postDataJSON() as { items: Setting[] };
      stored = body.items.map((item) => ({ ...item }));
      submissions.push(stored.map((item) => ({ ...item })));
    }
    await route.fulfill({
      json: { items: stored, total: stored.length, page: 1, limit: stored.length },
    });
  });
  await page.goto('/cabinet/notifications');
  const telegram = page.getByRole('checkbox', { name: 'Статус анкеты: Telegram', exact: true });
  await expect(telegram).toBeChecked();
  await telegram.uncheck();
  await page.getByRole('button', { name: 'Сохранить настройки', exact: true }).click();
  await expect(page.getByText('Настройки сохранены.', { exact: true })).toBeVisible();
  expect(submissions).toHaveLength(1);
  expect(submissions[0]?.find((item) => item.type === 'ApplicationStatusChanged')?.telegram).toBe(
    false,
  );

  // Use the app's links: a full page load would discard QueryClient and hide a stale-cache bug.
  const navigation = page.getByRole('navigation', { name: 'Личный раздел', exact: true });
  await navigation.getByRole('link', { name: 'Профиль', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Профиль', exact: true })).toBeVisible();
  await navigation.getByRole('link', { name: 'Уведомления', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Уведомления', exact: true })).toBeVisible();
  await expect(telegram).not.toBeChecked();
  await page.getByRole('button', { name: 'Сохранить настройки', exact: true }).click();
  await expect.poll(() => submissions.length).toBe(2);
  await expect(page.getByText('Настройки сохранены.', { exact: true })).toBeVisible();
  expect(submissions[1]?.find((item) => item.type === 'ApplicationStatusChanged')?.telegram).toBe(
    false,
  );
  expect(documents).toEqual(['/cabinet/notifications']);
  expect(errors).toEqual([]);
});

test('saved statistic overrides survive navigation, update the dashboard and clear explicitly', async ({
  page,
}) => {
  const errors: string[] = [];
  const documents: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('console', (entry) => {
    if (entry.type() === 'error' && /hydrat|React error #418/i.test(entry.text()))
      errors.push(entry.text());
  });
  page.on('request', (request) => {
    if (request.isNavigationRequest() && request.frame() === page.mainFrame())
      documents.push(new URL(request.url()).pathname);
  });
  type StatKey = (typeof STAT_KEYS)[number];
  type Override = { key: StatKey; value: number | null };
  const stored: Partial<Record<StatKey, number>> = {};
  const submissions: Override[][] = [];
  await mockApi(page);
  await page.route('**/api/v1/admin/stat-overrides', async (route) => {
    if (route.request().method() === 'PUT') {
      const body = route.request().postDataJSON() as { items: Override[] };
      submissions.push(body.items.map((item) => ({ ...item })));
      for (const item of body.items) {
        if (item.value === null) delete stored[item.key];
        else stored[item.key] = item.value;
      }
    }
    const items = STAT_KEYS.flatMap((key) =>
      stored[key] === undefined ? [] : [{ key, value: stored[key] }],
    );
    await route.fulfill({ json: { items, total: items.length, page: 1, limit: STAT_KEYS.length } });
  });
  await page.route('**/api/v1/public/stats', (route) =>
    route.fulfill({
      json: Object.fromEntries(
        STAT_KEYS.map((key) => [key, stored[key] ?? (key === 'places' ? 4 : 0)]),
      ),
    }),
  );
  // Seed the dashboard cache before saving an override, then navigate without reloading.
  await page.goto('/admin');
  const dashboardPlaces = page
    .locator('.stat')
    .filter({ hasText: 'Учреждений' })
    .locator('.stat__value');
  await expect(dashboardPlaces).toHaveText('4');
  const navigation = page.getByRole('navigation', { name: 'Управление Клубом', exact: true });
  await navigation.getByRole('link', { name: 'Счетчики', exact: true }).click();
  const places = page.getByRole('spinbutton', { name: 'Учреждения', exact: true });
  await expect(places).toHaveValue('');
  await places.fill('42');
  const save = page.getByRole('button', { name: 'Сохранить счетчики', exact: true });
  await save.click();
  await expect(page.getByText('Счетчики сохранены.', { exact: true })).toBeVisible();
  expect(submissions[0]?.find((item) => item.key === 'places')?.value).toBe(42);
  await navigation.getByRole('link', { name: 'Дашборд', exact: true }).click();
  await expect(dashboardPlaces).toHaveText('42');
  await navigation.getByRole('link', { name: 'Счетчики', exact: true }).click();
  await expect(places).toHaveValue('42');
  await save.click();
  await expect.poll(() => submissions.length).toBe(2);
  await expect(save).toBeEnabled();
  expect(submissions[1]?.find((item) => item.key === 'places')?.value).toBe(42);
  await places.fill('');
  await save.click();
  await expect.poll(() => submissions.length).toBe(3);
  await expect(save).toBeEnabled();
  expect(submissions[2]?.find((item) => item.key === 'places')?.value).toBeNull();
  await navigation.getByRole('link', { name: 'Дашборд', exact: true }).click();
  await expect(dashboardPlaces).toHaveText('4');
  expect(documents).toEqual(['/admin']);
  expect(errors).toEqual([]);
});

test('a guest Telegram confirmation opens the cabinet without reloading the browser', async ({
  page,
}) => {
  await page.route('**/api/v1/**', async (route) => {
    const path = new URL(route.request().url()).pathname;
    let body: unknown = { items: [], total: 0, page: 1, limit: 20 };
    let headers: Record<string, string> = {};
    if (path.endsWith('/telegram/start'))
      body = {
        token: 'test-login',
        pollSecret: 'test-secret',
        deepLink: 'https://t.me/test_bot?start=test-login',
        expiresAt: new Date(Date.now() + 60000).toISOString(),
      };
    else if (path.endsWith('/telegram/status')) {
      body = { status: 'USED', accessToken: 'test-memory-access' };
      headers = { 'set-cookie': 'club_refresh=test-only; Path=/; HttpOnly; SameSite=Lax' };
    } else if (path.endsWith('/auth/refresh'))
      body = { status: 'USED', accessToken: 'test-memory-access' };
    else if (path === '/api/v1/me') body = { ...me, role: 'CANDIDATE' };
    else if (path === '/api/v1/me/application')
      body = {
        id: placeId,
        status: 'NEW',
        questionnaire: null,
        history: [],
        hasOpenDayAttended: false,
      };
    await route.fulfill({ json: body, headers });
  });
  await page.goto('/login');
  await page.getByRole('button', { name: 'Войти через Telegram', exact: true }).click();
  await expect(page).toHaveURL(/\/cabinet$/);
  await expect(
    page.getByRole('heading', { name: 'Здравствуйте, Тестовый участник' }),
  ).toBeVisible();
  expect(
    await page.evaluate(() =>
      Object.values(localStorage).some((value) => value.includes('test-memory-access')),
    ),
  ).toBe(false);
});

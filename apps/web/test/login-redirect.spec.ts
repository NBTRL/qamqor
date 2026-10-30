import { expect, test } from '@playwright/test';
const eventId = 'd30e0000-0000-4000-8000-000000000301';
const eventPath = `/events/${eventId}`;
const onboarding = `/onboarding?${new URLSearchParams({ next: eventPath })}`;

for (const scenario of [
  { name: 'backslash authority', next: '/\\example.org', expected: '/cabinet' },
  { name: 'normalized authority', next: '/cabinet/..//example.org', expected: '/cabinet' },
  { name: 'encoded backslash', next: '/%5cexample.org', expected: '/cabinet' },
  {
    name: 'internal query and fragment',
    next: '/cabinet?tab=profile#details',
    expected: '/cabinet?tab=profile#details',
  },
  { name: 'new user', next: '/\\example.org', expected: '/onboarding', onboarding: false },
  {
    name: 'new user keeps an event after onboarding',
    next: eventPath,
    expected: onboarding,
    onboarding: false,
    complete: true,
  },
  {
    name: 'unfinished profile keeps a protected event',
    next: eventPath,
    expected: onboarding,
    onboarding: false,
    complete: true,
    direct: true,
  },
]) {
  test(`login return: ${scenario.name} (isolated API mocks)`, async ({ page, baseURL }) => {
    const externalRequests: string[] = [];
    let onboarded = scenario.onboarding !== false;
    const member = () => ({
      id: 'c8dc53c7-6548-4334-8bc9-e2a75fd0dacc',
      fullName: 'Тестовый участник',
      role: 'CANDIDATE',
      onboardingCompleted: onboarded,
      curatorPlaceIds: [],
      phone: '+70000000001',
      email: null,
      emailVerifiedAt: null,
    });
    await page.route('**/*', async (route) => {
      const url = new URL(route.request().url());
      if (url.origin !== new URL(baseURL!).origin) {
        externalRequests.push(url.href);
        await route.abort();
      } else await route.continue();
    });
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
      else if (path === '/api/v1/me') body = member();
      else if (path === '/api/v1/me/onboarding' && route.request().method() === 'POST') {
        onboarded = true;
        body = member();
      } else if (path === `/api/v1/events/${eventId}`)
        body = {
          id: eventId,
          type: 'CLUB_EVENT',
          title: 'Выбранное учебное событие',
          description: 'Проверка возврата после заполнения профиля.',
          startsAt: new Date(Date.now() + 86400000).toISOString(),
          endsAt: new Date(Date.now() + 90000000).toISOString(),
          location: 'Демонстрация',
          capacity: 10,
          isPublic: true,
          volunteersOnly: false,
        };
      else if (path === '/api/v1/me/application')
        body = { status: 'NEW', questionnaire: null, history: [], hasOpenDayAttended: false };
      await route.fulfill({ json: body, headers });
    });
    if (scenario.direct) {
      await page
        .context()
        .addCookies([{ name: 'club_refresh', value: 'test-only', url: baseURL! }]);
      await page.goto(scenario.next);
    } else {
      await page.goto(`/login?${new URLSearchParams({ next: scenario.next })}`);
      await page.getByRole('button', { name: 'Войти через Telegram', exact: true }).click();
    }
    await expect(page).toHaveURL(new URL(scenario.expected, baseURL).href);
    if (scenario.complete) {
      await page.getByLabel('Дата рождения').fill('2000-01-01');
      await page.getByRole('checkbox').check();
      await page.getByRole('button', { name: 'Продолжить', exact: true }).click();
      await expect(page).toHaveURL(new URL(eventPath, baseURL).href);
      await expect(
        page.getByRole('heading', { name: 'Выбранное учебное событие', exact: true }),
      ).toBeVisible();
      await expect(page.getByRole('button', { name: 'Записаться', exact: true })).toBeEnabled();
    }
    expect(externalRequests).toEqual([]);
  });
}

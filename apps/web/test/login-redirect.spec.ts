import { expect, test } from '@playwright/test';

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
]) {
  test(`login return: ${scenario.name} (isolated API mocks)`, async ({ page, baseURL }) => {
    const externalRequests: string[] = [];
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
      else if (path === '/api/v1/me')
        body = {
          id: 'c8dc53c7-6548-4334-8bc9-e2a75fd0dacc',
          fullName: 'Тестовый участник',
          role: 'CANDIDATE',
          onboardingCompleted: scenario.onboarding !== false,
          curatorPlaceIds: [],
          phone: '+70000000001',
          email: null,
          emailVerifiedAt: null,
        };
      else if (path === '/api/v1/me/application')
        body = { status: 'NEW', questionnaire: null, history: [], hasOpenDayAttended: false };
      await route.fulfill({ json: body, headers });
    });
    await page.goto(`/login?${new URLSearchParams({ next: scenario.next })}`);
    await page.getByRole('button', { name: 'Войти через Telegram', exact: true }).click();
    await expect(page).toHaveURL(new URL(scenario.expected, baseURL).href);
    expect(externalRequests).toEqual([]);
  });
}

import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { spawn } from 'node:child_process';
import { setTimeout as delay } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';

// Only test-e2e.mjs may supply the disposable local database. Never run on a deployment.
const database = new URL(process.env.DATABASE_URL ?? '');
assert.equal(process.env.NODE_ENV, 'test');
assert.equal(process.env.DEV_FAKE_TELEGRAM, 'true');
assert.ok(['localhost', '127.0.0.1'].includes(database.hostname));
assert.match(database.pathname, /^\/club_test_[0-9]+_[a-f0-9]+$/);
assert.ok(!process.env.VERCEL);
assert.equal(new URL(process.env.WEB_URL).origin, 'http://localhost:3000');
assert.ok(['localhost', '127.0.0.1'].includes(new URL(process.env.REDIS_URL).hostname));
const requireApi = createRequire(new URL('../apps/api/package.json', import.meta.url));
const requireWeb = createRequire(new URL('../apps/web/package.json', import.meta.url));
requireApi('reflect-metadata');
const { Test } = requireApi('@nestjs/testing');
const { chromium, expect } = requireWeb('@playwright/test');
const { AppModule } = await import('../apps/api/dist/app.module.js');
const { configureApp } = await import('../apps/api/dist/openapi.js');
const { PrismaService } = await import('../apps/api/dist/prisma/prisma.service.js');
const { RedisService } = await import('../apps/api/dist/common/redis.service.js');
const { AuthMailService } = await import('../apps/api/dist/common/mail.service.js');
const module = await Test.createTestingModule({
  imports: [AppModule.configure({ workers: false, telegram: false })],
}).compile();
const app = module.createNestApplication({ logger: false });
configureApp(app);
let web;
let browser;
let webFailure;
const errors = [];
const externalRequests = [];
const base = 'http://localhost:3000';
const eventId = 'd30e0000-0000-4000-8000-000000000301';
const volunteerEventId = 'd30e0000-0000-4000-8000-000000000303';
const eventPath = `/events/${eventId}`;
const candidateId = '9100000000001';
const adminId = '9100000000002';
const mails = [];
try {
  // Capture only the external email provider. The challenge, cookies, OTP verification,
  // HTTP routes, JWTs, guards, database writes and browser UI all remain real.
  app.get(AuthMailService).send = async (to, subject, text) => mails.push({ to, subject, text });
  await app.listen(4000, '127.0.0.1');
  const prisma = app.get(PrismaService);
  const redis = app.get(RedisService);
  let cursor = '0';
  do {
    const result = await redis.client.scan(cursor, 'MATCH', redis.key('throttle*'), 'COUNT', 1000);
    cursor = result[0];
    if (result[1].length) await redis.client.unlink(...result[1]);
  } while (cursor !== '0');
  await prisma.user.create({
    data: {
      telegramId: BigInt(adminId),
      fullName: 'Браузерный администратор',
      role: 'ADMIN',
      email: 'browser-admin@example.test',
      emailVerifiedAt: new Date(),
    },
  });
  web = spawn(
    process.execPath,
    [
      requireWeb.resolve('next/dist/bin/next'),
      'start',
      '--hostname',
      '127.0.0.1',
      '--port',
      '3000',
    ],
    {
      cwd: fileURLToPath(new URL('../apps/web', import.meta.url)),
      env: {
        ...process.env,
        NODE_ENV: 'production',
        DEV_FAKE_TELEGRAM: 'false',
        API_INTERNAL_URL: 'http://127.0.0.1:4000',
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    },
  );
  web.on('error', () => {
    webFailure = 'Web process could not start';
  });
  // Consume output without exposing environment values or authentication payloads.
  web.stdout.resume();
  web.stderr.resume();
  for (let attempt = 0; ; attempt++) {
    assert.ok(!webFailure && web.exitCode === null, webFailure ?? 'Web process exited');
    try {
      if ((await fetch(`${base}/api/v1/health`, { signal: AbortSignal.timeout(1000) })).ok) break;
    } catch {
      /* Wait for start. */
    }
    assert.ok(attempt < 100, 'Web did not start');
    await delay(300);
  }
  async function openBrowser() {
    browser = await chromium.launch({
      executablePath: process.env.CHROME_PATH || undefined,
      ...(process.env.CHROME_PATH
        ? {
            args: [
              '--no-sandbox',
              '--no-zygote',
              '--single-process',
              '--disable-dev-shm-usage',
              '--in-process-gpu',
              '--use-gl=angle',
              '--use-angle=swiftshader',
              '--enable-unsafe-swiftshader',
            ],
          }
        : {}),
    });
    const page = await browser.newPage({
      viewport: { width: 320, height: 900 },
      timezoneId: 'Asia/Almaty',
    });
    const navigation = [];
    page.on('framenavigated', (frame) => {
      if (frame === page.mainFrame()) {
        navigation.push(new URL(frame.url()).pathname);
        if (navigation.length > 3) navigation.shift();
      }
    });
    const recordError = (message) =>
      errors.push({ path: new URL(page.url()).pathname, navigation: [...navigation], message });
    page.on('pageerror', (error) => recordError(error.message));
    page.on('console', (message) => {
      if (message.type() === 'error' && /hydrat|React error #418/i.test(message.text()))
        recordError(message.text());
    });
    await page.route('**/*', (route) => {
      if (new URL(route.request().url()).origin === base) return route.continue();
      externalRequests.push(new URL(route.request().url()).origin);
      return route.abort();
    });
    return page;
  }
  async function login(page, telegramId) {
    const response = page.waitForResponse(
      (r) => r.url().endsWith('/api/v1/auth/telegram/start') && r.request().method() === 'POST',
    );
    await page.getByRole('button', { name: 'Войти через Telegram', exact: true }).click();
    const start = await response;
    assert.equal(start.status(), 200);
    const { token } = await start.json();
    const confirmed = await page.request.post(`${base}/api/v1/dev/telegram/confirm`, {
      headers: { Origin: base },
      data: { token, telegramId, phone: '+70000000001', fullName: 'Браузерный участник' },
    });
    assert.equal(confirmed.status(), 200);
  }
  async function onboard(page) {
    await expect(page.getByLabel('Дата рождения')).toBeVisible();
    await page.getByLabel('Дата рождения').fill('2000-01-01');
    await page.getByRole('checkbox').check();
    await page.getByRole('button', { name: 'Продолжить', exact: true }).click();
  }
  const page = await openBrowser();
  for (const path of ['/', '/kalendar', '/', '/kalendar']) {
    await page.goto(base + path);
    await expect(page.getByRole('main').getByRole('heading', { level: 1 })).toBeVisible();
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
  }
  await page
    .getByRole('region', { name: 'События календаря' })
    .getByRole('link', { name: 'Демо: знакомство с Qamqor', exact: true })
    .click();
  await expect(page).toHaveURL(new RegExp('/login\\?'));
  assert.equal(new URL(page.url()).searchParams.get('next'), eventPath);
  let candidateAccess;
  page.on('response', async (response) => {
    if (response.url().includes('/auth/telegram/status') && response.ok()) {
      const data = await response.json();
      if (data.accessToken) candidateAccess = data.accessToken;
    }
  });
  await login(page, candidateId);
  await expect(page).toHaveURL(new RegExp('/onboarding\\?'));
  await onboard(page);
  await expect(page).toHaveURL(base + eventPath);
  await page.getByRole('button', { name: 'Записаться', exact: true }).click();
  await expect(page.getByRole('status').filter({ hasText: 'Ваша запись:' })).toContainText(
    'Подтвержд',
  );
  await page.goto(`${base}/cabinet/registrations`);
  const row = page.getByRole('row').filter({ hasText: 'Демо: знакомство с Qamqor' });
  await expect(row).toContainText('Подтвержд');
  // Reload proves the registration is persisted, not merely optimistic client state.
  await page.reload();
  await expect(row).toContainText('Подтвержд');
  await row.getByRole('button', { name: 'Отменить запись' }).click();
  await expect(row).toContainText('Отмен');
  await page.reload();
  await expect(row).toContainText('Отмен');
  const candidate = await prisma.user.findUniqueOrThrow({
    where: { telegramId: BigInt(candidateId) },
  });
  assert.equal(
    (await prisma.eventRegistration.findFirstOrThrow({ where: { userId: candidate.id, eventId } }))
      .status,
    'CANCELLED',
  );
  assert.ok(candidateAccess);
  const denied = await page.request.get(`${base}/api/v1/admin/users`, {
    headers: { Authorization: `Bearer ${candidateAccess}` },
  });
  assert.equal(denied.status(), 403);
  const restricted = await page.request.post(`${base}/api/v1/events/${volunteerEventId}/register`, {
    headers: { Authorization: `Bearer ${candidateAccess}`, Origin: base },
    data: {},
  });
  assert.equal(restricted.status(), 403);
  await page.goto(`${base}/events/${volunteerEventId}`);
  await expect(page.getByText('Доступно после вступления в Клуб', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Записаться', exact: true })).toHaveCount(0);
  for (const path of ['/admin', '/curator']) {
    await page.goto(base + path);
    await expect(page.getByRole('heading', { name: 'Нет доступа', exact: true })).toBeVisible();
  }
  await browser.close();
  browser = undefined;
  const admin = await openBrowser();
  await admin.goto(`${base}/login?next=/admin`);
  await login(admin, adminId);
  await expect(admin.getByLabel('Одноразовый код')).toBeVisible();
  assert.equal(new URL(admin.url()).pathname, '/login');
  await expect(admin.getByRole('heading', { name: 'Управление Клубом', exact: true })).toHaveCount(
    0,
  );
  const code = /\b\d{6}\b/.exec(
    mails.find((m) => m.to === 'browser-admin@example.test')?.text ?? '',
  )?.[0];
  assert.ok(code, 'Test email challenge was not delivered');
  await admin.getByLabel('Одноразовый код').fill(code);
  await admin.getByRole('button', { name: 'Подтвердить вход', exact: true }).click();
  await onboard(admin);
  await expect(admin).toHaveURL(base + '/admin');
  await expect(
    admin.getByRole('heading', { name: 'Управление Клубом', exact: true }),
  ).toBeVisible();
  await admin.goto(`${base}/admin/users`);
  await admin.getByRole('searchbox', { name: 'Поиск' }).fill('Браузерный участник');
  await admin.getByRole('button', { name: 'Найти', exact: true }).click();
  await expect(admin.getByRole('table')).toContainText('Браузерный участник');

  // Exercise the real admin form, HTTP DTOs, atomic outbox and participant UI.
  const adminUser = await prisma.user.findUniqueOrThrow({ where: { telegramId: BigInt(adminId) } });
  const futureYear = new Date().getUTCFullYear() + 1;
  const movedStart = `${futureYear}-01-15T10:00:00.000Z`;
  const movedEnd = `${futureYear}-01-15T11:00:00.000Z`;
  const nextDay = `${futureYear}-01-16T10:00:00.000Z`;
  const originalStart = new Date(Date.now() + 7 * 86400_000);
  const movedEvent = await prisma.event.create({
    data: {
      type: 'SEMINAR',
      title: 'Браузерный перенос мероприятия',
      description: '',
      startsAt: originalStart,
      endsAt: new Date(originalStart.getTime() + 3600_000),
      location: 'Браузерное старое место',
      createdById: adminUser.id,
      capacity: 5,
    },
  });
  const movedDay = await prisma.openDaySession.create({
    data: { startsAt: originalStart, location: 'Браузерный ДОД для переноса', capacity: 5 },
  });
  await prisma.eventRegistration.create({
    data: { eventId: movedEvent.id, userId: candidate.id, status: 'CONFIRMED' },
  });
  await prisma.openDayRegistration.create({
    data: { sessionId: movedDay.id, userId: candidate.id },
  });

  async function editSchedule(resource, search, id, changes) {
    await admin.goto(`${base}/admin/${resource}`);
    await admin.getByRole('searchbox', { name: 'Поиск' }).fill(search);
    await admin.getByRole('button', { name: 'Найти', exact: true }).click();
    await admin
      .getByRole('row')
      .filter({ hasText: search })
      .getByRole('button', { name: 'Редактировать', exact: true })
      .click();
    const dialog = admin.getByRole('dialog');
    for (const [label, value] of Object.entries(changes))
      await dialog.getByLabel(label, { exact: true }).fill(value);
    const saved = admin.waitForResponse(
      (r) =>
        r.url().endsWith(`/api/v1/admin/${resource}/${id}`) && r.request().method() === 'PATCH',
    );
    await dialog.getByRole('button', { name: 'Сохранить', exact: true }).click();
    assert.equal((await saved).status(), 200);
    await expect(dialog).not.toBeVisible();
  }
  await editSchedule('events', movedEvent.title, movedEvent.id, {
    'Начало (МСК)': `${futureYear}-01-15T13:00`,
    'Окончание (МСК)': `${futureYear}-01-15T14:00`,
    Место: 'Браузерное новое место',
  });
  // Saving the same form again must not create a second reschedule notice.
  await editSchedule('events', movedEvent.title, movedEvent.id, {});
  await editSchedule('open-days', movedDay.location, movedDay.id, {
    'Начало (МСК)': `${futureYear}-01-16T13:00`,
    Место: 'Браузерный новый ДОД',
  });
  const persistedEvent = await prisma.event.findUniqueOrThrow({ where: { id: movedEvent.id } });
  assert.equal(persistedEvent.startsAt.toISOString(), movedStart);
  assert.equal(persistedEvent.endsAt.toISOString(), movedEnd);
  assert.equal(persistedEvent.location, 'Браузерное новое место');
  assert.equal(
    (
      await prisma.openDaySession.findUniqueOrThrow({ where: { id: movedDay.id } })
    ).startsAt.toISOString(),
    nextDay,
  );
  const changes = await prisma.notification.findMany({
    where: {
      userId: candidate.id,
      channel: 'IN_APP',
      type: { in: ['EventRescheduled', 'OpenDayRescheduled'] },
    },
  });
  assert.equal(changes.length, 2);
  assert.equal(changes.find((n) => n.type === 'EventRescheduled').payload.startsAt, movedStart);
  assert.equal(
    changes.find((n) => n.type === 'OpenDayRescheduled').payload.location,
    'Браузерный новый ДОД',
  );

  await browser.close();
  browser = undefined;
  const participant = await openBrowser();
  await participant.goto(`${base}/login?next=/cabinet/notifications`);
  await login(participant, candidateId);
  await expect(participant).toHaveURL(`${base}/cabinet/notifications`);
  const eventNotice = participant
    .getByRole('row')
    .filter({ hasText: 'Место: Браузерное новое место' });
  await expect(eventNotice).toContainText('Начало: 15.01.' + futureYear + ', 13:00 (Москва)');
  await expect(eventNotice).toContainText('Окончание: 15.01.' + futureYear + ', 14:00 (Москва)');
  await expect(eventNotice.getByRole('link', { name: 'Подробнее' })).toHaveAttribute(
    'href',
    `/events/${movedEvent.id}`,
  );
  const dayNotice = participant.getByRole('row').filter({ hasText: 'Место: Браузерный новый ДОД' });
  await expect(dayNotice).toContainText('Начало: 16.01.' + futureYear + ', 13:00 (Москва)');
  await expect(dayNotice.getByRole('link', { name: 'Подробнее' })).toHaveAttribute(
    'href',
    '/cabinet/registrations',
  );
  assert.ok(await participant.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
  assert.deepEqual(externalRequests, []);
  assert.deepEqual(errors, []);
  console.log(
    'PASS real browser/API/database: onboarding return, registration, persisted cancellation, candidate/admin guards, admin email challenge, reschedule notifications, mobile hydration',
  );
} finally {
  await browser?.close();
  if (web && web.exitCode === null) {
    const exited = new Promise((resolve) => web.once('exit', resolve));
    web.kill('SIGTERM');
    await Promise.race([exited, delay(5000)]);
    if (web.exitCode === null) {
      web.kill('SIGKILL');
      await exited;
    }
  }
  await app.close();
}

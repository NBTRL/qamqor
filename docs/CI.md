# Проверки pull request

Workflow `Project checks` запускается для pull request, push в main и вручную. Доступ GitHub token ограничен чтением содержимого; credentials checkout не сохраняются. Workflow не использует production secrets, не развёртывает сайт и не загружает `.env` в артефакты.

## Quality and browser tests

Устанавливаются Node 22 и pnpm 11.25.0. Из `.env.example` создаётся временный `.env` со случайными тестовыми JWT/S3-ключами; рабочие или production-ключи не нужны. Проверяются lockfile, lint, unit/component tests, воспроизводимость OpenAPI и клиента, production build и TypeScript. Затем запускаются Chromium и браузерные сценарии:

- UI, безопасный редирект, две вкладки и выход — `playwright.ci.config.ts`;
- публичные нужды — `playwright.needs.config.ts`;
- календарь — `playwright.calendar.config.ts`.

Браузерные проверки используют синтетический API. Настоящая серверная логика проверяется отдельным заданием. SSR-проверки подтверждают использование серверной первой страницы: календарь обходится без дополнительного запроса, нужды сохраняют список при ошибке клиентского обновления; работа общей оболочки сайта с полностью отключённым JavaScript остаётся отдельным ограничением.

## Backend integration

После успешной quality-проверки Docker Compose поднимает PostgreSQL, Redis, MinIO и Mailpit. MinIO собирается из официального исходного релиза существующим Dockerfile. `minio-init` создаёт закрытый тестовый бакет. `pnpm test:e2e` создаёт отдельную БД `club_test_*`, применяет миграции, выполняет весь backend E2E и удаляет временную БД. В конце Docker volumes удаляются на этом одноразовом GitHub runner.

Реальная доставка Telegram, внешний SMTP и внешний S3 этим workflow не подтверждаются. Ни тестовый Telegram-вход, ни credentials из этого workflow не предназначены для production.

## Локальный запуск

```sh
pnpm lint
pnpm test
pnpm gen:api
pnpm build
pnpm typecheck
pnpm --filter @club/web exec playwright install chromium
pnpm --filter @club/web exec playwright test --config playwright.ci.config.ts
pnpm --filter @club/web exec playwright test --config playwright.needs.config.ts
pnpm --filter @club/web exec playwright test --config playwright.calendar.config.ts
```

Для полного backend E2E нужна локальная инфраструктура из docker-compose.yml и `pnpm test:e2e`. При собственном Chromium задайте CHROME_PATH; по умолчанию используется установленный Playwright браузер на любой ОС.

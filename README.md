# Клуб волонтеров

Qamqor — учебный проект, демонстрирующий работу волонтёрской платформы. Реальный сбор пожертвований не проводится. Информационные страницы содержат демонстрационные материалы, редактируемые через CMS.

Сценарий показа проекта, состав демонстрационных данных и ограничения проверки описаны в [docs/DEMO.md](docs/DEMO.md).

Монорепозиторий платформы одного клуба: NestJS API, Next.js 15, общий контракт TypeScript/Zod. Реализованы новая публичная верстка в фиолетово-желтой палитре, Telegram-вход, кабинет, раздел куратора и админка.

API: NestJS 11, strict TypeScript/ESM, Prisma 7/PostgreSQL 16, Redis/BullMQ, Telegram grammY, nodemailer, S3/MinIO. Общие enums, русские подписи, переходы, права, ошибки и Zod-формы — в @club/shared.

## Локальный запуск

Нужны Node.js 22.12+ (проверено на 24), pnpm 11 и работающий Docker Desktop.

```powershell
cd C:\dev\qamqor2
pnpm install
docker compose up -d
pnpm db:deploy
# В .env задайте свои ADMIN_TELEGRAM_ID и ADMIN_EMAIL, если нужен первый администратор.
pnpm db:seed
pnpm dev
```

Первый локальный install создает отсутствующий .env со случайными JWT_SECRET и S3_SECRET_KEY; существующий файл не меняется. В CI/production окружение задается отдельно. Секреты, .env, загруженные файлы и логи не коммитятся.

Миграция `20261030030000_educational_demo` один раз добавляет учебный набор для демонстрации сайта во всех окружениях: 4 учреждения, 12 нужд, 3 мероприятия, поездку, 2 ДОД и 2 новости. Записи явно вымышленные; системная запись автора заблокирована, не имеет Telegram, почты или прав администратора. Повторное применение сохраняет правки и даты.

Отдельный локальный seed без ADMIN_* создаст регионы, ещё 8 демоучреждений, нужды и 2 сессии ДОД; дополнительные новости, мероприятия и поездки требуют автора-администратора. С настроенным ADMIN_* добавятся по 3 записи каждого типа. Seed считает указанный ADMIN_EMAIL подтвержденным — проверьте адрес. Он не заполняет телефон, дату рождения или согласие за пользователя. Повторный запуск сохраняет правки. В production `db:seed` создаёт только регионы и настроенного администратора; учебный набор из миграции от этой команды не зависит.

| Сервис             | Адрес                                         |
| ------------------ | --------------------------------------------- |
| Web                | http://localhost:3000                         |
| Swagger            | http://localhost:3000/api/docs                |
| API напрямую       | http://localhost:4000/api/docs                |
| Liveness           | http://localhost:3000/api/v1/health           |
| PostgreSQL         | localhost:55432, база club                    |
| Redis              | localhost:6379                                |
| MinIO S3 / console | http://localhost:9000 / http://localhost:9001 |
| Mailpit UI / SMTP  | http://localhost:8025 / localhost:1025        |

Compose привязывает инфраструктуру к loopback, создает приватный S3_BUCKET; minio-init должен завершиться с кодом 0. MinIO/mc собираются из закрепленных официальных исходников (source-only релизы), поэтому первый запуск требует сети и времени. Health проверяет процесс API; готовность БД/очередей проверяется отдельно.

## Проверка входа без реального бота

В .env установите DEV_FAKE_TELEGRAM=true, оставьте TELEGRAM_BOT_TOKEN пустым и перезапустите pnpm dev. В production fake запрещен проверкой при запуске. Этот режим предназначен для изолированных backend-тестов. Интерфейс `/login` работает с настоящим Telegram-ботом и не содержит обходного входа.

```powershell
$api = 'http://localhost:3000/api/v1'
$login = Invoke-RestMethod -Method Post -Uri "$api/auth/telegram/start" -ContentType 'application/json' -Body '{}'
$contact = @{
  token = $login.token
  telegramId = '900000000001'
  phone = '+79000000000'
  fullName = 'Локальный участник'
} | ConvertTo-Json
Invoke-RestMethod -Method Post -Uri "$api/dev/telegram/confirm" -ContentType 'application/json' -Body $contact
$session = Invoke-RestMethod -Uri "$api/auth/telegram/status?token=$($login.token)" -Headers @{ 'X-Poll-Secret' = $login.pollSecret }
$headers = @{ Authorization = "Bearer $($session.accessToken)" }
$onboarding = @{ birthDate = '1990-01-01'; consentVersion = '2026-10-27.v1' } | ConvertTo-Json
Invoke-RestMethod -Method Post -Uri "$api/me/onboarding" -Headers $headers -ContentType 'application/json' -Body $onboarding
Invoke-RestMethod -Uri "$api/me" -Headers $headers
```

Секреты остаются в переменных текущего процесса. Не используйте реальный чужой Telegram ID в fake-режиме. contactOnly=true оставляет CONTACT_RECEIVED; confirm=false имитирует «Нет»; contactUserId с другим ID проверяет отказ чужого контакта. Опрос не чаще раза в секунду, максимум 200 запросов; токен живет 5 минут и обменивается один раз.

Для админа используйте telegramId из ADMIN_TELEGRAM_ID. Status вернет nextStep=ADMIN_EMAIL_CODE и предварительную защищенную cookie; код найдите в Mailpit. Затем POST /auth/admin/verify-code {code} с этой cookie и Origin=WEB_URL выдаст access/refresh. Код живет 10 минут, максимум 5 попыток. После входа администратор тоже проходит онбординг.

Cookie refresh и предварительная cookie всегда HttpOnly/Secure/SameSite=Lax. Для проверки cookie-потоков используйте HTTPS либо localhost в браузере с поддержкой Secure-cookie для localhost; в API-тестах cookies передаются явно. Cookie-запросы refresh/logout/admin verify требуют Origin=WEB_URL, одинаковый user-agent и отправку credentials. Access JWT хранится только в памяти, срок 15 минут. При ротации не отправляйте параллельные refresh: повтор старого секрета отзывает семейство.

## Проверка с настоящим Telegram-ботом

1. Создайте бота через @BotFather. В .env укажите TELEGRAM_BOT_TOKEN и TELEGRAM_BOT_USERNAME без @; DEV_FAKE_TELEGRAM=false, TELEGRAM_MODE=polling.
2. Выполните pnpm telegram:setup и pnpm telegram:info, затем pnpm dev. Setup проверяет username, задает /help и /status, удаляет webhook для polling. Одновременно запускайте только один polling-процесс этого бота.
3. Вызовите POST /auth/telegram/start, откройте deepLink, поделитесь своим контактом кнопкой и нажмите «Да, это я» после проверки устройства. Опросите GET /auth/telegram/status?token=… с X-Poll-Secret.
4. Для ADMIN получите второй код на подтвержденный e-mail. Локально письма доступны в Mailpit, на сервере нужен рабочий SMTP. Резервный вход по e-mail для ADMIN отключен.

Webhook: TELEGRAM_MODE=webhook, PUBLIC_API_URL — внешний HTTPS base URL API без /api/v1, TELEGRAM_WEBHOOK_SECRET — отдельный случайный секрет. Обновления поступают на /api/v1/telegram/webhook; неверный секрет отклоняется. Next может проксировать этот путь на Nest. Проверка бота и установка webhook выполняются также при запуске приложения. Без токена API стартует, реальный Telegram-вход возвращает 503.

## Что реализовано

- Telegram-вход с собственным контактом, подтверждением устройства, одноразовыми хешированными токенами; admin e-mail-код, резервный вход не-ADMIN, привязка адреса, refresh-ротация, онбординг и анонимизация.
- Учреждения и закрытые поля по роли; права кураторов по PlaceCurator; анкеты, посещения ДОД, решение о приеме, мероприятия.
- Поездки, модерация записей, лист ожидания, явка, отчеты и фото. Последнее место защищено блокировкой строки в транзакции; смены статусов проверяют shared и пишут аудит.
- Публичный контент и календарь, все административные CRUD, обращения, ручной учет Donation, семь счетчиков с кэшем и ручными значениями.
- DB-outbox и BullMQ: IN_APP, Telegram, e-mail, 5 попыток, backoff/retry_after, 25 Telegram-сообщений/секунду, fallback при 403, напоминания с проверкой переноса.
- Presigned S3 POST с MIME/размером, проверкой сигнатуры файла, приватным бакетом и закрытыми по умолчанию фото. PDF отчетов клуба — только ADMIN; видео в альбомах может быть внешней ссылкой.
- DTO/Swagger, общий формат ошибок, BigInt→строки, helmet, Redis throttler, CORS только WEB_URL и журналирование без PII/токенов.

Полный договор о полях, переходах, правах и API — [docs/CONTRACT.md](docs/CONTRACT.md).

## Команды

```powershell
pnpm dev             # watch shared, TypeScript API + Node watch, Next
pnpm build           # production-сборка shared → api/web
pnpm typecheck       # strict TypeScript
pnpm test            # общие формы/контракт, бизнес-правила, инфраструктура, протокол Telegram
pnpm test:e2e        # реальный PostgreSQL/Redis/MinIO/Mailpit; временная БД
pnpm lint            # ESLint + Prettier
pnpm format
pnpm gen:api         # Nest OpenAPI → shared/openapi.json → типы и формы frontend
pnpm gen:client      # обновить клиент и формы из готового OpenAPI
pnpm test:web        # компонентные тесты интерфейса
pnpm start           # запустить production-сборку API + web
pnpm db:deploy       # готовые миграции, без сброса данных
pnpm db:migrate      # создание миграции в разработке
pnpm db:seed
pnpm telegram:setup
pnpm telegram:info
```

Для test:e2e сначала поднимите Docker. Скрипт допускает только локальный PostgreSQL, создает уникальную club_test_* базу, применяет все миграции, запускает HTTP-тесты и удаляет только свою базу, ключи Redis и загруженные тестовые S3-объекты. Основная club не сбрасывается. SMTP-тесты оставляют синтетические письма в Mailpit. Реальный Telegram в тестах заменен проверяемым протоколом grammY.

OpenAPI экспортируется без БД/Redis/HTTP-порта/воркеров/бота. Генерируемые packages/shared/openapi.json и apps/web/src/lib/api/schema.d.ts входят в исходники; вручную их не редактируют. После изменения API запускайте gen:api.

Husky/lint-staged запускают ESLint/форматирование измененных файлов при коммите. CI может задавать HUSKY=0. Установка зависимостей сохраняет заданные pnpm supply-chain policies.

## Структура

```text
apps/api/src/
  auth/               Telegram, сессии, e-mail, guards, профиль
  club/               учреждения, поездки, анкеты, ДОД, мероприятия
  admin/              пользователи, справочники, назначения, явка
  content/            CMS, публичные проекции, обращения, статистика
  notifications/      DB-outbox, BullMQ, напоминания, русские шаблоны
  storage/            S3 POST/GET и очистка удаленных файлов
  common/             ошибки, валидация, аудит, Redis/очереди/SMTP
  prisma/             клиент PostgreSQL
  scripts/            seed, Telegram CLI, offline OpenAPI
apps/api/prisma/      схема и миграции
apps/api/Dockerfile   образ API с healthcheck
apps/web/src/         публичные SSR-страницы, кабинет, куратор, админка, API-клиент
packages/shared/src/  enums, labels, transitions, constants, permissions,
                      errors, messages, schemas, server
docs/                 контракт и результаты проверки
infra/minio/          сборка MinIO/mc
scripts/              запуск, окружение, отдельная тестовая база
```

## Docker и деплой

```powershell
docker build -f apps/api/Dockerfile -t club-api:local .
```

Образ запускает node dist/main.js от пользователя node на 4000, NODE_ENV=production; содержит healthcheck и SIGTERM/graceful shutdown. Секреты передавайте окружением при запуске, .env не копируется в образ. Перед стартом выполняйте миграции отдельным deployment-шагом (pnpm db:deploy из сборочного окружения). Runtime-образ содержит только production-зависимости, собранный API/shared и миграции, без CLI мигратора.

В контейнере localhost означает сам контейнер: DATABASE_URL, REDIS_URL, SMTP_HOST и S3_ENDPOINT должны указывать на доступные из него сервисы. S3_ENDPOINT для presigned upload должен быть доступен одновременно API и браузеру. В production используйте отдельного S3-пользователя и приватный бакет. Прокси должен перезаписывать X-Forwarded-For и не записывать чувствительные query/header/body в журналы.

При остановке API прекращает polling/timers, завершает активные workers и закрывает подключения. Перед остановкой контейнера оставьте время на завершение доставки (например, docker stop --time 40).

В текущей облачной конфигурации владелец выбрал зарубежные регионы Vercel, Neon, Upstash и Tigris. Настройка автодеплоя, окружений и ограничения бесплатных планов описаны в [docs/VERCEL.md](docs/VERCEL.md). Размещение данных, резервных копий, SMTP, логов и мониторинга должно соответствовать принятой политике обработки данных проекта.

Приложения останавливаются Ctrl+C; docker compose stop сохраняет инфраструктуру. docker compose down сохраняет тома; --volumes удаляет локальные данные и применяется только при намеренном сбросе.

## Интерфейс

Открывайте **http://localhost:3000**. API — http://localhost:4000/api/v1, Swagger — http://localhost:4000/api/docs. Все запросы браузера к API идут через Next rewrites по своему origin. Access JWT хранится только в памяти; refresh — HttpOnly/Secure/SameSite=Lax cookie с Path=/, чтобы middleware видела ее на защищенных маршрутах.

- Публично: главная, новости и материалы, проекты, интервью, партнеры, альбомы, видео, отчеты, СМИ, контакты, помощь, вступление, учреждения, календарь.
- `/login`, `/onboarding`, `/verify-email`: настоящий Telegram-вход, подтверждение контакта и устройства, второй шаг администратора, резервная почта.
- `/cabinet`: обзор, анкета с черновиком вкладки, профиль/аватар, резервный e-mail, уведомления, записи.
- `/trips`, `/events`: каталог, фильтры, запись и отмена с учетом роли.
- `/curator`: свои поездки/учреждения, участники, явка, отчеты с фото, нужды.
- `/admin`: пользователи/кураторы, анкеты, ДОД, регионы/учреждения, контент с TipTap, мероприятия, обращения, ручной учет пожертвований, счетчики, уведомления, аудит.

Данные новостей/альбомов/мероприятий не подменяются вымышленными записями. Пока администратор их не добавил, показываются пустые состояния. Реквизиты пожертвования и политика персональных данных — явные заглушки; платежного функционала нет. Иллюстрации локальные SVG, шрифт системный, CDN не используется.

`pnpm gen:client` генерирует `schema.d.ts`, привязки CRUD `resources.ts` и метаданные форм `form-definitions.json`. Анкета всегда валидируется общей `questionnaireSchema`; метаданные OpenAPI используются для остальных административных форм. Клиентские роли не заменяют серверную проверку.

Ручной сценарий с настоящим ботом: [docs/LOCAL_CHECKLIST.md](docs/LOCAL_CHECKLIST.md). Результаты проверок интерфейса: [docs/FRONTEND_VERIFICATION.md](docs/FRONTEND_VERIFICATION.md).

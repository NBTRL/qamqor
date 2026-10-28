# Автоматический деплой на Vercel

Проект Vercel `acme-5a14/qamqor` подключён к `NBTRL/qamqor`. Push в `main`
запускает сборку и обновляет production-домен `qamqor-tawny.vercel.app`.
Другие ветки создают Preview. Корневая директория проекта Vercel должна быть
корнем репозитория, без общего Framework Preset и Build Command: команды каждого
приложения определены в корневом `vercel.json`.

## Приложения и маршруты

- `web`: Next.js из `apps/web`, публичные страницы сайта.
- `api`: NestJS из `apps/api`, публичные пути `/api/*`.
  Сборка генерирует Prisma Client и формирует автономный каталог `server-output`
  с production-зависимостями и явным ESM package scope.
- Привязка `API_INTERNAL_URL` позволяет Server Components обращаться к API
  своего деплоя. Значение создаёт Vercel; вручную его не задают.
- `worker`: один Vercel Daemon во Франкфурте, образ `Dockerfile.worker`.
  Обрабатывает BullMQ, outbox, напоминания и очистку файлов. Daemons и Services
  находятся в beta. Daemon работает только в Production; Preview проверяет HTTP API.

HTTP-процессы на Vercel не запускают фоновые воркеры. Периодическая сверка outbox,
напоминаний и удаления файлов в daemon выполняется раз в 15 минут. Новые уже
поставленные в Redis задания пробуждают обработчики сразу. Эти интервалы снижают
пустые запросы к Neon и Upstash, но не гарантируют, что любая нагрузка поместится
в бесплатные квоты. При превышении бесплатных лимитов возможна приостановка работы.

## Хранилища и переменные

- Neon Free, Франкфурт: `DATABASE_URL` и `DATABASE_URL_UNPOOLED`.
  Для Preview включено создание отдельных веток БД.
- Upstash Redis Free, Франкфурт: `REDIS_URL` (TLS). Eviction выключен.
  Production и Preview используют один Redis; ключи разделены по deployment environment.
- Приватный Tigris bucket `qamqor-files`: `TIGRIS_STORAGE_BUCKET`,
  `TIGRIS_STORAGE_ACCESS_KEY_ID`, `TIGRIS_STORAGE_SECRET_ACCESS_KEY`.
  API сопоставляет их с настройками S3, endpoint `https://t3.storage.dev`, region `auto`.
  CORS бакета должен разрешать загрузки с production origin сайта.
- `WEB_URL`, `PUBLIC_API_URL`: production origin сайта. Preview использует свой `VERCEL_URL`.
- `JWT_SECRET`: отдельные секреты Production и Preview, не менее 32 символов.
- Telegram только в Production: `TELEGRAM_BOT_TOKEN`, `TELEGRAM_BOT_USERNAME`,
  `TELEGRAM_MODE=webhook`, `TELEGRAM_WEBHOOK_SECRET`.
  Webhook: `/api/v1/telegram/webhook`. Этот же бот не должен работать локально в polling.
- `DEV_FAKE_TELEGRAM=false` во всех облачных окружениях.

SMTP не предоставляется этими интеграциями. Для почтовых кодов, включая второй шаг
администратора, отдельно требуются `SMTP_HOST`, `SMTP_PORT`, `MAIL_FROM` и при
необходимости `SMTP_USER` / `SMTP_PASS`. Без них почтовые операции возвращают ошибку,
остальной API запускается. Реальные данные не подменяются локальными адресами SMTP.

Секреты хранятся в Vercel как Secret. Не копируйте их в Git и в логи.
По выбору владельца в этой конфигурации используются зарубежные регионы.

## Миграции и проверка

API build запускает `scripts/vercel-migrate.mjs`: применяет существующие Prisma
миграции через непулированное соединение и останавливает деплой при ошибке.
Production и Preview используют переменные своей ветки Neon. Seed автоматически
не запускается; демоданные и администраторы не создаются при каждом деплое.

После деплоя проверьте:

1. `/api/v1/health` возвращает `status: ok`.
2. Публичные API-каталоги отвечают из PostgreSQL, без 500 и обращения к localhost.
3. Запуск Telegram-входа создаёт реальную сессию и deep link бота.
4. Загрузка файла через presigned POST работает с CORS, закрытые файлы требуют авторизацию.
5. Daemon запущен и не пишет ошибки соединения в runtime logs.

Полный вход с подтверждением собственного контакта выполняется пользователем в Telegram.

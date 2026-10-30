# Автоматический деплой на Vercel

Проект Vercel `acme-5a14/qamqor` подключён к `NBTRL/qamqor`. Push в `main`
запускает сборку и обновляет production-домен `qamqor-tawny.vercel.app`.
Другие ветки создают Preview. Корневая директория проекта Vercel должна быть
корнем репозитория, без общего Framework Preset и Build Command: команды каждого
приложения определены в корневом `vercel.json`.

## Приложения и маршруты

- `web`: Next.js из `apps/web`, публичные страницы сайта.
- `api`: NestJS из `apps/api`, публичные пути `/api/*`.
  Сборка генерирует Prisma Client. API запускается в контейнере из `Dockerfile.api`
  командой `node dist/scripts/start-vercel.js`; фоновые задания в HTTP-контейнере выключены.
- Привязка `API_INTERNAL_URL` позволяет Server Components обращаться к API
  своего деплоя. Значение создаёт Vercel; вручную его не задают.
- `worker`: один Vercel Daemon во Франкфурте, общий с API `Dockerfile.api`,
  команда `node dist/worker.js` задаётся явно в `vercel.json`.
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
- `PORT=4000`: порт HTTP-контейнера API в Production и Preview.
- `JWT_SECRET`: отдельные секреты Production и Preview, не менее 32 символов.
- Telegram только в Production: `TELEGRAM_BOT_TOKEN`, `TELEGRAM_BOT_USERNAME`,
  `TELEGRAM_MODE=webhook`, `TELEGRAM_WEBHOOK_SECRET`.
  Webhook: `/api/v1/telegram/webhook`. Этот же бот не должен работать локально в polling.
  Только daemon настраивает webhook и команды. HTTP API инициализирует обработку
  обновлений без повторных изменений настроек бота при масштабировании.
- `DEV_FAKE_TELEGRAM=false` во всех облачных окружениях.

SMTP не предоставляется этими интеграциями. Для почтовых кодов, включая второй шаг
администратора, отдельно требуются `SMTP_HOST`, `SMTP_PORT`, `MAIL_FROM` и при
необходимости `SMTP_USER` / `SMTP_PASS`. Без них почтовые операции возвращают ошибку,
остальной API запускается. Реальные данные не подменяются локальными адресами SMTP.

Секреты хранятся в Vercel как Secret. Не копируйте их в Git и в логи.
По выбору владельца в этой конфигурации используются зарубежные регионы.

## Сборка серверного контейнера

API и worker используют один Dockerfile и одинаковый набор серверных зависимостей.
`command` у daemon переопределяет команду HTTP-контейнера. Количество процессов,
обработка фоновых заданий и границы HTTP API задаются прежними entrypoint приложения.

Dockerfile устанавливает только API и его workspace-зависимости; исходники web
и документация не копируются в серверный build. Слой установки располагается до
копирования исходников API, чтобы прикладные правки могли использовать кеш зависимостей.
Оба потребителя всё равно остаются отдельными сервисами Vercel: повторное использование
сборки или слоёв зависит от платформы, а не гарантируется одинаковым именем Dockerfile.

`injectWorkspacePackages` и `syncInjectedDepsAfterScripts: [build]` позволяют
`pnpm deploy` сформировать отдельный lockfile серверного пакета и сохранить свежий
скомпилированный shared. Старый режим `--legacy` удалён. `--prefer-offline` использует
кеш, а при отсутствии метаданных разрешает обращение к registry; проверки зависимостей
и frozen lockfile не отключаются. Упаковываются production-зависимости, Prisma Client,
CLI и миграции, необходимые при запуске.
После упаковки явно выполняется `rebuild @prisma/engines`: нативный schema engine
должен находиться внутри итогового пакета, поскольку отключённые deploy lifecycle
scripts не гарантируют его наличие. CI проверяет запуск CLI в контейнере без сети.

Локальная проверка упакованного каталога после `pnpm build`:

```sh
pnpm --filter @club/api deploy --prod --prefer-offline --ignore-scripts /tmp/qamqor-runtime
node scripts/check-runtime.mjs /tmp/qamqor-runtime
```

Путь назначения должен быть новым. Проверка обходит символические ссылки, проверяет
наличие entrypoint/миграций и запускает настоящий Nest HTTP-сервер с offline-провайдерами
и тестовой конфигурацией. `/api/v1/health` должен вернуть 200; внешние подключения
не требуются. В CI тот же сценарий выполняется внутри собранного Docker-образа
с `--network none`. Это проверка упаковки, а реальные БД/очереди проверяются backend E2E.

## Диагностика preview

`Resource provisioning failed` у preview может возникнуть до запуска сборки:
в таком случае журнал build пуст, а команды Dockerfile ещё не выполнялись.
Следует проверять выделение ресурса интеграцией, а не менять исходники приложения
в ответ на отсутствие журнала компиляции.

Для Neon нужно установить фактическое число веток и сопоставить preview-ветки с PR.
На Free план допускает до 10 веток на проект. Закрытие PR само по себе не гарантирует
немедленное освобождение ветки: Vercel-managed integration удаляет её после удаления
соответствующего deployment, с учётом retention. Превышение лимита — возможная причина,
которую нельзя считать установленной без данных конкретного проекта.

Источники: [Neon integration](https://neon.com/docs/guides/vercel-managed-integration),
[Vercel preview environments](https://vercel.com/i/ephemeral-environments),
[daemon command](https://vercel.com/docs/daemons/config-reference#command).

## Миграции и проверка

HTTP-контейнер перед запуском сервера применяет существующие Prisma-миграции
через непулированное соединение и не начинает обслуживать запросы при ошибке.
Production и Preview используют переменные своей ветки Neon. Seed автоматически
не запускается, администраторы при деплое не создаются. Учебная миграция
`20261030030000_educational_demo` один раз добавляет вымышленные материалы
для показа проекта; повторный деплой не обновляет их даты и не стирает правки.
Состав набора и сценарий показа — в [DEMO.md](DEMO.md).

После деплоя проверьте:

1. `/api/v1/health` возвращает `status: ok`.
2. Публичные API-каталоги отвечают из PostgreSQL, без 500 и обращения к localhost.
3. Запуск Telegram-входа создаёт реальную сессию и deep link бота.
4. Загрузка файла через presigned POST работает с CORS, закрытые файлы требуют авторизацию.
5. Daemon запущен и не пишет ошибки соединения в runtime logs.

Полный вход с подтверждением собственного контакта выполняется пользователем в Telegram.

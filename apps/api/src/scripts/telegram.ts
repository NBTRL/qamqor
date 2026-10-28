import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { AppModule } from '../app.module.js';
import { TelegramService } from '../auth/telegram.service.js';
import { getEnvironment } from '../config/environment.js';

const env = getEnvironment();
const app = await NestFactory.createApplicationContext(
  AppModule.configure({ offline: true, workers: false, telegram: false }),
  { logger: false, abortOnError: false },
);
try {
  const telegram = app.get(TelegramService);
  if (process.argv[2] === 'setup') console.log(JSON.stringify(await telegram.setup()));
  else if (process.argv[2] === 'info') {
    const info = await telegram.info();
    // Telegram может включать адрес запроса в last_error_message. Выводим только известные безопасные категории.
    const error = info.last_error_message;
    console.log(
      JSON.stringify({
        mode: env.TELEGRAM_MODE,
        webhookConfigured: Boolean(info.url),
        pendingUpdateCount: info.pending_update_count,
        lastErrorAt: info.last_error_date
          ? new Date(info.last_error_date * 1000).toISOString()
          : null,
        deliveryError: !error
          ? null
          : (/401|403|404|429|500|502|503/.exec(error)?.[0] ?? 'DELIVERY_ERROR'),
        synchronizationErrorAt: info.last_synchronization_error_date ?? null,
      }),
    );
  } else throw new Error();
} catch (error) {
  console.error(
    !env.TELEGRAM_BOT_TOKEN
      ? 'Задайте TELEGRAM_BOT_TOKEN и TELEGRAM_BOT_USERNAME в .env.'
      : error instanceof Error && /^(TELEGRAM_BOT_USERNAME|Webhook требует)/.test(error.message)
        ? error.message
        : 'Не удалось настроить Telegram. Проверьте настройки и доступность Telegram API.',
  );
  process.exitCode = 1;
} finally {
  await app.close();
}

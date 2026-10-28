import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module.js';
import { getEnvironment } from './config/environment.js';
import { configureApp, setupSwagger } from './openapi.js';
import { Logger } from 'nestjs-pino';

async function bootstrap(): Promise<void> {
  const environment = getEnvironment();
  const app = await NestFactory.create(
    AppModule.configure(
      process.env.VERCEL
        ? { workers: false, telegram: process.env.TELEGRAM_MODE === 'webhook' }
        : {},
    ),
    {
      logger: false,
      abortOnError: false,
    },
  );
  try {
    app.useLogger(app.get(Logger));
    configureApp(app);
    setupSwagger(app);
    app.enableShutdownHooks();
    await app.listen(
      Number(process.env.PORT ?? 4000),
      environment.NODE_ENV === 'production' ? '0.0.0.0' : '127.0.0.1',
    );
  } catch (error) {
    // Иначе Redis/BullMQ оставляют процесс живым после ошибки getMe/username/listen.
    await app.close().catch(() => undefined);
    throw error;
  }
}
bootstrap().catch((error: unknown) => {
  const known =
    error instanceof Error &&
    /^(Некорректные переменные окружения:|DEV_FAKE_TELEGRAM=|TELEGRAM_BOT_USERNAME не совпадает|Webhook требует)/.test(
      error.message,
    );
  console.error(
    known
      ? error.message
      : 'Не удалось запустить API. Проверьте доступность сервисов и настройки Telegram.',
  );
  process.exitCode = 1;
});

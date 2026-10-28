import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { Logger } from 'nestjs-pino';
import { AppModule } from './app.module.js';
import { StorageService } from './storage/storage.service.js';

async function bootstrap(): Promise<void> {
  const app = await NestFactory.createApplicationContext(
    AppModule.configure({
      workers: true,
      telegram: true,
      // Let Neon suspend between scans; keep idle BullMQ traffic within the free allowance.
      backgroundIntervalMs: 15 * 60 * 1000,
      queueDrainDelaySeconds: 120,
      queueStalledIntervalMs: 120000,
    }),
    { logger: false, abortOnError: false },
  );
  app.useLogger(app.get(Logger));
  try {
    await app.get(StorageService).configureCors();
  } catch {
    await app.close();
    throw new Error('STORAGE_CORS_CONFIGURATION_FAILED');
  }
  app.enableShutdownHooks();
  // Queue connections normally keep the worker alive; retain it even before the first job.
  const heartbeat = setInterval(() => undefined, 60000);
  const stop = () => clearInterval(heartbeat);
  process.once('SIGTERM', stop);
  process.once('SIGINT', stop);
}

bootstrap().catch(() => {
  console.error('WORKER_STARTUP_FAILED');
  process.exit(1);
});

import 'reflect-metadata';
import { mkdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { NestFactory } from '@nestjs/core';
import { AppModule } from '../app.module.js';
import { getEnvironment } from '../config/environment.js';
import { configureApp, createOpenApiDocument } from '../openapi.js';

getEnvironment();
const app = await NestFactory.create(
  AppModule.configure({ offline: true, workers: false, telegram: false }),
  { logger: false },
);
try {
  configureApp(app);
  await app.init();
  const directory = new URL('../../../../packages/shared/', import.meta.url);
  await mkdir(fileURLToPath(directory), { recursive: true });
  await writeFile(
    fileURLToPath(new URL('openapi.json', directory)),
    `${JSON.stringify(createOpenApiDocument(app), null, 2)}\n`,
  );
  console.log('Экспортирован packages/shared/openapi.json');
} finally {
  await app.close();
}

import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { AppModule } from '../app.module.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { inspectUnusedUploads } from '../storage/upload-lifecycle.js';

const limit = Number(process.argv[2] ?? 25);
if (!Number.isInteger(limit) || limit < 1 || limit > 100) throw new Error('Limit must be 1..100.');
const app = await NestFactory.createApplicationContext(
  AppModule.configure({ offline: true, workers: false, telegram: false }),
  { logger: false },
);
try {
  const rows = await inspectUnusedUploads(app.get(PrismaService), { dryRun: true, limit });
  console.log(JSON.stringify({ dryRun: true, checked: rows.length, limit, rows }, null, 2));
} finally {
  await app.close();
}

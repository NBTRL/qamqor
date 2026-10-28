import 'reflect-metadata';
import { PrismaService } from '../prisma/prisma.service.js';
import { getEnvironment } from '../config/environment.js';
import { seed } from './seed-data.js';

const prisma = new PrismaService();
try {
  const result = await seed(prisma, getEnvironment());
  console.log(JSON.stringify(result));
  if (!result.administratorConfigured)
    console.log(
      'Задайте ADMIN_TELEGRAM_ID и ADMIN_EMAIL для первого администратора, новостей, мероприятий и поездок.',
    );
} catch {
  console.error(
    'Seed не выполнен. Проверьте миграции, ADMIN_TELEGRAM_ID и принадлежность ADMIN_EMAIL.',
  );
  process.exitCode = 1;
} finally {
  await prisma.$disconnect();
}

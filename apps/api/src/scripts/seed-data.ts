import { createHash } from 'node:crypto';
import type { ServerEnvironment } from '@club/shared/server';
import type { PrismaClient, PlaceType, EventType } from '../generated/prisma/client.js';

const id = (key: string) => {
  const hex = createHash('sha256').update(`club-seed-v1:${key}`).digest('hex');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-4${hex.slice(13, 16)}-a${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
};
const regions = [
  ['moscow', 'Москва'],
  ['moscow-oblast', 'Московская область'],
  ['saint-petersburg', 'Санкт-Петербург'],
  ['leningrad-oblast', 'Ленинградская область'],
  ['novosibirsk-oblast', 'Новосибирская область'],
  ['sverdlovsk-oblast', 'Свердловская область'],
  ['tatarstan', 'Республика Татарстан'],
  ['samara-oblast', 'Самарская область'],
  ['krasnodar-krai', 'Краснодарский край'],
  ['rostov-oblast', 'Ростовская область'],
] as const;

/** Повторный запуск добавляет отсутствующие демозаписи, сохраняя правки администратора. */
export async function seed(prisma: PrismaClient, env: ServerEnvironment) {
  if (Boolean(env.ADMIN_TELEGRAM_ID) !== Boolean(env.ADMIN_EMAIL))
    throw new Error(
      'Для первого администратора задайте одновременно ADMIN_TELEGRAM_ID и ADMIN_EMAIL.',
    );
  return prisma.$transaction(
    async (tx) => {
      // Сериализация повторных запусков seed без блокировки прикладных таблиц.
      await tx.$queryRaw`SELECT pg_advisory_xact_lock(2710282026::bigint)::text`;
      for (const [slug, name] of regions)
        await tx.region.upsert({ where: { slug }, create: { slug, name }, update: {} });
      let adminId: string | null = null;
      if (env.ADMIN_TELEGRAM_ID && env.ADMIN_EMAIL) {
        const existing = await tx.user.findUnique({
          where: { telegramId: BigInt(env.ADMIN_TELEGRAM_ID) },
        });
        const owner = await tx.user.findUnique({ where: { email: env.ADMIN_EMAIL } });
        if (owner && owner.id !== existing?.id)
          throw new Error('ADMIN_EMAIL уже закреплен за другим аккаунтом.');
        const admin = await tx.user.upsert({
          where: { telegramId: BigInt(env.ADMIN_TELEGRAM_ID) },
          create: {
            telegramId: BigInt(env.ADMIN_TELEGRAM_ID),
            fullName: 'Администратор клуба',
            role: 'ADMIN',
            email: env.ADMIN_EMAIL,
            emailVerifiedAt: new Date(),
          },
          update: {
            role: 'ADMIN',
            email: env.ADMIN_EMAIL,
            emailVerifiedAt:
              existing?.email === env.ADMIN_EMAIL && existing.emailVerifiedAt
                ? existing.emailVerifiedAt
                : new Date(),
          },
        });
        adminId = admin.id;
        if (!existing || existing.role !== 'ADMIN' || existing.email !== env.ADMIN_EMAIL)
          await tx.auditLog.create({
            data: {
              actorId: admin.id,
              action: 'ADMIN_BOOTSTRAPPED',
              entity: 'User',
              entityId: admin.id,
              diff: { source: 'seed' },
            },
          });
      }
      if (env.NODE_ENV === 'production')
        return { regions: regions.length, administratorConfigured: Boolean(adminId), demo: false };
      const placeTypes: PlaceType[] = [
        'ORPHANAGE',
        'BOARDING_SCHOOL',
        'ADULT_BOARDING',
        'ORPHANAGE',
        'BOARDING_SCHOOL',
        'ADULT_BOARDING',
        'YARD_PROGRAM',
        'YARD_PROGRAM',
      ];
      const placeIds: string[] = [];
      for (const [index, type] of placeTypes.entries()) {
        const region = await tx.region.findUniqueOrThrow({
          where: { slug: index < 4 ? 'moscow-oblast' : 'leningrad-oblast' },
        });
        const slug = `demo-place-${index + 1}`;
        const yard = type === 'YARD_PROGRAM';
        const row = await tx.place.upsert({
          where: { slug },
          update: {},
          create: {
            slug,
            type,
            regionId: region.id,
            name: `Демо: ${yard ? 'дворовая программа' : 'учреждение'} ${index + 1}`,
            city: index < 4 ? 'Химки' : 'Всеволожск',
            district: yard ? `Демонстрационный район ${index - 5}` : null,
            address: yard ? null : 'Демонстрационный адрес, уточнить у куратора',
            description:
              'Учебная запись для локальной разработки. Не является действующим учреждением.',
            privateNotes: 'Демонстрационные внутренние заметки.',
            beneficiariesCount: 20 + index * 5,
          },
        });
        placeIds.push(row.id);
        const needId = id(`need:${index}`);
        await tx.needItem.upsert({
          where: { id: needId },
          update: {},
          create: {
            id: needId,
            placeId: row.id,
            title: 'Материалы для творческих занятий',
            description: 'Демонстрационный список нужд.',
          },
        });
      }
      const future = (days: number, hours = 10) => {
        const date = new Date();
        date.setUTCDate(date.getUTCDate() + days);
        date.setUTCHours(hours, 0, 0, 0);
        return date;
      };
      for (let index = 0; index < 2; index++) {
        const sessionId = id(`open-day:${index}`);
        await tx.openDaySession.upsert({
          where: { id: sessionId },
          update: {},
          create: {
            id: sessionId,
            startsAt: future(3 + index * 7),
            location: 'Демо: клубное пространство',
            capacity: 30,
            notes: 'Знакомство с клубом и правилами волонтерства.',
          },
        });
      }
      if (adminId)
        for (let index = 0; index < 3; index++) {
          const slug = `demo-news-${index + 1}`;
          await tx.newsPost.upsert({
            where: { slug },
            update: {},
            create: {
              slug,
              title: `Демо: новости клуба ${index + 1}`,
              excerpt: 'Демонстрационная новость для проверки сайта.',
              bodyHtml:
                '<p>Добро пожаловать в Клуб волонтеров. Это демонстрационная публикация.</p>',
              authorId: adminId,
              status: 'PUBLISHED',
              publishedAt: new Date(),
            },
          });
          const eventId = id(`event:${index}`),
            tripId = id(`trip:${index}`);
          const types: EventType[] = ['CLUB_EVENT', 'MASTER_CLASS', 'CHARITY_ACTION'];
          await tx.event.upsert({
            where: { id: eventId },
            update: {},
            create: {
              id: eventId,
              type: types[index]!,
              title: `Демо: мероприятие ${index + 1}`,
              description: 'Демонстрационное событие клуба.',
              startsAt: future(5 + index * 7),
              endsAt: future(5 + index * 7, 12),
              location: 'Демо: клубное пространство',
              capacity: 25,
              volunteersOnly: index === 2,
              createdById: adminId,
            },
          });
          await tx.trip.upsert({
            where: { id: tripId },
            update: {},
            create: {
              id: tripId,
              placeId: placeIds[index]!,
              createdById: adminId,
              title: `Демо: поездка ${index + 1}`,
              description: 'Демонстрационная поездка. Перед реальной публикацией замените данные.',
              startsAt: future(7 + index * 7),
              endsAt: future(7 + index * 7, 14),
              meetingPoint: 'Демо: место сбора уточняется',
              capacity: 8,
              status: 'OPEN',
            },
          });
        }
      return {
        regions: regions.length,
        administratorConfigured: Boolean(adminId),
        demo: true,
        places: placeIds.length,
        authoredDemoCreated: Boolean(adminId),
      };
    },
    { timeout: 30000 },
  );
}

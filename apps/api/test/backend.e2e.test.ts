import 'reflect-metadata';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { Test } from '@nestjs/testing';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { AppModule } from '../dist/app.module.js';
import { configureApp, createOpenApiDocument } from '../dist/openapi.js';
import { PrismaService } from '../dist/prisma/prisma.service.js';
import { RedisService } from '../dist/common/redis.service.js';
import { CryptoService } from '../dist/common/crypto.service.js';
import { AuthMailService } from '../dist/common/mail.service.js';
import { CONSENT_VERSION, ErrorCode } from '@club/shared';
import { GrammyError } from 'grammy';
import { NotificationService } from '../dist/notifications/notification.service.js';
import { TelegramService } from '../dist/auth/telegram.service.js';
import { MailService } from '../dist/common/mail.service.js';
import { ReminderService } from '../dist/notifications/reminder.service.js';
import { seed } from '../dist/scripts/seed-data.js';
import { getEnvironment } from '../dist/config/environment.js';
import { S3Client, DeleteObjectCommand } from '@aws-sdk/client-s3';
import { Worker } from 'bullmq';
import { QueuesService } from '../dist/common/queues.service.js';
import { AuthService } from '../dist/auth/auth.service.js';
import { MeService } from '../dist/auth/me.service.js';
import { TripsService } from '../dist/club/trips.service.js';
import { ApplicationsService } from '../dist/club/applications.service.js';

let app: INestApplication;
let prisma: PrismaService;
let redis: RedisService;
let crypto: CryptoService;
const mails: Array<{ to: string; subject: string; text: string }> = [];
const agent = 'Club integration browser';
const validQuestionnaire = {
  motivation: 'Хочу регулярно помогать и делиться полезными знаниями.',
  volunteeringExperience: 'Опыта пока нет.',
  helpAreas: ['EDUCATION'],
  availableWeekdays: ['SATURDAY'],
  referralSource: 'Друзья',
  rulesAccepted: true,
};
const origin = process.env.WEB_URL ?? 'http://localhost:3000';
const api = () => request(app.getHttpServer());
const req = (method: 'get' | 'post' | 'put' | 'patch' | 'delete', path: string) =>
  api()[method](`/api/v1${path}`).set('User-Agent', agent).set('Origin', origin);
let sequence = 0;
const telegramId = () => String(9000000000000 + ++sequence);
const rawCookie = (response: { headers: Record<string, unknown> }, name: string) => {
  const cookies = response.headers['set-cookie'] as string[] | undefined;
  return cookies?.find((value) => value.startsWith(`${name}=`))?.split(';')[0] ?? '';
};
async function start() {
  const response = await req('post', '/auth/telegram/start').send({});
  expect(response.status).toBe(200);
  return response.body as { token: string; pollSecret: string; expiresAt: string };
}
async function poll(login: { token: string; pollSecret: string }, secret = login.pollSecret) {
  await redis.client.del(redis.key(`poll-second:${crypto.hash(login.token)}`));
  return req('get', `/auth/telegram/status?token=${login.token}`).set('X-Poll-Secret', secret);
}
async function loginUser(id = telegramId()) {
  const login = await start();
  expect(
    (
      await req('post', '/dev/telegram/confirm').send({
        token: login.token,
        telegramId: id,
        phone: '+70000000001',
        fullName: 'Тестовый участник',
      })
    ).status,
  ).toBe(200);
  const result = await poll(login);
  expect(result.status).toBe(200);
  return { login, result, access: result.body.accessToken as string, id };
}
beforeAll(async () => {
  const module = await Test.createTestingModule({
    imports: [AppModule.configure({ workers: false, telegram: false })],
  }).compile();
  app = module.createNestApplication({ logger: false });
  configureApp(app);
  await app.init();
  prisma = app.get(PrismaService);
  redis = app.get(RedisService);
  crypto = app.get(CryptoService);
  vi.spyOn(app.get(AuthMailService), 'send').mockImplementation(async (to, subject, text) => {
    mails.push({ to, subject, text });
  });
});
beforeEach(async () => {
  mails.length = 0;
  for (const kind of ['throttle', 'throttle-block', 'poll-second', 'poll-total', 'email-login']) {
    let cursor = '0';
    do {
      const result = await redis.client.scan(
        cursor,
        'MATCH',
        redis.key(`${kind}:*`),
        'COUNT',
        1000,
      );
      cursor = result[0];
      if (result[1].length) await redis.client.del(...result[1]);
    } while (cursor !== '0');
  }
});
afterAll(async () => {
  try {
    if (prisma) {
      const env = getEnvironment();
      const storage = new S3Client({
        endpoint: env.S3_ENDPOINT,
        region: 'us-east-1',
        forcePathStyle: true,
        credentials: { accessKeyId: env.S3_ACCESS_KEY, secretAccessKey: env.S3_SECRET_KEY },
      });
      try {
        for (const asset of await prisma.uploadAsset.findMany())
          await storage.send(new DeleteObjectCommand({ Bucket: env.S3_BUCKET, Key: asset.key }));
      } finally {
        storage.destroy();
      }
    }
  } finally {
    await app?.close();
  }
});

async function onboard(access: string) {
  const response = await req('post', '/me/onboarding')
    .set('Authorization', `Bearer ${access}`)
    .send({ birthDate: '1990-01-01', consentVersion: CONSENT_VERSION });
  expect(response.status).toBe(200);
}
async function volunteer() {
  const user = await loginUser();
  await onboard(user.access);
  const row = await prisma.user.update({
    where: { telegramId: BigInt(user.id) },
    data: { role: 'VOLUNTEER' },
  });
  return { ...user, userId: row.id };
}
async function administrator() {
  const id = telegramId();
  await prisma.user.create({
    data: {
      telegramId: BigInt(id),
      fullName: 'Администратор',
      role: 'ADMIN',
      email: `admin${id}@example.test`,
      emailVerifiedAt: new Date(),
    },
  });
  const login = await loginUser(id);
  const code = /\b\d{6}\b/.exec(mails.at(-1)!.text)![0];
  const verified = await req('post', '/auth/admin/verify-code')
    .set('Cookie', rawCookie(login.result, 'club_admin_challenge'))
    .send({ code });
  expect(verified.status).toBe(200);
  const access = verified.body.accessToken as string;
  await onboard(access);
  return {
    access,
    id,
    userId: (await prisma.user.findUniqueOrThrow({ where: { telegramId: BigInt(id) } })).id,
  };
}
async function fixturePlace(userId: string) {
  const region = await prisma.region.create({
    data: { name: 'Тестовый регион', slug: `region-${++sequence}` },
  });
  const place = await prisma.place.create({
    data: {
      name: 'Учреждение теста',
      slug: `place-${++sequence}`,
      type: 'ORPHANAGE',
      regionId: region.id,
      city: 'Тестовый город',
      address: 'Закрытый адрес',
      privateNotes: 'Внутренние заметки',
      description: 'Публичное описание',
    },
  });
  await prisma.placeCurator.create({ data: { userId, placeId: place.id } });
  return place;
}
async function fixtureTrip(curator: { access: string; userId: string }, capacity = 1) {
  const place = await fixturePlace(curator.userId);
  const response = await req('post', '/curator/trips')
    .set('Authorization', `Bearer ${curator.access}`)
    .send({
      placeId: place.id,
      title: 'Поездка теста',
      description: 'Совместное занятие',
      startsAt: new Date(Date.now() + 3600000).toISOString(),
      endsAt: new Date(Date.now() + 7200000).toISOString(),
      meetingPoint: 'Закрытое место сбора',
      capacity,
    });
  expect(response.status).toBe(201);
  const tripId = response.body.id as string;
  expect(
    (
      await req('post', `/curator/trips/${tripId}/status`)
        .set('Authorization', `Bearer ${curator.access}`)
        .send({ status: 'OPEN' })
    ).status,
  ).toBe(200);
  return { tripId, place };
}
describe('Поездки, анкета, приватность и уведомления', () => {
  it('сериализует гонку за последнее подтвержденное место без овербукинга', async () => {
    const curator = await volunteer(),
      first = await volunteer(),
      second = await volunteer();
    const { tripId } = await fixtureTrip(curator);
    const a = await req('post', `/trips/${tripId}/register`)
      .set('Authorization', `Bearer ${first.access}`)
      .send({});
    const b = await req('post', `/trips/${tripId}/register`)
      .set('Authorization', `Bearer ${second.access}`)
      .send({});
    expect(a.body.status).toBe('PENDING');
    expect(b.body.status).toBe('PENDING');
    const results = await Promise.all(
      [a, b].map((row) =>
        req('patch', `/curator/registrations/${row.body.id}`)
          .set('Authorization', `Bearer ${curator.access}`)
          .send({ status: 'CONFIRMED' }),
      ),
    );
    expect(results.map((row) => row.status).sort()).toEqual([200, 409]);
    expect(results.find((row) => row.status === 409)!.body.code).toBe(ErrorCode.TRIP_FULL);
    expect(await prisma.tripRegistration.count({ where: { tripId, status: 'CONFIRMED' } })).toBe(1);
  });
  it('отменяет подтвержденную запись и продвигает старейшего из WAITLIST в PENDING', async () => {
    const curator = await volunteer(),
      first = await volunteer(),
      second = await volunteer();
    const { tripId } = await fixtureTrip(curator);
    const a = await req('post', `/trips/${tripId}/register`)
      .set('Authorization', `Bearer ${first.access}`)
      .send({});
    await req('patch', `/curator/registrations/${a.body.id}`)
      .set('Authorization', `Bearer ${curator.access}`)
      .send({ status: 'CONFIRMED' });
    const b = await req('post', `/trips/${tripId}/register`)
      .set('Authorization', `Bearer ${second.access}`)
      .send({});
    expect(b.body.status).toBe('WAITLIST');
    expect(
      (
        await req('delete', `/trips/${tripId}/register`).set(
          'Authorization',
          `Bearer ${first.access}`,
        )
      ).status,
    ).toBe(200);
    expect(
      (await prisma.tripRegistration.findUniqueOrThrow({ where: { id: b.body.id } })).status,
    ).toBe('PENDING');
    expect(
      await prisma.notification.count({
        where: {
          userId: second.userId,
          type: 'RegistrationPromotedFromWaitlist',
          channel: 'IN_APP',
        },
      }),
    ).toBe(1);
  });
  it('скрывает закрытые поля и не дает куратору управлять чужим учреждением', async () => {
    const curator = await volunteer(),
      other = await volunteer();
    const { tripId, place } = await fixtureTrip(curator);
    const guest = await req('get', `/places/${place.slug}`);
    expect(guest.body.address).toBeUndefined();
    expect(guest.body.privateNotes).toBeUndefined();
    const privatePlace = await req('get', `/places/${place.slug}`).set(
      'Authorization',
      `Bearer ${other.access}`,
    );
    expect(privatePlace.body.address).toBe('Закрытый адрес');
    const foreign = await req('patch', `/curator/trips/${tripId}`)
      .set('Authorization', `Bearer ${other.access}`)
      .send({ title: 'Изменено' });
    expect(foreign.body.code).toBe(ErrorCode.FORBIDDEN_PLACE);
    const calendar = await req('get', '/public/calendar');
    const item = calendar.body.items.find((row: { id: string }) => row.id === tripId);
    expect(item.title).toBe('Поездка');
    expect(item.place).toBeUndefined();
    expect(item.meetingPoint).toBeUndefined();
    expect(
      (
        await req('get', `/trips?regionId=${place.regionId}`).set(
          'Authorization',
          `Bearer ${curator.access}`,
        )
      ).body.items.some((row: { id: string }) => row.id === tripId),
    ).toBe(true);
    expect(
      (
        await req('post', `/curator/trips/${tripId}/status`)
          .set('Authorization', `Bearer ${curator.access}`)
          .send({ status: 'CLOSED' })
      ).status,
    ).toBe(200);
    expect(
      (
        await req('get', `/trips?regionId=${place.regionId}`).set(
          'Authorization',
          `Bearer ${curator.access}`,
        )
      ).body.items.some((row: { id: string }) => row.id === tripId),
    ).toBe(false);
    expect(
      (
        await req('get', `/trips?regionId=${place.regionId}&status=CLOSED`).set(
          'Authorization',
          `Bearer ${curator.access}`,
        )
      ).body.items.some((row: { id: string }) => row.id === tripId),
    ).toBe(true);
  });
  it('проходит полный сценарий кандидата от входа до отчета о поездке', async () => {
    const admin = await administrator(),
      candidate = await loginUser(),
      curator = await volunteer();
    expect(
      (await req('get', '/trips').set('Authorization', `Bearer ${candidate.access}`)).body.code,
    ).toBe(ErrorCode.ONBOARDING_REQUIRED);
    await onboard(candidate.access);
    const questionnaire = {
      motivation: 'Хочу регулярно помогать и делиться полезными знаниями.',
      volunteeringExperience: 'Опыта пока нет.',
      helpAreas: ['EDUCATION'],
      availableWeekdays: ['SATURDAY'],
      referralSource: 'Друзья',
      rulesAccepted: true,
    };
    const application = await req('put', '/me/application')
      .set('Authorization', `Bearer ${candidate.access}`)
      .send(questionnaire);
    expect(application.body.status).toBe('QUESTIONNAIRE_DONE');
    expect(
      (
        await req('post', `/admin/applications/${application.body.id}/status`)
          .set('Authorization', `Bearer ${admin.access}`)
          .send({ status: 'ACCEPTED' })
      ).body.code,
    ).toBe(ErrorCode.OPEN_DAY_REQUIRED);
    const day = await req('post', '/admin/open-days')
      .set('Authorization', `Bearer ${admin.access}`)
      .send({
        startsAt: new Date(Date.now() + 3600000).toISOString(),
        location: 'Клуб',
        capacity: 20,
      });
    expect(day.status).toBe(201);
    const attendance = await req('post', `/me/open-days/${day.body.id}/register`)
      .set('Authorization', `Bearer ${candidate.access}`)
      .send({});
    expect(attendance.status).toBe(201);
    expect(
      (
        await req('patch', `/admin/open-day-registrations/${attendance.body.id}`)
          .set('Authorization', `Bearer ${admin.access}`)
          .send({ attended: true })
      ).status,
    ).toBe(200);
    expect(
      (
        await req('post', `/admin/applications/${application.body.id}/status`)
          .set('Authorization', `Bearer ${admin.access}`)
          .send({ status: 'ACCEPTED' })
      ).status,
    ).toBe(200);
    expect(
      (await req('get', '/me').set('Authorization', `Bearer ${candidate.access}`)).body.role,
    ).toBe('VOLUNTEER');
    const { tripId } = await fixtureTrip(curator);
    const registration = await req('post', `/trips/${tripId}/register`)
      .set('Authorization', `Bearer ${candidate.access}`)
      .send({});
    expect(registration.status).toBe(201);
    expect(
      (
        await req('post', `/trips/${tripId}/register`)
          .set('Authorization', `Bearer ${candidate.access}`)
          .send({})
      ).body.code,
    ).toBe(ErrorCode.TRIP_ALREADY_REGISTERED);
    expect(
      (
        await req('patch', `/curator/registrations/${registration.body.id}`)
          .set('Authorization', `Bearer ${curator.access}`)
          .send({ status: 'CONFIRMED' })
      ).status,
    ).toBe(200);
    const participants = await req('get', `/curator/trips/${tripId}/registrations`).set(
      'Authorization',
      `Bearer ${curator.access}`,
    );
    expect(participants.body.items[0].phone).toBe('+70000000001');
    expect(participants.body.items[0].telegramId).toBeUndefined();
    expect(participants.body.items[0].email).toBeUndefined();
    expect(participants.body.items[0].birthDate).toBeUndefined();
    await req('patch', `/curator/trips/${tripId}`)
      .set('Authorization', `Bearer ${curator.access}`)
      .send({ startsAt: new Date(Date.now() - 3600000).toISOString() });
    await req('post', `/curator/trips/${tripId}/status`)
      .set('Authorization', `Bearer ${curator.access}`)
      .send({ status: 'CLOSED' });
    expect(
      (
        await req('patch', `/curator/registrations/${registration.body.id}`)
          .set('Authorization', `Bearer ${curator.access}`)
          .send({ status: 'ATTENDED' })
      ).status,
    ).toBe(200);
    expect(
      (
        await req('post', `/curator/trips/${tripId}/status`)
          .set('Authorization', `Bearer ${curator.access}`)
          .send({ status: 'DONE' })
      ).status,
    ).toBe(200);
    expect(
      (
        await req('put', `/curator/trips/${tripId}/report`)
          .set('Authorization', `Bearer ${curator.access}`)
          .send({ text: 'Провели совместное занятие и пообщались с участниками.', hoursSpent: 3.5 })
      ).status,
    ).toBe(200);
    expect((await prisma.trip.findUniqueOrThrow({ where: { id: tripId } })).status).toBe(
      'REPORTED',
    );
    expect(
      (await req('get', '/admin/audit-log').set('Authorization', `Bearer ${candidate.access}`))
        .status,
    ).toBe(403);
    expect(
      (await req('get', '/admin/audit-log').set('Authorization', `Bearer ${admin.access}`)).status,
    ).toBe(200);
    await req('delete', '/me').set('Authorization', `Bearer ${candidate.access}`);
    expect(
      (await prisma.tripRegistration.findUniqueOrThrow({ where: { id: registration.body.id } }))
        .status,
    ).toBe('ATTENDED');
    expect(await prisma.report.count({ where: { tripId } })).toBe(1);
  });
  it('разрешает кандидату обычное мероприятие, но не volunteersOnly', async () => {
    const user = await loginUser();
    await onboard(user.access);
    const actor = await prisma.user.findUniqueOrThrow({ where: { telegramId: BigInt(user.id) } });
    const event = await prisma.event.create({
      data: {
        type: 'CLUB_EVENT',
        title: 'Тестовое мероприятие',
        description: 'Описание',
        startsAt: new Date(Date.now() + 3600000),
        endsAt: new Date(Date.now() + 7200000),
        location: 'Клуб',
        volunteersOnly: true,
        createdById: actor.id,
      },
    });
    expect(
      (
        await req('post', `/events/${event.id}/register`)
          .set('Authorization', `Bearer ${user.access}`)
          .send({})
      ).body.code,
    ).toBe(ErrorCode.EVENT_VOLUNTEERS_ONLY);
    await prisma.event.update({ where: { id: event.id }, data: { volunteersOnly: false } });
    expect(
      (
        await req('post', `/events/${event.id}/register`)
          .set('Authorization', `Bearer ${user.access}`)
          .send({})
      ).status,
    ).toBe(201);
  });
  it('при Telegram 403 сохраняет причину, ставит botBlockedAt и доставляет через подтвержденный e-mail', async () => {
    const user = await loginUser();
    const row = await prisma.user.update({
      where: { telegramId: BigInt(user.id) },
      data: { email: `fallback${user.id}@example.test`, emailVerifiedAt: new Date() },
    });
    await prisma.notificationSetting.create({
      data: { userId: row.id, type: 'RegistrationConfirmed', telegram: true, email: false },
    });
    const notifications = app.get(NotificationService);
    await prisma.$transaction((tx) =>
      notifications.notify(tx, [row.id], 'RegistrationConfirmed', {
        title: 'Поездка',
        tripId: '00000000-0000-4000-8000-000000000001',
      }),
    );
    const telegram = await prisma.notification.findFirstOrThrow({
      where: { userId: row.id, channel: 'TELEGRAM' },
    });
    const botSpy = vi
      .spyOn(app.get(TelegramService), 'send')
      .mockRejectedValue(
        new GrammyError(
          'Forbidden',
          { ok: false, error_code: 403, description: 'Forbidden' },
          'sendMessage',
          {},
        ),
      );
    const mailSpy = vi.spyOn(app.get(MailService), 'deliver').mockResolvedValue();
    try {
      await notifications.deliver(telegram.id, 'TELEGRAM');
      const failed = await prisma.notification.findUniqueOrThrow({ where: { id: telegram.id } });
      expect(failed.status).toBe('FAILED');
      expect(failed.lastError).toBe('BOT_BLOCKED');
      expect(
        (await prisma.user.findUniqueOrThrow({ where: { id: row.id } })).botBlockedAt,
      ).not.toBeNull();
      const fallback = await prisma.notification.findFirstOrThrow({
        where: { userId: row.id, channel: 'EMAIL' },
      });
      await notifications.deliver(fallback.id, 'EMAIL');
      expect(mailSpy).toHaveBeenCalledOnce();
      expect(
        (await prisma.notification.findUniqueOrThrow({ where: { id: fallback.id } })).status,
      ).toBe('SENT');
      expect(
        await prisma.notification.count({ where: { userId: row.id, channel: 'IN_APP' } }),
      ).toBe(1);
    } finally {
      botSpy.mockRestore();
      mailSpy.mockRestore();
    }
  });
});

describe('Повторный аудит контракта и пограничных состояний', () => {
  it('возвращает EMAIL_ALREADY_USED при одновременном подтверждении одного адреса', async () => {
    const users = [await loginUser(), await loginUser()];
    const email = `concurrent${++sequence}@example.test`;
    for (const user of users) {
      await onboard(user.access);
      expect(
        (
          await req('post', '/me/email')
            .set('Authorization', `Bearer ${user.access}`)
            .send({ email })
        ).status,
      ).toBe(200);
    }
    const tokens = mails.map((mail) => /token=([A-Za-z0-9_-]{43})/.exec(mail.text)![1]);
    const responses = await Promise.all(
      tokens.map((token) => req('get', `/auth/verify-email?token=${token}`)),
    );
    expect(responses.map((response) => response.status).sort()).toEqual([200, 409]);
    expect(responses.find((response) => response.status === 409)!.body.code).toBe(
      ErrorCode.EMAIL_ALREADY_USED,
    );
    expect(await prisma.user.count({ where: { email } })).toBe(1);
  });
  it('описывает примитивы, nullable-поля и пагинацию правильными типами OpenAPI', () => {
    const doc = createOpenApiDocument(app);
    for (const [name, properties] of Object.entries(doc.components!.schemas!)) {
      if (!('properties' in properties)) continue;
      for (const [field, schema] of Object.entries(properties.properties ?? {})) {
        if (!('type' in schema)) continue;
        if (schema.nullable && !schema.allOf && !schema.additionalProperties)
          expect(schema.type, `${name}.${field}`).not.toBe('object');
      }
    }
    const params = doc.paths['/api/v1/trips']!.get!.parameters!;
    for (const name of ['page', 'limit'])
      expect(params.find((param) => 'name' in param && param.name === name)).toHaveProperty(
        'schema.type',
        'number',
      );
    expect(doc.components!.schemas!.PhotoReferenceDto).toHaveProperty(
      'properties.isPublic.type',
      'boolean',
    );
  });

  it('не сохраняет комментарий записи после анонимизации уже авторизованного пользователя', async () => {
    const curator = await volunteer(),
      user = await volunteer();
    const { tripId } = await fixtureTrip(curator);
    const actor = await app.get(AuthService).authenticate(user.access);
    await app.get(MeService).anonymize(actor);
    await expect(
      app.get(TripsService).register(actor, tripId, 'Синтетический личный комментарий'),
    ).rejects.toMatchObject({ code: ErrorCode.ACCOUNT_BLOCKED });
    expect(await prisma.tripRegistration.count({ where: { tripId, userId: actor.id } })).toBe(0);
  });

  it('не восстанавливает анкету из запроса, начатого до удаления аккаунта', async () => {
    const user = await loginUser();
    await onboard(user.access);
    const actor = await app.get(AuthService).authenticate(user.access);
    await app.get(ApplicationsService).mine(actor);
    await app.get(MeService).anonymize(actor);
    await expect(
      app.get(ApplicationsService).questionnaire(actor, validQuestionnaire),
    ).rejects.toMatchObject({ code: ErrorCode.ACCOUNT_BLOCKED });
    expect(
      (await prisma.candidateApplication.findUniqueOrThrow({ where: { userId: actor.id } }))
        .questionnaire,
    ).toBeNull();
  });

  it('не отправляет напоминание из outbox после переноса поездки или отмены участия в ДОД', async () => {
    const curator = await volunteer();
    const participant = await volunteer();
    const { tripId } = await fixtureTrip(curator, 2);
    const startsAt = new Date(Date.now() + 3 * 3600000 - 1000);
    await prisma.trip.update({
      where: { id: tripId },
      data: { startsAt, endsAt: new Date(startsAt.getTime() + 3600000) },
    });
    await prisma.tripRegistration.create({
      data: { tripId, userId: curator.userId, status: 'CONFIRMED' },
    });
    await prisma.tripRegistration.create({
      data: { tripId, userId: participant.userId, status: 'CONFIRMED' },
    });
    const reminders = app.get(ReminderService),
      notifications = app.get(NotificationService);
    await reminders.process(
      {
        entity: 'trip',
        id: tripId,
        startsAt: startsAt.toISOString(),
        type: 'TripReminder3h',
        scheduledAt: startsAt.getTime() - 3 * 3600000,
      },
      `audit-${tripId}`,
    );
    const reminder = await prisma.notification.findFirstOrThrow({
      where: { userId: curator.userId, type: 'TripReminder3h', channel: 'TELEGRAM' },
    });
    const send = vi.spyOn(app.get(TelegramService), 'send').mockResolvedValue();
    const activeReminder = await prisma.notification.findFirstOrThrow({
      where: { userId: participant.userId, type: 'TripReminder3h', channel: 'TELEGRAM' },
    });
    await notifications.deliver(activeReminder.id, 'TELEGRAM');
    expect(send).toHaveBeenCalledOnce();
    send.mockClear();
    await prisma.trip.update({
      where: { id: tripId },
      data: {
        startsAt: new Date(startsAt.getTime() + 86400000),
        endsAt: new Date(startsAt.getTime() + 90000000),
      },
    });
    try {
      await notifications.deliver(reminder.id, 'TELEGRAM');
      expect(send).not.toHaveBeenCalled();
      expect(
        await prisma.notification.findUniqueOrThrow({ where: { id: reminder.id } }),
      ).toMatchObject({ status: 'FAILED', lastError: 'REMINDER_OBSOLETE' });
      const day = await prisma.openDaySession.create({
        data: {
          startsAt: new Date(Date.now() + 24 * 3600000 - 1000),
          location: 'Тест ДОД',
          capacity: 10,
        },
      });
      const registration = await prisma.openDayRegistration.create({
        data: { sessionId: day.id, userId: curator.userId },
      });
      await reminders.process(
        {
          entity: 'openDay',
          id: day.id,
          startsAt: day.startsAt.toISOString(),
          type: 'OpenDayReminder',
          scheduledAt: day.startsAt.getTime() - 24 * 3600000,
        },
        `audit-${day.id}`,
      );
      await prisma.openDayRegistration.update({
        where: { id: registration.id },
        data: { cancelledAt: new Date() },
      });
      const dayReminder = await prisma.notification.findFirstOrThrow({
        where: { userId: curator.userId, type: 'OpenDayReminder', channel: 'TELEGRAM' },
      });
      await notifications.deliver(dayReminder.id, 'TELEGRAM');
      expect(send).not.toHaveBeenCalled();
    } finally {
      send.mockRestore();
    }
  });

  it('не возвращает персональный комментарий после одновременной записи и удаления', async () => {
    const curator = await volunteer(),
      user = await volunteer();
    const { tripId } = await fixtureTrip(curator);
    const actor = await app.get(AuthService).authenticate(user.access);
    const results = await Promise.allSettled([
      app.get(TripsService).register(actor, tripId, 'Личный комментарий гонки'),
      app.get(MeService).anonymize(actor),
    ]);
    expect(results[1]!.status).toBe('fulfilled');
    expect(
      (await prisma.user.findUniqueOrThrow({ where: { id: actor.id } })).anonymizedAt,
    ).not.toBeNull();
    const rows = await prisma.tripRegistration.findMany({ where: { tripId, userId: actor.id } });
    expect(rows.every((row) => row.comment === null)).toBe(true);
  });

  it('отбрасывает просьбу об отчете после публикации или снятия куратора', async () => {
    const curator = await volunteer(),
      reminders = app.get(ReminderService),
      notifications = app.get(NotificationService);
    const send = vi.spyOn(app.get(TelegramService), 'send').mockResolvedValue();
    try {
      for (const published of [true, false]) {
        const { tripId } = await fixtureTrip(curator);
        const startsAt = new Date(Date.now() - 49 * 3600000),
          endsAt = new Date(Date.now() - 25 * 3600000);
        const trip = await prisma.trip.update({
          where: { id: tripId },
          data: { status: 'DONE', startsAt, endsAt },
        });
        await reminders.process(
          {
            entity: 'trip',
            id: tripId,
            startsAt: startsAt.toISOString(),
            type: 'ReportRequestedFromCurator',
            scheduledAt: endsAt.getTime() + 24 * 3600000,
          },
          `report-audit-${tripId}`,
        );
        const row = await prisma.notification.findFirstOrThrow({
          where: {
            userId: curator.userId,
            type: 'ReportRequestedFromCurator',
            payload: { path: ['tripId'], equals: tripId },
            channel: 'TELEGRAM',
          },
        });
        if (published) {
          await prisma.report.create({
            data: {
              tripId,
              authorId: curator.userId,
              text: 'Тест опубликованного отчета',
              hoursSpent: '2.00',
              publishedAt: new Date(),
            },
          });
        } else
          await prisma.placeCurator.delete({
            where: { userId_placeId: { userId: curator.userId, placeId: trip.placeId } },
          });
        await notifications.deliver(row.id, 'TELEGRAM');
        expect(
          (await prisma.notification.findUniqueOrThrow({ where: { id: row.id } })).lastError,
        ).toBe('REMINDER_OBSOLETE');
      }
      expect(send).not.toHaveBeenCalled();
    } finally {
      send.mockRestore();
    }
  });

  it('возвращает историю заявки при смене статуса администратором', async () => {
    const candidate = await loginUser();
    await onboard(candidate.access);
    const application = await req('put', '/me/application')
      .set('Authorization', `Bearer ${candidate.access}`)
      .send(validQuestionnaire);
    const admin = await administrator();
    const result = await req('post', `/admin/applications/${application.body.id}/status`)
      .set('Authorization', `Bearer ${admin.access}`)
      .send({ status: 'REJECTED', comment: 'Синтетическая причина отказа' });
    expect(result.status).toBe(200);
    expect(result.body.history).toEqual(
      expect.arrayContaining([expect.objectContaining({ toStatus: 'REJECTED' })]),
    );
  });

  it('отменяет предварительную сессию администратора при logout', async () => {
    const admin = await administrator();
    const login = await loginUser(admin.id);
    const challenge = rawCookie(login.result, 'club_admin_challenge');
    const code = /\b\d{6}\b/.exec(mails.at(-1)!.text)![0];
    expect((await req('post', '/auth/logout').set('Cookie', challenge).send({})).status).toBe(200);
    expect(
      (await req('post', '/auth/admin/verify-code').set('Cookie', challenge).send({ code })).body
        .code,
    ).toBe(ErrorCode.ADMIN_CODE_INVALID);
  });

  it('повторно принимает тот же Telegram-контакт, если сообщение с кнопками нужно отправить заново', async () => {
    const login = await start(),
      id = telegramId(),
      auth = app.get(AuthService);
    await auth.bindChat(login.token, id);
    const contact = {
      telegramId: id,
      contactUserId: id,
      chatId: id,
      phone: '+70000000001',
      fullName: 'Тест повтора контакта',
    };
    const first = await auth.receiveContact(contact);
    expect((await auth.receiveContact(contact)).id).toBe(first.id);
    expect(
      await prisma.auditLog.count({
        where: { entity: 'LoginToken', entityId: first.id, action: 'STATUS_CHANGED' },
      }),
    ).toBe(1);
  });
});

describe('Контент, статистика и инфраструктура', () => {
  it('доставляет DB-outbox через настоящий BullMQ worker в SMTP', async () => {
    const user = await prisma.user.create({
      data: {
        telegramId: BigInt(telegramId()),
        fullName: 'Получатель очереди',
        email: `queue${++sequence}@example.test`,
        emailVerifiedAt: new Date(),
      },
    });
    const notifications = app.get(NotificationService);
    await prisma.$transaction((tx) =>
      notifications.notify(tx, [user.id], 'EventRegistered', {
        title: 'Проверка настоящего воркера',
      }),
    );
    const row = await prisma.notification.findFirstOrThrow({
      where: { userId: user.id, channel: 'EMAIL' },
    });
    const worker = new Worker(
      'notifications-email',
      (job) => notifications.deliver(job.data.id, 'EMAIL'),
      { connection: redis.connection, prefix: redis.prefix, concurrency: 1 },
    );
    worker.on('error', () => {});
    try {
      await notifications.dispatch();
      let status = 'QUEUED';
      for (let attempt = 0; attempt < 100 && status === 'QUEUED'; attempt++) {
        await new Promise((resolve) => setTimeout(resolve, 50));
        status = (await prisma.notification.findUniqueOrThrow({ where: { id: row.id } })).status;
      }
      expect(status).toBe('SENT');
      expect(
        (await prisma.notification.findUniqueOrThrow({ where: { id: row.id } })).attempts,
      ).toBe(1);
    } finally {
      await worker.close();
    }
  });

  it('шифрует auth-mail в Redis и пропускает письма заблокированным получателям', async () => {
    const user = await prisma.user.create({
      data: { telegramId: BigInt(telegramId()), fullName: 'Тест почты', isBlocked: true },
    });
    const queues = new QueuesService(redis, { offline: false, workers: true, telegram: false });
    const mail = new AuthMailService(queues, crypto, app.get(MailService), prisma);
    const delivered = vi.spyOn(app.get(MailService), 'deliver');
    try {
      mail.onModuleInit();
      await mail.send('blocked@example.test', 'Проверка', 'Синтетический код 987654', user.id);
      const queue = queues.queue('auth-mail');
      let completed = 0;
      for (let attempt = 0; attempt < 100 && !completed; attempt++) {
        await new Promise((resolve) => setTimeout(resolve, 50));
        completed = await queue.getCompletedCount();
      }
      expect(completed).toBe(1);
      const jobs = await queue.getCompleted();
      expect(JSON.stringify(jobs[0]!.data)).not.toContain('987654');
      expect(JSON.stringify(jobs[0]!.data)).not.toContain('blocked@example.test');
      expect(delivered).not.toHaveBeenCalled();
    } finally {
      await queues.onModuleDestroy();
      delivered.mockRestore();
    }
  });
  it('отзывает старые сессии и коды администратора после подтвержденной смены e-mail', async () => {
    const admin = await administrator();
    const challenge = await loginUser(admin.id);
    const code = /\b\d{6}\b/.exec(mails.at(-1)!.text)![0];
    const preliminary = rawCookie(challenge.result, 'club_admin_challenge');
    expect(
      (
        await req('post', '/me/email')
          .set('Authorization', `Bearer ${admin.access}`)
          .send({ email: `changed${++sequence}@example.test` })
      ).status,
    ).toBe(200);
    const token = /token=([A-Za-z0-9_-]{43})/.exec(mails.at(-1)!.text)![1];
    expect((await req('get', `/auth/verify-email?token=${token}`)).status).toBe(200);
    expect(
      (await req('get', '/admin/users').set('Authorization', `Bearer ${admin.access}`)).status,
    ).toBe(401);
    expect(
      (await req('post', '/auth/admin/verify-code').set('Cookie', preliminary).send({ code })).body
        .code,
    ).toBe(ErrorCode.ADMIN_CODE_INVALID);
  });

  it('не принимает просроченный резервный e-mail-код', async () => {
    const user = await loginUser();
    const email = `expired${++sequence}@example.test`;
    const row = await prisma.user.update({
      where: { telegramId: BigInt(user.id) },
      data: { email, emailVerifiedAt: new Date() },
    });
    expect((await req('post', '/auth/email/login-code').send({ email })).status).toBe(200);
    const code = /\b\d{6}\b/.exec(mails.at(-1)!.text)![0];
    await prisma.emailLoginCode.updateMany({
      where: { userId: row.id },
      data: { expiresAt: new Date(Date.now() - 1000) },
    });
    expect((await req('post', '/auth/email/verify').send({ email, code })).status).toBe(401);
  });
  it('отзывает все семейство при конкурентном использовании одного refresh', async () => {
    const user = await loginUser();
    const old = rawCookie(user.result, 'club_refresh');
    const responses = await Promise.all([
      req('post', '/auth/refresh').set('Cookie', old).send({}),
      req('post', '/auth/refresh').set('Cookie', old).send({}),
    ]);
    expect(responses.map((response) => response.status).sort()).toEqual([200, 401]);
    const success = responses.find((response) => response.status === 200)!;
    expect(
      (await req('get', '/me').set('Authorization', `Bearer ${success.body.accessToken}`)).status,
    ).toBe(401);
  });

  it('разрешает посещение ДОД до анкеты и принятие после ее заполнения', async () => {
    const candidate = await loginUser();
    await onboard(candidate.access);
    const admin = await administrator();
    const user = await prisma.user.findUniqueOrThrow({
      where: { telegramId: BigInt(candidate.id) },
    });
    const day = await prisma.openDaySession.create({
      data: { startsAt: new Date(Date.now() - 86400000), location: 'Тестовый клуб', capacity: 10 },
    });
    expect(
      (
        await req('post', `/admin/open-days/${day.id}/attendance`)
          .set('Authorization', `Bearer ${admin.access}`)
          .send({ userId: user.id, attended: true })
      ).status,
    ).toBe(200);
    const application = await req('put', '/me/application')
      .set('Authorization', `Bearer ${candidate.access}`)
      .send({
        motivation: 'Хочу регулярно помогать участникам клубных программ.',
        volunteeringExperience: 'Опыта пока нет.',
        helpAreas: ['EDUCATION'],
        availableWeekdays: ['SATURDAY'],
        referralSource: 'Друзья',
        rulesAccepted: true,
      });
    expect(application.status).toBe(200);
    expect(
      (
        await req('post', `/admin/applications/${application.body.id}/status`)
          .set('Authorization', `Bearer ${admin.access}`)
          .send({ status: 'ACCEPTED' })
      ).status,
    ).toBe(200);
    expect(
      (await req('get', '/me').set('Authorization', `Bearer ${candidate.access}`)).body.role,
    ).toBe('VOLUNTEER');
  });
  it('проверяет все контентные CRUD, строгие DTO и санитизацию HTML', async () => {
    const admin = await administrator();
    const authorized = (method: 'get' | 'post' | 'patch' | 'delete', path: string) =>
      req(method, path).set('Authorization', `Bearer ${admin.access}`);
    const slug = `content-${++sequence}`;
    const page = {
      slug,
      title: 'Тестовый материал',
      bodyHtml:
        '<p onclick="alert(1)">Текст</p><script>alert(1)</script><a href="javascript:alert(1)">Ссылка</a>',
    };
    const album = await authorized('post', '/admin/albums').send({
      slug,
      title: 'Альбом',
      publishedAt: new Date().toISOString(),
    });
    expect(album.status).toBe(201);
    const fixtures = [
      {
        name: 'news',
        data: { ...page, excerpt: 'Анонс', status: 'DRAFT' },
        patch: { title: 'Измененная новость' },
      },
      { name: 'pages', data: page, patch: { title: 'Измененная страница' } },
      {
        name: 'media-items',
        data: { albumId: album.body.id, type: 'VIDEO', url: 'https://example.test/video.mp4' },
        patch: { caption: 'Видео клуба' },
      },
      { name: 'interviews', data: page, patch: { title: 'Измененное интервью' } },
      { name: 'projects', data: page, patch: { title: 'Измененный проект' } },
      { name: 'partners', data: { slug, name: 'Партнер' }, patch: { name: 'Новый партнер' } },
      {
        name: 'press',
        data: {
          title: 'Публикация',
          outlet: 'Издание',
          url: 'https://example.test/article',
          publishedAt: new Date().toISOString(),
        },
        patch: { title: 'Новая публикация' },
      },
      {
        name: 'club-reports',
        data: {
          title: 'Годовой отчет',
          year: 2026,
          fileUrl: 'https://example.test/report.pdf',
          publishedAt: new Date().toISOString(),
        },
        patch: { title: 'Обновленный отчет' },
      },
      {
        name: 'donations',
        data: { amount: '123.45', receivedAt: new Date().toISOString() },
        patch: { note: 'Ручной учет' },
      },
    ];
    for (const fixture of fixtures) {
      const base = `/admin/${fixture.name}`;
      const created = await authorized('post', base).send(fixture.data);
      expect(created.status, fixture.name).toBe(201);
      if ('bodyHtml' in fixture.data) {
        expect(created.body.bodyHtml).not.toMatch(/script|onclick|javascript:/);
        expect(created.body.bodyHtml).toContain('<p>Текст</p>');
      }
      const target = `${base}/${created.body.id}`;
      expect((await authorized('get', target)).status).toBe(200);
      expect((await authorized('get', `${base}?page=1&limit=1`)).body.limit).toBe(1);
      const changed = await authorized('patch', target).send(fixture.patch);
      expect(changed.status, fixture.name).toBe(200);
      for (const [key, value] of Object.entries(fixture.patch))
        expect(changed.body[key]).toBe(value);
      if (fixture.name === 'news') {
        expect((await req('get', `/news/${slug}`)).status).toBe(404);
        expect((await authorized('patch', target).send({ status: 'PUBLISHED' })).status).toBe(200);
        expect((await req('get', `/news/${slug}`)).status).toBe(200);
        expect((await authorized('patch', target).send({ status: 'DRAFT' })).body.code).toBe(
          ErrorCode.INVALID_TRANSITION,
        );
      }
      expect((await authorized('delete', target)).status).toBe(200);
      expect((await authorized('get', target)).status).toBe(404);
    }
    expect(
      (
        await authorized('patch', `/admin/albums/${album.body.id}`).send({
          description: 'Описание',
        })
      ).status,
    ).toBe(200);
    expect((await authorized('delete', `/admin/albums/${album.body.id}`)).status).toBe(200);
    expect(
      (await authorized('post', '/admin/pages').send({ ...page, role: 'ADMIN' })).body.code,
    ).toBe(ErrorCode.VALIDATION_ERROR);
    expect(
      (
        await authorized('post', '/admin/donations').send({
          amount: '-5',
          receivedAt: new Date().toISOString(),
        })
      ).status,
    ).toBe(400);
    expect(
      (
        await authorized('post', '/admin/donations').send({
          amount: '1000000000000',
          receivedAt: new Date().toISOString(),
        })
      ).body.code,
    ).toBe(ErrorCode.VALIDATION_ERROR);
    expect((await req('get', '/admin/pages')).status).toBe(401);
  });

  it('обрабатывает обращение с согласием, переходами и ограничением отправок', async () => {
    const admin = await administrator();
    const body = {
      name: 'Тестовый гость',
      contact: 'test@example.test',
      message: 'Хочу узнать подробнее о работе клуба.',
      personalDataConsent: true,
      consentVersion: CONSENT_VERSION,
    };
    const first = await req('post', '/contact-requests').send(body);
    expect(first.status).toBe(201);
    const row = await prisma.contactRequest.findFirstOrThrow({ where: { contact: body.contact } });
    expect(row.consentVersion).toBe(CONSENT_VERSION);
    expect(
      (
        await req('patch', `/admin/contact-requests/${row.id}`)
          .set('Authorization', `Bearer ${admin.access}`)
          .send({ status: 'DONE', adminNote: 'Обработано' })
      ).status,
    ).toBe(200);
    expect(
      (
        await req('patch', `/admin/contact-requests/${row.id}`)
          .set('Authorization', `Bearer ${admin.access}`)
          .send({ status: 'NEW' })
      ).body.code,
    ).toBe(ErrorCode.INVALID_TRANSITION);
    await req('post', '/contact-requests').send(body);
    await req('post', '/contact-requests').send(body);
    expect((await req('post', '/contact-requests').send(body)).status).toBe(429);
  });

  it('применяет переопределения к кэшу, принимает ноль и сбрасывает null', async () => {
    const admin = await administrator();
    await redis.client.del(redis.key('public-stats'));
    const original = await req('get', '/public/stats');
    expect(original.status).toBe(200);
    expect(Object.keys(original.body)).toHaveLength(7);
    const write = (items: object[]) =>
      req('put', '/admin/stat-overrides')
        .set('Authorization', `Bearer ${admin.access}`)
        .send({ items });
    expect((await write([{ key: 'beneficiaries', value: 0 }])).status).toBe(200);
    expect((await req('get', '/public/stats')).body.beneficiaries).toBe(0);
    expect((await write([{ key: 'beneficiaries', value: 777 }])).status).toBe(200);
    expect((await req('get', '/public/stats')).body.beneficiaries).toBe(777);
    expect((await write([{ key: 'beneficiaries', value: null }])).status).toBe(200);
    expect((await req('get', '/public/stats')).body.beneficiaries).toBe(
      original.body.beneficiaries,
    );
    expect((await write([{ key: 'beneficiaries', value: -1 }])).status).toBe(400);
  });

  it('проводит кандидата через учебный каталог, запись, личный кабинет и отмену без обхода прав', async () => {
    const eventId = 'd30e0000-0000-4000-8000-000000000301';
    const volunteerEventId = 'd30e0000-0000-4000-8000-000000000303';
    const dayId = 'd30e0000-0000-4000-8000-000000000501';
    const places = await req('get', '/places?search=Демо:');
    expect(places.status).toBe(200);
    const place = places.body.items.find((row: { slug: string }) => row.slug === 'edu-solnechny');
    expect(place).toBeDefined();
    const needs = await req('get', `/needs?placeId=${place.id}`);
    expect(needs.status).toBe(200);
    expect(needs.body.total).toBe(3);
    const calendar = await req('get', '/public/calendar');
    expect(calendar.body.items.some((row: { id: string }) => row.id === eventId)).toBe(true);
    expect((await req('post', `/events/${eventId}/register`).send({})).status).toBe(401);
    const candidate = await loginUser();
    expect(
      (
        await req('post', `/events/${eventId}/register`)
          .set('Authorization', `Bearer ${candidate.access}`)
          .send({})
      ).body.code,
    ).toBe(ErrorCode.ONBOARDING_REQUIRED);
    await onboard(candidate.access);
    const auth = { Authorization: `Bearer ${candidate.access}` };
    expect((await req('post', `/events/${eventId}/register`).set(auth).send({})).status).toBe(201);
    expect((await req('post', `/me/open-days/${dayId}/register`).set(auth).send({})).status).toBe(
      201,
    );
    expect(
      (await req('post', `/events/${volunteerEventId}/register`).set(auth).send({})).body.code,
    ).toBe(ErrorCode.EVENT_VOLUNTEERS_ONLY);
    expect(
      (await req('post', '/trips/d30e0000-0000-4000-8000-000000000401/register').set(auth).send({}))
        .status,
    ).toBe(403);
    const registrations = await req('get', '/me/registrations').set(auth);
    expect(registrations.status).toBe(200);
    expect(registrations.body.items).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ kind: 'EVENT', entityId: eventId, status: 'CONFIRMED' }),
        expect.objectContaining({ kind: 'OPEN_DAY', entityId: dayId, cancelledAt: null }),
      ]),
    );
    expect((await req('delete', `/events/${eventId}/register`).set(auth)).status).toBe(200);
    expect((await req('delete', `/me/open-days/${dayId}/register`).set(auth)).status).toBe(200);
    const cancelled = await req('get', '/me/registrations').set(auth);
    expect(
      cancelled.body.items.find((row: { entityId: string }) => row.entityId === eventId).status,
    ).toBe('CANCELLED');
    expect(
      cancelled.body.items.find((row: { entityId: string }) => row.entityId === dayId).cancelledAt,
    ).not.toBeNull();
  });

  it('создает seed повторяемо и сохраняет изменения, не подделывая телефон/согласие администратора', async () => {
    const env = {
      ...getEnvironment(),
      ADMIN_TELEGRAM_ID: telegramId(),
      ADMIN_EMAIL: `seed${++sequence}@example.test`,
    };
    await seed(prisma, env);
    const admin = await prisma.user.findUniqueOrThrow({
      where: { telegramId: BigInt(env.ADMIN_TELEGRAM_ID) },
    });
    expect(admin.role).toBe('ADMIN');
    expect(admin.emailVerifiedAt).not.toBeNull();
    expect(admin.phone).toBeNull();
    expect(admin.consentAt).toBeNull();
    expect(admin.birthDate).toBeNull();
    await prisma.place.update({
      where: { slug: 'demo-place-1' },
      data: { name: 'Правка администратора' },
    });
    await seed(prisma, env);
    expect((await prisma.place.findUniqueOrThrow({ where: { slug: 'demo-place-1' } })).name).toBe(
      'Правка администратора',
    );
    expect(await prisma.place.count({ where: { slug: { startsWith: 'demo-place-' } } })).toBe(8);
    expect(
      await prisma.place.count({
        where: { slug: { startsWith: 'demo-place-' }, type: 'YARD_PROGRAM' },
      }),
    ).toBe(2);
    expect(await prisma.newsPost.count({ where: { slug: { startsWith: 'demo-news-' } } })).toBe(3);
    expect(await prisma.trip.count({ where: { createdById: admin.id } })).toBe(3);
    expect(await prisma.event.count({ where: { createdById: admin.id } })).toBe(3);
  });

  it('сохраняет раздельные Swagger-схемы страницы, пагинации и факта ДОД', () => {
    const doc = createOpenApiDocument(app);
    const schemas = doc.components!.schemas!;
    expect(schemas.PageResponseDto).toHaveProperty('properties.bodyHtml');
    expect(schemas.PaginationMetaDto).toHaveProperty('properties.total');
    expect(schemas.OpenDayRegistrationResponseDto).toHaveProperty('properties.attended');
    expect(schemas.OpenDayRegistrationResponseDto).not.toHaveProperty('properties.status');
    for (const path of [
      '/auth/telegram/start',
      '/auth/telegram/status',
      '/auth/admin/verify-code',
      '/admin/donations',
      '/public/stats',
      '/uploads/presign',
    ])
      expect(doc.paths[`/api/v1${path}`]).toBeDefined();
    const operationIds = Object.values(doc.paths).flatMap((path) =>
      Object.values(path ?? {})
        .filter((item) => typeof item === 'object' && item && 'operationId' in item)
        .map((item) => item.operationId),
    );
    expect(new Set(operationIds).size).toBe(operationIds.length);
  });

  it('загружает в MinIO с подписанной политикой и закрывает приватные фото отчета', async () => {
    const curator = await volunteer();
    const place = await fixturePlace(curator.userId);
    const trip = await prisma.trip.create({
      data: {
        placeId: place.id,
        createdById: curator.userId,
        title: 'Поездка с фото',
        description: '',
        startsAt: new Date(Date.now() - 7200000),
        endsAt: new Date(Date.now() - 3600000),
        meetingPoint: 'Закрытый сбор',
        capacity: 2,
        status: 'DONE',
      },
    });
    const png = Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+j5YQAAAAASUVORK5CYII=',
      'base64',
    );
    const sign = async (sizeBytes = png.length, contentType = 'image/png') =>
      req('post', '/uploads/presign')
        .set('Authorization', `Bearer ${curator.access}`)
        .send({ purpose: 'REPORT_PHOTO', tripId: trip.id, contentType, sizeBytes });
    expect((await sign(11 * 1024 * 1024)).status).toBe(400);
    expect((await sign(10, 'image/svg+xml')).status).toBe(400);
    const signed = await sign();
    expect(signed.status).toBe(200);
    const upload = async (data: Buffer, mime = 'image/png') => {
      const form = new FormData();
      for (const [key, value] of Object.entries(signed.body.fields)) form.set(key, value as string);
      form.set('Content-Type', mime);
      form.set('file', new Blob([new Uint8Array(data)], { type: mime }), 'image.png');
      return fetch(signed.body.url, { method: 'POST', body: form });
    };
    expect((await upload(Buffer.alloc(png.length + 1))).ok).toBe(false);
    expect((await upload(png, 'image/jpeg')).ok).toBe(false);
    expect((await upload(Buffer.alloc(png.length))).ok).toBe(true);
    const reportPath = `/curator/trips/${trip.id}/report`;
    const report = (isPublic = false) =>
      req('put', reportPath)
        .set('Authorization', `Bearer ${curator.access}`)
        .send({
          text: 'Провели творческие занятия с участниками программы.',
          hoursSpent: 2.5,
          photos: [{ uploadId: signed.body.uploadId, isPublic }],
        });
    expect((await report()).body.code).toBe(ErrorCode.VALIDATION_ERROR);
    expect((await upload(png)).ok).toBe(true);
    expect((await report()).status).toBe(200);
    const filePath = `/files/${signed.body.uploadId}`;
    expect((await req('get', filePath)).status).toBe(403);
    expect(
      (await req('get', filePath).set('Authorization', `Bearer ${curator.access}`)).status,
    ).toBe(302);
    const publicReports = await req('get', '/public/reports?limit=100');
    expect(
      publicReports.body.items.find((item: { tripId?: string }) => item.tripId === trip.id).photos,
    ).toHaveLength(0);
    expect((await report(true)).status).toBe(200);
    expect((await req('get', filePath)).status).toBe(302);
    const candidate = await loginUser();
    await prisma.user.update({
      where: { telegramId: BigInt(candidate.id) },
      data: { role: 'VOLUNTEER' },
    });
    expect(
      (await req('get', `/places/${place.slug}`).set('Authorization', `Bearer ${candidate.access}`))
        .body.address,
    ).toBeUndefined();
    const other = await volunteer();
    await prisma.report.update({ where: { tripId: trip.id }, data: { authorId: other.userId } });
    expect(
      (await req('delete', '/me').set('Authorization', `Bearer ${curator.access}`)).status,
    ).toBe(200);
    expect(await prisma.reportPhoto.count({ where: { report: { tripId: trip.id } } })).toBe(0);
    expect(await prisma.report.count({ where: { tripId: trip.id } })).toBe(1);
    expect((await req('get', filePath)).status).toBe(404);
  });

  it('доставляет письмо в локальный SMTP Mailpit', async () => {
    const subject = `club-smtp-test-${Date.now()}`;
    await app
      .get(MailService)
      .deliver('integration@example.test', subject, 'Тестовая доставка без персональных данных.');
    const response = await fetch('http://localhost:8025/api/v1/messages');
    expect(response.ok).toBe(true);
    const data = (await response.json()) as { messages: Array<{ Subject: string }> };
    expect(data.messages.some((message) => message.Subject === subject)).toBe(true);
  });

  it('ограничивает доставку пятью попытками, учитывает retry_after и не дублирует IN_APP', async () => {
    const user = await volunteer();
    const notifications = app.get(NotificationService);
    for (let index = 0; index < 2; index++)
      await prisma.$transaction((tx) =>
        notifications.notify(
          tx,
          [user.userId],
          'RegistrationConfirmed',
          { tripId: crypto.random() },
          `retry-${user.userId}`,
        ),
      );
    const row = await prisma.notification.findFirstOrThrow({
      where: { userId: user.userId, channel: 'TELEGRAM' },
    });
    const send = vi.spyOn(app.get(TelegramService), 'send').mockRejectedValue(
      new GrammyError(
        'sendMessage',
        {
          ok: false,
          error_code: 429,
          description: 'Too Many Requests',
          parameters: { retry_after: 4 },
        },
        'sendMessage',
        {},
      ),
    );
    try {
      for (let index = 0; index < 5; index++)
        await expect(notifications.deliver(row.id, 'TELEGRAM')).rejects.toHaveProperty(
          'retryAfterMs',
          Math.max(4000, 1000 * 2 ** index),
        );
      await notifications.deliver(row.id, 'TELEGRAM');
      expect(send).toHaveBeenCalledTimes(5);
      expect(await prisma.notification.findUniqueOrThrow({ where: { id: row.id } })).toMatchObject({
        status: 'FAILED',
        attempts: 5,
        lastError: 'TELEGRAM_429',
      });
      expect(
        await prisma.notification.count({ where: { userId: user.userId, channel: 'IN_APP' } }),
      ).toBe(1);
    } finally {
      send.mockRestore();
    }
  });

  it('отбрасывает напоминания от прежней даты и дедуплицирует актуальные', async () => {
    const user = await volunteer();
    const place = await fixturePlace(user.userId);
    const startsAt = new Date(Date.now() + 3 * 3600000),
      endsAt = new Date(startsAt.getTime() + 3600000);
    const trip = await prisma.trip.create({
      data: {
        placeId: place.id,
        createdById: user.userId,
        title: 'Перенос поездки',
        description: '',
        startsAt,
        endsAt,
        meetingPoint: 'Закрытый сбор',
        capacity: 1,
        status: 'OPEN',
      },
    });
    await prisma.tripRegistration.create({
      data: { tripId: trip.id, userId: user.userId, status: 'CONFIRMED' },
    });
    const reminders = app.get(ReminderService);
    const old = {
      entity: 'trip' as const,
      id: trip.id,
      startsAt: startsAt.toISOString(),
      type: 'TripReminder3h' as const,
      scheduledAt: startsAt.getTime() - 3 * 3600000,
    };
    const moved = new Date(startsAt.getTime() + 3600000);
    await prisma.trip.update({
      where: { id: trip.id },
      data: { startsAt: moved, endsAt: new Date(endsAt.getTime() + 3600000) },
    });
    await reminders.process(old, `old-${trip.id}`);
    expect(
      await prisma.notification.count({ where: { userId: user.userId, type: 'TripReminder3h' } }),
    ).toBe(0);
    const current = {
      ...old,
      startsAt: moved.toISOString(),
      scheduledAt: moved.getTime() - 3 * 3600000,
    };
    await reminders.process(current, `new-${trip.id}`);
    await reminders.process(current, `new-${trip.id}`);
    expect(
      await prisma.notification.count({
        where: { userId: user.userId, type: 'TripReminder3h', channel: 'IN_APP' },
      }),
    ).toBe(1);
  });
});

describe('Авторизация Telegram', () => {
  it('не выдает сессию заблокированному пользователю', async () => {
    const id = telegramId();
    await prisma.user.create({
      data: {
        telegramId: BigInt(id),
        phone: '+70000000002',
        fullName: 'Участник',
        isBlocked: true,
      },
    });
    const login = await start();
    const response = await req('post', '/dev/telegram/confirm').send({
      token: login.token,
      telegramId: id,
      phone: '+70000000002',
      fullName: 'Участник',
    });
    expect(response.body.code).toBe(ErrorCode.ACCOUNT_BLOCKED);
  });
  it('требует подтвержденный e-mail администратора и исчерпывает пять попыток кода', async () => {
    const id = telegramId();
    const admin = await prisma.user.create({
      data: {
        telegramId: BigInt(id),
        phone: '+70000000002',
        fullName: 'Администратор',
        role: 'ADMIN',
      },
    });
    const missing = await start();
    await req('post', '/dev/telegram/confirm').send({
      token: missing.token,
      telegramId: id,
      phone: '+70000000002',
      fullName: 'Администратор',
    });
    expect((await poll(missing)).body.code).toBe(ErrorCode.ADMIN_EMAIL_REQUIRED);
    await prisma.user.update({
      where: { id: admin.id },
      data: { email: `admin${id}@example.test`, emailVerifiedAt: new Date() },
    });
    const login = await loginUser(id),
      preliminary = rawCookie(login.result, 'club_admin_challenge');
    const good = /\b\d{6}\b/.exec(mails.at(-1)!.text)![0],
      wrong = good === '000000' ? '999999' : '000000';
    for (let index = 0; index < 5; index++)
      expect(
        (
          await req('post', '/auth/admin/verify-code')
            .set('Cookie', preliminary)
            .send({ code: wrong })
        ).body.code,
      ).toBe(ErrorCode.ADMIN_CODE_INVALID);
    expect(
      (await req('post', '/auth/admin/verify-code').set('Cookie', preliminary).send({ code: good }))
        .body.code,
    ).toBe(ErrorCode.ADMIN_CODE_INVALID);
    expect(
      (
        await prisma.adminLoginCode.findFirstOrThrow({
          where: { userId: admin.id },
          orderBy: { createdAt: 'desc' },
        })
      ).attempts,
    ).toBe(5);
  });
  it('не принимает refresh-cookie с чужим Origin', async () => {
    const user = await loginUser();
    const response = await api()
      .post('/api/v1/auth/refresh')
      .set('Cookie', rawCookie(user.result, 'club_refresh'))
      .set('Origin', 'https://untrusted.example')
      .set('User-Agent', agent)
      .send({});
    expect(response.status).toBe(403);
  });
  it('выполняет привязку e-mail и резервный вход, запрещая его администратору', async () => {
    const user = await loginUser(),
      email = `person${user.id}@example.test`;
    await req('post', '/me/onboarding')
      .set('Authorization', `Bearer ${user.access}`)
      .send({ birthDate: '1990-01-01', consentVersion: CONSENT_VERSION });
    expect(
      (await req('post', '/me/email').set('Authorization', `Bearer ${user.access}`).send({ email }))
        .status,
    ).toBe(200);
    const token = /token=([A-Za-z0-9_-]{43})/.exec(mails.at(-1)!.text)![1];
    expect((await req('get', `/auth/verify-email?token=${token}`)).status).toBe(200);
    expect((await req('get', `/auth/verify-email?token=${token}`)).body.code).toBe(
      ErrorCode.LOGIN_TOKEN_INVALID,
    );
    await req('post', '/auth/email/login-code').send({ email });
    const code = /\b\d{6}\b/.exec(mails.at(-1)!.text)![0];
    const reserve = await req('post', '/auth/email/verify').send({ email, code });
    expect(reserve.body.accessToken).toBeTypeOf('string');
    expect((await req('post', '/auth/email/verify').send({ email, code })).status).toBe(401);
    const adminId = telegramId();
    const adminEmail = `admin${adminId}@example.test`;
    await prisma.user.create({
      data: {
        telegramId: BigInt(adminId),
        phone: '+70000000002',
        fullName: 'Администратор',
        role: 'ADMIN',
        email: adminEmail,
        emailVerifiedAt: new Date(),
      },
    });
    const before = mails.length;
    await req('post', '/auth/email/login-code').send({ email: adminEmail });
    expect(mails).toHaveLength(before);
    expect(
      (await req('post', '/auth/email/verify').send({ email: adminEmail, code: '123456' })).status,
    ).toBe(401);
  });
  it('анонимизирует аккаунт, отзывает сессии и не объединяет повторный вход с историей', async () => {
    const user = await loginUser();
    const before = await prisma.user.findUniqueOrThrow({ where: { telegramId: BigInt(user.id) } });
    expect((await req('delete', '/me').set('Authorization', `Bearer ${user.access}`)).status).toBe(
      200,
    );
    const row = await prisma.user.findUniqueOrThrow({ where: { id: before.id } });
    expect(row.telegramId).toBeNull();
    expect(row.phone).toBeNull();
    expect(row.fullName).toBe('Удаленный пользователь');
    expect((await req('get', '/me').set('Authorization', `Bearer ${user.access}`)).status).toBe(
      401,
    );
    const again = await loginUser(user.id);
    const profile = await req('get', '/me').set('Authorization', `Bearer ${again.access}`);
    expect(profile.body.id).not.toBe(before.id);
  });
  it('принимает только собственный контакт', async () => {
    const login = await start(),
      id = telegramId();
    const response = await req('post', '/dev/telegram/confirm').send({
      token: login.token,
      telegramId: id,
      contactUserId: telegramId(),
      phone: '+70000000001',
      fullName: 'Участник',
    });
    expect(response.body.code).toBe(ErrorCode.TELEGRAM_CONTACT_MISMATCH);
    expect((await poll(login)).body.status).toBe('PENDING');
    expect(await prisma.user.findUnique({ where: { telegramId: BigInt(id) } })).toBeNull();
  });
  it('разделяет контакт и подтверждение устройства, выдает сессию один раз', async () => {
    const login = await start(),
      id = telegramId();
    const contact = await req('post', '/dev/telegram/confirm').send({
      token: login.token,
      telegramId: id,
      phone: '+70000000001',
      fullName: 'Участник',
      contactOnly: true,
    });
    expect(contact.body.status).toBe('CONTACT_RECEIVED');
    expect((await poll(login)).body.status).toBe('CONTACT_RECEIVED');
    const token = await prisma.loginToken.findUniqueOrThrow({
      where: { tokenHash: crypto.hash(login.token) },
    });
    const auth = app.get((await import('../dist/auth/auth.service.js')).AuthService);
    await auth.confirmDevice(token.id, id, true);
    const result = await poll(login);
    expect(result.body.accessToken).toBeTypeOf('string');
    expect(result.headers['set-cookie']?.[0]).toMatch(/HttpOnly/);
    expect(result.headers['set-cookie']?.[0]).toMatch(/Secure/);
    expect(result.headers['set-cookie']?.[0]).toMatch(/SameSite=Lax/);
    expect((await poll(login)).body.code).toBe(ErrorCode.LOGIN_TOKEN_INVALID);
  });
  it('отклоняет истекший токен и отказ «Нет»', async () => {
    const login = await start();
    await prisma.loginToken.update({
      where: { tokenHash: crypto.hash(login.token) },
      data: { expiresAt: new Date(Date.now() - 1000) },
    });
    expect((await poll(login)).body.code).toBe(ErrorCode.LOGIN_TOKEN_EXPIRED);
    const declined = await start();
    await req('post', '/dev/telegram/confirm').send({
      token: declined.token,
      telegramId: telegramId(),
      phone: '+70000000001',
      fullName: 'Участник',
      confirm: false,
    });
    expect((await poll(declined)).body.code).toBe(ErrorCode.LOGIN_TOKEN_INVALID);
  });
  it('сохраняет пять ошибочных pollSecret и после этого не принимает верный', async () => {
    const login = await start();
    for (let index = 0; index < 5; index++)
      expect((await poll(login, 'incorrect')).body.code).toBe(ErrorCode.LOGIN_TOKEN_INVALID);
    expect(
      (
        await prisma.loginToken.findUniqueOrThrow({
          where: { tokenHash: crypto.hash(login.token) },
        })
      ).attempts,
    ).toBe(5);
    expect((await poll(login)).body.code).toBe(ErrorCode.LOGIN_TOKEN_INVALID);
  });
  it('ограничивает опрос одной секундой и общим бюджетом 200', async () => {
    const login = await start();
    expect((await poll(login)).status).toBe(200);
    expect(
      (
        await req('get', `/auth/telegram/status?token=${login.token}`).set(
          'X-Poll-Secret',
          login.pollSecret,
        )
      ).status,
    ).toBe(429);
    await redis.client.set(redis.key(`poll-total:${crypto.hash(login.token)}`), '200', 'EX', 300);
    expect((await poll(login)).status).toBe(429);
  });
  it('ротирует refresh и при повторном использовании отзывает все семейство', async () => {
    const user = await loginUser(),
      old = rawCookie(user.result, 'club_refresh');
    const rotated = await req('post', '/auth/refresh').set('Cookie', old).send({});
    expect(rotated.status).toBe(200);
    expect((await req('post', '/auth/refresh').set('Cookie', old).send({})).status).toBe(401);
    expect(
      (await req('get', '/me').set('Authorization', `Bearer ${rotated.body.accessToken}`)).status,
    ).toBe(401);
  });
  it('не пропускает предварительную сессию администратора без кода', async () => {
    const id = telegramId();
    await prisma.user.create({
      data: {
        telegramId: BigInt(id),
        phone: '+70000000002',
        fullName: 'Тестовый администратор',
        role: 'ADMIN',
        email: `admin${id}@example.test`,
        emailVerifiedAt: new Date(),
      },
    });
    const user = await loginUser(id);
    expect(user.result.body.nextStep).toBe('ADMIN_EMAIL_CODE');
    expect(user.result.body.accessToken).toBeUndefined();
    const preliminary = rawCookie(user.result, 'club_admin_challenge');
    expect(preliminary).toContain('club_admin_challenge=');
    const code = /\b\d{6}\b/.exec(mails.at(-1)!.text)![0];
    const verified = await req('post', '/auth/admin/verify-code')
      .set('Cookie', preliminary)
      .send({ code });
    expect(verified.status).toBe(200);
    expect(
      (await req('get', '/me').set('Authorization', `Bearer ${verified.body.accessToken}`)).body
        .role,
    ).toBe('ADMIN');
    expect(
      (await req('post', '/auth/admin/verify-code').set('Cookie', preliminary).send({ code })).body
        .code,
    ).toBe(ErrorCode.ADMIN_CODE_INVALID);
  });
  it('проверяет онбординг и сериализует telegramId строкой', async () => {
    const user = await loginUser();
    const profile = await req('get', '/me').set('Authorization', `Bearer ${user.access}`);
    expect(profile.body.telegramId).toBe(user.id);
    const young = await req('post', '/me/onboarding')
      .set('Authorization', `Bearer ${user.access}`)
      .send({ birthDate: '2020-01-01', consentVersion: CONSENT_VERSION });
    expect(young.body.code).toBe(ErrorCode.UNDERAGE);
    const adult = await req('post', '/me/onboarding')
      .set('Authorization', `Bearer ${user.access}`)
      .send({ birthDate: '1990-01-01', consentVersion: CONSENT_VERSION });
    expect(adult.body.onboardingCompleted).toBe(true);
  });
});

describe('Контракт интеграции frontend', () => {
  it('возвращает факт посещения ДОД независимо от анкеты в трех представлениях', async () => {
    const user = await loginUser();
    await onboard(user.access);
    const me = await req('get', '/me').set('Authorization', `Bearer ${user.access}`);
    const day = await prisma.openDaySession.create({
      data: { startsAt: new Date(Date.now() - 3600000), location: 'Знакомство', capacity: 10 },
    });
    await prisma.openDayRegistration.create({
      data: { userId: me.body.id, sessionId: day.id, attended: true },
    });
    const mine = await req('get', '/me/application').set('Authorization', `Bearer ${user.access}`);
    expect(mine.body.status).toBe('NEW');
    expect(mine.body.questionnaire).toBeNull();
    expect(mine.body.hasOpenDayAttended).toBe(true);
    const admin = await administrator();
    const detail = await req('get', `/admin/applications/${mine.body.id}`).set(
      'Authorization',
      `Bearer ${admin.access}`,
    );
    expect(detail.body.hasOpenDayAttended).toBe(true);
    expect(detail.body.user).not.toHaveProperty('openDayRegistrations');
    const list = await req(
      'get',
      '/admin/applications?search=' + encodeURIComponent(me.body.fullName),
    ).set('Authorization', `Bearer ${admin.access}`);
    expect(
      list.body.items.find((row: { id: string }) => row.id === mine.body.id).hasOpenDayAttended,
    ).toBe(true);
  });
  it('изолирует списки куратора и дает читать неактивные нужды только своего учреждения', async () => {
    const first = await volunteer(),
      other = await volunteer();
    const a = await fixtureTrip(first),
      b = await fixtureTrip(other);
    await prisma.needItem.create({
      data: {
        placeId: a.place.id,
        title: 'Материалы',
        description: 'Для занятий',
        isActive: false,
      },
    });
    const trips = await req('get', '/curator/trips?status=OPEN&limit=100').set(
      'Authorization',
      `Bearer ${first.access}`,
    );
    expect(trips.body.items.map((row: { id: string }) => row.id)).toContain(a.tripId);
    expect(trips.body.items.map((row: { id: string }) => row.id)).not.toContain(b.tripId);
    const places = await req('get', '/curator/places').set(
      'Authorization',
      `Bearer ${first.access}`,
    );
    expect(places.body.items.every((row: { id: string }) => row.id === a.place.id)).toBe(true);
    const needs = await req('get', `/curator/places/${a.place.id}/needs`).set(
      'Authorization',
      `Bearer ${first.access}`,
    );
    expect(needs.body.items[0].isActive).toBe(false);
    expect(
      (
        await req('get', `/curator/places/${a.place.id}/needs`).set(
          'Authorization',
          `Bearer ${other.access}`,
        )
      ).status,
    ).toBe(403);
  });
  it('публикует видео и интервью только после даты публикации', async () => {
    const published = await prisma.mediaAlbum.create({
      data: {
        slug: `public-album-${++sequence}`,
        title: 'Открытый альбом',
        publishedAt: new Date(Date.now() - 1000),
      },
    });
    const hidden = await prisma.mediaAlbum.create({
      data: { slug: `draft-album-${++sequence}`, title: 'Черновик' },
    });
    const video = await prisma.mediaItem.create({
      data: {
        albumId: published.id,
        type: 'VIDEO',
        url: 'http://localhost:3000/test.mp4',
        isPublic: true,
      },
    });
    const privateVideo = await prisma.mediaItem.create({
      data: {
        albumId: published.id,
        type: 'VIDEO',
        url: 'http://localhost:3000/private.mp4',
        isPublic: false,
      },
    });
    const hiddenVideo = await prisma.mediaItem.create({
      data: {
        albumId: hidden.id,
        type: 'VIDEO',
        url: 'http://localhost:3000/hidden.mp4',
        isPublic: true,
      },
    });
    const videos = await req('get', '/videos?limit=100');
    expect(videos.status).toBe(200);
    const ids = videos.body.items.map((row: { id: string }) => row.id);
    expect(ids).toContain(video.id);
    expect(ids).not.toContain(privateVideo.id);
    expect(ids).not.toContain(hiddenVideo.id);
    const interview = await prisma.interview.create({
      data: {
        slug: `interview-${++sequence}`,
        title: 'Интервью',
        bodyHtml: '<p>История</p>',
        publishedAt: new Date(Date.now() - 1000),
      },
    });
    expect((await req('get', `/interviews/${interview.slug}`)).body.id).toBe(interview.id);
    await prisma.interview.update({ where: { id: interview.id }, data: { publishedAt: null } });
    expect((await req('get', `/interviews/${interview.slug}`)).status).toBe(404);
  });
  it('сообщает об отклонении входа только владельцу pollSecret и задает cookie для middleware', async () => {
    const login = await start();
    const id = telegramId();
    await req('post', '/dev/telegram/confirm').send({
      token: login.token,
      telegramId: id,
      phone: '+70000000001',
      fullName: 'Участник',
      confirm: false,
    });
    const wrong = await poll(login, 'wrong-secret');
    expect(wrong.body.details?.status).toBeUndefined();
    const declined = await poll(login);
    expect(declined.body.code).toBe(ErrorCode.LOGIN_TOKEN_INVALID);
    expect(declined.body.details.status).toBe('DECLINED');
    const valid = await loginUser();
    expect(
      valid.result.headers['set-cookie']?.find((value: string) =>
        value.startsWith('club_refresh='),
      ),
    ).toMatch(/Path=\/(?:;|$)/);
  });
  it('позволяет кандидату загрузить личный аватар без доступа к чужому или CMS', async () => {
    const user = await loginUser();
    await onboard(user.access);
    const other = await volunteer();
    const png = Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+j5YQAAAAASUVORK5CYII=',
      'base64',
    );
    const signed = await req('post', '/uploads/presign')
      .set('Authorization', `Bearer ${user.access}`)
      .send({ purpose: 'AVATAR', contentType: 'image/png', sizeBytes: png.length });
    expect(signed.status).toBe(200);
    const form = new FormData();
    for (const [key, value] of Object.entries(signed.body.fields)) form.set(key, String(value));
    form.set('file', new Blob([new Uint8Array(png)], { type: 'image/png' }), 'avatar.png');
    expect((await fetch(signed.body.url, { method: 'POST', body: form })).ok).toBe(true);
    const patched = await req('patch', '/me')
      .set('Authorization', `Bearer ${user.access}`)
      .send({ avatarUrl: signed.body.fileUrl });
    expect(patched.status).toBe(200);
    expect((await fetch(patched.body.avatarUrl)).ok).toBe(true);
    expect((await req('get', `/files/${signed.body.uploadId}`)).status).toBe(403);
    expect(
      (
        await req('get', `/files/${signed.body.uploadId}`).set(
          'Authorization',
          `Bearer ${other.access}`,
        )
      ).status,
    ).toBe(403);
    expect(
      (
        await req('patch', '/me')
          .set('Authorization', `Bearer ${other.access}`)
          .send({ avatarUrl: signed.body.fileUrl })
      ).status,
    ).toBe(403);
    expect(
      (
        await req('post', '/uploads/presign')
          .set('Authorization', `Bearer ${user.access}`)
          .send({ purpose: 'CONTENT', contentType: 'image/png', sizeBytes: png.length })
      ).status,
    ).toBe(403);
  });
});

describe('Права на CMS-файлы по актуальной публикации', () => {
  async function cmsFile(userId: string, purpose: 'CONTENT' | 'CLUB_REPORT' = 'CONTENT') {
    const asset = await prisma.uploadAsset.create({
      data: {
        userId,
        purpose,
        key: `cms-access-tests/${crypto.random()}.${purpose === 'CONTENT' ? 'png' : 'pdf'}`,
        contentType: purpose === 'CONTENT' ? 'image/png' : 'application/pdf',
        sizeBytes: 100,
      },
    });
    const path = `/files/${asset.id}`;
    return { ...asset, path, fileUrl: `${getEnvironment().WEB_URL}/api/v1${path}` };
  }
  const download = (file: { path: string }, access?: string) => {
    const response = req('get', file.path);
    return access ? response.set('Authorization', `Bearer ${access}`) : response;
  };
  const past = () => new Date(Date.now() - 60_000);
  const future = () => new Date(Date.now() + 3600_000);

  it.each(['CONTENT', 'CLUB_REPORT'] as const)(
    'закрывает непривязанный %s и разрешает preview только администратору после онбординга',
    async (purpose) => {
      const admin = await administrator();
      const candidate = await loginUser();
      await onboard(candidate.access);
      const member = await volunteer();
      const file = await cmsFile(admin.userId, purpose);
      for (const access of [undefined, candidate.access, member.access])
        expect((await download(file, access)).status).toBe(403);
      expect((await download(file, admin.access)).status).toBe(302);
      const previewPath = `/uploads/${file.id}/preview`;
      expect((await req('get', previewPath)).status).toBe(401);
      for (const access of [candidate.access, member.access])
        expect(
          (await req('get', previewPath).set('Authorization', `Bearer ${access}`)).status,
        ).toBe(403);
      const preview = await req('get', previewPath).set('Authorization', `Bearer ${admin.access}`);
      expect(preview.status).toBe(200);
      expect(preview.body.url).toContain('X-Amz-Signature=');
      expect(preview.headers['cache-control']).toBe('no-store');
      expect(JSON.stringify(preview.body)).not.toContain(admin.access);
      await prisma.user.update({ where: { id: admin.userId }, data: { role: 'VOLUNTEER' } });
      expect((await download(file, admin.access)).status).toBe(403);
      expect(
        (await req('get', previewPath).set('Authorization', `Bearer ${admin.access}`)).status,
      ).toBe(403);
      await prisma.user.update({ where: { id: admin.userId }, data: { role: 'ADMIN' } });
      await prisma.user.update({ where: { id: admin.userId }, data: { birthDate: null } });
      expect((await download(file, admin.access)).status).toBe(403);
      expect(
        (await req('get', previewPath).set('Authorization', `Bearer ${admin.access}`)).body.code,
      ).toBe(ErrorCode.ONBOARDING_REQUIRED);
      await onboard(admin.access);
      await prisma.uploadAsset.update({ where: { id: file.id }, data: { deletedAt: new Date() } });
      expect((await download(file)).status).toBe(404);
      expect((await download(file, admin.access)).status).toBe(404);
      expect(
        (await req('get', previewPath).set('Authorization', `Bearer ${admin.access}`)).status,
      ).toBe(404);
    },
  );

  it('проверяет дату публикации новости и сразу закрывает прежний URL при архивировании и удалении', async () => {
    const admin = await administrator();
    const file = await cmsFile(admin.userId);
    const news = await prisma.newsPost.create({
      data: {
        slug: `cms-file-news-${++sequence}`,
        title: 'Новость с файлом',
        excerpt: 'Анонс',
        bodyHtml: '<p>Материал</p>',
        coverUrl: file.fileUrl,
        authorId: admin.userId,
      },
    });
    expect((await download(file)).status).toBe(403);
    await prisma.newsPost.update({
      where: { id: news.id },
      data: { status: 'PUBLISHED', publishedAt: future() },
    });
    expect((await download(file)).status).toBe(403);
    await prisma.newsPost.update({ where: { id: news.id }, data: { publishedAt: past() } });
    const visible = await download(file);
    expect(visible.status).toBe(302);
    expect(visible.headers.location).toContain('X-Amz-Signature=');
    expect(visible.headers['cache-control']).toBe('no-store');
    expect(
      (
        await req('patch', `/admin/news/${news.id}`)
          .set('Authorization', `Bearer ${admin.access}`)
          .send({ status: 'ARCHIVED' })
      ).status,
    ).toBe(200);
    expect((await download(file)).status).toBe(403);
    await prisma.newsPost.update({ where: { id: news.id }, data: { status: 'PUBLISHED' } });
    expect((await download(file)).status).toBe(302);
    expect(
      (await req('delete', `/admin/news/${news.id}`).set('Authorization', `Bearer ${admin.access}`))
        .status,
    ).toBe(200);
    expect((await download(file)).status).toBe(403);
  });

  it('проверяет одновременно публичность элемента и публикацию его альбома', async () => {
    const admin = await administrator();
    const file = await cmsFile(admin.userId);
    const album = await prisma.mediaAlbum.create({
      data: { slug: `cms-file-album-${++sequence}`, title: 'Альбом' },
    });
    const media = await prisma.mediaItem.create({
      data: { albumId: album.id, type: 'PHOTO', url: file.fileUrl, isPublic: true },
    });
    expect((await download(file)).status).toBe(403);
    await prisma.mediaAlbum.update({ where: { id: album.id }, data: { publishedAt: future() } });
    expect((await download(file)).status).toBe(403);
    await prisma.mediaAlbum.update({ where: { id: album.id }, data: { publishedAt: past() } });
    expect((await download(file)).status).toBe(302);
    await prisma.mediaItem.update({ where: { id: media.id }, data: { isPublic: false } });
    expect((await download(file)).status).toBe(403);
    await prisma.mediaItem.update({ where: { id: media.id }, data: { isPublic: true } });
    expect((await download(file)).status).toBe(302);
    await prisma.mediaAlbum.update({ where: { id: album.id }, data: { publishedAt: null } });
    expect((await download(file)).status).toBe(403);
    await prisma.mediaAlbum.update({ where: { id: album.id }, data: { publishedAt: past() } });
    expect(
      (
        await req('delete', `/admin/albums/${album.id}`).set(
          'Authorization',
          `Bearer ${admin.access}`,
        )
      ).status,
    ).toBe(200);
    expect((await download(file)).status).toBe(403);
  });

  it('оставляет общий файл публичным до удаления последней публичной ссылки', async () => {
    const admin = await administrator();
    const file = await cmsFile(admin.userId);
    const page = await prisma.page.create({
      data: {
        slug: `cms-shared-page-${++sequence}`,
        title: 'Страница',
        bodyHtml: `<img src="${file.fileUrl}">`,
      },
    });
    const album = await prisma.mediaAlbum.create({
      data: {
        slug: `cms-shared-album-${++sequence}`,
        title: 'Общий файл',
        publishedAt: past(),
        coverUrl: file.fileUrl,
      },
    });
    expect((await download(file)).status).toBe(302);
    await prisma.mediaAlbum.update({ where: { id: album.id }, data: { publishedAt: null } });
    expect((await download(file)).status).toBe(302);
    await prisma.page.delete({ where: { id: page.id } });
    expect((await download(file)).status).toBe(403);
  });

  it('распознает реальные HTML src/href, но не текст, чужой origin или похожий путь', async () => {
    const admin = await administrator();
    const file = await cmsFile(admin.userId);
    const page = await prisma.page.create({
      data: { slug: `cms-html-page-${++sequence}`, title: 'HTML-ссылки', bodyHtml: '' },
    });
    const hiddenReferences = [
      `<p>${file.fileUrl}</p>`,
      `<img alt="${file.fileUrl}" src="https://example.test/image.png">`,
      `<img src="https://example.test/api/v1/files/${file.id}">`,
      `<img src="${file.fileUrl}extra">`,
      `<img src="${file.fileUrl}/another-file">`,
      `<!-- <img src="${file.fileUrl}"> -->`,
    ];
    for (const bodyHtml of hiddenReferences) {
      await prisma.page.update({ where: { id: page.id }, data: { bodyHtml } });
      expect((await download(file)).status, bodyHtml).toBe(403);
    }
    for (const bodyHtml of [
      `<img src="${file.fileUrl}">`,
      `<a href="/api/v1/files/${file.id}?download=1&amp;source=cms#file">Файл</a>`,
      `<img src="${getEnvironment().PUBLIC_API_URL}/api/v1/files/${file.id}">`,
    ]) {
      await prisma.page.update({ where: { id: page.id }, data: { bodyHtml } });
      expect((await download(file)).status, bodyHtml).toBe(302);
    }
  });

  it.each(['news', 'interview', 'project'])(
    'проверяет публикацию HTML-only файла в %s без обложки',
    async (source) => {
      const admin = await administrator();
      const file = await cmsFile(admin.userId);
      const data = {
        slug: `cms-html-${source}-${++sequence}`,
        title: 'Иллюстрация в тексте',
        bodyHtml: `<p>Иллюстрация</p><img src="${file.fileUrl}">`,
      };
      let publish: () => Promise<unknown>;
      let hide: () => Promise<unknown>;
      if (source === 'news') {
        const row = await prisma.newsPost.create({
          data: { ...data, authorId: admin.userId, excerpt: 'Анонс' },
        });
        publish = () =>
          prisma.newsPost.update({
            where: { id: row.id },
            data: { status: 'PUBLISHED', publishedAt: past() },
          });
        hide = () =>
          prisma.newsPost.update({ where: { id: row.id }, data: { status: 'ARCHIVED' } });
      } else if (source === 'interview') {
        const row = await prisma.interview.create({ data });
        publish = () =>
          prisma.interview.update({ where: { id: row.id }, data: { publishedAt: past() } });
        hide = () =>
          prisma.interview.update({ where: { id: row.id }, data: { publishedAt: future() } });
      } else {
        const row = await prisma.project.create({ data: { ...data, isActive: false } });
        publish = () => prisma.project.update({ where: { id: row.id }, data: { isActive: true } });
        hide = () => prisma.project.update({ where: { id: row.id }, data: { isActive: false } });
      }
      expect((await download(file)).status).toBe(403);
      await publish();
      expect((await download(file)).status).toBe(302);
      await hide();
      expect((await download(file)).status).toBe(403);
    },
  );

  it.each([
    'place',
    'album',
    'interview',
    'project',
    'partner-logo',
    'partner-website',
    'press',
    'club-report',
  ])('учитывает публичную ссылку %s и отказывает после ее скрытия', async (source) => {
    const admin = await administrator();
    const file = await cmsFile(admin.userId, source === 'club-report' ? 'CLUB_REPORT' : 'CONTENT');
    let hide: () => Promise<unknown>;
    if (source === 'place') {
      const member = await volunteer();
      const place = await fixturePlace(member.userId);
      await prisma.place.update({ where: { id: place.id }, data: { coverImageUrl: file.fileUrl } });
      hide = () => prisma.place.update({ where: { id: place.id }, data: { isActive: false } });
    } else if (source === 'album') {
      const album = await prisma.mediaAlbum.create({
        data: {
          slug: `cms-cover-${++sequence}`,
          title: 'Обложка',
          coverUrl: file.fileUrl,
          publishedAt: past(),
        },
      });
      hide = () =>
        prisma.mediaAlbum.update({ where: { id: album.id }, data: { publishedAt: null } });
    } else if (source === 'interview') {
      const interview = await prisma.interview.create({
        data: {
          slug: `cms-interview-${++sequence}`,
          title: 'Интервью',
          bodyHtml: '',
          coverUrl: file.fileUrl,
          publishedAt: past(),
        },
      });
      hide = () =>
        prisma.interview.update({ where: { id: interview.id }, data: { publishedAt: null } });
    } else if (source === 'project') {
      const project = await prisma.project.create({
        data: {
          slug: `cms-project-${++sequence}`,
          title: 'Проект',
          bodyHtml: '',
          coverUrl: file.fileUrl,
        },
      });
      hide = () => prisma.project.update({ where: { id: project.id }, data: { isActive: false } });
    } else if (source === 'partner-logo' || source === 'partner-website') {
      const partner = await prisma.partner.create({
        data: {
          slug: `cms-partner-${++sequence}`,
          name: 'Партнер',
          ...(source === 'partner-logo' ? { logoUrl: file.fileUrl } : { websiteUrl: file.fileUrl }),
        },
      });
      hide = () => prisma.partner.update({ where: { id: partner.id }, data: { isActive: false } });
    } else if (source === 'press') {
      const press = await prisma.pressMention.create({
        data: { title: 'Публикация', outlet: 'Издание', url: file.fileUrl, publishedAt: past() },
      });
      hide = () =>
        prisma.pressMention.update({ where: { id: press.id }, data: { publishedAt: future() } });
    } else {
      const report = await prisma.clubReport.create({
        data: { title: 'Годовой отчет', year: 2026, fileUrl: file.fileUrl, publishedAt: past() },
      });
      hide = () =>
        prisma.clubReport.update({ where: { id: report.id }, data: { publishedAt: null } });
    }
    expect((await download(file)).status).toBe(302);
    await hide();
    expect((await download(file)).status).toBe(403);
  });
});

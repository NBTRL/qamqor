import {
  Inject,
  Injectable,
  Logger,
  type OnModuleInit,
  type OnModuleDestroy,
} from '@nestjs/common';
import { Bot, InlineKeyboard, Keyboard } from 'grammy';
import type { Update } from 'grammy/types';
import { DISPLAY_TIME_ZONE, ErrorCode } from '@club/shared';
import { getEnvironment } from '../config/environment.js';
import { AuthService } from './auth.service.js';
import { RUNTIME, type RuntimeOptions } from '../common/runtime.module.js';
import { CryptoService } from '../common/crypto.service.js';
import { RedisService } from '../common/redis.service.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { ApiException } from '../common/api-exception.js';

export function deviceDescription(agent: string): string {
  const browser = /Edg\//.test(agent)
    ? 'Edge'
    : /Firefox\//.test(agent)
      ? 'Firefox'
      : /Chrome\//.test(agent)
        ? 'Chrome'
        : /Safari\//.test(agent)
          ? 'Safari'
          : 'Другой браузер';
  const os = /Android/.test(agent)
    ? 'Android'
    : /iPhone|iPad/.test(agent)
      ? 'iOS'
      : /Windows/.test(agent)
        ? 'Windows'
        : /Macintosh/.test(agent)
          ? 'macOS'
          : /Linux/.test(agent)
            ? 'Linux'
            : 'другая ОС';
  return `${browser}, ${os}`;
}
@Injectable()
export class TelegramService implements OnModuleInit, OnModuleDestroy {
  private readonly env = getEnvironment();
  private readonly logger = new Logger(TelegramService.name);
  readonly bot?: Bot;
  private polling?: Promise<void>;
  constructor(
    private readonly auth: AuthService,
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
    private readonly crypto: CryptoService,
    @Inject(RUNTIME) private readonly runtime: RuntimeOptions,
  ) {
    if (this.env.TELEGRAM_BOT_TOKEN) this.bot = new Bot(this.env.TELEGRAM_BOT_TOKEN);
    const bot = this.bot;
    if (!bot) return;
    bot.catch(() => this.logger.warn('TELEGRAM_UPDATE_FAILED'));
    bot.command('start', async (ctx) => {
      if (ctx.chat.type !== 'private') return;
      const token = ctx.match.startsWith('login_') ? ctx.match.slice(6) : '';
      try {
        if (!/^[A-Za-z0-9_-]{43}$/.test(token)) throw new Error();
        await this.auth.bindChat(token, String(ctx.chat.id));
        await ctx.reply(
          'Добро пожаловать в Клуб волонтеров! Поделитесь собственным контактом, чтобы продолжить вход.',
          {
            reply_markup: new Keyboard()
              .requestContact('Поделиться своим контактом')
              .resized()
              .oneTime(),
          },
        );
      } catch {
        await ctx.reply(
          'Ссылка недействительна или устарела. Вернитесь на сайт и начните вход заново.',
        );
      }
    });
    bot.on('message:contact', async (ctx) => {
      if (ctx.chat.type !== 'private') return;
      try {
        const contact = ctx.message.contact;
        const token = await this.auth.receiveContact({
          telegramId: String(ctx.from.id),
          contactUserId: contact.user_id === undefined ? '' : String(contact.user_id),
          chatId: String(ctx.chat.id),
          phone: contact.phone_number,
          fullName: [ctx.from.first_name, ctx.from.last_name].filter(Boolean).join(' '),
          username: ctx.from.username,
        });
        const time = new Intl.DateTimeFormat('ru-RU', {
          timeZone: DISPLAY_TIME_ZONE,
          dateStyle: 'short',
          timeStyle: 'short',
        }).format(token.createdAt);
        await ctx.reply(
          `Вход на сайт Клуба волонтеров: ${deviceDescription(token.createdUserAgent)}, ${time} по Москве. Это вы? Подтверждайте только вход, который начали сами.`,
          {
            reply_markup: new InlineKeyboard()
              .text('Да, это я', `login:y:${token.id}`)
              .text('Нет', `login:n:${token.id}`),
          },
        );
      } catch {
        await ctx.reply(
          'Не удалось принять контакт. Поделитесь своим контактом через кнопку. Если ссылка устарела, начните вход заново на сайте.',
        );
      }
    });
    bot.callbackQuery(/^login:([yn]):([0-9a-f-]{36})$/, async (ctx) => {
      if (ctx.chat?.type !== 'private') return;
      try {
        await this.auth.confirmDevice(ctx.match[2]!, String(ctx.from.id), ctx.match[1] === 'y');
        await ctx.editMessageText(
          ctx.match[1] === 'y'
            ? 'Вход подтвержден. Вернитесь на сайт.'
            : 'Вход отклонен. Если это были не вы, не открывайте чужие ссылки для входа.',
        );
        await ctx.answerCallbackQuery();
      } catch {
        await ctx.answerCallbackQuery({ text: 'Подтверждение недействительно или устарело.' });
      }
    });
    bot.command('help', async (ctx) => {
      if (ctx.chat.type === 'private')
        await ctx.reply(
          'Начните вход на сайте Клуба волонтеров, откройте ссылку, поделитесь своим контактом и подтвердите устройство. Паролей нет. /status — ваши ближайшие записи.',
        );
    });
    bot.command('status', async (ctx) => {
      if (ctx.chat.type !== 'private') return;
      if (!ctx.from) return;
      const user = await this.prisma.user.findUnique({
        where: { telegramId: BigInt(ctx.from.id) },
      });
      if (!user || user.isBlocked || user.anonymizedAt) {
        await ctx.reply('Сначала войдите через сайт Клуба волонтеров.');
        return;
      }
      const [trips, events, days] = await Promise.all([
        this.prisma.tripRegistration.findMany({
          where: {
            userId: user.id,
            status: { in: ['PENDING', 'CONFIRMED', 'WAITLIST'] },
            trip: { startsAt: { gte: new Date() }, status: { in: ['OPEN', 'CLOSED'] } },
          },
          include: { trip: true },
          take: 10,
          orderBy: { trip: { startsAt: 'asc' } },
        }),
        this.prisma.eventRegistration.findMany({
          where: { userId: user.id, status: 'CONFIRMED', event: { startsAt: { gte: new Date() } } },
          include: { event: true },
          take: 10,
          orderBy: { event: { startsAt: 'asc' } },
        }),
        this.prisma.openDayRegistration.findMany({
          where: { userId: user.id, cancelledAt: null, session: { startsAt: { gte: new Date() } } },
          include: { session: true },
          take: 10,
          orderBy: { session: { startsAt: 'asc' } },
        }),
      ]);
      const date = (value: Date) =>
        new Intl.DateTimeFormat('ru-RU', {
          timeZone: DISPLAY_TIME_ZONE,
          dateStyle: 'short',
          timeStyle: 'short',
        }).format(value);
      const lines = [
        ...trips.map((item) => `${date(item.trip.startsAt)} — ${item.trip.title}`),
        ...events.map((item) => `${date(item.event.startsAt)} — ${item.event.title}`),
        ...days.map((item) => `${date(item.session.startsAt)} — День открытых дверей`),
      ];
      await ctx.reply(
        lines.length
          ? `Ваши ближайшие записи:\n${lines.join('\n')}`
          : 'Пока нет ближайших записей. Расписание доступно на сайте.',
      );
    });
  }
  async setup(): Promise<{ username: string; mode: string }> {
    const bot = this.bot;
    if (!bot) throw new ApiException(ErrorCode.TELEGRAM_UNAVAILABLE);
    await bot.init();
    if (
      !this.env.TELEGRAM_BOT_USERNAME ||
      bot.botInfo.username.toLowerCase() !== this.env.TELEGRAM_BOT_USERNAME.toLowerCase()
    )
      throw new Error('TELEGRAM_BOT_USERNAME не совпадает с username бота.');
    await bot.api.setMyCommands([
      { command: 'help', description: 'Как это работает' },
      { command: 'status', description: 'Мои ближайшие записи' },
    ]);
    if (this.env.TELEGRAM_MODE === 'webhook') {
      if (!this.env.TELEGRAM_WEBHOOK_SECRET || !this.env.PUBLIC_API_URL.startsWith('https://'))
        throw new Error('Webhook требует PUBLIC_API_URL с HTTPS и TELEGRAM_WEBHOOK_SECRET.');
      await bot.api.setWebhook(
        `${this.env.PUBLIC_API_URL.replace(/\/$/, '')}/api/v1/telegram/webhook`,
        {
          secret_token: this.env.TELEGRAM_WEBHOOK_SECRET,
          allowed_updates: ['message', 'callback_query'],
        },
      );
    } else await bot.api.deleteWebhook({ drop_pending_updates: false });
    return { username: bot.botInfo.username, mode: this.env.TELEGRAM_MODE };
  }
  async info() {
    if (!this.bot) throw new ApiException(ErrorCode.TELEGRAM_UNAVAILABLE);
    return this.bot.api.getWebhookInfo();
  }
  async onModuleInit(): Promise<void> {
    if (this.runtime.offline || !this.runtime.telegram || !this.bot) return;
    if (this.runtime.telegramSetup === false) {
      await this.bot.init();
      return;
    }
    await this.setup();
    if (this.env.TELEGRAM_MODE === 'polling')
      this.polling = this.bot
        .start({ allowed_updates: ['message', 'callback_query'] })
        .catch(() => {
          this.logger.error('TELEGRAM_POLLING_STOPPED');
        });
  }
  verifyWebhook(secret: string | undefined): void {
    if (
      this.env.TELEGRAM_MODE !== 'webhook' ||
      !this.env.TELEGRAM_WEBHOOK_SECRET ||
      !secret ||
      !this.crypto.equal(secret, this.env.TELEGRAM_WEBHOOK_SECRET)
    )
      throw new ApiException(ErrorCode.FORBIDDEN);
  }
  async handleUpdate(update: Update): Promise<{ ok: true }> {
    if (!this.bot) throw new ApiException(ErrorCode.TELEGRAM_UNAVAILABLE);
    const doneKey = this.redis.key(`telegram-update-done:${update.update_id}`);
    const lockKey = this.redis.key(`telegram-update-lock:${update.update_id}`);
    if (await this.redis.client.exists(doneKey)) return { ok: true };
    const lock = this.crypto.random();
    if (!(await this.redis.client.set(lockKey, lock, 'PX', 60000, 'NX')))
      throw new ApiException(ErrorCode.RATE_LIMITED);
    try {
      await this.bot.handleUpdate(update);
      await this.redis.client.set(doneKey, '1', 'EX', 86400);
    } finally {
      await this.redis.client.eval(
        "if redis.call('GET',KEYS[1])==ARGV[1] then return redis.call('DEL',KEYS[1]) end return 0",
        1,
        lockKey,
        lock,
      );
    }
    return { ok: true };
  }
  async send(chatId: string, text: string): Promise<void> {
    if (!this.bot) throw new ApiException(ErrorCode.TELEGRAM_UNAVAILABLE);
    await this.bot.api.sendMessage(chatId, text, { link_preview_options: { is_disabled: true } });
  }
  async onModuleDestroy(): Promise<void> {
    if (this.bot?.isRunning()) await this.bot.stop();
    await this.polling;
  }
}

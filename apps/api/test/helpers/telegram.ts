import type { Update } from 'grammy/types';
import { TelegramService } from '../../dist/auth/telegram.service.js';
import { CryptoService } from '../../dist/common/crypto.service.js';
import type { PrismaService } from '../../dist/prisma/prisma.service.js';

// Exercise real grammY handlers; intercept every outgoing API request.
export function telegramFixture(prisma: PrismaService) {
  const previous = process.env.TELEGRAM_BOT_TOKEN;
  let service: TelegramService;
  try {
    process.env.TELEGRAM_BOT_TOKEN = '123456:synthetic_test_token';
    service = new TelegramService({} as never, prisma, {} as never, new CryptoService(), {
      offline: true,
      workers: false,
      telegram: false,
    });
  } finally {
    if (previous === undefined) delete process.env.TELEGRAM_BOT_TOKEN;
    else process.env.TELEGRAM_BOT_TOKEN = previous;
  }
  service.bot!.botInfo = {
    id: 123456,
    is_bot: true,
    first_name: 'Club',
    username: 'club_test_bot',
    can_join_groups: false,
    can_read_all_group_messages: false,
    supports_inline_queries: false,
    can_connect_to_business: false,
    has_main_web_app: false,
    has_topics_enabled: false,
    allows_users_to_create_topics: false,
    can_manage_bots: false,
    supports_join_request_queries: false,
  };
  const messages: string[] = [];
  service.bot!.api.config.use(async (_previous, method, payload) => {
    if (method !== 'sendMessage') throw new Error(`Unexpected Telegram call: ${method}`);
    messages.push((payload as { text: string }).text);
    return {
      ok: true,
      result: { message_id: 1, date: 1, chat: { id: 1, type: 'private' } },
    } as never;
  });
  let updateId = 0;
  const from = (id: number) => ({ id, is_bot: false, first_name: 'Участник' });
  const chat = (id: number) => ({ id, type: 'private' as const, first_name: 'Участник' });
  const message = (id: number, text: string): Update => ({
    update_id: ++updateId,
    message: {
      message_id: updateId,
      date: Math.floor(Date.now() / 1000),
      from: from(id),
      chat: chat(id),
      text,
      ...(text.startsWith('/')
        ? { entities: [{ offset: 0, length: text.length, type: 'bot_command' as const }] }
        : {}),
    },
  });
  const membership = (id: number, blocked: boolean): Update => ({
    update_id: ++updateId,
    my_chat_member: {
      chat: chat(id),
      from: from(id),
      date: Math.floor(Date.now() / 1000),
      old_chat_member: blocked
        ? { status: 'member', user: service.bot!.botInfo }
        : { status: 'kicked', user: service.bot!.botInfo, until_date: 0 },
      new_chat_member: blocked
        ? { status: 'kicked', user: service.bot!.botInfo, until_date: 0 }
        : { status: 'member', user: service.bot!.botInfo },
    },
  });
  return {
    service,
    messages,
    message,
    membership,
    handle: (update: Update) => service.bot!.handleUpdate(update),
  };
}

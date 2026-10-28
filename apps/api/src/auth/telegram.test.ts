import { afterEach, describe, expect, it, vi } from 'vitest';
import { deviceDescription, TelegramService } from './telegram.service.js';
import { CryptoService } from '../common/crypto.service.js';

afterEach(() => vi.unstubAllEnvs());
function telegram(mode: 'polling' | 'webhook' = 'polling', username = 'club_test_bot') {
  vi.stubEnv('TELEGRAM_BOT_TOKEN', '123456:synthetic_test_token');
  vi.stubEnv('TELEGRAM_BOT_USERNAME', username);
  vi.stubEnv('TELEGRAM_MODE', mode);
  vi.stubEnv('PUBLIC_API_URL', 'https://club.example.test');
  vi.stubEnv('TELEGRAM_WEBHOOK_SECRET', 'synthetic_webhook_secret');
  const contact = {
    id: '123e4567-e89b-42d3-a456-426614174000',
    createdUserAgent: 'Chrome/123 Windows',
    createdAt: new Date('2026-10-28T09:00:00Z'),
  };
  const auth = {
    bindChat: vi.fn().mockResolvedValue(contact.id),
    receiveContact: vi.fn().mockResolvedValue(contact),
    confirmDevice: vi.fn().mockResolvedValue(undefined),
  };
  const service = new TelegramService(
    auth as never,
    {} as never,
    {} as never,
    new CryptoService(),
    { offline: true, workers: false, telegram: false },
  );
  const calls: Array<{ method: string; payload: unknown }> = [];
  service.bot!.api.config.use(async (_previous, method, payload) => {
    calls.push({ method, payload });
    if (method === 'getMe')
      return {
        ok: true,
        result: { id: 123456, is_bot: true, first_name: 'Club', username: 'club_test_bot' },
      } as never;
    if (method === 'sendMessage')
      return {
        ok: true,
        result: { message_id: 1, date: 1793178000, chat: { id: 900000000001, type: 'private' } },
      } as never;
    return { ok: true, result: true } as never;
  });
  return { service, calls, auth, contact };
}
describe('Протокол Telegram', () => {
  it('разбирает устройство без вывода исходного user-agent', () => {
    expect(deviceDescription('Mozilla Chrome/100 Windows private-value')).toBe('Chrome, Windows');
    expect(deviceDescription('Mozilla Safari/100 iPhone')).toBe('Safari, iOS');
  });
  it('проверяет username, команды и удаляет webhook для polling', async () => {
    const { service, calls } = telegram();
    expect(await service.setup()).toEqual({ username: 'club_test_bot', mode: 'polling' });
    expect(calls.map((call) => call.method)).toEqual(['getMe', 'setMyCommands', 'deleteWebhook']);
    expect(calls[1]!.payload).toMatchObject({
      commands: [
        { command: 'help', description: 'Как это работает' },
        { command: 'status', description: 'Мои ближайшие записи' },
      ],
    });
  });
  it('не запускает бот с username другого бота', async () => {
    const { service } = telegram('polling', 'wrong_bot');
    await expect(service.setup()).rejects.toThrow('TELEGRAM_BOT_USERNAME не совпадает');
  });
  it('устанавливает HTTPS webhook и проверяет секрет', async () => {
    const { service, calls } = telegram('webhook');
    await service.setup();
    expect(calls.at(-1)).toMatchObject({
      method: 'setWebhook',
      payload: {
        url: 'https://club.example.test/api/v1/telegram/webhook',
        secret_token: 'synthetic_webhook_secret',
      },
    });
    expect(() => service.verifyWebhook(undefined)).toThrow();
    expect(() => service.verifyWebhook('wrong')).toThrow();
    expect(() => service.verifyWebhook('synthetic_webhook_secret')).not.toThrow();
  });
  it('проводит /start, request_contact и подтверждение устройства через обработчики grammY', async () => {
    const { service, calls, auth, contact } = telegram();
    await service.setup();
    const from = { id: 900000000001, is_bot: false, first_name: 'Участник' };
    const chat = { id: from.id, type: 'private' as const, first_name: from.first_name };
    const command = `/start login_${'a'.repeat(43)}`;
    await service.bot!.handleUpdate({
      update_id: 1,
      message: {
        message_id: 1,
        date: 1793178000,
        from,
        chat,
        text: command,
        entities: [{ offset: 0, length: 6, type: 'bot_command' }],
      },
    });
    expect(auth.bindChat).toHaveBeenCalledWith('a'.repeat(43), String(from.id));
    expect(calls.at(-1)).toMatchObject({
      method: 'sendMessage',
      payload: {
        reply_markup: {
          keyboard: [[{ text: 'Поделиться своим контактом', request_contact: true }]],
        },
      },
    });
    await service.bot!.handleUpdate({
      update_id: 2,
      message: {
        message_id: 2,
        date: 1793178000,
        from,
        chat,
        contact: { phone_number: '+70000000000', first_name: from.first_name, user_id: from.id },
      },
    });
    expect(auth.receiveContact).toHaveBeenCalledWith(
      expect.objectContaining({ telegramId: String(from.id), contactUserId: String(from.id) }),
    );
    expect(calls.at(-1)).toMatchObject({
      method: 'sendMessage',
      payload: {
        text: expect.stringContaining('Chrome, Windows'),
        reply_markup: {
          inline_keyboard: [
            [
              { text: 'Да, это я', callback_data: `login:y:${contact.id}` },
              { text: 'Нет', callback_data: `login:n:${contact.id}` },
            ],
          ],
        },
      },
    });
    await service.bot!.handleUpdate({
      update_id: 3,
      callback_query: {
        id: 'callback',
        from,
        chat_instance: 'test',
        data: `login:y:${contact.id}`,
        message: { message_id: 3, date: 1793178000, chat },
      },
    });
    expect(auth.confirmDevice).toHaveBeenCalledWith(contact.id, String(from.id), true);
  });
});

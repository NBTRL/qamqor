import { describe, expect, it, vi } from 'vitest';
import { TelegramService } from './telegram.service.js';

describe('Telegram lifecycle in deployment roles', () => {
  it('opens HTTP handling without waiting for Telegram or changing its configuration', async () => {
    const init = vi.fn(() => new Promise(() => undefined));
    const service = Object.assign(Object.create(TelegramService.prototype), {
      runtime: { offline: false, telegram: true, telegramSetup: false },
      bot: { init },
    }) as TelegramService;
    const setup = vi.spyOn(service, 'setup');
    await service.onModuleInit();
    expect(init).not.toHaveBeenCalled();
    expect(setup).not.toHaveBeenCalled();
  });

  it('initializes Telegram before processing the first webhook and releases failed locks', async () => {
    const init = vi.fn().mockResolvedValue(undefined);
    const handleUpdate = vi.fn().mockImplementation(async () => {
      expect(init).toHaveBeenCalled();
    });
    const client = {
      exists: vi.fn().mockResolvedValue(0),
      set: vi.fn().mockResolvedValue('OK'),
      eval: vi.fn().mockResolvedValue(1),
    };
    const service = Object.assign(Object.create(TelegramService.prototype), {
      bot: { init, handleUpdate },
      redis: { key: (key: string) => key, client },
      crypto: { random: () => 'lock' },
    }) as TelegramService;
    await expect(service.handleUpdate({ update_id: 1 })).resolves.toEqual({ ok: true });
    expect(init.mock.calls[0]?.[0]).toBeInstanceOf(AbortSignal);
    expect(handleUpdate).toHaveBeenCalledOnce();
    expect(client.set).toHaveBeenCalledWith('telegram-update-done:1', '1', 'EX', 86400);
    client.set.mockClear();
    init.mockRejectedValueOnce(new Error('Telegram unavailable'));
    await expect(service.handleUpdate({ update_id: 2 })).rejects.toThrow('Telegram unavailable');
    expect(handleUpdate).toHaveBeenCalledOnce();
    expect(client.set).not.toHaveBeenCalledWith('telegram-update-done:2', '1', 'EX', 86400);
    expect(client.eval).toHaveBeenCalledTimes(2);
  });

  it('keeps webhook configuration in the background process', async () => {
    const service = Object.assign(Object.create(TelegramService.prototype), {
      runtime: { offline: false, telegram: true },
      bot: {},
      env: { TELEGRAM_MODE: 'webhook' },
    }) as TelegramService;
    const setup = vi
      .spyOn(service, 'setup')
      .mockResolvedValue({ username: 'bot', mode: 'webhook' });
    await service.onModuleInit();
    expect(setup).toHaveBeenCalledOnce();
  });
  it('subscribes to bot blocking updates in polling mode too', async () => {
    const start = vi.fn().mockResolvedValue(undefined);
    const service = Object.assign(Object.create(TelegramService.prototype), {
      runtime: { offline: false, telegram: true },
      bot: { start },
      env: { TELEGRAM_MODE: 'polling' },
    }) as TelegramService;
    vi.spyOn(service, 'setup').mockResolvedValue({ username: 'bot', mode: 'polling' });
    await service.onModuleInit();
    expect(start).toHaveBeenCalledWith({
      allowed_updates: ['message', 'callback_query', 'my_chat_member'],
    });
  });
});

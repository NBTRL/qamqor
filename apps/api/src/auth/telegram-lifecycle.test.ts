import { describe, expect, it, vi } from 'vitest';
import { TelegramService } from './telegram.service.js';

describe('Telegram lifecycle in deployment roles', () => {
  it('initializes HTTP handling without changing bot commands or webhook', async () => {
    const init = vi.fn().mockResolvedValue(undefined);
    const service = Object.assign(Object.create(TelegramService.prototype), {
      runtime: { offline: false, telegram: true, telegramSetup: false },
      bot: { init },
    }) as TelegramService;
    const setup = vi.spyOn(service, 'setup');
    await service.onModuleInit();
    expect(init).toHaveBeenCalledOnce();
    expect(setup).not.toHaveBeenCalled();
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
});

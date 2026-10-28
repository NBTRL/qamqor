import { describe, expect, it, vi } from 'vitest';

const startup = vi.hoisted(() => ({
  app: {
    useLogger: vi.fn(),
    get: vi.fn(),
    setGlobalPrefix: vi.fn(),
    useGlobalFilters: vi.fn(),
    useGlobalInterceptors: vi.fn(),
    useGlobalPipes: vi.fn(),
    use: vi.fn(),
    enableCors: vi.fn(),
    enableShutdownHooks: vi.fn(),
    listen: vi
      .fn()
      .mockRejectedValue(new Error('TELEGRAM_BOT_USERNAME не совпадает с username бота.')),
    close: vi.fn().mockResolvedValue(undefined),
  },
}));
vi.mock('@nestjs/core', async (original) => ({
  ...(await original<object>()),
  NestFactory: { create: vi.fn().mockResolvedValue(startup.app) },
}));
vi.mock('../openapi.js', () => ({ configureApp: vi.fn(), setupSwagger: vi.fn() }));
describe('Ошибка запуска', () => {
  it('закрывает приложение и воркеры, если настройка бота или listen завершается ошибкой', async () => {
    const previous = process.exitCode;
    const output = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    try {
      await import('../main.js');
      await vi.waitFor(() => expect(process.exitCode).toBe(1));
      expect(startup.app.close).toHaveBeenCalledOnce();
      expect(output).toHaveBeenCalledWith('TELEGRAM_BOT_USERNAME не совпадает с username бота.');
    } finally {
      process.exitCode = previous;
      output.mockRestore();
    }
  });
});

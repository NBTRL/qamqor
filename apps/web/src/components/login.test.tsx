import { beforeEach, afterEach, describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { errorMessages, ErrorCode, LoginTokenStatus, loginTokenStatusLabels } from '@club/shared';
import { setAccessToken } from '@/lib/api/client';
import { Login } from './login';
const { replace, location } = vi.hoisted(() => ({
  replace: vi.fn(),
  location: { next: '/cabinet/profile' },
}));
vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace }),
  useSearchParams: () => new URLSearchParams({ next: location.next }),
}));
vi.mock('qrcode', () => ({
  default: { toDataURL: vi.fn().mockResolvedValue('data:image/png;base64,cXJjb2Rl') },
}));
let poll: unknown;
let startError: string | undefined;
let meDone = true;
const requests: Request[] = [];
const response = (value: unknown, status = 200) =>
  new Response(JSON.stringify(value), { status, headers: { 'Content-Type': 'application/json' } });
async function flush() {
  await act(async () => {
    for (let i = 0; i < 6; i++) await vi.advanceTimersByTimeAsync(0);
  });
}
async function mount() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  const view = render(
    <QueryClientProvider client={client}>
      <Login />
    </QueryClientProvider>,
  );
  fireEvent.click(screen.getByRole('button', { name: 'Войти через Telegram' }));
  await flush();
  return view;
}
beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-10-28T10:00:00Z'));
  poll = { status: LoginTokenStatus.PENDING };
  startError = undefined;
  meDone = true;
  location.next = '/cabinet/profile';
  requests.length = 0;
  replace.mockClear();
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: Request) => {
      requests.push(input);
      const path = new URL(input.url).pathname;
      if (path.endsWith('/telegram/start'))
        return startError
          ? response({ code: startError }, 503)
          : response({
              token: 'test-token',
              pollSecret: 'test-poll-secret',
              deepLink: 'https://t.me/club_test_bot?start=test-token',
              expiresAt: new Date(Date.now() + 5000).toISOString(),
            });
      if (path.endsWith('/telegram/status'))
        return poll && typeof poll === 'object' && 'code' in poll
          ? response(poll, 400)
          : response(poll);
      if (path.endsWith('/verify-code') || path.endsWith('/email/verify'))
        return response({ status: 'USED', accessToken: 'test-access' });
      if (path.endsWith('/me')) return response({ id: 'test-user', onboardingCompleted: meDone });
      return response({ ok: true });
    }),
  );
});
afterEach(() => {
  setAccessToken();
  vi.useRealTimers();
});
describe('Telegram login (API mocks only in this test)', () => {
  it('shows PENDING, QR and deep link; sends the poll secret in a header only', async () => {
    await mount();
    expect(screen.getByText(loginTokenStatusLabels.PENDING)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Открыть в Telegram' })).toHaveAttribute(
      'href',
      'https://t.me/club_test_bot?start=test-token',
    );
    expect(screen.getByAltText(/QR-код/)).toBeInTheDocument();
    const request = requests.find((r) => r.url.includes('/status'))!;
    expect(request.headers.get('X-Poll-Secret')).toBe('test-poll-secret');
    expect(request.url).not.toContain('poll-secret');
    expect(sessionStorage.length).toBe(0);
  });
  it('shows CONTACT_RECEIVED on the next poll', async () => {
    await mount();
    poll = { status: LoginTokenStatus.CONTACT_RECEIVED };
    await act(() => vi.advanceTimersByTimeAsync(2000));
    await flush();
    expect(screen.getByText('Подтвердите вход в боте')).toBeInTheDocument();
  });
  it.each([
    { status: LoginTokenStatus.DECLINED },
    { code: ErrorCode.LOGIN_TOKEN_INVALID, details: { status: LoginTokenStatus.DECLINED } },
  ])('stops on DECLINED and permits a fresh attempt (%j)', async (value) => {
    poll = value;
    await mount();
    expect(screen.getByText(loginTokenStatusLabels.DECLINED)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Попробовать снова' })).toBeInTheDocument();
    const before = requests.length;
    await act(() => vi.advanceTimersByTimeAsync(8000));
    expect(requests.length).toBe(before);
  });
  it('expires at the deadline and stops polling', async () => {
    await mount();
    await act(() => vi.advanceTimersByTimeAsync(6000));
    await flush();
    expect(screen.getByText(loginTokenStatusLabels.EXPIRED)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Повторить' })).toBeInTheDocument();
    const before = requests.length;
    await act(() => vi.advanceTimersByTimeAsync(5000));
    expect(requests.length).toBe(before);
  });
  it('stops requests when unmounted', async () => {
    const view = await mount();
    view.unmount();
    const count = requests.length;
    await act(() => vi.advanceTimersByTimeAsync(8000));
    expect(requests.length).toBe(count);
  });
  it('polls on focus without overlapping or hitting the one-second limit', async () => {
    await mount();
    await act(() => vi.advanceTimersByTimeAsync(1200));
    fireEvent(window, new Event('focus'));
    await flush();
    expect(requests.filter((r) => r.url.includes('/status'))).toHaveLength(2);
  });
  it('shows contact mismatch using the shared error dictionary', async () => {
    poll = { code: ErrorCode.TELEGRAM_CONTACT_MISMATCH };
    await mount();
    expect(screen.getByRole('alert')).toHaveTextContent(errorMessages.TELEGRAM_CONTACT_MISMATCH);
  });
  it('explains missing Telegram configuration', async () => {
    startError = ErrorCode.TELEGRAM_UNAVAILABLE;
    await mount();
    expect(screen.getByRole('alert')).toHaveTextContent('Бот не настроен: добавьте токен в .env');
  });
  it('handles admin email requirement without exposing the backup form', async () => {
    poll = { code: ErrorCode.ADMIN_EMAIL_REQUIRED };
    await mount();
    expect(screen.getByRole('alert')).toHaveTextContent('Обратитесь к главному администратору');
    expect(screen.queryByText('Нет доступа к Telegram?')).not.toBeInTheDocument();
  });
  it('switches to the admin second step and hides backup email', async () => {
    poll = { status: 'CONFIRMED', nextStep: 'ADMIN_EMAIL_CODE' };
    await mount();
    expect(screen.getByRole('heading', { name: 'Введите код из письма' })).toBeInTheDocument();
    expect(screen.queryByText('Нет доступа к Telegram?')).not.toBeInTheDocument();
  });
  it('finishes login with an in-memory token', async () => {
    poll = { status: 'USED', accessToken: 'test-access' };
    await mount();
    expect(replace).toHaveBeenCalledWith('/cabinet/profile');
    expect(sessionStorage.length).toBe(0);
  });
  describe.each(['telegram', 'backup', 'admin'] as const)('%s return URL', (method) => {
    it.each([
      ['/\\example.org', '/cabinet'],
      ['/cabinet/profile?tab=contacts#email', '/cabinet/profile?tab=contacts#email'],
    ])('safely completes login with next=%j', async (next, expected) => {
      location.next = next;
      poll =
        method === 'admin'
          ? { status: 'CONFIRMED', nextStep: 'ADMIN_EMAIL_CODE' }
          : method === 'telegram'
            ? { status: 'USED', accessToken: 'test-access' }
            : { status: LoginTokenStatus.PENDING };
      await mount();
      if (method === 'admin') {
        fireEvent.change(screen.getByLabelText('Одноразовый код'), { target: { value: '123456' } });
        fireEvent.submit(screen.getByRole('button', { name: 'Подтвердить вход' }).closest('form')!);
        await flush();
      } else if (method === 'backup') {
        fireEvent.click(screen.getByRole('button', { name: 'Нет доступа к Telegram?' }));
        fireEvent.change(screen.getByLabelText('E-mail'), {
          target: { value: 'test@example.org' },
        });
        const form = screen.getByRole('button', { name: 'Получить код' }).closest('form')!;
        fireEvent.submit(form);
        await flush();
        fireEvent.change(screen.getByLabelText('Код из письма'), { target: { value: '123456' } });
        fireEvent.submit(form);
        await flush();
      }
      expect(replace).toHaveBeenCalledWith(expected);
    });
  });
  it('routes a new user to onboarding', async () => {
    meDone = false;
    poll = { status: 'USED', accessToken: 'test-access' };
    await mount();
    expect(replace).toHaveBeenCalledWith('/onboarding');
  });
});

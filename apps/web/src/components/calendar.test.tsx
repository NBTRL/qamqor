import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Calendar } from './calendar';
import type { Model, Page } from '@/lib/api/client';

const auth = vi.hoisted(() => ({ me: null as Model<'MeResponseDto'> | null, loading: false }));
vi.mock('./providers', () => ({ useAuth: () => auth }));
const range = { from: '2026-10-01T00:00:00.000Z', to: '2026-12-30T00:00:00.000Z' };
const event = (n: number): Model<'CalendarItemDto'> => ({
  id: String(n).padStart(4, '0'),
  title: `Событие ${n}`,
  type: 'CLUB_EVENT',
  startsAt: new Date(Date.parse(range.from) + n * 60000).toISOString(),
});
const response = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
const data = (total: number, page = 1): Page<Model<'CalendarItemDto'>> => ({
  items: Array.from({ length: Math.min(100, Math.max(0, total - (page - 1) * 100)) }, (_, i) =>
    event((page - 1) * 100 + i + 1),
  ),
  total,
  page,
  limit: 100,
});
function mount(initial: Page<Model<'CalendarItemDto'>> | null = null, initialError?: string) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, staleTime: Infinity } },
  });
  const element = () => (
    <QueryClientProvider client={client}>
      <Calendar initial={initial} initialError={initialError} range={range} />
    </QueryClientProvider>
  );
  const view = render(element());
  return { ...view, update: () => view.rerender(element()) };
}
beforeEach(() => {
  auth.me = null;
  auth.loading = false;
});
describe('Calendar pagination', () => {
  it.each([0, 100, 101, 205])('makes every event available for a list of %i', async (total) => {
    const requests: URL[] = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: Request) => {
        const url = new URL(input.url);
        requests.push(url);
        return response(data(total, Number(url.searchParams.get('page'))));
      }),
    );
    const view = mount();
    if (total === 0) {
      expect(await screen.findByText('Ближайших событий пока нет.')).toBeInTheDocument();
    } else {
      await screen.findByText(`Показано ${Math.min(100, total)} из ${total}`);
      for (let shown = 100; shown < total; shown += 100) {
        fireEvent.click(screen.getByRole('button', { name: 'Загрузить ещё' }));
        await screen.findByText(`Показано ${Math.min(shown + 100, total)} из ${total}`);
      }
    }
    expect(view.container.querySelectorAll('article')).toHaveLength(total);
    expect([...view.container.querySelectorAll('h2')].map((node) => node.textContent)).toEqual(
      Array.from({ length: total }, (_, i) => `Событие ${i + 1}`),
    );
    expect(screen.queryByRole('button', { name: 'Загрузить ещё' })).not.toBeInTheDocument();
    expect(requests.map((url) => url.searchParams.get('page'))).toEqual(
      Array.from({ length: Math.max(1, Math.ceil(total / 100)) }, (_, i) => String(i + 1)),
    );
    expect(
      requests.every(
        (url) =>
          url.pathname === '/api/v1/public/calendar' &&
          url.searchParams.get('from') === range.from &&
          url.searchParams.get('to') === range.to,
      ),
    ).toBe(true);
  });
  it('continues the server-rendered first page and blocks repeat clicks during loading', async () => {
    let finish!: (value: Response) => void;
    const fetch = vi.fn(
      () =>
        new Promise<Response>((resolve) => {
          finish = resolve;
        }),
    );
    vi.stubGlobal('fetch', fetch);
    mount(data(101));
    expect(screen.getByText('Событие 100')).toBeInTheDocument();
    expect(fetch).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Загрузить ещё' }));
    const button = await screen.findByRole('button', { name: 'Загрузка…' });
    expect(button).toBeDisabled();
    fireEvent.click(button);
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(
      new URL((fetch.mock.calls[0] as unknown as [Request])[0].url).searchParams.get('page'),
    ).toBe('2');
    finish(response(data(101, 2)));
    expect(await screen.findByText('Событие 101')).toBeInTheDocument();
  });
  it('retains previous events and retries the failed page without reloading page one', async () => {
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(response({ code: 'INTERNAL_ERROR' }, 500))
      .mockResolvedValueOnce(response(data(101, 2)));
    vi.stubGlobal('fetch', fetch);
    mount(data(101));
    fireEvent.click(screen.getByRole('button', { name: 'Загрузить ещё' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Повторить загрузку' }));
    expect(screen.getByText('Событие 100')).toBeInTheDocument();
    expect(screen.queryByText('Ближайших событий пока нет.')).not.toBeInTheDocument();
    await screen.findByText('Показано 101 из 101');
    expect(
      fetch.mock.calls.map(([input]) => new URL((input as Request).url).searchParams.get('page')),
    ).toEqual(['2', '2']);
  });
  it('distinguishes an initial request failure from an empty calendar', async () => {
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValueOnce(response({ code: 'INTERNAL_ERROR' }, 500))
        .mockResolvedValueOnce(response(data(0))),
    );
    mount();
    const retry = await screen.findByRole('button', { name: 'Повторить загрузку' });
    expect(screen.queryByText('Ближайших событий пока нет.')).not.toBeInTheDocument();
    fireEvent.click(retry);
    expect(await screen.findByText('Ближайших событий пока нет.')).toBeInTheDocument();
  });
  it('clears a server-side loading error after the client recovers', async () => {
    let finish!: (value: Response) => void;
    vi.stubGlobal(
      'fetch',
      vi.fn(
        () =>
          new Promise<Response>((resolve) => {
            finish = resolve;
          }),
      ),
    );
    mount(null, 'Сервер временно недоступен');
    expect(screen.getByText('Сервер временно недоступен')).toBeInTheDocument();
    finish(response(data(1)));
    await screen.findByText('Событие 1');
    expect(screen.queryByText('Сервер временно недоступен')).not.toBeInTheDocument();
  });
  it('removes overlapping items while keeping chronological order', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => response({ ...data(101, 2), items: [event(101), event(100)] })),
    );
    const view = mount(data(101));
    fireEvent.click(screen.getByRole('button', { name: 'Загрузить ещё' }));
    await screen.findByText('Показано 101 из 101');
    expect(view.container.querySelectorAll('article')).toHaveLength(101);
    expect(
      [...view.container.querySelectorAll('h2')].slice(-2).map((node) => node.textContent),
    ).toEqual(['Событие 100', 'Событие 101']);
  });
  it('separates guest, participant and role caches and hides private data during identity changes', async () => {
    const privateItem = { ...event(1), title: 'Закрытое событие', meetingPoint: 'Секретное место' };
    const requests: string[] = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: Request) => {
        const path = new URL(input.url).pathname;
        requests.push(path);
        return response({
          ...data(1),
          items: path.includes('/public/')
            ? [event(1)]
            : [
                auth.me?.role === 'VOLUNTEER'
                  ? privateItem
                  : { ...privateItem, meetingPoint: undefined },
              ],
        });
      }),
    );
    const view = mount(data(1));
    auth.me = {
      id: 'member',
      role: 'VOLUNTEER',
      onboardingCompleted: true,
    } as Model<'MeResponseDto'>;
    view.update();
    await screen.findByText('Место сбора: Секретное место');
    expect(screen.getByRole('link', { name: 'Закрытое событие' })).toHaveAttribute(
      'href',
      '/events/0001',
    );
    auth.loading = true;
    view.update();
    expect(screen.queryByText('Закрытое событие')).not.toBeInTheDocument();
    expect(screen.getByText('Событие 1')).toBeInTheDocument();
    auth.loading = false;
    auth.me = { ...auth.me, role: 'CANDIDATE' };
    view.update();
    await screen.findByText('Закрытое событие');
    expect(screen.queryByText('Место сбора: Секретное место')).not.toBeInTheDocument();
    auth.me = null;
    view.update();
    await waitFor(() => expect(screen.queryByText('Закрытое событие')).not.toBeInTheDocument());
    expect(screen.getByText('Событие 1')).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Событие 1' })).not.toBeInTheDocument();
    expect(requests).toEqual(['/api/v1/calendar', '/api/v1/calendar']);
  });
});

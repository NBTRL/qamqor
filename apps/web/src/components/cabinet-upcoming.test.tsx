import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { Model } from '@/lib/api/client';
import { CabinetHome } from './cabinet';

vi.mock('./providers', () => ({
  useAuth: () => ({ me: { id: '11111111-1111-4111-8111-111111111111', fullName: 'Участник' } }),
}));

type Registration = Model<'MeRegistrationResponseDto'>;
const clients: QueryClient[] = [];
const json = (body: unknown) =>
  new Response(JSON.stringify(body), { headers: { 'Content-Type': 'application/json' } });
const page = (items: Registration[]) => ({ items, total: items.length, page: 1, limit: 6 });
const baseTime = Date.parse('2050-01-01T00:00:00Z');
const row = (id: number, minutes: number, extra: Partial<Registration> = {}): Registration => ({
  id: `11111111-1111-4111-8111-${String(id).padStart(12, '0')}`,
  entityId: `22222222-2222-4222-8222-${String(id).padStart(12, '0')}`,
  kind: 'EVENT',
  title: `Мероприятие ${id}`,
  startsAt: new Date(baseTime + minutes * 60000).toISOString(),
  status: 'CONFIRMED',
  ...extra,
});

function fixture(initial = [row(1, 1), row(2, 2)]) {
  const state = { items: initial, queries: [] as URLSearchParams[] };
  // The historical endpoint is ordered by registration creation, not event time.
  // The oldest-created nearest entry falls beyond its first hundred records.
  const historical = [...Array.from({ length: 101 }, (_, i) => row(i + 20, i + 200)), ...initial];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: Request) => {
      const url = new URL(input.url);
      if (url.pathname === '/api/v1/me/application')
        return json({ status: 'NEW', history: [], questionnaire: null, hasOpenDayAttended: false });
      if (url.pathname === '/api/v1/me/notifications') return json(page([]));
      expect(url.pathname).toBe('/api/v1/me/registrations');
      state.queries.push(url.searchParams);
      return json(
        url.searchParams.get('upcoming') === 'true'
          ? page(state.items)
          : { ...page(historical.slice(0, 100)), total: historical.length },
      );
    }),
  );
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, staleTime: Infinity, gcTime: Infinity } },
  });
  clients.push(client);
  render(
    <QueryClientProvider client={client}>
      <CabinetHome />
    </QueryClientProvider>,
  );
  return { state, client };
}
const registrationLinks = () =>
  screen
    .getAllByRole('link')
    .filter((link) => link.getAttribute('href') === '/cabinet/registrations');

afterEach(() => {
  clients.splice(0).forEach((client) => client.clear());
  vi.useRealTimers();
});

describe('cabinet upcoming registrations', () => {
  it('requests six server-selected upcoming entries and preserves mixed-type chronological order', async () => {
    vi.spyOn(Date, 'now').mockReturnValue(baseTime);
    const items = [
      row(1, 1, { kind: 'TRIP', title: 'Ближайшая давняя запись', status: 'PENDING' }),
      row(2, 2, { kind: 'OPEN_DAY', title: 'День открытых дверей', status: null }),
      row(3, 3, { kind: 'TRIP', title: 'Поездка из листа ожидания', status: 'WAITLIST' }),
      row(4, 4),
      row(5, 5),
      row(6, 6),
    ];
    const { state } = fixture(items);
    await waitFor(() => expect(state.queries).toHaveLength(1));
    expect(state.queries[0]!.get('upcoming')).toBe('true');
    expect(state.queries[0]!.get('limit')).toBe('6');
    await screen.findByRole('link', { name: 'Ближайшая давняя запись' });
    expect(registrationLinks().map((link) => link.textContent)).toEqual(
      items.map((item) => item.title),
    );
  });

  it('refreshes the upcoming list when existing registration cancellation invalidates its cache prefix', async () => {
    vi.spyOn(Date, 'now').mockReturnValue(baseTime);
    const { state, client } = fixture();
    await screen.findByRole('link', { name: 'Мероприятие 1' });
    state.items = [row(2, 2), row(3, 3)];
    await act(async () => {
      await client.invalidateQueries({ queryKey: ['registrations'] });
    });
    await screen.findByRole('link', { name: 'Мероприятие 3' });
    expect(screen.queryByRole('link', { name: 'Мероприятие 1' })).not.toBeInTheDocument();
    expect(state.queries).toHaveLength(2);
    expect(
      state.queries.every(
        (query) => query.get('upcoming') === 'true' && query.get('limit') === '6',
      ),
    ).toBe(true);
    expect(registrationLinks().map((link) => link.textContent)).toEqual([
      'Мероприятие 2',
      'Мероприятие 3',
    ]);
  });

  it('hides a cached entry once it has started without changing the remaining server order', async () => {
    vi.useFakeTimers({ toFake: ['Date', 'setInterval', 'clearInterval'] });
    vi.setSystemTime(baseTime);
    const { state } = fixture([row(1, 0.25), row(2, 2)]);
    await screen.findByRole('link', { name: 'Мероприятие 1' });
    await act(async () => {
      vi.advanceTimersByTime(30000);
    });
    expect(screen.queryByRole('link', { name: 'Мероприятие 1' })).not.toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Мероприятие 2' })).toBeInTheDocument();
    expect(state.queries).toHaveLength(1);
  });
});

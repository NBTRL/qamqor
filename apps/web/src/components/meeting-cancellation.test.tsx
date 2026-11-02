import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { AdminResource } from './admin';
import { EventDetail } from './trips';
import { MyRegistrations } from './cabinet';

vi.mock('./providers', () => ({ useAuth: () => ({ me: { id: 'member', role: 'VOLUNTEER' } }) }));
const clients: QueryClient[] = [];
afterEach(() => {
  clients.splice(0).forEach((client) => client.clear());
});
const json = (value: unknown, status = 200) =>
  new Response(JSON.stringify(value), { status, headers: { 'Content-Type': 'application/json' } });
const page = (items: unknown[]) => ({ items, total: items.length, page: 1, limit: 20 });
const meeting = {
  id: '11111111-1111-4111-8111-111111111111',
  title: 'Встреча клуба',
  type: 'CLUB_EVENT',
  startsAt: '2050-01-01T10:00:00Z',
  endsAt: '2050-01-01T12:00:00Z',
  location: 'Клуб',
  description: '',
  capacity: 20,
  cancelledAt: null as string | null,
  cancelReason: null as string | null,
};
function mount(node: React.ReactNode) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  clients.push(client);
  render(<QueryClientProvider client={client}>{node}</QueryClientProvider>);
}
function fixture(kind: 'events' | 'open-days') {
  let row = { ...meeting };
  const state = {
    fail: false,
    hold: false,
    release: () => {},
    writes: [] as { path: string; body: unknown }[],
  };
  vi.stubGlobal(
    'fetch',
    vi.fn(async (request: Request) => {
      const path = new URL(request.url).pathname;
      if (request.method === 'GET') return json(page([row]));
      state.writes.push({ path, body: await request.json() });
      if (state.hold)
        await new Promise<void>((resolve) => {
          state.release = resolve;
        });
      if (state.fail)
        return json({ code: 'CONFLICT', message: 'Не удалось отменить встречу' }, 409);
      row = { ...row, cancelledAt: '2026-11-02T10:00:00Z', cancelReason: 'Организатор заболел' };
      return json(row);
    }),
  );
  mount(<AdminResource resourceKey={kind} />);
  return state;
}
describe('Whole-meeting cancellation UI', () => {
  it.each(['events', 'open-days'] as const)(
    'cancels %s with a reason, refreshes history and removes unsafe actions',
    async (kind) => {
      const state = fixture(kind);
      fireEvent.click(await screen.findByRole('button', { name: 'Отменить встречу' }));
      const submit = screen.getByRole('button', { name: 'Подтвердить отмену встречи' });
      expect(submit).toBeDisabled();
      fireEvent.change(screen.getByLabelText('Причина отмены'), { target: { value: '  ' } });
      expect(submit).toBeDisabled();
      fireEvent.change(screen.getByLabelText('Причина отмены'), {
        target: { value: '  Организатор заболел  ' },
      });
      fireEvent.click(submit);
      await screen.findByText('Встреча отменена');
      expect(state.writes).toEqual([
        {
          path: `/api/v1/admin/${kind}/${meeting.id}/cancel`,
          body: { cancelReason: 'Организатор заболел' },
        },
      ]);
      expect(screen.queryByRole('button', { name: 'Отменить встречу' })).not.toBeInTheDocument();
      expect(screen.queryByRole('button', { name: 'Удалить' })).not.toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'Участники' })).toBeVisible();
      expect(screen.getByText('Организатор заболел')).toBeVisible();
    },
  );
  it('locks the submitted reason and prevents duplicate requests while saving', async () => {
    const state = fixture('events');
    state.hold = true;
    fireEvent.click(await screen.findByRole('button', { name: 'Отменить встречу' }));
    fireEvent.change(screen.getByLabelText('Причина отмены'), {
      target: { value: 'Организатор заболел' },
    });
    const submit = screen.getByRole('button', { name: 'Подтвердить отмену встречи' });
    fireEvent.click(submit);
    await waitFor(() => expect(submit).toBeDisabled());
    expect(screen.getByLabelText('Причина отмены')).toBeDisabled();
    fireEvent.click(submit);
    expect(state.writes).toHaveLength(1);
    await act(async () => state.release());
    await screen.findByText('Встреча отменена');
  });
  it('retains the reason after failure and allows retry', async () => {
    const state = fixture('open-days');
    state.fail = true;
    fireEvent.click(await screen.findByRole('button', { name: 'Отменить встречу' }));
    fireEvent.change(screen.getByLabelText('Причина отмены'), {
      target: { value: 'Организатор заболел' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Подтвердить отмену встречи' }));
    await screen.findByRole('alert');
    expect(screen.getByLabelText('Причина отмены')).toHaveValue('Организатор заболел');
    state.fail = false;
    fireEvent.click(screen.getByRole('button', { name: 'Подтвердить отмену встречи' }));
    await screen.findByText('Встреча отменена');
    expect(state.writes).toHaveLength(2);
  });
  it('shows cancellation on the event page without registration controls', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        json({ ...meeting, cancelledAt: '2026-11-02T10:00:00Z', cancelReason: 'Непогода' }),
      ),
    );
    mount(<EventDetail id={meeting.id} />);
    await screen.findByText(/Мероприятие отменено. Причина: Непогода/);
    expect(screen.getByRole('status')).toHaveTextContent('Регистрация закрыта');
    expect(screen.queryByRole('button', { name: /Записаться/ })).not.toBeInTheDocument();
  });
  it('retains the meeting and reason in registration history without a personal cancellation action', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        json(
          page([
            {
              id: 'registration',
              entityId: meeting.id,
              kind: 'OPEN_DAY',
              title: 'День открытых дверей',
              startsAt: meeting.startsAt,
              status: null,
              cancelledAt: '2026-11-02T10:00:00Z',
              entityCancelledAt: '2026-11-02T10:00:00Z',
              cancelReason: 'Непогода',
              attended: false,
            },
          ]),
        ),
      ),
    );
    mount(<MyRegistrations />);
    await screen.findByText('Встреча отменена. Причина: Непогода');
    expect(screen.queryByRole('button', { name: 'Отменить запись' })).not.toBeInTheDocument();
  });
});

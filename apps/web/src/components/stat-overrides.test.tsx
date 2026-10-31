import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { STAT_KEYS } from '@club/shared';
import type { Model, Page } from '@/lib/api/client';
import { StatOverrides } from './admin';

type Override = Model<'StatOverrideDto'>;
const clients: QueryClient[] = [];
const json = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json' } });

afterEach(() => {
  for (const client of clients) client.clear();
  clients.length = 0;
});

function fixture(initial: Override[] = []) {
  let stored = structuredClone(initial);
  let reads = 0;
  const writes: Model<'OverridesDto'>[] = [];
  const snapshot = (): Page<Override> => ({
    items: structuredClone(stored),
    total: stored.length,
    page: 1,
    limit: STAT_KEYS.length,
  });
  const server = {
    get: undefined as (() => Promise<Response> | Response) | undefined,
    put: undefined as ((body: Model<'OverridesDto'>) => Promise<Response> | Response) | undefined,
    snapshot,
    replace: (items: Override[]) => {
      stored = structuredClone(items);
    },
    writes,
    get reads() {
      return reads;
    },
  };
  vi.stubGlobal(
    'fetch',
    vi.fn(async (request: Request) => {
      expect(new URL(request.url).pathname).toBe('/api/v1/admin/stat-overrides');
      if (request.method === 'GET') {
        reads++;
        return server.get ? server.get() : json(snapshot());
      }
      expect(request.method).toBe('PUT');
      const body = (await request.json()) as Model<'OverridesDto'>;
      writes.push(body);
      if (server.put) return server.put(body);
      for (const item of body.items) {
        stored = stored.filter((row) => row.key !== item.key);
        if (item.value !== null) stored.push(item);
      }
      return json(snapshot());
    }),
  );
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, staleTime: Infinity, gcTime: Infinity } },
  });
  clients.push(client);
  const mount = () =>
    render(
      <QueryClientProvider client={client}>
        <StatOverrides />
      </QueryClientProvider>,
    );
  return { server, client, mount };
}

const save = () => screen.getByRole('button', { name: /^Сохранить счетчики$/ });
const places = () => screen.getByLabelText('Учреждения');

describe('Saved administrative counters', () => {
  it('keeps an override through remount and another save, and clears it only explicitly', async () => {
    const f = fixture();
    let view = f.mount();
    await screen.findByLabelText('Учреждения');
    fireEvent.change(places(), { target: { value: '42' } });
    fireEvent.click(save());
    await screen.findByText('Счетчики сохранены.');
    expect(f.server.snapshot().items).toContainEqual({ key: 'places', value: 42 });
    view.unmount();

    view = f.mount();
    await waitFor(() => expect(places()).toHaveValue(42));
    expect(f.server.reads).toBe(1);
    fireEvent.click(save());
    await waitFor(() => expect(f.server.writes).toHaveLength(2));
    await waitFor(() => expect(save()).toBeEnabled());
    expect(f.server.writes[1]?.items).toContainEqual({ key: 'places', value: 42 });

    fireEvent.change(places(), { target: { value: '' } });
    fireEvent.click(save());
    await waitFor(() => expect(f.server.writes).toHaveLength(3));
    await waitFor(() => expect(save()).toBeEnabled());
    expect(f.server.writes[2]?.items).toContainEqual({ key: 'places', value: null });
    expect(f.server.snapshot().items).not.toContainEqual({ key: 'places', value: 42 });
    view.unmount();
    f.mount();
    await waitFor(() => expect(places()).toHaveValue(null));
    expect(f.server.reads).toBe(1);
  });

  it('uses the returned server snapshot and invalidates the existing dashboard query', async () => {
    const f = fixture();
    f.client.setQueryData(['admin-dashboard'], { stats: { places: 1 } });
    f.server.put = () => {
      // The read after commit may include a newer value from another administrator.
      f.server.replace([{ key: 'places', value: 43 }]);
      return json(f.server.snapshot());
    };
    f.mount();
    await screen.findByLabelText('Учреждения');
    fireEvent.change(places(), { target: { value: '42' } });
    fireEvent.click(save());
    await screen.findByText('Счетчики сохранены.');
    await waitFor(() => expect(places()).toHaveValue(43));
    expect(f.client.getQueryData(['stat-overrides'])).toEqual(f.server.snapshot());
    expect(f.client.getQueryState(['admin-dashboard'])?.isInvalidated).toBe(true);
    fireEvent.click(save());
    await waitFor(() => expect(f.server.writes).toHaveLength(2));
    expect(f.server.writes[1]?.items).toContainEqual({ key: 'places', value: 43 });
  });

  it('locks in-flight edits and duplicate submits, retaining the draft after an error', async () => {
    const f = fixture();
    let finish!: (response: Response) => void;
    f.server.put = () => new Promise((resolve) => (finish = resolve));
    f.mount();
    await screen.findByLabelText('Учреждения');
    fireEvent.change(places(), { target: { value: '42' } });
    fireEvent.click(save());
    await waitFor(() => expect(f.server.writes).toHaveLength(1));
    expect(places()).toBeDisabled();
    await userEvent.type(places(), '99');
    expect(places()).toHaveValue(42);
    await act(async () => fireEvent.submit(save().closest('form')!));
    expect(f.server.writes).toHaveLength(1);
    await act(async () => finish(json({ code: 'VALIDATION_ERROR' }, 400)));
    await screen.findByRole('alert');
    expect(places()).toHaveValue(42);
    expect(places()).toBeEnabled();
    expect(f.client.getQueryData(['stat-overrides'])).toEqual({
      items: [],
      total: 0,
      page: 1,
      limit: STAT_KEYS.length,
    });
    f.server.put = undefined;
    fireEvent.click(save());
    await screen.findByText('Счетчики сохранены.');
    expect(f.server.writes[1]?.items).toContainEqual({ key: 'places', value: 42 });
  });

  it('refreshes untouched counters without overwriting an unsaved counter', async () => {
    const f = fixture([{ key: 'places', value: 1 }]);
    f.mount();
    await screen.findByLabelText('Учреждения');
    fireEvent.change(places(), { target: { value: '42' } });
    f.server.replace([
      { key: 'places', value: 2 },
      { key: 'curators', value: 7 },
    ]);
    await act(async () => {
      await f.client.invalidateQueries({ queryKey: ['stat-overrides'] });
    });
    expect(places()).toHaveValue(42);
    await waitFor(() => expect(screen.getByLabelText('Кураторы')).toHaveValue(7));
    fireEvent.click(save());
    await screen.findByText('Счетчики сохранены.');
    expect(f.server.writes[0]?.items).toEqual(
      expect.arrayContaining([
        { key: 'places', value: 42 },
        { key: 'curators', value: 7 },
      ]),
    );
  });

  it('does not let an older background read replace a confirmed save', async () => {
    const f = fixture([{ key: 'places', value: 1 }]);
    f.mount();
    await screen.findByLabelText('Учреждения');
    const oldSnapshot = f.server.snapshot();
    let finishRead!: (response: Response) => void;
    f.server.get = () => new Promise((resolve) => (finishRead = resolve));
    void f.client.invalidateQueries({ queryKey: ['stat-overrides'] });
    await waitFor(() => expect(f.server.reads).toBe(2));
    fireEvent.change(places(), { target: { value: '42' } });
    fireEvent.click(save());
    await screen.findByText('Счетчики сохранены.');
    await act(async () => finishRead(json(oldSnapshot)));
    expect(places()).toHaveValue(42);
    expect(f.client.getQueryData(['stat-overrides'])).toEqual(f.server.snapshot());
  });
});

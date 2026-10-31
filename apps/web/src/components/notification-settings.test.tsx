import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { NOTIFICATION_TYPES } from '@club/shared';
import type { Model, Page } from '@/lib/api/client';
import { Notifications, notificationTitle } from './cabinet';

const auth = vi.hoisted(() => ({ verified: true }));
vi.mock('./providers', () => ({
  useAuth: () => ({
    me: {
      id: '11111111-1111-4111-8111-111111111111',
      role: 'VOLUNTEER',
      emailVerifiedAt: auth.verified ? '2026-10-01T00:00:00Z' : null,
    },
  }),
}));

type Setting = Model<'SettingDto'>;
const clients: QueryClient[] = [];
const firstType = NOTIFICATION_TYPES[0]!;
const secondType = NOTIFICATION_TYPES[1]!;
const checkbox = (type: Setting['type'] = firstType, channel = 'Telegram') =>
  screen.getByRole('checkbox', { name: `${notificationTitle(type)}: ${channel}` });
const button = () => screen.getByRole('button', { name: 'Сохранить настройки' });
const response = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json' } });
const page = (items: Setting[]): Page<Setting> => ({
  items,
  total: items.length,
  page: 1,
  limit: items.length,
});

function fixture() {
  const state = {
    stored: NOTIFICATION_TYPES.map((type) => ({ type, telegram: true, email: true })) as Setting[],
    writes: [] as Setting[][],
    reads: 0,
    fail: false,
    hold: undefined as Promise<void> | undefined,
    holdRead: undefined as Promise<void> | undefined,
    normalize: (items: Setting[]) => items,
  };
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: Request) => {
      const path = new URL(input.url).pathname;
      if (path === '/api/v1/me/notifications') return response(page([]));
      expect(path).toBe('/api/v1/me/notification-settings');
      if (input.method === 'GET') {
        state.reads++;
        const snapshot = structuredClone(state.stored);
        await state.holdRead;
        return response(page(snapshot));
      } else {
        expect(input.method).toBe('PUT');
        const body = (await input.json()) as { items: Setting[] };
        state.writes.push(structuredClone(body.items));
        await state.hold;
        if (state.fail) return response({ code: 'INTERNAL_ERROR' }, 500);
        state.stored = state.normalize(body.items);
      }
      return response(page(state.stored));
    }),
  );
  const client = new QueryClient({
    defaultOptions: {
      queries: { retry: false, staleTime: 30000, gcTime: Infinity },
      mutations: { retry: false },
    },
  });
  clients.push(client);
  const mount = () =>
    render(
      <QueryClientProvider client={client}>
        <Notifications />
      </QueryClientProvider>,
    );
  return { state, client, mount };
}

beforeEach(() => {
  auth.verified = true;
});
afterEach(() => {
  clients.splice(0).forEach((client) => client.clear());
});

describe('Notification settings persistence', () => {
  it.each([false, true])(
    'keeps the saved choice on return and a repeated save (stale cache: %s)',
    async (stale) => {
      const { state, client, mount } = fixture();
      const view = mount();
      await screen.findByRole('button', { name: 'Сохранить настройки' });
      fireEvent.click(checkbox());
      fireEvent.click(button());
      await screen.findByText('Настройки сохранены.');
      expect(state.stored[0]!.telegram).toBe(false);
      view.unmount();
      if (stale)
        await client.invalidateQueries({
          queryKey: ['notification-settings'],
          refetchType: 'none',
        });
      const returned = mount();
      expect(checkbox()).not.toBeChecked();
      if (stale) await waitFor(() => expect(state.reads).toBe(2));
      else expect(state.reads).toBe(1);
      fireEvent.click(button());
      await waitFor(() => expect(state.writes).toHaveLength(2));
      await screen.findByText('Настройки сохранены.');
      expect(state.writes[1]![0]!.telegram).toBe(false);
      expect(state.stored[0]!.telegram).toBe(false);
      returned.unmount();
    },
  );

  it('uses the confirmed server response for the form and cache', async () => {
    const { state, client, mount } = fixture();
    state.normalize = (items) =>
      items.map((item) => (item.type === secondType ? { ...item, telegram: false } : item));
    const view = mount();
    await screen.findByRole('button', { name: 'Сохранить настройки' });
    fireEvent.click(checkbox());
    fireEvent.click(button());
    await screen.findByText('Настройки сохранены.');
    expect(checkbox(secondType)).not.toBeChecked();
    expect(client.getQueryData(['notification-settings'])).toEqual(page(state.stored));
    view.unmount();
  });

  it('does not let an older in-flight read replace the successful save', async () => {
    const { state, client, mount } = fixture();
    const view = mount();
    await screen.findByRole('button', { name: 'Сохранить настройки' });
    let release!: () => void;
    state.holdRead = new Promise<void>((resolve) => {
      release = resolve;
    });
    let reading!: Promise<void>;
    await act(async () => {
      reading = client.refetchQueries({ queryKey: ['notification-settings'], exact: true });
    });
    await waitFor(() => expect(state.reads).toBe(2));
    fireEvent.click(checkbox());
    fireEvent.click(button());
    await screen.findByText('Настройки сохранены.');
    await act(async () => {
      release();
      await reading;
    });
    expect(checkbox()).not.toBeChecked();
    expect(client.getQueryData(['notification-settings'])).toEqual(page(state.stored));
    view.unmount();
  });

  it('locks edits and duplicate submits while saving, keeping a failed draft for retry', async () => {
    const { state, client, mount } = fixture();
    let release!: () => void;
    state.hold = new Promise<void>((resolve) => {
      release = resolve;
    });
    state.fail = true;
    const view = mount();
    await screen.findByRole('button', { name: 'Сохранить настройки' });
    fireEvent.click(checkbox());
    const form = button().closest('form')!;
    fireEvent.submit(form);
    await waitFor(() => expect(state.writes).toHaveLength(1));
    expect(checkbox()).toBeDisabled();
    expect(checkbox(secondType)).toBeDisabled();
    expect(button()).toBeDisabled();
    const user = userEvent.setup();
    await user.click(checkbox());
    expect(checkbox()).not.toBeChecked();
    await act(async () => fireEvent.submit(form));
    expect(state.writes).toHaveLength(1);
    await act(async () => release());
    await screen.findByRole('alert');
    expect(checkbox()).toBeEnabled();
    expect(checkbox()).not.toBeChecked();
    expect(state.stored[0]!.telegram).toBe(true);
    expect(client.getQueryData(['notification-settings'])).toEqual(page(state.stored));
    state.fail = false;
    state.hold = undefined;
    fireEvent.click(button());
    await screen.findByText('Настройки сохранены.');
    expect(state.writes).toHaveLength(2);
    expect(state.stored[0]!.telegram).toBe(false);
    view.unmount();
  });

  it('refreshes pristine switches while retaining unsaved changes during a background refetch', async () => {
    const { state, client, mount } = fixture();
    const view = mount();
    await screen.findByRole('button', { name: 'Сохранить настройки' });
    state.stored = state.stored.map((item) =>
      item.type === firstType ? { ...item, telegram: false } : item,
    );
    await act(async () => {
      await client.invalidateQueries({ queryKey: ['notification-settings'] });
    });
    await waitFor(() => expect(checkbox()).not.toBeChecked());
    fireEvent.click(checkbox());
    state.stored = state.stored.map((item) =>
      item.type === secondType ? { ...item, telegram: false } : item,
    );
    await act(async () => {
      await client.invalidateQueries({ queryKey: ['notification-settings'] });
    });
    await waitFor(() => expect(checkbox(secondType)).not.toBeChecked());
    expect(checkbox()).toBeChecked();
    fireEvent.click(button());
    await screen.findByText('Настройки сохранены.');
    expect(state.stored[0]!.telegram).toBe(true);
    expect(state.stored[1]!.telegram).toBe(false);
    view.unmount();
  });

  it('keeps unverified email disabled and false after saving and refetching', async () => {
    auth.verified = false;
    const { state, client, mount } = fixture();
    const view = mount();
    await screen.findByRole('button', { name: 'Сохранить настройки' });
    expect(checkbox(firstType, 'e-mail')).toBeDisabled();
    expect(checkbox(firstType, 'e-mail')).not.toBeChecked();
    fireEvent.click(checkbox());
    fireEvent.click(button());
    await screen.findByText('Настройки сохранены.');
    expect(state.writes[0]!.every((item) => item.email === false)).toBe(true);
    state.stored = state.stored.map((item) => ({ ...item, email: true }));
    await act(async () => {
      await client.invalidateQueries({ queryKey: ['notification-settings'] });
    });
    expect(checkbox(firstType, 'e-mail')).toBeDisabled();
    expect(checkbox(firstType, 'e-mail')).not.toBeChecked();
    view.unmount();
  });

  it('clears an unsaved email choice when verification is lost without dropping other edits', async () => {
    const { state, client, mount } = fixture();
    state.stored = state.stored.map((item) => ({ ...item, email: false }));
    const view = mount();
    await screen.findByRole('button', { name: 'Сохранить настройки' });
    fireEvent.click(checkbox(firstType, 'e-mail'));
    fireEvent.click(checkbox());
    expect(checkbox(firstType, 'e-mail')).toBeChecked();
    auth.verified = false;
    view.rerender(
      <QueryClientProvider client={client}>
        <Notifications />
      </QueryClientProvider>,
    );
    await waitFor(() => expect(checkbox(firstType, 'e-mail')).not.toBeChecked());
    expect(checkbox(firstType, 'e-mail')).toBeDisabled();
    expect(checkbox()).not.toBeChecked();
    fireEvent.click(button());
    await screen.findByText('Настройки сохранены.');
    expect(state.stored[0]!).toMatchObject({ telegram: false, email: false });
    view.unmount();
  });
});

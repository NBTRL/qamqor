import { describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { Model, Page } from '@/lib/api/client';
import { PlaceNeeds } from './curator';

const placeId = '11111111-1111-4111-8111-111111111111';
const needId = '22222222-2222-4222-8222-222222222222';
const endpoint = `/api/v1/curator/places/${placeId}/needs`;
const response = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json' } });
const page = (items: Model<'NeedResponseDto'>[]): Page<Model<'NeedResponseDto'>> => ({
  items,
  total: items.length,
  page: 1,
  limit: 100,
});
function createClient() {
  return new QueryClient({
    defaultOptions: { queries: { retry: false, staleTime: Infinity, gcTime: Infinity } },
  });
}
function mount(client = createClient()) {
  return {
    ...render(
      <QueryClientProvider client={client}>
        <PlaceNeeds id={placeId} />
      </QueryClientProvider>,
    ),
    client,
  };
}
async function addNeed() {
  fireEvent.click(await screen.findByRole('button', { name: 'Добавить потребность' }));
  fireEvent.change(screen.getByLabelText('Название'), { target: { value: 'Книги для занятий' } });
  fireEvent.change(screen.getByLabelText('Описание'), { target: { value: 'Первое описание' } });
}

describe('Curator needs saving', () => {
  it('keeps server IDs for subsequent edits and synchronizes the cached form on remount', async () => {
    const requests: Model<'NeedsWriteDto'>[] = [];
    const stored: Model<'NeedResponseDto'>[] = [];
    let reads = 0;
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: Request) => {
        expect(new URL(input.url).pathname).toBe(endpoint);
        if (input.method === 'GET') {
          reads++;
          return response(page(stored));
        }
        expect(input.method).toBe('PATCH');
        const body = (await input.json()) as Model<'NeedsWriteDto'>;
        requests.push(body);
        for (const item of body.items) {
          if (item.id)
            Object.assign(
              stored.find((row) => row.id === item.id)!,
              item,
            );
          else stored.push({ ...item, id: needId, placeId, isActive: item.isActive ?? true });
        }
        return response(page(stored));
      }),
    );
    const client = createClient();
    client.setQueryData(['public-needs', placeId], page([]));
    const view = mount(client);
    await addNeed();
    fireEvent.click(screen.getByRole('button', { name: 'Сохранить нужды' }));
    await screen.findByText('Нужды сохранены.');
    expect(requests[0]!.items[0]!.id).toBeUndefined();
    expect(view.client.getQueryData(['needs', placeId])).toEqual(page(stored));
    expect(view.client.getQueryState(['public-needs', placeId])?.isInvalidated).toBe(true);
    expect(screen.queryByRole('button', { name: 'Убрать' })).not.toBeInTheDocument();

    fireEvent.change(screen.getByLabelText('Описание'), {
      target: { value: 'Обновлённое описание' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Сохранить нужды' }));
    await waitFor(() => expect(requests).toHaveLength(2));
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Сохранить нужды' })).toBeEnabled(),
    );
    expect(requests[1]!.items).toEqual([
      {
        id: needId,
        title: 'Книги для занятий',
        description: 'Обновлённое описание',
        isActive: true,
      },
    ]);
    expect(stored).toHaveLength(1);
    expect(view.client.getQueryData(['needs', placeId])).toEqual(page(stored));

    view.unmount();
    const remounted = mount(view.client);
    expect(await screen.findByLabelText('Описание')).toHaveValue('Обновлённое описание');
    expect(reads).toBe(1);
    fireEvent.change(screen.getByLabelText('Название'), { target: { value: 'Книги и альбомы' } });
    fireEvent.click(screen.getByRole('button', { name: 'Сохранить нужды' }));
    await waitFor(() => expect(requests).toHaveLength(3));
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Сохранить нужды' })).toBeEnabled(),
    );
    expect(requests[2]!.items[0]!.id).toBe(needId);
    expect(stored).toHaveLength(1);
    expect(stored[0]!.title).toBe('Книги и альбомы');
    remounted.unmount();
    view.client.clear();
  });

  it('prevents edits while saving and retains the draft when the request fails', async () => {
    let finish!: (value: Response) => void;
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: Request) =>
        input.method === 'GET'
          ? response(page([]))
          : new Promise<Response>((resolve) => {
              finish = resolve;
            }),
      ),
    );
    const view = mount();
    await addNeed();
    fireEvent.click(screen.getByRole('button', { name: 'Сохранить нужды' }));
    await waitFor(() => expect(screen.getByLabelText('Описание')).toBeDisabled());
    expect(screen.getByLabelText('Название')).toBeDisabled();
    expect(screen.getByLabelText('Актуально')).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Добавить потребность' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Убрать' })).toBeDisabled();
    const user = userEvent.setup();
    await user.type(screen.getByLabelText('Описание'), 'неприменённая правка');
    expect(screen.getByLabelText('Описание')).toHaveValue('Первое описание');

    await act(async () => finish(response({ code: 'INTERNAL_ERROR' }, 500)));
    await waitFor(() => expect(screen.getByLabelText('Описание')).toBeEnabled());
    expect(screen.getByLabelText('Название')).toHaveValue('Книги для занятий');
    expect(screen.getByLabelText('Описание')).toHaveValue('Первое описание');
    expect(screen.getByRole('button', { name: 'Убрать' })).toBeEnabled();
    expect(view.client.getQueryData(['needs', placeId])).toEqual(page([]));
    expect(screen.getByRole('alert')).toBeInTheDocument();
    view.unmount();
    view.client.clear();
  });
});

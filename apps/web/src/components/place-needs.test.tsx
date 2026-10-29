import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { PlaceNeeds, PlaceNeedsPreview } from './place-needs';
import type { Model } from '@/lib/api/client';

const placeId = '11111111-1111-4111-8111-111111111111';
const otherId = '22222222-2222-4222-8222-222222222222';
const need = (n: number, id = placeId) => ({
  id: String(n),
  placeId: id,
  title: `Нужда ${n}`,
  description: `Описание ${n}`,
  isActive: true,
});
const response = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json' } });
function mount(id = placeId) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <PlaceNeeds placeId={id} />
    </QueryClientProvider>,
  );
}
describe('Public place needs', () => {
  it('loads the second page without losing the first and scopes requests to the place', async () => {
    const requests: URL[] = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: Request) => {
        const url = new URL(input.url);
        requests.push(url);
        const page = Number(url.searchParams.get('page'));
        return response({
          items: page === 1 ? Array.from({ length: 20 }, (_, i) => need(i + 1)) : [need(21)],
          total: 21,
          page,
          limit: 20,
        });
      }),
    );
    mount();
    expect(await screen.findByText('Нужда 20')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Загрузить ещё' }));
    expect(await screen.findByText('Нужда 21')).toBeInTheDocument();
    expect(screen.getByText('Нужда 1')).toBeInTheDocument();
    expect(screen.getByRole('status')).toHaveTextContent('Показано 21 из 21');
    expect(screen.queryByRole('button', { name: 'Загрузить ещё' })).not.toBeInTheDocument();
    expect(requests.map((url) => url.searchParams.get('page'))).toEqual(['1', '2']);
    expect(requests.every((url) => url.searchParams.get('placeId') === placeId)).toBe(true);
  });
  it('shows an empty state when no active needs are published', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => response({ items: [], total: 0, page: 1, limit: 20 })),
    );
    mount();
    expect(
      await screen.findByText('Сейчас у учреждения нет опубликованных нужд.'),
    ).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Загрузить ещё' })).not.toBeInTheDocument();
  });
  it('offers retry after an error instead of claiming there are no needs', async () => {
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(response({ code: 'INTERNAL_ERROR' }, 500))
      .mockResolvedValueOnce(response({ items: [need(1)], total: 1, page: 1, limit: 20 }));
    vi.stubGlobal('fetch', fetch);
    mount();
    fireEvent.click(await screen.findByRole('button', { name: 'Повторить загрузку' }));
    expect(await screen.findByText('Нужда 1')).toBeInTheDocument();
    expect(
      screen.queryByText('Сейчас у учреждения нет опубликованных нужд.'),
    ).not.toBeInTheDocument();
  });
  it('does not render another place or inactive items, and treats descriptions as plain text', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        response({
          items: [
            { ...need(1), description: '<img src=x onerror=alert(1)>' },
            need(2, otherId),
            { ...need(3), isActive: false },
          ],
          total: 3,
          page: 1,
          limit: 20,
        }),
      ),
    );
    const view = mount();
    expect(await screen.findByText('<img src=x onerror=alert(1)>')).toBeInTheDocument();
    expect(screen.queryByText('Нужда 2')).not.toBeInTheDocument();
    expect(screen.queryByText('Нужда 3')).not.toBeInTheDocument();
    expect(view.container.querySelector('img')).toBeNull();
  });
  it('links a card preview to the full needs section', () => {
    const place = {
      slug: 'test-place',
      needs: [need(1)],
      needsTotal: 21,
    } as Model<'PlaceResponseDto'>;
    render(<PlaceNeedsPreview place={place} />);
    expect(screen.getByText('Нужда 1')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Все нужды (21)' })).toHaveAttribute(
      'href',
      '/uchrezhdeniya/test-place#needs',
    );
  });
});

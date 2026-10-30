import { describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { DataTable, type TableQuery } from './data-table';

describe('DataTable after deleting records', () => {
  it.each([20, 0])('returns to an existing page when only %i rows remain', async (remaining) => {
    let records = Array.from({ length: 21 }, (_, index) => ({
      id: String(index + 1),
      title: `Запись ${index + 1}`,
    }));
    const load = vi.fn(async ({ page, limit }: TableQuery) => ({
      items: records.slice((page - 1) * limit, page * limit),
      total: records.length,
      page,
      limit,
    }));
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={client}>
        <DataTable
          name="records"
          load={load}
          columns={[{ title: 'Название', cell: (row) => row.title }]}
        />
      </QueryClientProvider>,
    );
    await screen.findByText('Запись 1');
    fireEvent.click(screen.getByRole('button', { name: 'Вперёд' }));
    await screen.findByText('Запись 21');
    records = records.slice(0, remaining);
    await act(async () => {
      await client.invalidateQueries({ queryKey: ['table', 'records'] });
    });
    await screen.findByText(`Страница 1 · всего ${remaining}`);
    expect(screen.getByRole('button', { name: 'Назад' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Вперёд' })).toBeDisabled();
    if (remaining) expect(await screen.findByText('Запись 1')).toBeInTheDocument();
    else expect(screen.getByText('Здесь пока ничего нет.')).toBeInTheDocument();
    expect(load).toHaveBeenLastCalledWith({ page: 1, limit: 20 });
    client.clear();
  });

  it('does not describe a failed initial request as an empty table', async () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={client}>
        <DataTable
          name="failed"
          load={async () => {
            throw new Error('Сервис недоступен');
          }}
          columns={[]}
        />
      </QueryClientProvider>,
    );
    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('Сервис недоступен'));
    expect(screen.queryByText('Здесь пока ничего нет.')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Назад' })).not.toBeInTheDocument();
    client.clear();
  });
});

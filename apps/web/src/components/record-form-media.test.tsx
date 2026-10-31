import { afterEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { RecordForm } from './record-form';
const clients: QueryClient[] = [];
afterEach(() => {
  clients.forEach((client) => client.clear());
  clients.length = 0;
});
describe('CMS media upload controls', () => {
  it('shows an image upload only for PHOTO and reacts to type changes', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async () =>
          new Response(JSON.stringify({ items: [], total: 0, page: 1, limit: 100 }), {
            headers: { 'Content-Type': 'application/json' },
          }),
      ),
    );
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    clients.push(client);
    render(
      <QueryClientProvider client={client}>
        <RecordForm schemaName="MediaItemWriteDto" initial={{ type: 'VIDEO' }} onSave={vi.fn()} />
      </QueryClientProvider>,
    );
    await screen.findByRole('option', { name: 'Видео' });
    expect(screen.queryByLabelText('Загрузить изображение')).not.toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('Тип'), { target: { value: 'PHOTO' } });
    expect(screen.getByLabelText('Загрузить изображение')).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('Тип'), { target: { value: 'VIDEO' } });
    expect(screen.queryByLabelText('Загрузить изображение')).not.toBeInTheDocument();
    expect(screen.getByLabelText('Ссылка')).toBeInTheDocument();
  });
  it('does not attach an image upload to a press publication URL', () => {
    const client = new QueryClient();
    clients.push(client);
    render(
      <QueryClientProvider client={client}>
        <RecordForm schemaName="PressWriteDto" onSave={vi.fn()} />
      </QueryClientProvider>,
    );
    expect(screen.queryByLabelText('Загрузить изображение')).not.toBeInTheDocument();
  });
});

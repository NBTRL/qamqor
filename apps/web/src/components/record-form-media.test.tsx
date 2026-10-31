import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { RecordForm } from './record-form';
const clients: QueryClient[] = [];
const albumId = '11111111-1111-4111-8111-111111111111';
const photoUrl = 'http://localhost:3000/api/v1/files/22222222-2222-4222-8222-222222222222';
const videoUrl = 'https://media.example.test/video.mp4';
const albums = () =>
  new Response(
    JSON.stringify({ items: [{ id: albumId, title: 'Альбом' }], total: 1, page: 1, limit: 100 }),
    { headers: { 'Content-Type': 'application/json' } },
  );
function mediaForm(
  initial: Record<string, unknown>,
  onSave = vi.fn(async (_body: unknown) => ({})),
) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  clients.push(client);
  render(
    <QueryClientProvider client={client}>
      <RecordForm
        schemaName="MediaItemWriteDto"
        initial={{ albumId, ...initial }}
        onSave={onSave}
      />
    </QueryClientProvider>,
  );
  return onSave;
}
afterEach(() => {
  clients.forEach((client) => client.clear());
  clients.length = 0;
});
describe('CMS media upload controls', () => {
  it.each([
    { type: 'PHOTO', url: photoUrl, nextType: 'VIDEO', nextUrl: videoUrl },
    { type: 'VIDEO', url: videoUrl, nextType: 'PHOTO', nextUrl: photoUrl },
  ])(
    'clears the previous URL on $type → $nextType and requires a replacement',
    async ({ type, url, nextType, nextUrl }) => {
      vi.stubGlobal(
        'fetch',
        vi.fn(async () => albums()),
      );
      const save = mediaForm({ type, url, caption: 'Подпись остаётся' });
      await screen.findByRole('option', { name: 'Альбом' });
      expect(screen.getByLabelText('Ссылка')).toHaveValue(url);
      fireEvent.change(screen.getByLabelText('Тип'), { target: { value: nextType } });
      expect(screen.getByLabelText('Ссылка')).toHaveValue('');
      expect(screen.getByLabelText('Подпись')).toHaveValue('Подпись остаётся');
      const form = screen.getByRole('button', { name: /^Сохранить$/ }).closest('form')!;
      fireEvent.submit(form);
      await screen.findByText('Введите ссылку с http:// или https://.');
      expect(save).not.toHaveBeenCalled();
      fireEvent.change(screen.getByLabelText('Ссылка'), { target: { value: nextUrl } });
      fireEvent.submit(form);
      await waitFor(() => expect(save).toHaveBeenCalledOnce());
      expect(save.mock.calls[0]?.[0]).toMatchObject({
        type: nextType,
        url: nextUrl,
        caption: 'Подпись остаётся',
      });
    },
  );

  it('keeps the existing URL when the media type is unchanged', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => albums()),
    );
    const save = mediaForm({ type: 'PHOTO', url: photoUrl });
    await screen.findByRole('option', { name: 'Альбом' });
    fireEvent.change(screen.getByLabelText('Тип'), { target: { value: 'PHOTO' } });
    fireEvent.submit(screen.getByRole('button', { name: /^Сохранить$/ }).closest('form')!);
    await waitFor(() => expect(save).toHaveBeenCalledOnce());
    expect(save.mock.calls[0]?.[0]).toMatchObject({ type: 'PHOTO', url: photoUrl });
  });

  it('does not restore an old image after switching type while its upload is pending', async () => {
    let finishUpload!: (response: Response) => void;
    let uploadSignal: AbortSignal | undefined;
    const pending = new Promise<Response>((resolve) => {
      finishUpload = resolve;
    });
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL, options?: RequestInit) => {
        const url = input instanceof Request ? input.url : String(input);
        if (url === 'https://upload.example.test/') {
          uploadSignal = options?.signal ?? undefined;
          return pending;
        }
        if (url.endsWith('/api/v1/uploads/presign'))
          return new Response(
            JSON.stringify({
              url: 'https://upload.example.test/',
              fields: {},
              uploadId: albumId,
              fileUrl: photoUrl,
            }),
            { headers: { 'Content-Type': 'application/json' } },
          );
        return albums();
      }),
    );
    const save = mediaForm({ type: 'PHOTO', url: photoUrl });
    await screen.findByRole('option', { name: 'Альбом' });
    fireEvent.change(screen.getByLabelText('Загрузить изображение'), {
      target: { files: [new File(['png'], 'photo.png', { type: 'image/png' })] },
    });
    await screen.findByText('Загрузка…');
    await waitFor(() => expect(uploadSignal).toBeDefined());
    fireEvent.change(screen.getByLabelText('Тип'), { target: { value: 'VIDEO' } });
    expect(uploadSignal?.aborted).toBe(true);
    expect(screen.getByLabelText('Ссылка')).toHaveValue('');
    fireEvent.change(screen.getByLabelText('Ссылка'), { target: { value: videoUrl } });
    await act(async () => {
      finishUpload(new Response(null, { status: 204 }));
      await pending;
    });
    expect(screen.getByLabelText('Ссылка')).toHaveValue(videoUrl);
    fireEvent.submit(screen.getByRole('button', { name: /^Сохранить$/ }).closest('form')!);
    await waitFor(() => expect(save).toHaveBeenCalledOnce());
    expect(save.mock.calls[0]?.[0]).toMatchObject({ type: 'VIDEO', url: videoUrl });
  });

  it.each(['PHOTO', 'VIDEO'] as const)(
    'sends an explicit empty caption when clearing a %s caption',
    async (type) => {
      const albumId = '11111111-1111-4111-8111-111111111111';
      vi.stubGlobal(
        'fetch',
        vi.fn(
          async () =>
            new Response(
              JSON.stringify({
                items: [{ id: albumId, title: 'Тестовый альбом' }],
                total: 1,
                page: 1,
                limit: 100,
              }),
              { headers: { 'Content-Type': 'application/json' } },
            ),
        ),
      );
      const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
      clients.push(client);
      const save = vi.fn(async (_body: unknown) => ({ ok: true }));
      render(
        <QueryClientProvider client={client}>
          <RecordForm
            schemaName="MediaItemWriteDto"
            initial={{
              albumId,
              type,
              url:
                type === 'PHOTO'
                  ? 'https://example.test/photo.png'
                  : 'https://example.test/video.mp4',
              caption: 'Прежняя подпись',
              isPublic: true,
              sortOrder: 0,
            }}
            onSave={save}
          />
        </QueryClientProvider>,
      );
      await screen.findByRole('option', { name: 'Тестовый альбом' });
      fireEvent.change(screen.getByLabelText('Подпись'), { target: { value: '' } });
      fireEvent.submit(screen.getByRole('button', { name: /^Сохранить$/ }).closest('form')!);
      await waitFor(() => expect(save).toHaveBeenCalledOnce());
      // Assert the wire payload: an undefined property would disappear from JSON.
      const body = JSON.parse(JSON.stringify(save.mock.calls[0]![0]));
      expect(body).toMatchObject({ albumId, type, caption: '', isPublic: true, sortOrder: 0 });
      expect(body.url).toContain(type === 'PHOTO' ? 'photo.png' : 'video.mp4');
    },
  );

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

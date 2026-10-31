import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { Model } from '@/lib/api/client';
import { RecordForm } from './record-form';

vi.mock('next/dynamic', async () => {
  const { default: Editor } = await import('./editor');
  return { default: () => Editor };
});

const clients: QueryClient[] = [];
const oldUrl = 'https://images.example/old.png';
const newUrl = 'https://images.example/new.png';
const json = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json' } });
const upload: Model<'PresignResponseDto'> = {
  uploadId: 'c8dc53c7-6548-4334-8bc9-e2a75fd0dacc',
  fileUrl: newUrl,
  url: 'https://storage.example/upload',
  fields: { key: 'new.png' },
  expiresAt: '2026-11-01T00:00:00.000Z',
  maxSizeBytes: 10000000,
};

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => (resolve = done));
  return { promise, resolve };
}

afterEach(() => {
  for (const client of clients) client.clear();
  clients.length = 0;
});

function fixture(news = false) {
  const presign = deferred<Response>();
  const storage = deferred<Response>();
  let presignCalls = 0;
  let storageCalls = 0;
  const server = {
    presign: () => presign.promise,
    storage: () => storage.promise,
    get presignCalls() {
      return presignCalls;
    },
    get storageCalls() {
      return storageCalls;
    },
  };
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: Request | string) => {
      const url = typeof input === 'string' ? input : input.url;
      if (url === upload.url) {
        storageCalls++;
        return server.storage();
      }
      expect(new URL(url).pathname).toBe('/api/v1/uploads/presign');
      presignCalls++;
      return server.presign();
    }),
  );
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  clients.push(client);
  const onSave = vi.fn(async (body: unknown) => body);
  const onDone = vi.fn();
  render(
    <QueryClientProvider client={client}>
      <RecordForm
        schemaName={news ? 'NewsWriteDto' : 'PartnerWriteDto'}
        initial={
          news
            ? {
                slug: 'news',
                title: 'Новость',
                bodyHtml: '<p>Текст новости</p>',
                excerpt: 'Краткое описание',
                coverUrl: oldUrl,
              }
            : { slug: 'partner', name: 'Партнёр', logoUrl: oldUrl }
        }
        onSave={onSave}
        onDone={onDone}
      />
    </QueryClientProvider>,
  );
  const save = screen.getByRole('button', { name: /^Сохранить$/ });
  const file = screen.getAllByLabelText('Загрузить изображение').at(-1)!;
  const choose = () =>
    fireEvent.change(file, {
      target: { files: [new File(['image'], 'new.png', { type: 'image/png' })] },
    });
  const submit = async () => act(async () => fireEvent.submit(save.closest('form')!));
  return { server, presign, storage, onSave, onDone, save, file, choose, submit };
}

describe('RecordForm attachments', () => {
  it('blocks saving through both upload stages and saves only the completed new URL', async () => {
    const f = fixture();
    f.choose();
    await screen.findByText('Загрузка…');
    expect(f.save).toBeDisabled();
    await f.submit();
    expect(f.onSave).not.toHaveBeenCalled();
    expect(f.onDone).not.toHaveBeenCalled();
    await act(async () => f.presign.resolve(json(upload)));
    await waitFor(() => expect(f.server.storageCalls).toBe(1));
    expect(f.save).toBeDisabled();
    await f.submit();
    expect(f.onSave).not.toHaveBeenCalled();
    await act(async () => f.storage.resolve(new Response(null, { status: 204 })));
    await waitFor(() => expect(f.save).toBeEnabled());
    await f.submit();
    await waitFor(() => expect(f.onSave).toHaveBeenCalledOnce());
    expect(f.onSave.mock.calls[0]?.[0]).toMatchObject({ logoUrl: newUrl });
    await waitFor(() => expect(f.onDone).toHaveBeenCalledOnce());
  });

  it('keeps a failed selected image blocked until its retry succeeds', async () => {
    const f = fixture();
    f.choose();
    await act(async () => f.presign.resolve(json(upload)));
    await waitFor(() => expect(f.server.storageCalls).toBe(1));
    await act(async () => f.storage.resolve(new Response(null, { status: 503 })));
    await screen.findByRole('alert');
    expect(f.save).toBeDisabled();
    await f.submit();
    expect(f.onSave).not.toHaveBeenCalled();
    expect(screen.getByLabelText('Логотип')).toHaveValue(oldUrl);

    f.server.presign = async () => json(upload);
    f.server.storage = async () => new Response(null, { status: 204 });
    fireEvent.click(screen.getByRole('button', { name: /^Повторить загрузку$/ }));
    await waitFor(() => expect(f.save).toBeEnabled());
    await f.submit();
    await waitFor(() => expect(f.onSave).toHaveBeenCalledOnce());
    expect(f.onSave.mock.calls[0]?.[0]).toMatchObject({ logoUrl: newUrl });
  });

  it('allows the previous URL only after explicitly abandoning a failed new image', async () => {
    const f = fixture();
    f.choose();
    await act(async () => f.presign.resolve(json({ code: 'VALIDATION_ERROR' }, 400)));
    await screen.findByRole('alert');
    expect(f.save).toBeDisabled();
    await f.submit();
    expect(f.onSave).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: /^Не использовать выбранный файл$/ }));
    expect(f.save).toBeEnabled();
    await f.submit();
    await waitFor(() => expect(f.onSave).toHaveBeenCalledOnce());
    expect(f.onSave.mock.calls[0]?.[0]).toMatchObject({ logoUrl: oldUrl });
  });

  it('ignores a cancelled late upload and prevents new attachments during a save', async () => {
    const f = fixture();
    f.choose();
    await screen.findByText('Загрузка…');
    fireEvent.click(screen.getByRole('button', { name: /^Отменить загрузку$/ }));
    expect(f.save).toBeEnabled();
    await act(async () => f.presign.resolve(json(upload)));
    expect(f.server.storageCalls).toBe(0);
    expect(screen.getByLabelText('Логотип')).toHaveValue(oldUrl);

    const saved = deferred<unknown>();
    f.onSave.mockImplementationOnce(() => saved.promise);
    await f.submit();
    await waitFor(() => expect(f.onSave).toHaveBeenCalledOnce());
    expect(f.file).toBeDisabled();
    expect(f.save).toBeDisabled();
    await f.submit();
    expect(f.onSave).toHaveBeenCalledOnce();
    expect(f.onSave.mock.calls[0]?.[0]).toMatchObject({ logoUrl: oldUrl });
    await act(async () => saved.resolve({ ok: true }));
    await waitFor(() => expect(f.file).toBeEnabled());
  });

  it('tracks cover and rich-text image uploads independently until both finish', async () => {
    // jsdom has no layout; ProseMirror scrolls a DOM Range when inserting an image.
    const createRange = document.createRange.bind(document);
    vi.spyOn(document, 'createRange').mockImplementation(() => {
      const range = createRange();
      range.getClientRects = () => [] as unknown as DOMRectList;
      range.getBoundingClientRect = () => new DOMRect();
      return range;
    });
    const f = fixture(true);
    await screen.findByRole('textbox', { name: 'Текст материала' });
    const files = screen.getAllByLabelText('Загрузить изображение');
    expect(files).toHaveLength(2);
    const editorPresign = deferred<Response>();
    const coverPresign = deferred<Response>();
    const editorStorage = deferred<Response>();
    const coverStorage = deferred<Response>();
    f.server.presign = () =>
      f.server.presignCalls === 1 ? editorPresign.promise : coverPresign.promise;
    let writes = 0;
    f.server.storage = () => (++writes === 1 ? editorStorage.promise : coverStorage.promise);
    fireEvent.change(files[0]!, {
      target: { files: [new File(['inline'], 'inline.png', { type: 'image/png' })] },
    });
    fireEvent.change(files[1]!, {
      target: { files: [new File(['cover'], 'cover.png', { type: 'image/png' })] },
    });
    expect(f.save).toBeDisabled();
    await act(async () =>
      editorPresign.resolve(json({ ...upload, fileUrl: 'https://images.example/inline.png' })),
    );
    await waitFor(() => expect(f.server.storageCalls).toBe(1));
    await act(async () => editorStorage.resolve(new Response(null, { status: 204 })));
    await screen.findByText('Загружен: inline.png');
    expect(f.save).toBeDisabled();
    await f.submit();
    expect(f.onSave).not.toHaveBeenCalled();
    await act(async () => coverPresign.resolve(json(upload)));
    await waitFor(() => expect(f.server.storageCalls).toBe(2));
    await act(async () => coverStorage.resolve(new Response(null, { status: 204 })));
    await waitFor(() => expect(f.save).toBeEnabled());
    await f.submit();
    await waitFor(() => expect(f.onSave).toHaveBeenCalledOnce());
    expect(f.onSave.mock.calls[0]?.[0]).toMatchObject({
      coverUrl: newUrl,
      bodyHtml: expect.stringContaining('https://images.example/inline.png'),
    });
  });
});

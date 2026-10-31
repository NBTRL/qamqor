import { describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { UPLOAD_IMAGE_MAX_BYTES, UPLOAD_PDF_MAX_BYTES } from '@club/shared';
import { Upload } from './upload';
import { useUploadGuard } from './upload-guard';

const json = (value: unknown) =>
  new Response(JSON.stringify(value), { headers: { 'Content-Type': 'application/json' } });
const upload = (id: string) => ({
  uploadId: id,
  fileUrl: `https://files.test/${id}.png`,
  url: `https://storage.test/${id}`,
  fields: { key: id },
});
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}
function choose(name = 'image.png', type = 'image/png') {
  fireEvent.change(screen.getByLabelText('Загрузить изображение'), {
    target: { files: [new File(['image'], name, { type })] },
  });
}

it('aborts a cancelled transfer and ignores its late completion during a replacement upload', async () => {
  const oldTransfer = deferred<Response>();
  const newTransfer = deferred<Response>();
  const uploaded = vi.fn();
  const status = vi.fn();
  let calls = 0;
  let oldSignal: AbortSignal | undefined;
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: Request | string, init?: RequestInit) => {
      if (typeof input !== 'string') return json(upload(String(++calls)));
      if (input.endsWith('/1')) {
        oldSignal = init?.signal ?? undefined;
        return oldTransfer.promise;
      }
      return newTransfer.promise;
    }),
  );
  render(<Upload purpose="CONTENT" onUploaded={uploaded} onStateChange={status} />);
  choose();
  await waitFor(() => expect(oldSignal).toBeDefined());
  fireEvent.click(screen.getByRole('button', { name: 'Отменить загрузку' }));
  expect(oldSignal?.aborted).toBe(true);
  choose('replacement.png');
  await waitFor(() => expect(calls).toBe(2));
  await act(async () => oldTransfer.resolve(new Response(null, { status: 204 })));
  expect(uploaded).not.toHaveBeenCalled();
  expect(screen.getByText('Загрузка…')).toBeInTheDocument();
  expect(status.mock.lastCall?.[1]).toBe('pending');
  await act(async () => newTransfer.resolve(new Response(null, { status: 204 })));
  await waitFor(() => expect(uploaded).toHaveBeenCalledWith(upload('2')));
  expect(status.mock.lastCall?.[1]).toBe('idle');
  expect(screen.getByText('Загружен: replacement.png')).toBeInTheDocument();
});

it('does not start storage POST when a cancelled presign response arrives late', async () => {
  const presign = deferred<Response>();
  const uploaded = vi.fn();
  const fetcher = vi.fn(() => presign.promise);
  vi.stubGlobal('fetch', fetcher);
  render(<Upload purpose="CONTENT" onUploaded={uploaded} />);
  choose();
  await waitFor(() => expect(fetcher).toHaveBeenCalledTimes(1));
  fireEvent.click(screen.getByRole('button', { name: 'Отменить загрузку' }));
  await act(async () => presign.resolve(json(upload('cancelled'))));
  expect(fetcher).toHaveBeenCalledTimes(1);
  expect(uploaded).not.toHaveBeenCalled();
  expect(screen.queryByText('Загрузка…')).not.toBeInTheDocument();
});

it('removes an unmounted uploader from the guard and aborts its request', async () => {
  const presign = deferred<Response>();
  let signal: AbortSignal | undefined;
  vi.stubGlobal(
    'fetch',
    vi.fn((input: Request) => {
      signal = input.signal;
      return presign.promise;
    }),
  );
  const uploaded = vi.fn();
  function Form({ show }: { show: boolean }) {
    const guard = useUploadGuard();
    return (
      <>
        <button disabled={guard.blocked}>Сохранить</button>
        {show && (
          <Upload purpose="CONTENT" onStateChange={guard.onStateChange} onUploaded={uploaded} />
        )}
      </>
    );
  }
  const view = render(<Form show />);
  choose();
  await waitFor(() => expect(signal).toBeDefined());
  expect(screen.getByRole('button', { name: 'Сохранить' })).toBeDisabled();
  view.rerender(<Form show={false} />);
  expect(signal?.aborted).toBe(true);
  expect(screen.getByRole('button', { name: 'Сохранить' })).toBeEnabled();
  await act(async () => presign.resolve(json(upload('unmounted'))));
  expect(uploaded).not.toHaveBeenCalled();
});

describe('client file validation', () => {
  it.each([
    ['CONTENT', 'file.txt', 'text/plain', 5, 'Выберите JPEG, PNG или WebP.'],
    [
      'CONTENT',
      'large.png',
      'image/png',
      UPLOAD_IMAGE_MAX_BYTES + 1,
      'Размер изображения — до 10 МБ.',
    ],
    ['CLUB_REPORT', 'file.png', 'image/png', 5, 'Выберите PDF.'],
    [
      'CLUB_REPORT',
      'large.pdf',
      'application/pdf',
      UPLOAD_PDF_MAX_BYTES + 1,
      'Размер PDF — до 20 МБ.',
    ],
  ] as const)(
    'blocks unresolved invalid %s files without contacting the server (%s)',
    async (purpose, name, type, size, error) => {
      const fetcher = vi.fn();
      vi.stubGlobal('fetch', fetcher);
      const status = vi.fn();
      render(<Upload purpose={purpose} onUploaded={vi.fn()} onStateChange={status} />);
      const file = new File(['data'], name, { type });
      Object.defineProperty(file, 'size', { value: size });
      fireEvent.change(screen.getByLabelText('Загрузить изображение'), {
        target: { files: [file] },
      });
      expect(await screen.findByText(error)).toBeInTheDocument();
      expect(fetcher).not.toHaveBeenCalled();
      expect(status.mock.lastCall?.[1]).toBe('error');
      fireEvent.click(screen.getByRole('button', { name: 'Не использовать выбранный файл' }));
      expect(status.mock.lastCall?.[1]).toBe('idle');
      expect(screen.queryByText(error)).not.toBeInTheDocument();
    },
  );
});

import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { Model } from '@/lib/api/client';
import { Profile } from './cabinet';
import { TripReport } from './curator';

const auth = vi.hoisted(() => ({ reload: vi.fn(async () => undefined) }));
vi.mock('./record-form', () => ({ RecordForm: () => null }));
vi.mock('./providers', () => ({
  useAuth: () => ({
    me: {
      id: '11111111-1111-4111-8111-111111111111',
      fullName: 'Тестовый участник',
      nickname: '',
      city: '',
      phone: '+70000000001',
      avatarUrl: 'https://uploads.example/old.png',
      email: null,
      emailVerifiedAt: null,
    },
    reload: auth.reload,
  }),
}));

const tripId = '22222222-2222-4222-8222-222222222222';
const uploadId = '33333333-3333-4333-8333-333333333333';
const fileUrl = 'https://uploads.example/new.png';
const clients: QueryClient[] = [];
const response = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json' } });
const deferred = () => {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
};

function fixture(kind: 'profile' | 'report') {
  const state = {
    presignHold: undefined as Promise<void> | undefined,
    storageHold: undefined as Promise<void> | undefined,
    writeHold: undefined as Promise<void> | undefined,
    storageFail: false,
    presignCalls: 0,
    storageCalls: 0,
    writes: [] as Record<string, unknown>[],
  };
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: Request | string) => {
      const path = new URL(typeof input === 'string' ? input : input.url).pathname;
      if (typeof input === 'string') {
        expect(input).toBe('https://storage.example/upload');
        state.storageCalls++;
        await state.storageHold;
        return new Response(null, { status: state.storageFail ? 500 : 204 });
      }
      if (path === '/api/v1/uploads/presign') {
        state.presignCalls++;
        expect(await input.json()).toMatchObject({
          purpose: kind === 'profile' ? 'AVATAR' : 'REPORT_PHOTO',
          ...(kind === 'report' ? { tripId } : {}),
          contentType: 'image/png',
        });
        await state.presignHold;
        return response({
          url: 'https://storage.example/upload',
          fields: { key: 'new.png' },
          uploadId,
          fileUrl,
          expiresAt: '2026-11-01T00:00:00.000Z',
          maxSizeBytes: 10000000,
        } satisfies Model<'PresignResponseDto'>);
      }
      if (path === `/api/v1/trips/${tripId}`)
        return response({ id: tripId, title: 'Поездка', status: 'DONE', report: null });
      expect(path).toBe(
        kind === 'profile' ? '/api/v1/me' : `/api/v1/curator/trips/${tripId}/report`,
      );
      expect(input.method).toBe(kind === 'profile' ? 'PATCH' : 'PUT');
      state.writes.push((await input.json()) as Record<string, unknown>);
      await state.writeHold;
      return response({ ok: true });
    }),
  );
  const client = new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: Infinity },
      mutations: { retry: false },
    },
  });
  clients.push(client);
  render(
    <QueryClientProvider client={client}>
      {kind === 'profile' ? <Profile /> : <TripReport id={tripId} />}
    </QueryClientProvider>,
  );
  const ready = async () => {
    const button = await screen.findByRole('button', {
      name: kind === 'profile' ? 'Сохранить профиль' : 'Опубликовать отчет',
    });
    if (kind === 'report')
      fireEvent.change(screen.getByRole('textbox', { name: 'Текст отчета' }), {
        target: { value: 'Подробный отчет о проведенной поездке.' },
      });
    const input = screen.getByLabelText(
      kind === 'profile' ? 'Новый аватар' : 'Загрузить изображение',
    );
    return { button, input, form: button.closest('form')! };
  };
  return { state, ready };
}

afterEach(() => {
  clients.splice(0).forEach((client) => client.clear());
});

describe('Profile and trip report upload coordination', () => {
  it.each(['profile', 'report'] as const)(
    '%s waits for presigning and storage, then saves the completed attachment',
    async (kind) => {
      const { state, ready } = fixture(kind);
      const presign = deferred();
      const storage = deferred();
      state.presignHold = presign.promise;
      state.storageHold = storage.promise;
      const { button, input, form } = await ready();
      fireEvent.change(input, {
        target: { files: [new File(['png'], 'photo.png', { type: 'image/png' })] },
      });
      await screen.findByText('Загрузка…');
      expect(button).toBeDisabled();
      await act(async () => fireEvent.submit(form));
      expect(state.writes).toEqual([]);
      await act(async () => presign.resolve());
      await waitFor(() => expect(state.storageCalls).toBe(1));
      expect(button).toBeDisabled();
      await act(async () => fireEvent.submit(form));
      expect(state.writes).toEqual([]);
      await act(async () => storage.resolve());
      await screen.findByText('Загружен: photo.png');
      expect(button).toBeEnabled();
      fireEvent.submit(form);
      await waitFor(() => expect(state.writes).toHaveLength(1));
      expect(state.writes[0]).toMatchObject(
        kind === 'profile' ? { avatarUrl: fileUrl } : { photos: [{ uploadId, isPublic: false }] },
      );
    },
  );

  it('keeps a failed avatar upload blocking save until retry succeeds', async () => {
    const { state, ready } = fixture('profile');
    state.storageFail = true;
    const { button, input, form } = await ready();
    fireEvent.change(input, {
      target: { files: [new File(['png'], 'avatar.png', { type: 'image/png' })] },
    });
    await screen.findByRole('alert');
    expect(button).toBeDisabled();
    await act(async () => fireEvent.submit(form));
    expect(state.writes).toEqual([]);
    state.storageFail = false;
    fireEvent.click(screen.getByRole('button', { name: 'Повторить загрузку' }));
    await screen.findByText('Загружен: avatar.png');
    fireEvent.submit(form);
    await waitFor(() => expect(state.writes).toHaveLength(1));
    expect(state.writes[0]).toMatchObject({ avatarUrl: fileUrl });
    expect(state.presignCalls).toBe(2);
  });

  it('allows publishing without a failed report photo only after explicitly abandoning it', async () => {
    const { state, ready } = fixture('report');
    state.storageFail = true;
    const { button, input, form } = await ready();
    fireEvent.change(input, {
      target: { files: [new File(['png'], 'report.png', { type: 'image/png' })] },
    });
    await screen.findByRole('alert');
    expect(button).toBeDisabled();
    await act(async () => fireEvent.submit(form));
    expect(state.writes).toEqual([]);
    fireEvent.click(screen.getByRole('button', { name: 'Не использовать выбранный файл' }));
    expect(button).toBeEnabled();
    fireEvent.submit(form);
    await waitFor(() => expect(state.writes).toHaveLength(1));
    expect(state.writes[0]).toMatchObject({ photos: [] });
  });

  it.each(['profile', 'report'] as const)(
    '%s prevents starting another upload while the form save is in flight',
    async (kind) => {
      const { state, ready } = fixture(kind);
      const saving = deferred();
      state.writeHold = saving.promise;
      const { button, input, form } = await ready();
      fireEvent.submit(form);
      await waitFor(() => expect(state.writes).toHaveLength(1));
      expect(button).toBeDisabled();
      expect(input).toBeDisabled();
      await act(async () => fireEvent.submit(form));
      expect(state.writes).toHaveLength(1);
      await act(async () => saving.resolve());
      await waitFor(() => expect(button).toBeEnabled());
      expect(input).toBeEnabled();
    },
  );
});

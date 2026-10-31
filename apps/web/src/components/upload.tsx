'use client';
import { useEffect, useId, useRef, useState } from 'react';
import { UPLOAD_IMAGE_MAX_BYTES, UPLOAD_IMAGE_TYPES, UPLOAD_PDF_MAX_BYTES } from '@club/shared';
import { api, result, type Model } from '@/lib/api/client';
import { Button, ErrorNotice } from './ui';
import type { UploadState, UploadStateHandler } from './upload-guard';

export function Upload({
  purpose,
  tripId,
  onUploaded,
  onStateChange,
  disabled = false,
  label = 'Загрузить изображение',
}: {
  purpose: Model<'PresignDto'>['purpose'];
  tripId?: string;
  onUploaded: (upload: Model<'PresignResponseDto'>) => void;
  onStateChange?: UploadStateHandler;
  disabled?: boolean;
  label?: string;
}) {
  const id = useId();
  const [filename, setFilename] = useState('');
  const [state, setState] = useState<UploadState>('idle');
  const [error, setError] = useState<unknown>();
  const selected = useRef<File | undefined>(undefined);
  const active = useRef<AbortController | undefined>(undefined);

  useEffect(
    () => () => {
      active.current?.abort();
      active.current = undefined;
      onStateChange?.(id, 'idle');
    },
    [id, onStateChange],
  );

  const start = async (file: File) => {
    const controller = new AbortController();
    active.current = controller;
    selected.current = file;
    setState('pending');
    setError(undefined);
    onStateChange?.(id, 'pending');
    try {
      const pdf = purpose === 'CLUB_REPORT';
      if (
        !(pdf
          ? file.type === 'application/pdf'
          : UPLOAD_IMAGE_TYPES.includes(file.type as (typeof UPLOAD_IMAGE_TYPES)[number]))
      )
        throw new Error(pdf ? 'Выберите PDF.' : 'Выберите JPEG, PNG или WebP.');
      if (file.size > (pdf ? UPLOAD_PDF_MAX_BYTES : UPLOAD_IMAGE_MAX_BYTES))
        throw new Error(pdf ? 'Размер PDF — до 20 МБ.' : 'Размер изображения — до 10 МБ.');
      const upload = await result(
        api.POST('/api/v1/uploads/presign', {
          signal: controller.signal,
          body: {
            purpose,
            tripId,
            contentType: file.type as Model<'PresignDto'>['contentType'],
            sizeBytes: file.size,
          },
        }),
      );
      if (active.current !== controller) return;
      const form = new FormData();
      for (const [key, value] of Object.entries(upload.fields)) form.append(key, value);
      form.append('file', file);
      const response = await fetch(upload.url, {
        method: 'POST',
        body: form,
        signal: controller.signal,
      });
      if (active.current !== controller) return;
      if (!response.ok) throw new Error('Не удалось загрузить файл. Повторите загрузку.');
      onUploaded(upload);
      setFilename(file.name);
      selected.current = undefined;
      active.current = undefined;
      setState('idle');
      onStateChange?.(id, 'idle');
    } catch (cause) {
      if (active.current !== controller) return;
      active.current = undefined;
      setError(cause);
      setState('error');
      onStateChange?.(id, 'error');
    }
  };
  const cancel = () => {
    active.current?.abort();
    active.current = undefined;
    selected.current = undefined;
    setError(undefined);
    setState('idle');
    onStateChange?.(id, 'idle');
  };
  return (
    <div className="field">
      <label>
        <span>{label}</span>
        <input
          type="file"
          accept={purpose === 'CLUB_REPORT' ? 'application/pdf' : UPLOAD_IMAGE_TYPES.join(',')}
          disabled={disabled || state === 'pending'}
          onChange={(event) => {
            const file = event.target.files?.[0];
            if (file) void start(file);
            event.target.value = '';
          }}
        />
      </label>
      <small>
        {state === 'pending'
          ? 'Загрузка…'
          : filename
            ? `Загружен: ${filename}`
            : 'Файл отправляется напрямую в хранилище.'}
      </small>
      <ErrorNotice error={error} />
      {state !== 'idle' && (
        <div className="actions">
          {state === 'error' && (
            <Button
              type="button"
              variant="secondary"
              disabled={disabled}
              onClick={() => {
                if (selected.current) void start(selected.current);
              }}
            >
              Повторить загрузку
            </Button>
          )}
          <Button type="button" variant="secondary" disabled={disabled} onClick={cancel}>
            {state === 'pending' ? 'Отменить загрузку' : 'Не использовать выбранный файл'}
          </Button>
        </div>
      )}
    </div>
  );
}

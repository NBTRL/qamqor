'use client';
import { useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { UPLOAD_IMAGE_MAX_BYTES, UPLOAD_IMAGE_TYPES, UPLOAD_PDF_MAX_BYTES } from '@club/shared';
import { api, result, type Model } from '@/lib/api/client';
import { ErrorNotice } from './ui';
export function Upload({
  purpose,
  tripId,
  onUploaded,
  label = 'Загрузить изображение',
}: {
  purpose: Model<'PresignDto'>['purpose'];
  tripId?: string;
  onUploaded: (upload: Model<'PresignResponseDto'>) => void;
  label?: string;
}) {
  const [filename, setFilename] = useState('');
  const mutation = useMutation({
    mutationFn: async (file: File) => {
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
          body: {
            purpose,
            tripId,
            contentType: file.type as Model<'PresignDto'>['contentType'],
            sizeBytes: file.size,
          },
        }),
      );
      const form = new FormData();
      for (const [key, value] of Object.entries(upload.fields)) form.append(key, value);
      form.append('file', file);
      const response = await fetch(upload.url, { method: 'POST', body: form });
      if (!response.ok) throw new Error('Не удалось загрузить файл. Повторите загрузку.');
      onUploaded(upload);
      setFilename(file.name);
    },
  });
  return (
    <div className="field">
      <label>
        <span>{label}</span>
        <input
          type="file"
          accept={purpose === 'CLUB_REPORT' ? 'application/pdf' : UPLOAD_IMAGE_TYPES.join(',')}
          disabled={mutation.isPending}
          onChange={(event) => {
            const file = event.target.files?.[0];
            if (file) mutation.mutate(file);
            event.target.value = '';
          }}
        />
      </label>
      <small>
        {mutation.isPending
          ? 'Загрузка…'
          : filename
            ? `Загружен: ${filename}`
            : 'Файл отправляется напрямую в хранилище.'}
      </small>
      <ErrorNotice error={mutation.error} />
    </div>
  );
}

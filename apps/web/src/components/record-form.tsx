'use client';
import dynamic from 'next/dynamic';
import { Controller, useForm, useWatch } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import {
  enumLabels,
  transitions,
  EventType,
  NewsStatus,
  contactRequestStatusTransitions,
  ContactRequestStatus,
} from '@club/shared';
import { useMutation, useQuery } from '@tanstack/react-query';
import { api, result } from '@/lib/api/client';
import { definition, resolve, schemaFor } from '@/lib/form-schema';
import type { components } from '@/lib/api/schema';
import definitions from '@/lib/form-definitions.json';
import { inputDateTime } from '@/lib/format';
import { Button, ErrorNotice, Field } from './ui';
import { Upload } from './upload';
import { useUploadGuard } from './upload-guard';
const Editor = dynamic(() => import('./editor'), {
  ssr: false,
  loading: () => <p>Загрузка редактора…</p>,
});
export const fieldLabels: Record<string, string> = {
  slug: 'Адрес страницы (латиницей)',
  title: 'Название',
  name: 'Название',
  bodyHtml: 'Текст',
  excerpt: 'Краткое описание',
  description: 'Описание',
  coverUrl: 'Обложка',
  coverImageUrl: 'Обложка',
  logoUrl: 'Логотип',
  websiteUrl: 'Сайт',
  status: 'Статус',
  publishedAt: 'Дата публикации (МСК)',
  isActive: 'Активно',
  albumId: 'Альбом',
  type: 'Тип',
  url: 'Ссылка',
  caption: 'Подпись',
  isPublic: 'Публично',
  sortOrder: 'Порядок',
  outlet: 'Издание',
  year: 'Год',
  fileUrl: 'Файл отчета',
  amount: 'Сумма',
  currency: 'Валюта',
  donorName: 'Имя жертвователя',
  note: 'Примечание',
  receivedAt: 'Дата поступления (МСК)',
  adminNote: 'Заметка администратора',
  fullName: 'ФИО',
  nickname: 'Ник',
  city: 'Город',
  email: 'E-mail',
  role: 'Роль',
  isBlocked: 'Заблокирован',
  telegramId: 'Telegram ID',
  userId: 'Участник',
  placeId: 'Учреждение',
  regionId: 'Регион',
  district: 'Район',
  address: 'Адрес (закрыто)',
  privateNotes: 'Заметки (закрыто)',
  beneficiariesCount: 'Число подопечных',
  startsAt: 'Начало (МСК)',
  endsAt: 'Окончание (МСК)',
  location: 'Место',
  capacity: 'Количество мест',
  volunteersOnly: 'Только для волонтеров',
  registrationUrl: 'Ссылка на регистрацию',
  notes: 'Примечания',
  meetingPoint: 'Место сбора',
  cancelReason: 'Причина отмены',
  comment: 'Комментарий',
  text: 'Текст отчета',
  hoursSpent: 'Волонтерские часы',
};
export function labelEnum(values: unknown[], value: unknown) {
  for (const labels of Object.values(enumLabels)) {
    if (values.every((key) => typeof key === 'string' && key in labels)) {
      return (labels as Record<string, string>)[String(value)] ?? String(value);
    }
  }
  return String(value);
}
type SchemaName = keyof components['schemas'] & keyof typeof definitions;
export function RecordForm({
  schemaName,
  initial = {},
  onSave,
  onDone,
}: {
  schemaName: SchemaName;
  initial?: Record<string, unknown>;
  onSave: (body: unknown) => Promise<unknown>;
  onDone?: (data: unknown) => void;
}) {
  const node = resolve(definition(schemaName));
  const properties = node.properties ?? {};
  const defaults: Record<string, unknown> = {};
  for (const [key, raw] of Object.entries(properties)) {
    const field = resolve(raw);
    const value = initial[key] ?? field.default;
    if (value !== undefined)
      defaults[key] =
        field.format === 'date-time' && typeof value === 'string' ? inputDateTime(value) : value;
    else if (field.type === 'boolean') defaults[key] = false;
  }
  const base = schemaFor(schemaName) as z.ZodType<Record<string, unknown>, Record<string, unknown>>;
  const form = useForm<Record<string, unknown>>({
    resolver: zodResolver(base),
    defaultValues: defaults,
  });
  const save = useMutation({ mutationFn: onSave, onSuccess: (data) => onDone?.(data) });
  const mediaType = useWatch({ control: form.control, name: 'type' });
  const uploads = useUploadGuard();
  const lookups = useQuery({
    queryKey: ['form-lookups', schemaName],
    queryFn: async () => {
      const data: Record<string, { id: string; label: string }[]> = {};
      for (const key of ['regionId', 'placeId', 'userId', 'albumId']) {
        if (!(key in properties)) continue;
        const rows: { id: string; label: string }[] = [];
        let page = 1;
        while (true) {
          const query = { page, limit: 100 };
          const response =
            key === 'regionId'
              ? await result(api.GET('/api/v1/admin/regions', { params: { query } }))
              : key === 'placeId'
                ? await result(api.GET('/api/v1/curator/places', { params: { query } }))
                : key === 'userId'
                  ? await result(api.GET('/api/v1/admin/users', { params: { query } }))
                  : await result(api.GET('/api/v1/admin/albums', { params: { query } }));
          rows.push(
            ...response.items.map((row) => ({
              id: row.id,
              label:
                'name' in row
                  ? row.name
                  : 'fullName' in row
                    ? row.fullName
                    : 'title' in row
                      ? row.title
                      : 'Запись',
            })),
          );
          if (page * 100 >= response.total) break;
          page++;
        }
        data[key] = rows;
      }
      return data;
    },
    enabled: Object.keys(properties).some((key) =>
      ['regionId', 'placeId', 'userId', 'albumId'].includes(key),
    ),
  });
  return (
    <form
      className="form"
      onSubmit={(event) => {
        event.preventDefault();
        if (uploads.isBlocked() || save.isPending || form.formState.isSubmitting) return;
        void form.handleSubmit((body) => {
          if (!uploads.isBlocked() && !save.isPending) save.mutate(body);
        })(event);
      }}
    >
      {Object.entries(properties).map(([key, raw]) => {
        const field = resolve(raw);
        const required = node.required?.includes(key);
        // PATCH needs the empty string to clear a stored media caption.
        const keepEmpty = schemaName === 'MediaItemWriteDto' && key === 'caption';
        let values = field.enum;
        if (key === 'type' && schemaName.startsWith('Event'))
          values = values?.filter((value) => value !== EventType.TRIP);
        if (key === 'status' && initial[key] && values?.includes(NewsStatus.DRAFT)) {
          const current = String(initial[key]);
          const allowed =
            (transitions.NewsStatus as Record<string, readonly string[]>)[current] ?? [];
          values = values.filter((value) => value === current || allowed.includes(String(value)));
        }
        if (
          key === 'status' &&
          initial[key] &&
          values?.includes(ContactRequestStatus.IN_PROGRESS)
        ) {
          const current = String(initial[key]);
          const allowed =
            (contactRequestStatusTransitions as Record<string, readonly string[]>)[current] ?? [];
          values = values.filter((value) => value === current || allowed.includes(String(value)));
        }
        return (
          <Controller
            key={key}
            name={key}
            control={form.control}
            render={({ field: control, fieldState }) => (
              <Field
                label={fieldLabels[key] ?? key}
                error={fieldState.error?.message}
                hint={
                  schemaName === 'MediaItemWriteDto' && key === 'url'
                    ? 'При смене типа укажите ссылку заново.'
                    : !required
                      ? 'Необязательно'
                      : undefined
                }
              >
                {key === 'bodyHtml' ? (
                  <Editor
                    value={String(control.value ?? '')}
                    onChange={control.onChange}
                    onUploadStateChange={uploads.onStateChange}
                    disabled={save.isPending || form.formState.isSubmitting}
                  />
                ) : field.type === 'boolean' ? (
                  <input
                    type="checkbox"
                    checked={!!control.value}
                    onChange={(event) => control.onChange(event.target.checked)}
                  />
                ) : lookups.data?.[key] ? (
                  <select
                    value={String(control.value ?? '')}
                    onChange={(event) => control.onChange(event.target.value || undefined)}
                  >
                    <option value="">Выберите…</option>
                    {lookups.data[key].map((row) => (
                      <option key={row.id} value={row.id}>
                        {row.label}
                      </option>
                    ))}
                  </select>
                ) : values ? (
                  <select
                    value={String(control.value ?? '')}
                    onChange={(event) => {
                      const value = event.target.value || undefined;
                      if (
                        schemaName === 'MediaItemWriteDto' &&
                        key === 'type' &&
                        value !== control.value
                      )
                        form.setValue('url', '', {
                          shouldDirty: true,
                          shouldValidate: form.formState.isSubmitted,
                        });
                      control.onChange(value);
                    }}
                  >
                    <option value="">Выберите…</option>
                    {values.map((value) => (
                      <option value={String(value)} key={String(value)}>
                        {labelEnum(values!, value)}
                      </option>
                    ))}
                  </select>
                ) : field.type === 'array' || field.type === 'object' ? (
                  <JsonField value={control.value} onChange={control.onChange} />
                ) : (
                  <>
                    {[
                      'description',
                      'notes',
                      'note',
                      'privateNotes',
                      'adminNote',
                      'excerpt',
                    ].includes(key) ? (
                      <textarea
                        {...control}
                        value={String(control.value ?? '')}
                        onChange={(event) => control.onChange(event.target.value)}
                        required={required}
                        minLength={field.minLength}
                        maxLength={field.maxLength}
                      />
                    ) : (
                      <input
                        {...control}
                        value={String(control.value ?? '')}
                        onChange={(event) =>
                          control.onChange(
                            event.target.value === '' && !required && !keepEmpty
                              ? field.nullable
                                ? null
                                : undefined
                              : event.target.value,
                          )
                        }
                        type={
                          field.format === 'date-time'
                            ? 'datetime-local'
                            : field.type === 'number' || field.type === 'integer'
                              ? 'number'
                              : field.format === 'email' || key === 'email'
                                ? 'email'
                                : field.format === 'uri'
                                  ? 'url'
                                  : 'text'
                        }
                        min={field.minimum}
                        max={field.maximum}
                        minLength={field.minLength}
                        maxLength={field.maxLength}
                        pattern={field.pattern}
                        required={required}
                        step={field.type === 'number' ? 'any' : undefined}
                      />
                    )}
                    {(['coverUrl', 'coverImageUrl', 'logoUrl', 'fileUrl'].includes(key) ||
                      (key === 'url' &&
                        schemaName === 'MediaItemWriteDto' &&
                        mediaType === 'PHOTO')) && (
                      <Upload
                        purpose={key === 'fileUrl' ? 'CLUB_REPORT' : 'CONTENT'}
                        onUploaded={(upload) => control.onChange(upload.fileUrl)}
                        onStateChange={uploads.onStateChange}
                        disabled={save.isPending || form.formState.isSubmitting}
                        label={key === 'fileUrl' ? 'Загрузить PDF' : 'Загрузить изображение'}
                      />
                    )}
                  </>
                )}
              </Field>
            )}
          />
        );
      })}
      <ErrorNotice error={save.error ?? lookups.error} />
      <Button
        disabled={
          save.isPending || lookups.isLoading || form.formState.isSubmitting || uploads.blocked
        }
      >
        Сохранить
      </Button>
      {save.isSuccess && <p role="status">Сохранено.</p>}
    </form>
  );
}
function JsonField({ value, onChange }: { value: unknown; onChange: (value: unknown) => void }) {
  return (
    <textarea
      value={typeof value === 'string' ? value : JSON.stringify(value ?? [], null, 2)}
      onChange={(event) => {
        try {
          onChange(JSON.parse(event.target.value));
        } catch {
          onChange(event.target.value);
        }
      }}
    />
  );
}

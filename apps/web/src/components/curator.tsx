'use client';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useForm, useFieldArray } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import {
  TripStatus,
  tripStatusLabels,
  tripStatusTransitions,
  registrationStatusLabels,
  registrationStatusTransitions,
  RegistrationStatus,
} from '@club/shared';
import { api, result, type Model } from '@/lib/api/client';
import { schemaFor } from '@/lib/form-schema';
import { date } from '@/lib/format';
import { DataTable } from './data-table';
import { RecordForm } from './record-form';
import { Button, ButtonLink, ErrorNotice, Loading, Field } from './ui';
import { Upload } from './upload';
import { useUploadGuard } from './upload-guard';
export function CuratorHome() {
  const [status, setStatus] = useState<TripStatus>(TripStatus.OPEN);
  const places = useQuery({
    queryKey: ['curator-places'],
    queryFn: () => result(api.GET('/api/v1/curator/places', { params: { query: { limit: 100 } } })),
  });
  return (
    <>
      <h1>Раздел куратора</h1>
      <div className="actions">
        <ButtonLink href="/curator/trips/new">Создать поездку</ButtonLink>
      </div>
      <Field label="Статус поездки">
        <select value={status} onChange={(e) => setStatus(e.target.value as TripStatus)}>
          {Object.values(TripStatus).map((s) => (
            <option key={s} value={s}>
              {tripStatusLabels[s]}
            </option>
          ))}
        </select>
      </Field>
      <DataTable
        key={status}
        name={`curator-trips-${status}`}
        load={(query) =>
          result(api.GET('/api/v1/curator/trips', { params: { query: { ...query, status } } }))
        }
        columns={[
          {
            title: 'Поездка',
            cell: (row) => <Link href={`/curator/trips/${row.id}`}>{row.title}</Link>,
          },
          { title: 'Учреждение', cell: (row) => row.place.name },
          { title: 'Начало', cell: (row) => date(row.startsAt) },
          { title: 'Места', cell: (row) => `${row.confirmedCount} / ${row.capacity}` },
          {
            title: 'Действия',
            cell: (row) => (
              <div className="stack">
                <Link href={`/curator/trips/${row.id}/participants`}>Участники</Link>
                <Link href={`/curator/trips/${row.id}/report`}>Отчет</Link>
              </div>
            ),
          },
        ]}
      />
      <h2>Нужды моих учреждений</h2>
      <ErrorNotice error={places.error} />
      {places.data?.items.map((place) => (
        <p key={place.id}>
          <Link href={`/curator/places/${place.id}/needs`}>{place.name}</Link>
        </p>
      ))}
    </>
  );
}
export function TripEditor({ id }: { id?: string }) {
  const router = useRouter();
  const cache = useQueryClient();
  const query = useQuery({
    queryKey: ['trip', id],
    queryFn: () => result(api.GET('/api/v1/trips/{id}', { params: { path: { id: id! } } })),
    enabled: !!id,
  });
  const [reason, setReason] = useState('');
  const status = useMutation({
    mutationFn: (next: TripStatus) =>
      result(
        api.POST('/api/v1/curator/trips/{id}/status', {
          params: { path: { id: id! } },
          body: {
            status: next,
            ...(next === TripStatus.CANCELLED ? { cancelReason: reason } : {}),
          },
        }),
      ),
    onSuccess: () => void cache.invalidateQueries({ queryKey: ['trip', id] }),
  });
  if (id && query.isLoading) return <Loading />;
  if (id && !query.data) return <ErrorNotice error={query.error} />;
  const trip = query.data;
  const initial = trip ? { ...trip, placeId: trip.place.id } : {};
  return (
    <>
      <Link href="/curator">← Раздел куратора</Link>
      <h1>{id ? 'Редактирование поездки' : 'Новая поездка'}</h1>
      <RecordForm
        key={id ?? 'new'}
        schemaName={id ? 'TripPatchDto' : 'TripCreateDto'}
        initial={initial}
        onSave={(body) =>
          id
            ? result(
                api.PATCH('/api/v1/curator/trips/{id}', {
                  params: { path: { id } },
                  body: schemaFor('TripPatchDto').parse(body),
                }),
              )
            : result(
                api.POST('/api/v1/curator/trips', { body: schemaFor('TripCreateDto').parse(body) }),
              )
        }
        onDone={(created) => {
          void cache.invalidateQueries({ queryKey: ['trip', id] });
          void cache.invalidateQueries({ queryKey: ['table'] });
          if (
            !id &&
            created &&
            typeof created === 'object' &&
            'id' in created &&
            typeof created.id === 'string'
          )
            router.replace(`/curator/trips/${encodeURIComponent(created.id)}`);
        }}
      />
      {trip && (
        <section className="section">
          <h2>Статус: {tripStatusLabels[trip.status]}</h2>
          <Field label="Причина отмены" hint="Обязательна при отмене поездки.">
            <input value={reason} onChange={(e) => setReason(e.target.value)} maxLength={2000} />
          </Field>
          <div className="actions">
            {tripStatusTransitions[trip.status].map((next) => (
              <Button
                key={next}
                disabled={
                  status.isPending || (next === TripStatus.CANCELLED && reason.trim().length < 3)
                }
                onClick={() => status.mutate(next)}
              >
                {tripStatusLabels[next]}
              </Button>
            ))}
          </div>
          <ErrorNotice error={status.error} />
          <Link href={`/curator/trips/${trip.id}/participants`}>Участники поездки</Link>
        </section>
      )}
    </>
  );
}
export function Participants({ id }: { id: string }) {
  const cache = useQueryClient();
  const trip = useQuery({
    queryKey: ['trip', id],
    queryFn: () => result(api.GET('/api/v1/trips/{id}', { params: { path: { id } } })),
  });
  const mutation = useMutation({
    mutationFn: ({
      registrationId,
      status,
    }: {
      registrationId: string;
      status: RegistrationStatus;
    }) =>
      result(
        api.PATCH('/api/v1/curator/registrations/{id}', {
          params: { path: { id: registrationId } },
          body: { status },
        }),
      ),
    onSuccess: () => {
      void cache.invalidateQueries({ queryKey: ['table', `participants-${id}`] });
      void cache.invalidateQueries({ queryKey: ['trip', id] });
    },
  });
  return (
    <>
      <Link href="/curator">← Раздел куратора</Link>
      <h1>Участники поездки</h1>
      {trip.data && (
        <p>
          {trip.data.title} · подтверждено: {trip.data.confirmedCount} / {trip.data.capacity}
        </p>
      )}
      <ErrorNotice error={mutation.error ?? trip.error} />
      <DataTable
        name={`participants-${id}`}
        load={(query) =>
          result(
            api.GET('/api/v1/curator/trips/{id}/registrations', {
              params: { path: { id }, query },
            }),
          )
        }
        columns={[
          { title: 'ФИО', cell: (row) => row.fullName },
          { title: 'Ник', cell: (row) => row.nickname ?? '—' },
          { title: 'Телефон', cell: (row) => row.phone ?? '—' },
          { title: 'Статус', cell: (row) => registrationStatusLabels[row.status] },
          {
            title: 'Действия',
            cell: (row) => (
              <div className="actions">
                {registrationStatusTransitions[row.status]
                  .filter((next) => next !== RegistrationStatus.CANCELLED)
                  .map((next) => (
                    <Button
                      key={next}
                      variant="secondary"
                      disabled={
                        mutation.isPending ||
                        ((next === RegistrationStatus.ATTENDED ||
                          next === RegistrationStatus.NO_SHOW) &&
                          (!trip.data || Date.parse(trip.data.startsAt) > Date.now()))
                      }
                      onClick={() => mutation.mutate({ registrationId: row.id, status: next })}
                    >
                      {registrationStatusLabels[next]}
                    </Button>
                  ))}
              </div>
            ),
          },
        ]}
      />
      <p className="text-muted">
        Явка доступна после начала поездки. Лист ожидания формируется при заполнении мест;
        освободившееся место переводит первую запись в ожидание подтверждения.
      </p>
    </>
  );
}
export function TripReport({ id }: { id: string }) {
  const query = useQuery({
    queryKey: ['trip', id],
    queryFn: () => result(api.GET('/api/v1/trips/{id}', { params: { path: { id } } })),
  });
  if (query.isLoading) return <Loading />;
  if (!query.data) return <ErrorNotice error={query.error} />;
  return (
    <>
      <h1>Отчет о поездке</h1>
      <p>{query.data.title}</p>
      {query.data.status === TripStatus.DONE || query.data.status === TripStatus.REPORTED ? (
        <ReportForm id={id} initial={query.data.report} />
      ) : (
        <p className="notice">Сначала отметьте поездку как проведенную.</p>
      )}
    </>
  );
}
function ReportForm({ id, initial }: { id: string; initial?: Model<'ReportResponseDto'> | null }) {
  const cache = useQueryClient();
  const uploads = useUploadGuard();
  const form = useForm<Model<'ReportWriteDto'>>({
    resolver: zodResolver(schemaFor('ReportWriteDto')),
    defaultValues: {
      text: initial?.text ?? '',
      hoursSpent: Number(initial?.hoursSpent ?? 0),
      photos:
        initial?.photos.flatMap((photo) =>
          photo.uploadId ? [{ uploadId: photo.uploadId, isPublic: photo.isPublic }] : [],
        ) ?? [],
    },
  });
  const photos = useFieldArray({ control: form.control, name: 'photos' });
  const mutation = useMutation({
    mutationFn: (body: Model<'ReportWriteDto'>) =>
      result(api.PUT('/api/v1/curator/trips/{id}/report', { params: { path: { id } }, body })),
    onSuccess: () => void cache.invalidateQueries({ queryKey: ['trip', id] }),
  });
  return (
    <form
      className="form"
      onSubmit={(event) => {
        if (uploads.isBlocked() || mutation.isPending || form.formState.isSubmitting) {
          event.preventDefault();
          return;
        }
        void form.handleSubmit((body) => {
          if (!uploads.isBlocked() && !mutation.isPending) mutation.mutate(body);
        })(event);
      }}
    >
      <Field label="Текст отчета" error={form.formState.errors.text?.message}>
        <textarea {...form.register('text')} minLength={20} />
      </Field>
      <Field label="Волонтерские часы" error={form.formState.errors.hoursSpent?.message}>
        <input
          type="number"
          min="0"
          max="1000"
          step="0.01"
          {...form.register('hoursSpent', { valueAsNumber: true })}
        />
      </Field>
      <Upload
        purpose="REPORT_PHOTO"
        tripId={id}
        onUploaded={(upload) => photos.append({ uploadId: upload.uploadId, isPublic: false })}
        onStateChange={uploads.onStateChange}
        disabled={mutation.isPending || form.formState.isSubmitting}
      />
      <p className="notice">
        Фото по умолчанию закрыты. Перед публикацией фотографий детей убедитесь, что у Клуба есть
        необходимые согласия.
      </p>
      {photos.fields.map((photo, index) => (
        <div className="actions" key={photo.id}>
          <span>Фото {index + 1}</span>
          <label className="check">
            <input type="checkbox" {...form.register(`photos.${index}.isPublic`)} />
            Публично
          </label>
          <Button type="button" variant="secondary" onClick={() => photos.remove(index)}>
            Убрать фото
          </Button>
        </div>
      ))}
      <ErrorNotice error={mutation.error} />
      <Button disabled={mutation.isPending || form.formState.isSubmitting || uploads.blocked}>
        Опубликовать отчет
      </Button>
      {mutation.isSuccess && <p role="status">Отчет сохранен.</p>}
    </form>
  );
}
export function PlaceNeeds({ id }: { id: string }) {
  const query = useQuery({
    queryKey: ['needs', id],
    queryFn: () =>
      result(
        api.GET('/api/v1/curator/places/{id}/needs', {
          params: { path: { id }, query: { limit: 100 } },
        }),
      ),
  });
  return (
    <>
      <h1>Нужды учреждения</h1>
      <ErrorNotice error={query.error} />
      {query.isLoading ? (
        <Loading />
      ) : (
        query.data && <NeedsForm id={id} initial={query.data.items} />
      )}
    </>
  );
}
function NeedsForm({ id, initial }: { id: string; initial: Model<'NeedResponseDto'>[] }) {
  const cache = useQueryClient();
  const values = (items: Model<'NeedResponseDto'>[]) => ({
    items: items.map(({ id, title, description, isActive }) => ({
      id,
      title,
      description,
      isActive,
    })),
  });
  const form = useForm<Model<'NeedsWriteDto'>>({
    resolver: zodResolver(schemaFor('NeedsWriteDto')),
    defaultValues: values(initial),
  });
  const rows = useFieldArray({ control: form.control, name: 'items', keyName: 'fieldKey' });
  const save = useMutation({
    mutationFn: (body: Model<'NeedsWriteDto'>) =>
      result(api.PATCH('/api/v1/curator/places/{id}/needs', { params: { path: { id } }, body })),
    onSuccess: (data) => {
      // Retain the assigned IDs so the next save updates newly created rows.
      form.reset(values(data.items));
      cache.setQueryData(['needs', id], data);
      void cache.invalidateQueries({ queryKey: ['public-needs', id] });
    },
  });
  return (
    <form
      className="form"
      aria-busy={save.isPending}
      onSubmit={form.handleSubmit((body) => {
        if (!save.isPending) save.mutate(body);
      })}
    >
      {/* Block in-flight edits before replacing the draft with the saved rows and IDs. */}
      <fieldset className="form__body" disabled={save.isPending}>
        {rows.fields.map((row, index) => (
          <fieldset key={row.fieldKey}>
            <legend>Потребность {index + 1}</legend>
            <Field label="Название" error={form.formState.errors.items?.[index]?.title?.message}>
              <input {...form.register(`items.${index}.title`)} />
            </Field>
            <Field label="Описание">
              <textarea {...form.register(`items.${index}.description`)} />
            </Field>
            <label className="check">
              <input type="checkbox" {...form.register(`items.${index}.isActive`)} />
              Актуально
            </label>
            {!row.id && (
              <Button variant="secondary" type="button" onClick={() => rows.remove(index)}>
                Убрать
              </Button>
            )}
          </fieldset>
        ))}
        <Button
          type="button"
          variant="secondary"
          disabled={rows.fields.length >= 100}
          onClick={() => rows.append({ title: '', description: '', isActive: true })}
        >
          Добавить потребность
        </Button>
      </fieldset>
      <ErrorNotice error={save.error} />
      <Button disabled={save.isPending}>Сохранить нужды</Button>
      {save.isSuccess && <p role="status">Нужды сохранены.</p>}
    </form>
  );
}

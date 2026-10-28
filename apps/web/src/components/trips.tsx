'use client';
import Image from 'next/image';
import { useNow } from '@/lib/use-now';
import Link from 'next/link';
import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  TripStatus,
  tripStatusLabels,
  RegistrationStatus,
  registrationStatusLabels,
  PlaceType,
  placeTypeLabels,
  eventTypeLabels,
  EventType,
} from '@club/shared';
import { api, result, type Model } from '@/lib/api/client';
import { date } from '@/lib/format';
import { useAuth, can } from './providers';
import { Button, ErrorNotice, Empty, Field, Loading } from './ui';
export function TripCard({
  trip,
  candidate = false,
}: {
  trip: Model<'TripResponseDto'>;
  candidate?: boolean;
}) {
  return (
    <article className="card">
      <Image
        unoptimized
        className="card__image"
        src={trip.place.coverImage ?? '/placeholder.svg'}
        width="640"
        height="400"
        loading="lazy"
        alt=""
      />
      <div className="card__body">
        <span className="badge">{tripStatusLabels[trip.status]}</span>
        <h2>
          <Link href={`/trips/${trip.id}`}>{trip.title}</Link>
        </h2>
        <p>
          {trip.place.name} · {trip.place.region.name}
        </p>
        <p>{date(trip.startsAt)}</p>
        <p>
          Подтверждено: {trip.confirmedCount} / {trip.capacity}
        </p>
        {candidate && <p className="notice">Доступно после вступления в Клуб</p>}
      </div>
    </article>
  );
}
export function TripsList() {
  const { me } = useAuth();
  const [page, setPage] = useState(1);
  const [regionId, setRegion] = useState('');
  const [placeType, setType] = useState<PlaceType | undefined>();
  const [day, setDay] = useState('');
  const [status, setStatus] = useState<TripStatus>(TripStatus.OPEN);
  const regions = useQuery({
    queryKey: ['regions'],
    queryFn: () => result(api.GET('/api/v1/public/regions', { params: { query: { limit: 100 } } })),
  });
  const query = useQuery({
    queryKey: ['trips', page, regionId, placeType, day, status],
    queryFn: () =>
      result(
        api.GET('/api/v1/trips', {
          params: {
            query: {
              page,
              limit: 12,
              status,
              regionId: regionId || undefined,
              placeType,
              dateFrom: day ? `${day}T00:00:00+03:00` : undefined,
              dateTo: day ? `${day}T23:59:59+03:00` : undefined,
            },
          },
        }),
      ),
  });
  return (
    <>
      <h1>Поездки</h1>
      <div className="filters">
        <Field label="Регион">
          <select
            value={regionId}
            onChange={(e) => {
              setRegion(e.target.value);
              setPage(1);
            }}
          >
            <option value="">Все регионы</option>
            {regions.data?.items.map((region) => (
              <option key={region.id} value={region.id}>
                {region.name}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Тип учреждения">
          <select
            value={placeType ?? ''}
            onChange={(e) => {
              setType((e.target.value as PlaceType) || undefined);
              setPage(1);
            }}
          >
            <option value="">Все типы</option>
            {Object.values(PlaceType).map((type) => (
              <option key={type} value={type}>
                {placeTypeLabels[type]}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Дата (МСК)">
          <input
            type="date"
            value={day}
            onChange={(e) => {
              setDay(e.target.value);
              setPage(1);
            }}
          />
        </Field>
        <Field label="Статус">
          <select
            value={status}
            onChange={(e) => {
              setStatus(e.target.value as TripStatus);
              setPage(1);
            }}
          >
            {Object.values(TripStatus)
              .filter((s) => s !== TripStatus.DRAFT)
              .map((s) => (
                <option key={s} value={s}>
                  {tripStatusLabels[s]}
                </option>
              ))}
          </select>
        </Field>
      </div>
      <ErrorNotice error={query.error ?? regions.error} />
      {query.isLoading ? (
        <Loading />
      ) : query.data?.items.length ? (
        <div className="grid">
          {query.data.items.map((trip) => (
            <TripCard key={trip.id} trip={trip} candidate={!can(me, 'trip.register')} />
          ))}
        </div>
      ) : (
        <Empty>Поездки по выбранным условиям не найдены.</Empty>
      )}
      <div className="pagination">
        <Button variant="secondary" disabled={page === 1} onClick={() => setPage(page - 1)}>
          Назад
        </Button>
        <span>Страница {page}</span>
        <Button
          variant="secondary"
          disabled={!query.data || page * 12 >= query.data.total}
          onClick={() => setPage(page + 1)}
        >
          Вперёд
        </Button>
      </div>
    </>
  );
}
export function TripDetail({ id }: { id: string }) {
  const { me } = useAuth();
  const query = useQuery({
    queryKey: ['trip', id],
    queryFn: () => result(api.GET('/api/v1/trips/{id}', { params: { path: { id } } })),
  });
  if (query.isLoading) return <Loading />;
  if (!query.data) return <ErrorNotice error={query.error} />;
  const trip = query.data;
  return (
    <>
      <Link href="/trips">← Поездки</Link>
      <h1>{trip.title}</h1>
      <span className="badge">{tripStatusLabels[trip.status]}</span>
      <p>
        {trip.place.name} · {trip.place.region.name}
      </p>
      <p>
        {date(trip.startsAt)} — {date(trip.endsAt)}
      </p>
      <p>{trip.description}</p>
      {trip.meetingPoint && <p>Место сбора: {trip.meetingPoint}</p>}
      <p>
        Подтверждено: {trip.confirmedCount} / {trip.capacity}
      </p>
      {trip.cancelReason && <p className="notice">{trip.cancelReason}</p>}
      {can(me, 'trip.register') ? (
        <RegistrationActions id={id} kind="TRIP" disabled={trip.status !== TripStatus.OPEN} />
      ) : (
        <p className="notice">Доступно после вступления в Клуб</p>
      )}
      {trip.report && (
        <section>
          <h2>Отчет</h2>
          <p>{trip.report.text}</p>
          <p>Волонтерских часов: {trip.report.hoursSpent}</p>
          <div className="grid">
            {trip.report.photos.map((photo) => (
              <Image
                unoptimized
                key={photo.id}
                src={photo.url}
                width="640"
                height="400"
                alt="Фото из отчета"
                loading="lazy"
              />
            ))}
          </div>
        </section>
      )}
    </>
  );
}
export function EventsList() {
  const [type, setType] = useState<EventType | undefined>();
  const [page, setPage] = useState(1);
  const query = useQuery({
    queryKey: ['events', page, type],
    queryFn: () =>
      result(api.GET('/api/v1/events', { params: { query: { page, limit: 12, type } } })),
  });
  return (
    <>
      <h1>Мероприятия</h1>
      <Field label="Тип">
        <select
          value={type ?? ''}
          onChange={(e) => {
            setType((e.target.value as EventType) || undefined);
            setPage(1);
          }}
        >
          <option value="">Все типы</option>
          {Object.values(EventType)
            .filter((t) => t !== EventType.TRIP)
            .map((t) => (
              <option key={t} value={t}>
                {eventTypeLabels[t]}
              </option>
            ))}
        </select>
      </Field>
      <ErrorNotice error={query.error} />
      {query.isLoading ? (
        <Loading />
      ) : query.data?.items.length ? (
        <div className="grid">
          {query.data.items.map((item) => (
            <article className="card" key={item.id}>
              <div className="card__body">
                <span className="badge">{eventTypeLabels[item.type]}</span>
                <h2>
                  <Link href={`/events/${item.id}`}>{item.title}</Link>
                </h2>
                <p>{date(item.startsAt)}</p>
                <p>{item.volunteersOnly ? 'Для волонтеров Клуба' : 'Открыто для кандидатов'}</p>
              </div>
            </article>
          ))}
        </div>
      ) : (
        <Empty />
      )}
      <div className="pagination">
        <Button variant="secondary" disabled={page === 1} onClick={() => setPage(page - 1)}>
          Назад
        </Button>
        <span>Страница {page}</span>
        <Button
          variant="secondary"
          disabled={!query.data || page * 12 >= query.data.total}
          onClick={() => setPage(page + 1)}
        >
          Вперёд
        </Button>
      </div>
    </>
  );
}
export function EventDetail({ id }: { id: string }) {
  const now = useNow();
  const { me } = useAuth();
  const query = useQuery({
    queryKey: ['event', id],
    queryFn: () => result(api.GET('/api/v1/events/{id}', { params: { path: { id } } })),
  });
  if (query.isLoading) return <Loading />;
  if (!query.data) return <ErrorNotice error={query.error} />;
  const item = query.data;
  return (
    <>
      <Link href="/events">← Мероприятия</Link>
      <h1>{item.title}</h1>
      <span className="badge">{eventTypeLabels[item.type]}</span>
      <p>
        {date(item.startsAt)} — {date(item.endsAt)}
      </p>
      <p>{item.location}</p>
      <p>{item.description}</p>
      {can(me, item.volunteersOnly ? 'event.register.volunteersOnly' : 'event.register.public') ? (
        <RegistrationActions id={id} kind="EVENT" disabled={Date.parse(item.startsAt) < now} />
      ) : (
        <p className="notice">Доступно после вступления в Клуб</p>
      )}
    </>
  );
}
function RegistrationActions({
  id,
  kind,
  disabled,
}: {
  id: string;
  kind: 'TRIP' | 'EVENT';
  disabled: boolean;
}) {
  const cache = useQueryClient();
  const mine = useQuery({
    queryKey: ['registrations', 'actions'],
    queryFn: async () => {
      let page = 1;
      const rows: Model<'MeRegistrationResponseDto'>[] = [];
      while (true) {
        const data = await result(
          api.GET('/api/v1/me/registrations', { params: { query: { page, limit: 100 } } }),
        );
        rows.push(...data.items);
        if (page * 100 >= data.total) break;
        page++;
      }
      return rows;
    },
  });
  const mutation = useMutation({
    mutationFn: (cancel: boolean) =>
      cancel
        ? kind === 'TRIP'
          ? result(api.DELETE('/api/v1/trips/{id}/register', { params: { path: { id } } }))
          : result(api.DELETE('/api/v1/events/{id}/register', { params: { path: { id } } }))
        : kind === 'TRIP'
          ? result(api.POST('/api/v1/trips/{id}/register', { params: { path: { id } }, body: {} }))
          : result(api.POST('/api/v1/events/{id}/register', { params: { path: { id } } })),
    onSuccess: () => {
      void cache.invalidateQueries({ queryKey: ['registrations'] });
      void cache.invalidateQueries({ queryKey: ['table', 'registrations'] });
      void cache.invalidateQueries({ queryKey: ['trip', id] });
    },
  });
  const row = mine.data?.find((r) => r.entityId === id && r.kind === kind);
  const cancellable =
    row?.status &&
    [
      RegistrationStatus.PENDING,
      RegistrationStatus.CONFIRMED,
      RegistrationStatus.WAITLIST,
    ].includes(row.status as RegistrationStatus);
  return (
    <>
      <ErrorNotice error={mine.error ?? mutation.error} />
      {row?.status && (
        <p className="notice" role="status">
          Ваша запись: {registrationStatusLabels[row.status]}
        </p>
      )}
      <Button
        disabled={
          mutation.isPending ||
          mine.isLoading ||
          !!mine.error ||
          (!cancellable && (disabled || !!row))
        }
        onClick={() => mutation.mutate(!!cancellable)}
      >
        {cancellable ? 'Отменить запись' : 'Записаться'}
      </Button>
    </>
  );
}

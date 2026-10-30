'use client';
import Link from 'next/link';
import { useInfiniteQuery } from '@tanstack/react-query';
import { eventCalendarColors, eventTypeLabels, EventType } from '@club/shared';
import { api, result, type Model, type Page } from '@/lib/api/client';
import { date } from '@/lib/format';
import { useAuth } from './providers';
import { Button, Empty, ErrorNotice, Loading } from './ui';

type CalendarPage = Page<Model<'CalendarItemDto'>>;
export function Calendar({
  initial,
  initialError,
  range,
}: {
  initial: CalendarPage | null;
  initialError?: string;
  range: { from: string; to: string };
}) {
  const { me, loading } = useAuth();
  const query = useInfiniteQuery({
    queryKey: [
      'calendar',
      me?.id ?? 'guest',
      me?.role,
      me?.onboardingCompleted,
      range.from,
      range.to,
    ],
    initialPageParam: 1,
    queryFn: ({ pageParam, signal }) =>
      result(
        api.GET(me ? '/api/v1/calendar' : '/api/v1/public/calendar', {
          params: { query: { ...range, page: pageParam, limit: 100 } },
          signal,
        }),
      ),
    enabled: !loading,
    initialData: !me && initial ? { pages: [initial], pageParams: [1] } : undefined,
    getNextPageParam: (last) => (last.page * last.limit < last.total ? last.page + 1 : undefined),
  });
  // While identity is being resolved, only the public server-rendered page is safe to show.
  const pages = loading ? (initial ? [initial] : []) : (query.data?.pages ?? []);
  const items = [
    ...new Map(
      pages.flatMap((page) => page.items).map((item) => [`${item.type}-${item.id}`, item]),
    ).values(),
  ].sort((a, b) => Date.parse(a.startsAt) - Date.parse(b.startsAt) || a.id.localeCompare(b.id));
  const error =
    query.isPending && initialError ? new Error(initialError) : loading ? null : query.error;
  const waitingForFirstPage = pages.length === 0 && (loading || query.isPending);
  return (
    <section aria-label="События календаря" aria-busy={!loading && query.isFetching}>
      <div className="legend">
        {Object.values(EventType).map((type) => (
          <span key={type}>
            <i className="legend__dot" style={{ background: eventCalendarColors[type] }} />
            {eventTypeLabels[type]}
          </span>
        ))}
      </div>
      <ErrorNotice error={error} />
      {!items.length && !error && waitingForFirstPage && <Loading />}
      {!items.length && !waitingForFirstPage && !error && (
        <Empty>Ближайших событий пока нет.</Empty>
      )}
      {items.map((item) => (
        <article
          className="calendar-item"
          style={{ borderColor: eventCalendarColors[item.type] }}
          key={`${item.type}-${item.id}`}
        >
          <span className="badge">{eventTypeLabels[item.type]}</span>
          <h2>
            <Link
              href={
                me && !loading
                  ? `/${item.type === EventType.TRIP ? 'trips' : 'events'}/${item.id}`
                  : `/login?next=${encodeURIComponent(`/${item.type === EventType.TRIP ? 'trips' : 'events'}/${item.id}`)}`
              }
            >
              {item.title}
            </Link>
          </h2>
          <p>
            {date(item.startsAt)}
            {item.endsAt && ` — ${date(item.endsAt)}`}
          </p>
          {item.region && <p>{item.region.name}</p>}
          {item.place && <p>{item.place.name}</p>}
          {item.location && <p>{item.location}</p>}
          {item.meetingPoint && <p>Место сбора: {item.meetingPoint}</p>}
        </article>
      ))}
      {items.length > 0 && (
        <p className="text-muted" role="status">
          Показано {items.length} из {pages[0]?.total ?? 0}
        </p>
      )}
      {error ? (
        <Button
          variant="secondary"
          disabled={loading || query.isFetching}
          onClick={() =>
            void (query.isFetchNextPageError ? query.fetchNextPage() : query.refetch())
          }
        >
          {query.isFetching ? 'Загрузка…' : 'Повторить загрузку'}
        </Button>
      ) : query.hasNextPage ? (
        <Button
          variant="secondary"
          disabled={loading || query.isFetching}
          onClick={() => void query.fetchNextPage()}
        >
          {query.isFetchingNextPage ? 'Загрузка…' : 'Загрузить ещё'}
        </Button>
      ) : null}
    </section>
  );
}

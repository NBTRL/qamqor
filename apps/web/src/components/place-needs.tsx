'use client';
import Link from 'next/link';
import { useInfiniteQuery } from '@tanstack/react-query';
import { api, result, type Model, type Page } from '@/lib/api/client';
import { Button, Empty, ErrorNotice, Loading } from './ui';

type NeedsPage = Page<Model<'NeedResponseDto'>>;
export function PlaceNeedsPreview({ place }: { place: Model<'PlaceResponseDto'> }) {
  return (
    <div className="needs-preview">
      <h3>Актуальные нужды</h3>
      {place.needs?.length ? (
        <ul>
          {place.needs.map((need) => (
            <li key={need.id}>{need.title}</li>
          ))}
        </ul>
      ) : place.needsTotal === 0 ? (
        <p className="text-muted">Пока нет опубликованных нужд.</p>
      ) : null}
      <Link href={`/uchrezhdeniya/${place.slug}#needs`}>
        {place.needsTotal ? `Все нужды (${place.needsTotal})` : 'Узнать, чем помочь'}
      </Link>
    </div>
  );
}

export function PlaceNeeds({ placeId, initial }: { placeId: string; initial?: NeedsPage }) {
  const query = useInfiniteQuery({
    queryKey: ['public-needs', placeId],
    initialPageParam: 1,
    queryFn: ({ pageParam }) =>
      result(
        api.GET('/api/v1/needs', {
          params: { query: { placeId, page: pageParam, limit: 20 } },
        }),
      ),
    initialData: initial ? { pages: [initial], pageParams: [1] } : undefined,
    staleTime: 0,
    getNextPageParam: (last) => (last.page * last.limit < last.total ? last.page + 1 : undefined),
  });
  const items = [
    ...new Map(
      query.data?.pages
        .flatMap((page) => page.items)
        .filter((item) => item.placeId === placeId && item.isActive)
        .map((item) => [item.id, item]),
    ).values(),
  ];
  const total = query.data?.pages[0]?.total ?? 0;
  return (
    <section id="needs" className="place-needs" aria-labelledby="needs-title">
      <h2 id="needs-title">Актуальные нужды учреждения</h2>
      <p>Выберите, чем можете помочь, и свяжитесь с командой Клуба для согласования передачи.</p>
      {query.isPending && <Loading />}
      <ErrorNotice error={query.error} />
      {query.isError && (
        <Button variant="secondary" onClick={() => void query.refetch()}>
          Повторить загрузку
        </Button>
      )}
      {!query.isPending && !query.isError && items.length === 0 && (
        <Empty>Сейчас у учреждения нет опубликованных нужд.</Empty>
      )}
      {items.length > 0 && (
        <>
          <ul className="need-list">
            {items.map((item) => (
              <li key={item.id}>
                <h3>{item.title}</h3>
                <p>{item.description}</p>
              </li>
            ))}
          </ul>
          <p className="text-muted" role="status">
            Показано {items.length} из {total}
          </p>
          {query.hasNextPage && (
            <Button
              variant="secondary"
              disabled={query.isFetchingNextPage}
              onClick={() => void query.fetchNextPage()}
            >
              {query.isFetchingNextPage ? 'Загрузка…' : 'Загрузить ещё'}
            </Button>
          )}
          <p>
            <Link href="/kontakty">Связаться с Клубом по поводу помощи</Link>
          </p>
        </>
      )}
    </section>
  );
}

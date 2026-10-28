'use client';
import { useState, type ReactNode } from 'react';
import { useQuery } from '@tanstack/react-query';
import { type Page } from '@/lib/api/client';
import { Button, Empty, ErrorNotice, Loading } from './ui';
export type TableQuery = { page: number; limit: number; search?: string };
export function DataTable<T>({
  name,
  load,
  columns,
  filters,
  revision = 0,
}: {
  name: string;
  load: (query: TableQuery) => Promise<Page<T>>;
  columns: { title: string; cell: (row: T) => ReactNode }[];
  filters?: ReactNode;
  revision?: number;
}) {
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState('');
  const [input, setInput] = useState('');
  const query = useQuery({
    queryKey: ['table', name, page, search, revision],
    queryFn: () => load({ page, limit: 20, ...(search ? { search } : {}) }),
  });
  return (
    <>
      <form
        className="filters"
        onSubmit={(event) => {
          event.preventDefault();
          setPage(1);
          setSearch(input);
        }}
      >
        <label>
          Поиск
          <input
            className="search"
            type="search"
            value={input}
            onChange={(event) => setInput(event.target.value)}
          />
        </label>
        <Button variant="secondary">Найти</Button>
        {filters}
      </form>
      <ErrorNotice error={query.error} />
      {query.isLoading ? (
        <Loading />
      ) : !query.data?.items.length ? (
        <Empty />
      ) : (
        <>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  {columns.map((col, i) => (
                    <th scope="col" key={i}>
                      {col.title}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {query.data.items.map((row, i) => (
                  <tr key={typeof row === 'object' && row && 'id' in row ? String(row.id) : i}>
                    {columns.map((col, j) => (
                      <td key={j}>{col.cell(row)}</td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="pagination">
            <Button variant="secondary" disabled={page <= 1} onClick={() => setPage(page - 1)}>
              Назад
            </Button>
            <span>
              Страница {page} · всего {query.data.total}
            </span>
            <Button
              variant="secondary"
              disabled={page * 20 >= query.data.total}
              onClick={() => setPage(page + 1)}
            >
              Вперёд
            </Button>
          </div>
        </>
      )}
    </>
  );
}

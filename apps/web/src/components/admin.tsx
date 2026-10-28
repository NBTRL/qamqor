'use client';
import Link from 'next/link';
import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  ApplicationStatus,
  applicationStatusLabels,
  applicationStatusTransitions,
  ContactRequestStatus,
  contactRequestStatusLabels,
  NewsStatus,
  newsStatusLabels,
  userRoleLabels,
  STAT_KEYS,
  notificationStatusLabels,
  NotificationStatus,
  notificationChannelLabels,
  registrationStatusLabels,
  registrationStatusTransitions,
  RegistrationStatus,
  type UserRole,
  helpAreaLabels,
  weekdayLabels,
} from '@club/shared';
import { api, result, type Model } from '@/lib/api/client';
import { resources } from '@/lib/resources';
import { date } from '@/lib/format';
import { schemaFor } from '@/lib/form-schema';
import { Button, ErrorNotice, Empty, Field, Modal, Loading } from './ui';
import { DataTable } from './data-table';
import { RecordForm, fieldLabels, labelEnum } from './record-form';
import { notificationTitle } from './cabinet';
export function AdminNav() {
  return (
    <nav className="admin-nav" aria-label="Управление Клубом">
      <Link href="/admin">Дашборд</Link>
      <Link href="/admin/applications">Анкеты кандидатов</Link>
      {Object.entries(resources).map(([key, resource]) => (
        <Link key={key} href={`/admin/${key}`}>
          {resource.title}
        </Link>
      ))}
      <Link href="/admin/stat-overrides">Счетчики</Link>
      <Link href="/admin/notifications">Неудачные уведомления</Link>
      <Link href="/admin/audit-log">Журнал аудита</Link>
    </nav>
  );
}
export function AdminDashboard() {
  const query = useQuery({
    queryKey: ['admin-dashboard'],
    queryFn: async () => {
      const [stats, users, applications, notifications] = await Promise.all([
        result(api.GET('/api/v1/public/stats')),
        result(api.GET('/api/v1/admin/users', { params: { query: { limit: 1 } } })),
        result(api.GET('/api/v1/admin/applications', { params: { query: { limit: 1 } } })),
        result(
          api.GET('/api/v1/admin/notifications', {
            params: { query: { limit: 1, status: NotificationStatus.FAILED } },
          }),
        ),
      ]);
      return {
        stats,
        users: users.total,
        applications: applications.total,
        failed: notifications.total,
      };
    },
  });
  return (
    <>
      <AdminNav />
      <h1>Управление Клубом</h1>
      <ErrorNotice error={query.error} />
      {query.isLoading ? (
        <Loading />
      ) : (
        query.data && (
          <div className="stats">
            {[
              ['Пользователей', query.data.users],
              ['Анкет кандидатов', query.data.applications],
              ['Поездок', query.data.stats.trips],
              ['Учреждений', query.data.stats.places],
              ['Неудачных уведомлений', query.data.failed],
            ].map(([label, value]) => (
              <div className="stat" key={label}>
                <span className="stat__value">{value}</span>
                {label}
              </div>
            ))}
          </div>
        )
      )}
    </>
  );
}
type Row = Record<string, unknown>;
const rowId = (row: Row) => String(row['id']);
const nameOf = (row: Row) =>
  String(
    row['title'] ??
      row['name'] ??
      row['fullName'] ??
      row['caption'] ??
      row['donorName'] ??
      row['location'] ??
      row['id'],
  );
export function AdminResource({ resourceKey }: { resourceKey: keyof typeof resources }) {
  const resource = resources[resourceKey];
  const [edit, setEdit] = useState<Row | null>(null);
  const [creating, setCreating] = useState(false);
  const [deleting, setDeleting] = useState<Row | null>(null);
  const [registrations, setRegistrations] = useState<string | null>(null);
  const [filter, setFilter] = useState('');
  const cache = useQueryClient();
  const refresh = () => {
    void cache.invalidateQueries({ queryKey: ['table', `admin-${resourceKey}-${filter}`] });
    setEdit(null);
    setCreating(false);
    setDeleting(null);
  };
  const remove = useMutation({
    mutationFn: async (id: string) =>
      'remove' in resource ? resource.remove(id) : Promise.resolve(),
    onSuccess: refresh,
  });
  const statusLabels =
    resourceKey === 'news'
      ? newsStatusLabels
      : resourceKey === 'contact-requests'
        ? contactRequestStatusLabels
        : resourceKey === 'users'
          ? userRoleLabels
          : null;
  return (
    <>
      <AdminNav />
      <h1>{resource.title}</h1>
      <div className="actions">
        {'create' in resource && (
          <Button onClick={() => setCreating(true)}>
            {resourceKey === 'curators' ? 'Назначить куратора' : 'Добавить'}
          </Button>
        )}
        {statusLabels && (
          <Field label={resourceKey === 'users' ? 'Роль' : 'Статус'}>
            <select value={filter} onChange={(e) => setFilter(e.target.value)}>
              <option value="">Все</option>
              {Object.entries(statusLabels).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
          </Field>
        )}
      </div>
      <DataTable<Row>
        key={`${resourceKey}-${filter}`}
        name={`admin-${resourceKey}-${filter}`}
        load={async (query) => {
          const data = await resource.list({
            ...query,
            ...(filter ? { [resourceKey === 'users' ? 'role' : 'status']: filter } : {}),
          });
          return { ...data, items: data.items.map((row) => ({ ...row })) };
        }}
        columns={[
          {
            title: 'Название / участник',
            cell: (row) => (
              <>
                <strong>{nameOf(row)}</strong>
                {resourceKey === 'curators' && (
                  <p>
                    Участник: <UserName id={String(row['userId'])} />
                    <br />
                    Учреждение: <PlaceName id={String(row['placeId'])} />
                  </p>
                )}
                {resourceKey === 'contact-requests' && (
                  <>
                    <p>{String(row['contact'])}</p>
                    <p>{String(row['message'])}</p>
                  </>
                )}
                {resourceKey === 'users' && (
                  <p>
                    {String(row['email'] ?? '')}
                    <br />
                    Telegram ID: {String(row['telegramId'] ?? '—')}
                  </p>
                )}
              </>
            ),
          },
          {
            title: 'Сведения',
            cell: (row) => (
              <>
                {row['status'] && (
                  <p>
                    {labelEnum(
                      resourceKey === 'contact-requests'
                        ? Object.values(ContactRequestStatus)
                        : Object.values(NewsStatus),
                      row['status'],
                    )}
                  </p>
                )}
                {row['role'] && <p>{userRoleLabels[row['role'] as UserRole]}</p>}
                {row['isBlocked'] === true && <span className="badge">Заблокирован</span>}
                {row['startsAt'] && <p>{date(String(row['startsAt']))}</p>}
                {row['publishedAt'] && <p>{date(String(row['publishedAt']))}</p>}
                {row['amount'] && (
                  <p>
                    {String(row['amount'])} {String(row['currency'] ?? 'RUB')}
                  </p>
                )}
              </>
            ),
          },
          {
            title: 'Действия',
            cell: (row) => (
              <div className="actions">
                {'update' in resource && (
                  <Button variant="secondary" onClick={() => setEdit(row)}>
                    Редактировать
                  </Button>
                )}
                {'remove' in resource && (
                  <Button variant="secondary" onClick={() => setDeleting(row)}>
                    {resourceKey === 'curators' ? 'Снять назначение' : 'Удалить'}
                  </Button>
                )}
                {['open-days', 'events'].includes(resourceKey) && (
                  <Button variant="secondary" onClick={() => setRegistrations(rowId(row))}>
                    Участники
                  </Button>
                )}
              </div>
            ),
          },
        ]}
      />
      <Modal
        open={creating || !!edit}
        onClose={() => {
          setCreating(false);
          setEdit(null);
        }}
        title={`${edit ? 'Редактирование' : 'Добавление'}: ${resource.title}`}
      >
        <RecordForm
          key={edit ? rowId(edit) : 'new'}
          schemaName={(edit ? resource.updateSchema : resource.createSchema)!}
          initial={edit ?? {}}
          onSave={(body) =>
            edit && 'update' in resource
              ? resource.update(rowId(edit), body)
              : 'create' in resource
                ? resource.create(body)
                : Promise.reject(new Error('Действие недоступно.'))
          }
          onDone={refresh}
        />
      </Modal>
      <Modal open={!!deleting} onClose={() => setDeleting(null)} title="Подтвердите удаление">
        <p>{deleting && nameOf(deleting)}</p>
        <p>
          {resourceKey === 'users'
            ? 'Персональные данные пользователя будут обезличены. Записи и отчеты сохранятся.'
            : 'Действие нельзя отменить.'}
        </p>
        <ErrorNotice error={remove.error} />
        <Button
          variant="danger"
          disabled={remove.isPending}
          onClick={() => deleting && remove.mutate(rowId(deleting))}
        >
          Подтвердить
        </Button>
      </Modal>
      <Modal open={!!registrations} onClose={() => setRegistrations(null)} title="Участники">
        {registrations && (
          <AdminParticipants
            kind={resourceKey === 'events' ? 'EVENT' : 'OPEN_DAY'}
            id={registrations}
          />
        )}
      </Modal>
    </>
  );
}
function AdminParticipants({ kind, id }: { kind: 'EVENT' | 'OPEN_DAY'; id: string }) {
  const cache = useQueryClient();
  const mutation = useMutation({
    mutationFn: async ({
      registrationId,
      attended,
      status,
    }: {
      registrationId: string;
      attended?: boolean;
      status?: RegistrationStatus;
    }) =>
      kind === 'OPEN_DAY'
        ? result(
            api.PATCH('/api/v1/admin/open-day-registrations/{id}', {
              params: { path: { id: registrationId } },
              body: { attended: !!attended },
            }),
          )
        : result(
            api.PATCH('/api/v1/admin/event-registrations/{id}', {
              params: { path: { id: registrationId } },
              body: { status: status! },
            }),
          ),
    onSuccess: () =>
      void cache.invalidateQueries({ queryKey: ['table', `admin-attendance-${id}`] }),
  });
  return (
    <>
      <ErrorNotice error={mutation.error} />
      <DataTable<Model<'OpenDayRegistrationResponseDto'> | Model<'AdminEventRegistrationDto'>>
        name={`admin-attendance-${id}`}
        load={async (query) =>
          kind === 'OPEN_DAY'
            ? result(
                api.GET('/api/v1/admin/open-days/{id}/registrations', {
                  params: { path: { id }, query },
                }),
              )
            : result(
                api.GET('/api/v1/admin/events/{id}/registrations', {
                  params: { path: { id }, query },
                }),
              )
        }
        columns={[
          { title: 'Участник', cell: (row) => <UserName id={row.userId} /> },
          {
            title: 'Статус',
            cell: (row) =>
              'attended' in row
                ? row.cancelledAt
                  ? 'Запись отменена'
                  : row.attended
                    ? 'ДОД посещен'
                    : 'Ожидает посещения'
                : registrationStatusLabels[row.status],
          },
          {
            title: 'Действия',
            cell: (row) =>
              'attended' in row ? (
                <Button
                  variant="secondary"
                  disabled={mutation.isPending || !!row.cancelledAt}
                  onClick={() =>
                    mutation.mutate({ registrationId: row.id, attended: !row.attended })
                  }
                >
                  {row.attended ? 'Снять отметку' : 'Отметить посещение'}
                </Button>
              ) : (
                <div className="actions">
                  {registrationStatusTransitions[row.status].map((status) => (
                    <Button
                      key={status}
                      variant="secondary"
                      disabled={mutation.isPending}
                      onClick={() => mutation.mutate({ registrationId: row.id, status })}
                    >
                      {registrationStatusLabels[status]}
                    </Button>
                  ))}
                </div>
              ),
          },
        ]}
      />
    </>
  );
}
function UserName({ id }: { id: string }) {
  const query = useQuery({
    queryKey: ['admin-user', id],
    queryFn: () => result(api.GET('/api/v1/admin/users/{id}', { params: { path: { id } } })),
  });
  return <>{query.data?.fullName ?? id}</>;
}
export function Applications() {
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState('');
  const [selected, setSelected] = useState<string | null>(null);
  const query = useQuery({
    queryKey: ['applications', page, search],
    queryFn: () =>
      result(
        api.GET('/api/v1/admin/applications', {
          params: { query: { page, limit: 50, search: search || undefined } },
        }),
      ),
  });
  return (
    <>
      <AdminNav />
      <h1>Анкеты кандидатов</h1>
      <Field label="Поиск">
        <input
          type="search"
          value={search}
          onChange={(e) => {
            setSearch(e.target.value);
            setPage(1);
          }}
        />
      </Field>
      <ErrorNotice error={query.error} />
      {query.isLoading ? (
        <Loading />
      ) : (
        <div className="kanban">
          {Object.values(ApplicationStatus).map((status) => (
            <section key={status} className="kanban__column">
              <h2>{applicationStatusLabels[status]}</h2>
              {query.data?.items
                .filter((row) => row.status === status)
                .map((row) => (
                  <article className="card" key={row.id}>
                    <div className="card__body">
                      <h3>
                        {row.user && 'fullName' in row.user
                          ? String(row.user.fullName)
                          : row.userId}
                      </h3>
                      <p className="badge">
                        {row.hasOpenDayAttended ? 'ДОД посещен' : 'ДОД не посещен'}
                      </p>
                      <Button variant="secondary" onClick={() => setSelected(row.id)}>
                        Открыть анкету
                      </Button>
                    </div>
                  </article>
                ))}
            </section>
          ))}
        </div>
      )}
      <div className="pagination">
        <Button variant="secondary" disabled={page === 1} onClick={() => setPage(page - 1)}>
          Назад
        </Button>
        <span>Страница {page}</span>
        <Button
          variant="secondary"
          disabled={!query.data || page * 50 >= query.data.total}
          onClick={() => setPage(page + 1)}
        >
          Вперёд
        </Button>
      </div>
      <Modal open={!!selected} onClose={() => setSelected(null)} title="Анкета кандидата">
        {selected && <ApplicationDecision id={selected} />}
      </Modal>
    </>
  );
}
function ApplicationDecision({ id }: { id: string }) {
  const cache = useQueryClient();
  const query = useQuery({
    queryKey: ['admin-application', id],
    queryFn: () => result(api.GET('/api/v1/admin/applications/{id}', { params: { path: { id } } })),
  });
  const [comment, setComment] = useState('');
  const mutation = useMutation({
    mutationFn: (status: ApplicationStatus) =>
      result(
        api.POST('/api/v1/admin/applications/{id}/status', {
          params: { path: { id } },
          body: { status, comment },
        }),
      ),
    onSuccess: () => {
      void cache.invalidateQueries({ queryKey: ['applications'] });
      void cache.invalidateQueries({ queryKey: ['admin-application', id] });
    },
  });
  const row = query.data;
  if (!row)
    return (
      <>
        <Loading />
        <ErrorNotice error={query.error} />
      </>
    );
  return (
    <>
      <h3>{applicationStatusLabels[row.status]}</h3>
      <p className="badge">{row.hasOpenDayAttended ? 'ДОД посещен' : 'ДОД не посещен'}</p>
      {row.questionnaire ? (
        <dl>
          {Object.entries(row.questionnaire).map(([key, value]) => (
            <div key={key}>
              <dt>
                <strong>
                  {{
                    motivation: 'Мотивация',
                    volunteeringExperience: 'Опыт волонтерства',
                    helpAreas: 'Чем готов помогать',
                    availableWeekdays: 'Удобные дни',
                    referralSource: 'Откуда узнал',
                    rulesAccepted: 'Правила Клуба',
                  }[key] ?? key}
                </strong>
              </dt>
              <dd>
                {Array.isArray(value)
                  ? value
                      .map((item) =>
                        key === 'helpAreas'
                          ? helpAreaLabels[item as keyof typeof helpAreaLabels]
                          : key === 'availableWeekdays'
                            ? weekdayLabels[item as keyof typeof weekdayLabels]
                            : String(item),
                      )
                      .join(', ')
                  : value === true
                    ? 'Ознакомлен'
                    : String(value)}
              </dd>
            </div>
          ))}
        </dl>
      ) : (
        <Empty>Анкета еще не заполнена.</Empty>
      )}
      <h3>История</h3>
      <ol>
        {row.history.map((item, index) => (
          <li key={index}>
            {'createdAt' in item ? date(String(item.createdAt)) : ''} ·{' '}
            {'toStatus' in item ? applicationStatusLabels[item.toStatus as ApplicationStatus] : ''}
            {'comment' in item && item.comment ? ` — ${String(item.comment)}` : ''}
          </li>
        ))}
      </ol>
      <Field label="Комментарий администратора">
        <textarea
          value={comment}
          maxLength={5000}
          onChange={(event) => setComment(event.target.value)}
        />
      </Field>
      <div className="actions">
        {applicationStatusTransitions[row.status]
          .filter((status) => status !== ApplicationStatus.QUESTIONNAIRE_DONE)
          .map((status) => (
            <Button
              key={status}
              disabled={mutation.isPending}
              onClick={() => mutation.mutate(status)}
            >
              {applicationStatusLabels[status]}
            </Button>
          ))}
      </div>
      {!row.hasOpenDayAttended && (
        <p className="notice">
          Для собеседования и принятия нужна заполненная анкета и подтвержденное посещение Дня
          открытых дверей.
        </p>
      )}
      <ErrorNotice error={mutation.error} />
    </>
  );
}
export function StatOverrides() {
  const query = useQuery({
    queryKey: ['stat-overrides'],
    queryFn: () => result(api.GET('/api/v1/admin/stat-overrides')),
  });
  const [values, setValues] = useState<Partial<Record<(typeof STAT_KEYS)[number], string>>>({});
  const mutation = useMutation({
    mutationFn: () => {
      const body = schemaFor('OverridesDto').parse({
        items: STAT_KEYS.map((key) => {
          const stored = query.data?.items.find((row) => row.key === key)?.value;
          const value = values[key];
          return {
            key,
            value: value === undefined ? (stored ?? null) : value === '' ? null : Number(value),
          };
        }),
      });
      return result(api.PUT('/api/v1/admin/stat-overrides', { body }));
    },
  });
  return (
    <>
      <AdminNav />
      <h1>Переопределение счетчиков</h1>
      <p>Пустое поле возвращает автоматический расчет.</p>
      <ErrorNotice error={query.error ?? mutation.error} />
      {query.data && (
        <form
          className="form"
          onSubmit={(event) => {
            event.preventDefault();
            mutation.mutate();
          }}
        >
          {STAT_KEYS.map((key) => (
            <Field
              key={key}
              label={
                {
                  places: 'Учреждения',
                  curators: 'Кураторы',
                  events12Months: 'Мероприятия за 12 месяцев',
                  masterClasses12Months: 'Мастер-классы за 12 месяцев',
                  uniqueParticipants12Months: 'Участники за 12 месяцев',
                  beneficiaries: 'Подопечные',
                  trips: 'Поездки',
                }[key]
              }
            >
              <input
                type="number"
                min="0"
                max="2147483647"
                value={values[key] ?? query.data.items.find((row) => row.key === key)?.value ?? ''}
                onChange={(event) => setValues({ ...values, [key]: event.target.value })}
              />
            </Field>
          ))}
          <Button disabled={mutation.isPending}>Сохранить счетчики</Button>
          {mutation.isSuccess && <p role="status">Счетчики сохранены.</p>}
        </form>
      )}
    </>
  );
}
export function AdminNotifications() {
  return (
    <>
      <AdminNav />
      <h1>Неудачные уведомления</h1>
      <DataTable
        name="failed-notifications"
        load={(query) =>
          result(
            api.GET('/api/v1/admin/notifications', {
              params: { query: { ...query, status: NotificationStatus.FAILED } },
            }),
          )
        }
        columns={[
          { title: 'Тип', cell: (row) => notificationTitle(row.type) },
          { title: 'Канал', cell: (row) => notificationChannelLabels[row.channel] },
          { title: 'Статус', cell: (row) => notificationStatusLabels[row.status] },
          { title: 'Попытки', cell: (row) => row.attempts },
          { title: 'Ошибка', cell: (row) => row.lastError ?? '—' },
          { title: 'Создано', cell: (row) => date(row.createdAt) },
        ]}
      />
    </>
  );
}
export function AuditLog() {
  const [entity, setEntity] = useState('');
  return (
    <>
      <AdminNav />
      <h1>Журнал аудита</h1>
      <Field label="Сущность">
        <input value={entity} onChange={(e) => setEntity(e.target.value)} />
      </Field>
      <DataTable
        key={entity}
        name={`audit-${entity}`}
        load={(query) =>
          result(
            api.GET('/api/v1/admin/audit-log', {
              params: { query: { ...query, entity: entity || undefined } },
            }),
          )
        }
        columns={[
          { title: 'Дата', cell: (row) => date(row.createdAt) },
          { title: 'Действие', cell: (row) => row.action },
          {
            title: 'Сущность',
            cell: (row) => (
              <>
                {row.entity}
                <br />
                {row.entityId}
              </>
            ),
          },
          {
            title: 'Автор',
            cell: (row) => (row.actorId ? <UserName id={row.actorId} /> : 'Система'),
          },
          {
            title: 'Изменения',
            cell: (row) => (
              <dl>
                {Object.entries(row.diff).map(([key, value]) => (
                  <div key={key}>
                    <dt>{fieldLabels[key] ?? key}</dt>
                    <dd>
                      {Array.isArray(value)
                        ? value.join(', ')
                        : typeof value === 'object'
                          ? Object.entries(value ?? {})
                              .map(([k, v]) => `${k}: ${String(v)}`)
                              .join('; ')
                          : String(value)}
                    </dd>
                  </div>
                ))}
              </dl>
            ),
          },
        ]}
      />
    </>
  );
}

function PlaceName({ id }: { id: string }) {
  const query = useQuery({
    queryKey: ['admin-place', id],
    queryFn: () => result(api.GET('/api/v1/admin/places/{id}', { params: { path: { id } } })),
  });
  return <>{query.data?.name ?? id}</>;
}

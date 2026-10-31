'use client';
import Image from 'next/image';
import { useNow } from '@/lib/use-now';
import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import {
  questionnaireSchema,
  type QuestionnaireInput,
  HELP_AREAS,
  WEEKDAYS,
  helpAreaLabels,
  weekdayLabels,
  CONSENT_VERSION,
  ApplicationStatus,
  applicationStatusLabels,
  RegistrationStatus,
  registrationStatusLabels,
  NOTIFICATION_TYPES,
  notificationChannelLabels,
  notificationStatusLabels,
  emailSchema,
  UserRole,
  notificationTypeLabels,
} from '@club/shared';
import { api, result, clearPrivateStorage, type Model } from '@/lib/api/client';
import { date } from '@/lib/format';
import { schemaFor } from '@/lib/form-schema';
import { useAuth } from './providers';
import { Button, ButtonLink, ErrorNotice, Field, Modal } from './ui';
import { OpenDays } from './public-widgets';
import { DataTable } from './data-table';
import { Upload } from './upload';
import { useUploadGuard } from './upload-guard';
export function BotWarning() {
  const { me } = useAuth();
  return me?.botBlockedAt ? (
    <p className="notice" role="status">
      Бот заблокирован — уведомления идут на e-mail. Разблокируйте бота в Telegram.{' '}
      {!me.emailVerifiedAt && (
        <>
          Подтвердите резервный e-mail в <Link href="/cabinet/profile">профиле</Link>, чтобы
          получать письма.
        </>
      )}
    </p>
  ) : null;
}
export function CabinetHome() {
  const now = useNow();
  const { me } = useAuth();
  const app = useQuery({
    queryKey: ['application'],
    queryFn: () => result(api.GET('/api/v1/me/application')),
  });
  const registrations = useQuery({
    queryKey: ['registrations', 'next'],
    queryFn: () =>
      result(
        api.GET('/api/v1/me/registrations', { params: { query: { upcoming: true, limit: 6 } } }),
      ),
  });
  const notifications = useQuery({
    queryKey: ['notifications', 'overview'],
    queryFn: () =>
      result(api.GET('/api/v1/me/notifications', { params: { query: { limit: 100 } } })),
  });
  const data = app.data;
  const progress = [
    { title: 'Анкета', done: !!data?.questionnaire },
    { title: 'День открытых дверей (посещение)', done: !!data?.hasOpenDayAttended },
    {
      title: 'Собеседование (при необходимости)',
      done:
        data?.history.some(
          (row) => 'toStatus' in row && row.toStatus === ApplicationStatus.INTERVIEW,
        ) ||
        data?.status === ApplicationStatus.INTERVIEW ||
        data?.status === ApplicationStatus.ACCEPTED,
    },
    {
      title: 'Решение',
      done:
        data?.status === ApplicationStatus.ACCEPTED || data?.status === ApplicationStatus.REJECTED,
    },
  ];
  return (
    <>
      <h1>Здравствуйте, {me?.nickname || me?.fullName}</h1>
      <BotWarning />
      <h2>Вступление в Клуб</h2>
      <ErrorNotice error={app.error} />
      {data && (
        <>
          <span className="badge">{applicationStatusLabels[data.status]}</span>
          <ol className="progress">
            {progress.map((step) => (
              <li className={step.done ? 'progress__done' : ''} key={step.title}>
                {step.done ? '✓ ' : ''}
                {step.title}
              </li>
            ))}
          </ol>
          <ButtonLink href="/cabinet/application">Перейти к анкете</ButtonLink>
        </>
      )}
      <h2>Ближайшие записи</h2>
      <ErrorNotice error={registrations.error} />
      {registrations.data?.items
        .filter((item) => Date.parse(item.startsAt) > now)
        .map((item) => (
          <p key={item.id}>
            <Link href="/cabinet/registrations">{item.title}</Link> · {date(item.startsAt)}
          </p>
        ))}
      <h2>Непрочитанные уведомления</h2>
      <ErrorNotice error={notifications.error} />
      {notifications.data?.items
        .filter((item) => !item.readAt)
        .slice(0, 5)
        .map((item) => (
          <p key={item.id}>
            <Link href="/cabinet/notifications">{notificationTitle(item.type)}</Link>
          </p>
        ))}
      <Link href="/cabinet/notifications">Все уведомления</Link>
    </>
  );
}
export function ApplicationForm() {
  const { me } = useAuth();
  const cache = useQueryClient();
  const query = useQuery({
    queryKey: ['application'],
    queryFn: () => result(api.GET('/api/v1/me/application')),
  });
  const [step, setStep] = useState(0);
  const [saved, setSaved] = useState('');
  const form = useForm<QuestionnaireInput>({
    resolver: zodResolver(questionnaireSchema),
    defaultValues: {
      motivation: '',
      volunteeringExperience: '',
      helpAreas: [],
      availableWeekdays: [],
      referralSource: '',
    },
  });
  const key = `club:questionnaire:${me?.id}:${CONSENT_VERSION}`;
  const editable =
    me?.role === UserRole.CANDIDATE &&
    !!query.data &&
    [ApplicationStatus.NEW, ApplicationStatus.QUESTIONNAIRE_DONE].includes(
      query.data.status as ApplicationStatus,
    );
  useEffect(() => {
    if (!query.data) return;
    const initial: unknown = query.data.questionnaire;
    try {
      const draft = sessionStorage.getItem(key);
      if (draft) {
        const parsedDraft = z
          .partialRecord(
            questionnaireSchema.keyof(),
            z.union([z.string(), z.array(z.string()), z.boolean()]),
          )
          .safeParse(JSON.parse(draft));
        if (parsedDraft.success) {
          form.reset({
            ...parsedDraft.data,
            rulesAccepted: parsedDraft.data.rulesAccepted === true ? true : undefined,
          } as Partial<QuestionnaireInput>);
          return;
        }
      }
    } catch {
      /* An invalid local draft is ignored; the server remains authoritative. */
    }
    const parsed = questionnaireSchema.partial().safeParse(initial);
    if (parsed.success) form.reset(parsed.data);
  }, [query.data, key, form]);
  useEffect(() => {
    if (!editable) return;
    let timer: ReturnType<typeof setTimeout>;
    const unsubscribe = form.subscribe({
      formState: { values: true },
      callback: ({ values: value }) => {
        clearTimeout(timer);
        timer = setTimeout(() => {
          try {
            sessionStorage.setItem(key, JSON.stringify(value));
            setSaved('Черновик сохранён в этой вкладке.');
          } catch {
            setSaved('Не удалось сохранить черновик в браузере.');
          }
        }, 500);
      },
    });
    return () => {
      clearTimeout(timer);
      unsubscribe();
    };
  }, [form, key, editable]);
  const mutation = useMutation({
    mutationFn: (body: QuestionnaireInput) => result(api.PUT('/api/v1/me/application', { body })),
    onSuccess: (data) => {
      cache.setQueryData(['application'], data);
      sessionStorage.removeItem(key);
      setSaved('Анкета отправлена.');
    },
  });
  const next = async () => {
    const fields: ('motivation' | 'volunteeringExperience' | 'helpAreas' | 'availableWeekdays')[] =
      step === 0 ? ['motivation', 'volunteeringExperience'] : ['helpAreas', 'availableWeekdays'];
    if (await form.trigger(fields)) setStep(step + 1);
  };
  return (
    <>
      <h1>Анкета кандидата</h1>
      <ErrorNotice error={query.error} />
      <p>Анкету и посещение Дня открытых дверей можно пройти в любом порядке.</p>
      <p>Шаг {step + 1} из 3</p>
      <form
        className="form"
        onSubmit={form.handleSubmit((body) => {
          if (editable) mutation.mutate(body);
        })}
      >
        {!editable && query.data && (
          <p className="notice">
            Анкета доступна для просмотра. Редактирование на текущем этапе закрыто.
          </p>
        )}
        <fieldset disabled={!editable} className="form__body">
          {step === 0 ? (
            <>
              {(['motivation', 'volunteeringExperience'] as const).map((name) => (
                <Field
                  key={name}
                  label={
                    name === 'motivation' ? 'Почему хотите стать волонтером?' : 'Опыт волонтерства'
                  }
                  error={form.formState.errors[name]?.message}
                >
                  <textarea {...form.register(name)} />
                </Field>
              ))}
            </>
          ) : step === 1 ? (
            <>
              <fieldset>
                <legend>Чем готовы помогать</legend>
                <div className="checks">
                  {HELP_AREAS.map((value) => (
                    <label className="check" key={value}>
                      <input type="checkbox" value={value} {...form.register('helpAreas')} />
                      {helpAreaLabels[value]}
                    </label>
                  ))}
                </div>
                {form.formState.errors.helpAreas && (
                  <p role="alert">{form.formState.errors.helpAreas.message}</p>
                )}
              </fieldset>
              <fieldset>
                <legend>Удобные дни недели</legend>
                <div className="checks">
                  {WEEKDAYS.map((value) => (
                    <label className="check" key={value}>
                      <input
                        type="checkbox"
                        value={value}
                        {...form.register('availableWeekdays')}
                      />
                      {weekdayLabels[value]}
                    </label>
                  ))}
                </div>
                {form.formState.errors.availableWeekdays && (
                  <p role="alert">{form.formState.errors.availableWeekdays.message}</p>
                )}
              </fieldset>
            </>
          ) : (
            <>
              <Field
                label="Откуда узнали о Клубе?"
                error={form.formState.errors.referralSource?.message}
              >
                <input {...form.register('referralSource')} />
              </Field>
              <label className="check">
                <input type="checkbox" {...form.register('rulesAccepted')} />
                <span>
                  Ознакомлен с{' '}
                  <Link href="/o-klube-volonterov" target="_blank">
                    правилами Клуба
                  </Link>
                  .
                </span>
              </label>
              {form.formState.errors.rulesAccepted && (
                <p role="alert">{form.formState.errors.rulesAccepted.message}</p>
              )}
            </>
          )}
        </fieldset>
        <div className="actions">
          {step > 0 && (
            <Button type="button" variant="secondary" onClick={() => setStep(step - 1)}>
              Назад
            </Button>
          )}
          {step < 2 ? (
            <Button type="button" onClick={() => void next()}>
              Далее
            </Button>
          ) : (
            <Button disabled={mutation.isPending || !editable}>Отправить анкету</Button>
          )}
        </div>
        <p role="status">{saved}</p>
        <ErrorNotice error={mutation.error} />
      </form>
      <section className="section">
        <h2>День открытых дверей</h2>
        {query.data?.hasOpenDayAttended && (
          <p className="notice">Посещение Дня открытых дверей подтверждено.</p>
        )}
        <OpenDays />
      </section>
    </>
  );
}
const profileSchema = z.object({
  fullName: z.string().trim().min(2).max(160),
  nickname: z.string().trim().max(100).nullable().optional(),
  city: z.string().trim().max(160).nullable().optional(),
});
export function Profile() {
  const { me, reload } = useAuth();
  const cache = useQueryClient();
  const uploads = useUploadGuard();
  const form = useForm<z.infer<typeof profileSchema>>({
    resolver: zodResolver(profileSchema),
    defaultValues: {
      fullName: me?.fullName ?? '',
      nickname: me?.nickname ?? '',
      city: me?.city ?? '',
    },
  });
  const [avatar, setAvatar] = useState<string>();
  const [email, setEmail] = useState(me?.email ?? '');
  const [confirm, setConfirm] = useState(false);
  const mutation = useMutation({
    mutationFn: (body: z.infer<typeof profileSchema>) =>
      result(
        api.PATCH('/api/v1/me', { body: { ...body, ...(avatar ? { avatarUrl: avatar } : {}) } }),
      ),
    onSuccess: async () => {
      setAvatar(undefined);
      await reload();
    },
  });
  const mail = useMutation({
    mutationFn: () =>
      result(api.POST('/api/v1/me/email', { body: { email: emailSchema.parse(email) } })),
    onSuccess: () => void reload(),
  });
  const removeEmail = useMutation({
    mutationFn: () => result(api.DELETE('/api/v1/me/email')),
    onSuccess: () => {
      setEmail('');
      void reload();
    },
  });
  const remove = useMutation({
    mutationFn: () => result(api.DELETE('/api/v1/me')),
    onSuccess: () => {
      clearPrivateStorage();
      cache.clear();
      window.location.assign('/');
    },
  });
  return (
    <>
      <h1>Профиль</h1>
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
        {me?.avatarUrl && (
          <Image
            unoptimized
            className="avatar"
            src={me.avatarUrl}
            width="100"
            height="100"
            alt="Ваш аватар"
          />
        )}
        <Upload
          purpose="AVATAR"
          onUploaded={(value) => setAvatar(value.fileUrl)}
          label="Новый аватар"
          onStateChange={uploads.onStateChange}
          disabled={mutation.isPending || form.formState.isSubmitting}
        />
        {(['fullName', 'nickname', 'city'] as const).map((name) => (
          <Field
            key={name}
            label={{ fullName: 'ФИО', nickname: 'Ник', city: 'Город' }[name]}
            error={form.formState.errors[name]?.message}
          >
            <input {...form.register(name)} />
          </Field>
        ))}
        <Field label="Телефон из Telegram" hint="Подтвержден Telegram, редактирование недоступно.">
          <input value={me?.phone ?? ''} readOnly />
        </Field>
        <ErrorNotice error={mutation.error} />
        {mutation.isSuccess && <p role="status">Профиль сохранён.</p>}
        <Button disabled={mutation.isPending || form.formState.isSubmitting || uploads.blocked}>
          Сохранить профиль
        </Button>
      </form>
      <section className="section">
        <h2>Резервный e-mail</h2>
        <p>
          Нужен для уведомлений, если бот заблокирован, и резервного входа по коду. Администратор
          подтверждает им второй шаг входа.
        </p>
        <p>
          Статус:{' '}
          {me?.emailVerifiedAt
            ? 'подтвержден'
            : me?.email
              ? 'ожидает подтверждения'
              : 'не добавлен'}
        </p>
        <form
          className="form"
          onSubmit={(event) => {
            event.preventDefault();
            mail.mutate();
          }}
        >
          <Field label="E-mail">
            <input
              type="email"
              required
              value={email}
              onChange={(event) => setEmail(event.target.value)}
            />
          </Field>
          <div className="actions">
            <Button disabled={mail.isPending}>Отправить подтверждение</Button>
            {me?.email && me.role !== UserRole.ADMIN && (
              <Button
                type="button"
                variant="secondary"
                onClick={() => removeEmail.mutate()}
                disabled={removeEmail.isPending}
              >
                Удалить e-mail
              </Button>
            )}
          </div>
          <ErrorNotice error={mail.error ?? removeEmail.error} />
          {mail.isSuccess && <p role="status">Письмо отправлено. Откройте ссылку подтверждения.</p>}
        </form>
      </section>
      <Button variant="danger" onClick={() => setConfirm(true)}>
        Удалить аккаунт
      </Button>
      <Modal open={confirm} onClose={() => setConfirm(false)} title="Удалить аккаунт?">
        <p>
          Персональные данные будут удалены. Записи и отчеты сохранятся обезличенными для
          статистики. Это действие нельзя отменить.
        </p>
        <ErrorNotice error={remove.error} />
        <div className="actions">
          <Button variant="danger" disabled={remove.isPending} onClick={() => remove.mutate()}>
            Подтвердить удаление аккаунта
          </Button>
          <Button variant="secondary" onClick={() => setConfirm(false)}>
            Отмена
          </Button>
        </div>
      </Modal>
    </>
  );
}
export function MyRegistrations() {
  const now = useNow();
  const cache = useQueryClient();
  const cancel = useMutation({
    mutationFn: async (row: Model<'MeRegistrationResponseDto'>) =>
      row.kind === 'TRIP'
        ? result(
            api.DELETE('/api/v1/trips/{id}/register', { params: { path: { id: row.entityId } } }),
          )
        : row.kind === 'EVENT'
          ? result(
              api.DELETE('/api/v1/events/{id}/register', {
                params: { path: { id: row.entityId } },
              }),
            )
          : result(
              api.DELETE('/api/v1/me/open-days/{id}/register', {
                params: { path: { id: row.entityId } },
              }),
            ),
    onSuccess: () => {
      void cache.invalidateQueries({ queryKey: ['table', 'registrations'] });
      void cache.invalidateQueries({ queryKey: ['registrations'] });
    },
  });
  return (
    <>
      <h1>Мои записи</h1>
      <ErrorNotice error={cancel.error} />
      <DataTable
        name="registrations"
        load={(query) => result(api.GET('/api/v1/me/registrations', { params: { query } }))}
        columns={[
          {
            title: 'Событие',
            cell: (row) => (
              <>
                {row.title}
                <p>
                  {row.kind === 'TRIP'
                    ? 'Поездка'
                    : row.kind === 'EVENT'
                      ? 'Мероприятие'
                      : 'День открытых дверей'}
                </p>
              </>
            ),
          },
          { title: 'Дата (МСК)', cell: (row) => date(row.startsAt) },
          {
            title: 'Статус',
            cell: (row) =>
              row.status
                ? registrationStatusLabels[row.status]
                : row.cancelledAt
                  ? 'Отменено'
                  : row.attended
                    ? 'Посещение подтверждено'
                    : 'Вы записаны',
          },
          {
            title: 'Действия',
            cell: (row) =>
              !row.cancelledAt &&
              Date.parse(row.startsAt) > now &&
              (!row.status ||
                [
                  RegistrationStatus.PENDING,
                  RegistrationStatus.WAITLIST,
                  RegistrationStatus.CONFIRMED,
                ].includes(row.status as RegistrationStatus)) ? (
                <Button
                  variant="secondary"
                  disabled={cancel.isPending}
                  onClick={() => cancel.mutate(row)}
                >
                  Отменить запись
                </Button>
              ) : null,
          },
        ]}
      />
    </>
  );
}
export const notificationTitle = (type: string) =>
  notificationTypeLabels[type as keyof typeof notificationTypeLabels] ?? type;
export function Notifications() {
  const { me } = useAuth();
  const cache = useQueryClient();
  const settings = useQuery({
    queryKey: ['notification-settings'],
    queryFn: () => result(api.GET('/api/v1/me/notification-settings')),
  });
  const read = useMutation({
    mutationFn: (id: string) =>
      result(api.PATCH('/api/v1/me/notifications/{id}/read', { params: { path: { id } } })),
    onSuccess: () => {
      void cache.invalidateQueries({ queryKey: ['table', 'notifications'] });
      void cache.invalidateQueries({ queryKey: ['notifications'] });
    },
  });
  return (
    <>
      <h1>Уведомления</h1>
      <BotWarning />
      <p>
        Telegram {me?.botBlockedAt ? 'заблокирован' : 'доступен'}. E-mail{' '}
        {me?.emailVerifiedAt ? 'подтвержден' : 'недоступен до подтверждения'}.
      </p>
      <ErrorNotice error={settings.error ?? read.error} />
      {settings.data && (
        <NotificationSettings initial={settings.data.items} verified={!!me?.emailVerifiedAt} />
      )}
      <h2>Сообщения</h2>
      <DataTable
        name="notifications"
        load={(query) => result(api.GET('/api/v1/me/notifications', { params: { query } }))}
        columns={[
          {
            title: 'Уведомление',
            cell: (row) => (
              <>
                {notificationTitle(row.type)}
                <p>
                  {typeof row.payload['message'] === 'string'
                    ? row.payload['message']
                    : typeof row.payload['title'] === 'string'
                      ? row.payload['title']
                      : ''}
                </p>
              </>
            ),
          },
          { title: 'Дата', cell: (row) => date(row.createdAt) },
          { title: 'Канал', cell: (row) => notificationChannelLabels[row.channel] },
          { title: 'Статус', cell: (row) => notificationStatusLabels[row.status] },
          {
            title: 'Прочитано',
            cell: (row) =>
              row.readAt ? (
                '✓'
              ) : (
                <Button
                  variant="secondary"
                  disabled={read.isPending}
                  onClick={() => read.mutate(row.id)}
                >
                  Отметить прочитанным
                </Button>
              ),
          },
        ]}
      />
    </>
  );
}
const notificationSettingsValues = (items: Model<'SettingDto'>[], verified: boolean) => ({
  items: items.map((item) => ({ ...item, email: verified && item.email })),
});
function NotificationSettings({
  initial,
  verified,
}: {
  initial: Model<'SettingDto'>[];
  verified: boolean;
}) {
  const cache = useQueryClient();
  const saving = useRef(false);
  const form = useForm<{ items: Model<'SettingDto'>[] }>({
    resolver: zodResolver(schemaFor('SettingsWriteDto')),
    defaultValues: notificationSettingsValues(initial, verified),
  });
  const {
    reset,
    setValue,
    formState: { dirtyFields },
  } = form;
  useEffect(() => {
    // Refresh untouched switches without replacing an unsaved choice.
    reset(notificationSettingsValues(initial, verified), { keepDirtyValues: true });
    if (!verified)
      NOTIFICATION_TYPES.forEach((_type, index) =>
        setValue(`items.${index}.email`, false, { shouldDirty: true }),
      );
  }, [initial, verified, reset, setValue]);
  const save = useMutation({
    mutationFn: (body: { items: Model<'SettingDto'>[] }) =>
      result(api.PUT('/api/v1/me/notification-settings', { body })),
    onSuccess: async (data) => {
      // An older focus/refetch response must not replace the confirmed save.
      await cache.cancelQueries({ queryKey: ['notification-settings'], exact: true });
      cache.setQueryData(['notification-settings'], data);
      reset(notificationSettingsValues(data.items, verified));
    },
    onSettled: () => {
      saving.current = false;
    },
  });
  return (
    <form
      aria-busy={save.isPending}
      onSubmit={(event) => {
        event.preventDefault();
        if (saving.current) return;
        void form.handleSubmit((body) => {
          if (saving.current) return;
          saving.current = true;
          save.mutate(notificationSettingsValues(body.items, verified));
        })(event);
      }}
    >
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th scope="col">Тип события</th>
              <th scope="col">Telegram</th>
              <th scope="col">E-mail</th>
            </tr>
          </thead>
          <tbody>
            {NOTIFICATION_TYPES.map((type, index) => (
              <tr key={type}>
                <th scope="row">{notificationTitle(type)}</th>
                <td>
                  <input
                    type="checkbox"
                    aria-label={`${notificationTitle(type)}: Telegram`}
                    disabled={save.isPending}
                    {...form.register(`items.${index}.telegram`)}
                  />
                </td>
                <td>
                  <input
                    type="checkbox"
                    disabled={!verified || save.isPending}
                    aria-label={`${notificationTitle(type)}: e-mail`}
                    {...form.register(`items.${index}.email`)}
                  />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="actions">
        <Button disabled={save.isPending}>Сохранить настройки</Button>
      </div>
      <ErrorNotice error={save.error} />
      {save.isSuccess && !Object.keys(dirtyFields).length && (
        <p role="status">Настройки сохранены.</p>
      )}
    </form>
  );
}

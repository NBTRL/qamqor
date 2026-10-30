'use client';
import Image from 'next/image';
import { PlaceNeedsPreview } from './place-needs';
import Link from 'next/link';
import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import {
  CONSENT_VERSION,
  contactRequestSchema,
  type ContactRequestInput,
  placeTypeLabels,
} from '@club/shared';
import { api, result, type Model } from '@/lib/api/client';
import { date } from '@/lib/format';
import { useAuth } from './providers';
import { Button, ButtonLink, Modal, RichText, Empty, ErrorNotice, Field, Loading } from './ui';
const subscribeToHydration = () => () => {};
export function ContactForm() {
  const interactive = useSyncExternalStore(
    subscribeToHydration,
    () => true,
    () => false,
  );
  const form = useForm<ContactRequestInput>({
    resolver: zodResolver(contactRequestSchema),
    defaultValues: { name: '', contact: '', message: '', consentVersion: CONSENT_VERSION },
  });
  const mutation = useMutation({
    mutationFn: (body: ContactRequestInput) =>
      result(api.POST('/api/v1/contact-requests', { body })),
  });
  if (mutation.isSuccess)
    return (
      <p className="notice" role="status">
        Спасибо! Ваше обращение принято.
      </p>
    );
  return (
    <form
      className="form"
      aria-busy={!interactive}
      onSubmit={form.handleSubmit((value) => mutation.mutate(value))}
    >
      <p className="text-muted">
        Учебная форма: сообщения сохраняются на сервере. Для проверки используйте вымышленные имя и
        контакт.
      </p>
      <fieldset className="form__body" disabled={!interactive}>
        {(['name', 'contact', 'message'] as const).map((name) => (
          <Field
            key={name}
            label={
              { name: 'Ваше имя', contact: 'E-mail или телефон для ответа', message: 'Сообщение' }[
                name
              ]
            }
            error={form.formState.errors[name]?.message}
          >
            {name === 'message' ? (
              <textarea {...form.register(name)} />
            ) : (
              <input {...form.register(name)} autoComplete={name === 'name' ? 'name' : undefined} />
            )}
          </Field>
        ))}
        <label className="check">
          <input type="checkbox" required {...form.register('personalDataConsent')} />
          <span>
            Согласен на <Link href="/policy">обработку персональных данных</Link>.
          </span>
        </label>
        <ErrorNotice error={mutation.error} />
        <Button disabled={mutation.isPending}>Отправить сообщение</Button>
      </fieldset>
    </form>
  );
}
export function NewsCard({
  item,
  modal = false,
}: {
  item: Model<'NewsResponseDto'>;
  modal?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const full = useQuery({
    queryKey: ['news', item.slug],
    queryFn: () =>
      result(api.GET('/api/v1/news/{slug}', { params: { path: { slug: item.slug } } })),
    enabled: open,
  });
  return (
    <article className="card news-card">
      <Image
        unoptimized
        className="card__image"
        src={item.coverUrl || '/placeholder.svg'}
        width="640"
        height="400"
        loading="lazy"
        alt=""
      />
      <div className="card__body">
        <time className="card__meta" dateTime={item.publishedAt ?? undefined}>
          {date(item.publishedAt, false)}
        </time>
        <h3>
          {modal ? (
            <>
              <button
                className="news-card__button"
                aria-haspopup="dialog"
                onClick={() => setOpen(true)}
              >
                {item.title}
              </button>
              <noscript>
                <Link href={`/novosti/${item.slug}`}>{item.title}</Link>
              </noscript>
            </>
          ) : (
            <Link href={`/novosti/${item.slug}`}>{item.title}</Link>
          )}
        </h3>
        <p>{item.excerpt}</p>
        <Link href={`/novosti/${item.slug}`}>Читать новость</Link>
      </div>
      {modal && (
        <Modal open={open} onClose={() => setOpen(false)} title={item.title}>
          {full.isLoading ? (
            <Loading />
          ) : full.data ? (
            <>
              {full.data.coverUrl && (
                <Image unoptimized src={full.data.coverUrl} width="640" height="400" alt="" />
              )}
              <p>{date(full.data.publishedAt, false)}</p>
              <RichText html={full.data.bodyHtml} />
            </>
          ) : (
            <ErrorNotice error={full.error} />
          )}
        </Modal>
      )}
    </article>
  );
}
export function StatCounter({ value, label }: { value: number; label: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const [display, setDisplay] = useState(value);
  useEffect(() => {
    const node = ref.current;
    if (!node || window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    let frame = 0;
    const observer = new IntersectionObserver((entries) => {
      if (!entries.some((e) => e.isIntersecting)) return;
      observer.disconnect();
      const started = performance.now();
      const tick = (now: number) => {
        const progress = Math.min(1, (now - started) / 850);
        setDisplay(Math.round(value * progress));
        if (progress < 1) frame = requestAnimationFrame(tick);
      };
      frame = requestAnimationFrame(tick);
    });
    observer.observe(node);
    return () => {
      observer.disconnect();
      cancelAnimationFrame(frame);
    };
  }, [value]);
  return (
    <div ref={ref} className="stat">
      <span className="stat__value" aria-label={String(value)}>
        {display.toLocaleString('ru-RU')}
      </span>
      <span>{label}</span>
    </div>
  );
}
export function StepList() {
  return (
    <ol className="steps">
      <li>
        <h3>Познакомьтесь с Клубом</h3>
        <p>Посетите День открытых дверей, узнайте о наших правилах и задайте вопросы.</p>
      </li>
      <li>
        <h3>Расскажите о себе</h3>
        <p>Войдите через Telegram и заполните анкету. Мы поможем выбрать направление помощи.</p>
      </li>
      <li>
        <h3>Присоединяйтесь к поездке</h3>
        <p>После принятия в Клуб выберите поездку и станьте частью команды.</p>
      </li>
    </ol>
  );
}
export function OpenDays() {
  const { me } = useAuth();
  const cache = useQueryClient();
  const days = useQuery({
    queryKey: ['open-days'],
    queryFn: () => result(api.GET('/api/v1/open-days')),
  });
  const signup = useMutation({
    mutationFn: (id: string) =>
      result(api.POST('/api/v1/me/open-days/{id}/register', { params: { path: { id } } })),
    onSuccess: () => {
      void cache.invalidateQueries({ queryKey: ['registrations'] });
      void cache.invalidateQueries({ queryKey: ['table', 'registrations'] });
    },
  });
  return (
    <div className="stack">
      <p>
        Можно прийти на День открытых дверей до заполнения анкеты. Посещение отмечает администратор.
      </p>
      <ErrorNotice error={days.error ?? signup.error} />
      {days.isLoading ? (
        <Loading />
      ) : !days.data?.items.length ? (
        <Empty>Ближайшие сессии скоро появятся.</Empty>
      ) : (
        days.data.items.map((day) => (
          <article className="card" key={day.id}>
            <div className="card__body">
              <h3>{date(day.startsAt)}</h3>
              <p>
                {day.location} · до {day.capacity} участников
              </p>
              <p>{day.notes}</p>
              {me ? (
                <Button disabled={signup.isPending} onClick={() => signup.mutate(day.id)}>
                  Записаться
                </Button>
              ) : (
                <ButtonLink href="/login?next=/cabinet/application">Войти и записаться</ButtonLink>
              )}
            </div>
          </article>
        ))
      )}
      {signup.isSuccess && (
        <p className="notice" role="status">
          Вы записаны на День открытых дверей. Запись доступна в кабинете.
        </p>
      )}
    </div>
  );
}
export function HomeModals() {
  const [modal, setModal] = useState<'video' | 'days' | 'contact' | null>(null);
  const videos = useQuery({
    queryKey: ['videos', 'home'],
    queryFn: () => result(api.GET('/api/v1/videos', { params: { query: { limit: 1 } } })),
    enabled: modal === 'video',
  });
  return (
    <>
      <div className="grid hero__cards">
        <button className="help-card" onClick={() => setModal('video')}>
          ▷ Видео о Клубе
        </button>
        <a className="help-card" href="#latest_news">
          Последние новости ↗
        </a>
        <a className="help-card" href="#help">
          Как помочь ↗
        </a>
      </div>
      <div className="actions">
        <Button onClick={() => setModal('days')}>График Дня открытых дверей</Button>
        <Button variant="secondary" onClick={() => setModal('contact')}>
          Связаться с Клубом
        </Button>
      </div>
      <Modal
        open={modal !== null}
        onClose={() => setModal(null)}
        title={
          modal === 'video'
            ? 'Видео о Клубе'
            : modal === 'days'
              ? 'День открытых дверей'
              : 'Напишите нам'
        }
      >
        {modal === 'days' ? (
          <OpenDays />
        ) : modal === 'contact' ? (
          <ContactForm />
        ) : videos.data?.items[0] ? (
          <video
            controls
            preload="metadata"
            src={videos.data.items[0].url}
            aria-label={videos.data.items[0].caption ?? 'Видео о Клубе'}
          />
        ) : (
          <>
            <ErrorNotice error={videos.error} />
            <Empty>Видео ещё не опубликовано.</Empty>
          </>
        )}
      </Modal>
    </>
  );
}
export function PrivatePlace({ slug }: { slug: string }) {
  const { me } = useAuth();
  const query = useQuery({
    queryKey: ['place-private', slug, me?.id],
    queryFn: () => result(api.GET('/api/v1/places/{slug}', { params: { path: { slug } } })),
    enabled: !!me?.onboardingCompleted,
  });
  return query.data ? (
    <>
      {query.data.address && (
        <p>
          <strong>Адрес:</strong> {query.data.address}
        </p>
      )}
      {query.data.privateNotes && (
        <div className="notice">
          <h2>Заметки учреждения</h2>
          <p>{query.data.privateNotes}</p>
        </div>
      )}
    </>
  ) : null;
}
export function PlaceCard({ item }: { item: Model<'PlaceResponseDto'> }) {
  return (
    <article className="card">
      <Image
        unoptimized
        className="card__image"
        src={item.coverImage ?? '/placeholder.svg'}
        width="640"
        height="400"
        loading="lazy"
        alt=""
      />
      <div className="card__body">
        <span className="badge">{placeTypeLabels[item.type]}</span>
        <h2>
          <Link href={`/uchrezhdeniya/${item.slug}`}>{item.name}</Link>
        </h2>
        <p>
          {item.region.name} · {item.city}
        </p>
        {item.district && <p>Район: {item.district}</p>}
        <PlaceNeedsPreview place={item} />
      </div>
    </article>
  );
}

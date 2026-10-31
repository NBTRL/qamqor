import Image from 'next/image';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { sections, publicList } from '@/lib/public-content';
import { serverApi } from '@/lib/api/server';
import { result, message } from '@/lib/api/client';
import { ContactForm, OpenDays, StepList, PlaceCard } from '@/components/public-widgets';
import { ButtonLink, Empty, RichText, ErrorNotice } from '@/components/ui';
import { date } from '@/lib/format';
import { Calendar } from '@/components/calendar';
import { hasRichTextContent } from '@club/shared';
export async function generateMetadata({ params }: { params: Promise<{ section: string }> }) {
  const { section } = await params;
  const title = sections[section as keyof typeof sections];
  return {
    title: title ?? 'Страница не найдена',
    description: `${title ?? 'Материалы'} Клуба волонтеров. Участие, помощь и жизнь сообщества.`,
    openGraph: {
      title: `${title} | Клуб волонтеров`,
      description: `${title} Клуба волонтеров.`,
      url: `/${section}`,
    },
  };
}
export default async function Page({
  params,
  searchParams,
}: {
  params: Promise<{ section: string }>;
  searchParams: Promise<{ page?: string }>;
}) {
  const { section } = await params;
  const title = sections[section as keyof typeof sections];
  if (!title) notFound();
  const page = Math.max(1, Number((await searchParams).page) || 1);
  const api = await serverApi();
  const managed = ['kontakty', 'policy', 'donation', 'o-klube-volonterov'].includes(section)
    ? await capture(
        (async () => {
          const response = await api.GET('/api/v1/pages/{slug}', {
            params: { path: { slug: section } },
          });
          if (response.response.status === 404) return null;
          return result(Promise.resolve(response));
        })(),
      )
    : null;
  const managedContent = managed?.error ? (
    <div className="notice" role="alert">
      Не удалось загрузить содержимое страницы. Обновите страницу и повторите попытку.
    </div>
  ) : managed?.data && hasRichTextContent(managed.data.bodyHtml) ? (
    <RichText html={managed.data.bodyHtml} />
  ) : null;
  let content;
  if (section === 'kontakty')
    content = (
      <>
        {managedContent ?? (
          <p>
            Это учебный проект Qamqor. Отправьте тестовое сообщение через форму ниже, используя
            вымышленные имя и контакт.
          </p>
        )}
        <ContactForm />
      </>
    );
  else if (section === 'policy')
    content = managedContent ?? (
      <div className="notice">
        <h2>Данные в учебном проекте</h2>
        <p>
          Qamqor — учебная демонстрация волонтёрской платформы. Сообщения из форм сохраняются на
          сервере, а подтверждённый Telegram-вход использует данные аккаунта. Для учебных проверок
          используйте вымышленные данные в формах и отдельный тестовый аккаунт.
        </p>
      </div>
    );
  else if (section === 'donation')
    content = (
      <>
        <p>Раздел демонстрирует, как может быть организована помощь волонтёрскому клубу.</p>
        {managedContent ?? (
          <div className="notice">
            <h2>Учебная демонстрация помощи</h2>
            <p>
              Реальный сбор денег не проводится. Платёжная форма не подключена, банковские реквизиты
              не публикуются.
            </p>
          </div>
        )}
        <ButtonLink href="/kontakty">Перейти к тестовой форме</ButtonLink>
      </>
    );
  else if (section === 'stat-volonterom')
    content = (
      <>
        <p>Волонтером может стать совершеннолетний участник. Начните с знакомства с Клубом.</p>
        <StepList />
        <div className="actions">
          <ButtonLink href="/login">Войти через Telegram</ButtonLink>
          <a className="button button--secondary" href="#open-days">
            Записаться на День открытых дверей
          </a>
        </div>
        <div id="open-days">
          <h2>Ближайший День открытых дверей</h2>
          <OpenDays />
        </div>
      </>
    );
  else if (section === 'o-klube-volonterov') {
    content = managedContent ?? (
      <>
        <p>
          Клуб волонтеров — сообщество людей, которые помогают детям и взрослым в учреждениях. Мы
          создаем долгосрочные отношения и поддерживаем инициативы участников.
        </p>
        <ButtonLink href="/stat-volonterom">Присоединиться</ButtonLink>
      </>
    );
  } else if (section === 'kalendar') {
    const from = new Date();
    const range = {
      from: from.toISOString(),
      to: new Date(from.getTime() + 90 * 86400_000).toISOString(),
    };
    const response = await capture(
      result(
        api.GET('/api/v1/public/calendar', {
          params: { query: { ...range, page: 1, limit: 100 } },
        }),
      ),
    );
    content = (
      <Calendar
        initial={response.data}
        range={range}
        initialError={response.error ? message(response.error) : undefined}
      />
    );
  } else if (section === 'uchrezhdeniya') {
    const response = await capture(
      result(api.GET('/api/v1/places', { params: { query: { page, limit: 12 } } })),
    );
    const data = response.data;
    content = (
      <>
        <ErrorNotice error={response.error} />
        {data && (
          <>
            {data.items.length ? (
              <div className="grid">
                {data.items.map((item) => (
                  <PlaceCard key={item.id} item={item} />
                ))}
              </div>
            ) : (
              <Empty>Учреждения пока не добавлены.</Empty>
            )}
            <Pagination page={page} total={data.total} limit={12} base={section} />
          </>
        )}
      </>
    );
  } else {
    const response = await capture(publicList(section, page));
    const data = response.data;
    content = (
      <>
        <ErrorNotice error={response.error} />
        {data && (
          <>
            {!data.items.length ? (
              <Empty>Материалы пока не опубликованы.</Empty>
            ) : (
              <div className="grid">
                {data.items.map((item) => (
                  <article key={item.id} className="card">
                    {(item.coverUrl || item.logoUrl) && (
                      <Image
                        unoptimized
                        className="card__image"
                        src={item.coverUrl || item.logoUrl || '/placeholder.svg'}
                        width="640"
                        height="400"
                        loading="lazy"
                        alt=""
                      />
                    )}
                    <div className="card__body">
                      {item.publishedAt && (
                        <time className="card__meta">{date(item.publishedAt, false)}</time>
                      )}
                      <h2>
                        {item.slug &&
                        ['novosti', 'interv-yu-s-volonterami', 'fotoalbomy'].includes(section) ? (
                          <Link href={`/${section}/${item.slug}`}>{item.title ?? item.name}</Link>
                        ) : (
                          (item.title ?? item.name ?? item.caption ?? 'Видео Клуба')
                        )}
                      </h2>
                      {item.excerpt && <p>{item.excerpt}</p>}
                      {item.description && <p>{item.description}</p>}
                      {item.bodyHtml && <RichText html={item.bodyHtml} />}
                      {item.text && <p>{item.text}</p>}
                      {item.fileUrl && (
                        <a href={item.fileUrl} target="_blank" rel="noreferrer">
                          Открыть отчет {item.year ?? ''}
                        </a>
                      )}
                      {item.websiteUrl && (
                        <a href={item.websiteUrl} target="_blank" rel="noreferrer">
                          Сайт партнера
                        </a>
                      )}
                      {item.url &&
                        (section === 'video' ? (
                          <video
                            src={item.url}
                            controls
                            preload="metadata"
                            aria-label={item.caption ?? 'Видео Клуба'}
                          />
                        ) : (
                          <a href={item.url} target="_blank" rel="noreferrer">
                            Читать публикацию
                          </a>
                        ))}
                      {item.photos?.map((photo) => (
                        <Image
                          unoptimized
                          src={photo.url}
                          key={photo.id}
                          width="640"
                          height="400"
                          loading="lazy"
                          alt="Фотография из отчета"
                        />
                      ))}
                    </div>
                  </article>
                ))}
              </div>
            )}
            <Pagination page={page} total={data.total} limit={data.limit} base={section} />
          </>
        )}
      </>
    );
  }
  return (
    <section className="container section">
      <div className="page-heading">
        <Link href="/">Главная</Link>
        <h1>{title}</h1>
      </div>
      {content}
    </section>
  );
}
function Pagination({
  page,
  total,
  limit,
  base,
}: {
  page: number;
  total: number;
  limit: number;
  base: string;
}) {
  return total > limit ? (
    <nav aria-label="Страницы" className="pagination">
      {page > 1 && <Link href={`/${base}?page=${page - 1}`}>Предыдущая</Link>}
      <span>
        Страница {page} из {Math.ceil(total / limit)}
      </span>
      {page * limit < total && <Link href={`/${base}?page=${page + 1}`}>Следующая</Link>}
    </nav>
  ) : null;
}

async function capture<T>(promise: Promise<T>): Promise<{ data: T | null; error: unknown }> {
  try {
    return { data: await promise, error: null };
  } catch (error) {
    return { data: null, error };
  }
}

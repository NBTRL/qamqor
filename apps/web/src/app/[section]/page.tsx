import Image from 'next/image';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { sections, publicList } from '@/lib/public-content';
import { serverApi } from '@/lib/api/server';
import { result } from '@/lib/api/client';
import { ContactForm, OpenDays, StepList, Calendar, PlaceCard } from '@/components/public-widgets';
import { ButtonLink, Empty, RichText, ErrorNotice } from '@/components/ui';
import { date } from '@/lib/format';
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
  let content;
  if (section === 'kontakty')
    content = (
      <>
        <p>
          Свяжитесь с командой Клуба через форму. Контактные реквизиты будут добавлены
          администратором.
        </p>
        <ContactForm />
      </>
    );
  else if (section === 'policy')
    content = (
      <div className="notice">
        <h2>Документ готовится</h2>
        <p>
          Это локальная страница-заглушка. До публичного запуска администратор должен разместить
          утвержденную политику обработки персональных данных и сведения об операторе.
        </p>
      </div>
    );
  else if (section === 'donation')
    content = (
      <>
        <p>Помочь можно временем, нужными вещами и поддержкой работы Клуба.</p>
        <div className="notice">
          <h2>Реквизиты — заглушка</h2>
          <p>
            Получатель: [название Клуба]
            <br />
            ИНН: [будет добавлен]
            <br />
            Расчетный счет: [будет добавлен]
            <br />
            Банк и БИК: [будут добавлены]
          </p>
          <p>
            Онлайн-оплата не подключена. Перед переводом запросите актуальные реквизиты у команды.
          </p>
        </div>
        <ButtonLink href="/kontakty">Обсудить помощь</ButtonLink>
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
    const response = await api.GET('/api/v1/pages/{slug}', { params: { path: { slug: section } } });
    content = response.data ? (
      <RichText html={response.data.bodyHtml} />
    ) : (
      <>
        <p>
          Клуб волонтеров — сообщество людей, которые помогают детям и взрослым в учреждениях. Мы
          создаем долгосрочные отношения и поддерживаем инициативы участников.
        </p>
        <ButtonLink href="/stat-volonterom">Присоединиться</ButtonLink>
      </>
    );
  } else if (section === 'kalendar') {
    const response = await capture(
      result(api.GET('/api/v1/public/calendar', { params: { query: { limit: 100 } } })),
    );
    content = (
      <>
        <ErrorNotice error={response.error} />
        <Calendar initial={response.data} />
      </>
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

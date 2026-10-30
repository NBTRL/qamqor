import Image from 'next/image';
import Link from 'next/link';
import { eventCalendarColors, eventTypeLabels, EventType } from '@club/shared';
import { serverApi } from '@/lib/api/server';
import { NewsCard, StatCounter, StepList, HomeModals } from '@/components/public-widgets';
import { Section, Empty, ButtonLink, ErrorNotice, HelpCard } from '@/components/ui';
import { date } from '@/lib/format';
export const metadata = {
  title: 'Qamqor — учебная волонтёрская платформа',
  description:
    'Учебная демонстрация платформы: знакомство с Клубом, анкета, события и управление волонтёрскими поездками.',
};
export default async function Home() {
  const api = await serverApi();
  const responses = await Promise.allSettled([
    api.GET('/api/v1/news', { params: { query: { limit: 6 } } }),
    api.GET('/api/v1/public/stats'),
    api.GET('/api/v1/public/calendar', {
      params: { query: { limit: 3, from: new Date().toISOString() } },
    }),
  ]);
  const news = responses[0].status === 'fulfilled' ? responses[0].value.data : undefined;
  const stats = responses[1].status === 'fulfilled' ? responses[1].value.data : undefined;
  const calendar = responses[2].status === 'fulfilled' ? responses[2].value.data : undefined;
  return (
    <>
      <section className="hero">
        <div className="container">
          <div className="hero__grid">
            <div>
              <p className="eyebrow">Дружба начинается с участия</p>
              <h1 className="hero__title">
                Мы — сообщество волонтеров, поддерживающих детей из детских домов и взрослых,
                которые проживают в интернатах
              </h1>
              <p>Дарим внимание. Делимся знаниями. Помогаем поверить в себя.</p>
              <ButtonLink href="/stat-volonterom">Стать волонтером</ButtonLink>
            </div>
            <Image
              unoptimized
              className="hero__image"
              src="/hero.svg"
              width="600"
              height="440"
              alt="Волонтеры объединяются, чтобы помогать"
              fetchPriority="high"
            />
          </div>
          <HomeModals />
        </div>
      </section>
      <Section title="Миссия Клуба">
        <div className="grid grid--two mission">
          <p>
            Мы помогаем детям и взрослым, живущим в учреждениях, раскрыть способности и
            почувствовать поддержку. Для нас волонтерство — это регулярное общение и доверие.
          </p>
          <p>
            Клуб объединяет людей разных профессий и интересов. Вместе мы создаем пространство, в
            котором каждый может быть полезен.
          </p>
        </div>
      </Section>
      <Section title="Что мы делаем" alt>
        <div className="grid grid--two">
          <ul className="what-we-do">
            <li>Проводим творческие занятия и мастер-классы.</li>
            <li>Поддерживаем учебу и знакомим с профессиями.</li>
            <li>Организуем спортивные и клубные мероприятия.</li>
          </ul>
          <ul className="what-we-do">
            <li>Развиваем самостоятельность и бытовые навыки.</li>
            <li>Общаемся, дружим и помогаем поверить в свои силы.</li>
          </ul>
        </div>
        <Link href="/uchrezhdeniya">Посмотреть учреждения и регионы</Link>
      </Section>
      <Section title="Почему с нами">
        <div className="grid">
          <div className="help-card">
            <h3>Регулярная помощь</h3>
            <p>Встречи становятся частью жизни, а знакомство — дружбой.</p>
          </div>
          <div className="help-card">
            <h3>Разные люди</h3>
            <p>Объединяем опыт, идеи и таланты волонтеров.</p>
          </div>
          <div className="help-card">
            <h3>Общее дело</h3>
            <p>Поддерживаем участников на каждом шаге.</p>
          </div>
        </div>
      </Section>
      <Section title="Клуб в цифрах" alt>
        {stats ? (
          <div className="stats">
            {(Object.keys(stats) as (keyof typeof stats)[]).map((key) => (
              <StatCounter
                key={key}
                value={stats[key]}
                label={
                  {
                    places: 'учреждений',
                    curators: 'кураторов',
                    events12Months: 'мероприятий за 12 месяцев',
                    masterClasses12Months: 'мастер-классов за 12 месяцев',
                    uniqueParticipants12Months: 'участников за 12 месяцев',
                    beneficiaries: 'подопечных',
                    trips: 'поездок',
                  }[key]
                }
              />
            ))}
          </div>
        ) : (
          <Empty>Счетчики временно недоступны.</Empty>
        )}
      </Section>
      <Section id="latest_news" title="Последние новости">
        {news?.items.length ? (
          <div className="grid">
            {news.items.map((item) => (
              <NewsCard key={item.id} item={item} modal />
            ))}
          </div>
        ) : (
          <Empty>Новости скоро появятся.</Empty>
        )}
        <div className="actions">
          <ButtonLink href="/novosti" secondary>
            Все новости
          </ButtonLink>
        </div>
      </Section>
      <Section title="Ближайшие события" alt>
        {calendar?.items.length ? (
          <div className="grid">
            {calendar.items.map((item) => (
              <article className="card" key={item.id}>
                <div className="card__body">
                  <time>{date(item.startsAt)}</time>
                  <h3>{item.title}</h3>
                  <Link href="/kalendar">Подробнее в календаре</Link>
                </div>
              </article>
            ))}
          </div>
        ) : (
          <Empty>Ближайшие события скоро появятся.</Empty>
        )}
      </Section>
      <Section title="Как стать волонтером">
        <p>
          Клуб принимает совершеннолетних участников. Анкету и День открытых дверей можно пройти в
          любом порядке.
        </p>
        <StepList />
        <ButtonLink href="/stat-volonterom">Начать знакомство</ButtonLink>
      </Section>
      <Section id="help" title="Как помочь" alt>
        <div className="grid help-grid">
          <HelpCard
            title="Стать волонтером"
            description="Дарите время, внимание и знания."
            href="/stat-volonterom"
            icon="heart"
          />
          <HelpCard
            title="Поддержать Клуб"
            description="Помогите нашим встречам состояться."
            href="/donation"
            icon="arrow"
          />
          <HelpCard
            title="Приобрести нужное"
            description="Закройте актуальные нужды учреждений."
            href="/uchrezhdeniya"
            icon="plus"
          />
          <HelpCard
            title="Следить за жизнью Клуба"
            description="Читайте истории, новости и приглашения."
            href="/novosti"
            icon="star"
          />
        </div>
      </Section>
      <Section title="Календарь событий">
        <p>Найдите ближайшую поездку, мастер-класс или встречу Клуба.</p>
        <div className="legend">
          {Object.values(EventType).map((type) => (
            <span key={type}>
              <i className="legend__dot" style={{ background: eventCalendarColors[type] }} />
              {eventTypeLabels[type]}
            </span>
          ))}
        </div>
        <ButtonLink href="/kalendar">Открыть календарь</ButtonLink>
      </Section>
      {responses.some((x) => x.status === 'rejected') && (
        <div className="container">
          <ErrorNotice error={new Error('Часть данных недоступна. Проверьте запуск API.')} />
        </div>
      )}
    </>
  );
}

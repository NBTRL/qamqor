import type { Metadata } from 'next';
import { cookies } from 'next/headers';
import { REFRESH_COOKIE_NAME } from '@club/shared';
import { Providers } from '@/components/providers';
import { Header, Footer } from '@/components/shell';
import './globals.css';
const noScriptStyles = `
  button, .skeleton { display: none !important; }
  .header { position: static; }
  .header__nav { display: block; }
  .header__nav > .container { flex-wrap: wrap; }
`;
export const metadata: Metadata = {
  metadataBase: new URL(process.env.WEB_URL ?? 'http://localhost:3000'),
  title: { default: 'Клуб волонтеров', template: '%s | Клуб волонтеров' },
  icons: { icon: '/logo.svg' },
  description:
    'Учебный проект Qamqor: демонстрация волонтёрской платформы, личного кабинета и управления контентом.',
  openGraph: {
    title: 'Qamqor — учебный проект',
    description: 'Демонстрация волонтёрской платформы.',
    type: 'website',
    locale: 'ru_RU',
    images: ['/hero.svg'],
  },
};
export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const hasSession = (await cookies()).has(REFRESH_COOKIE_NAME);
  return (
    <html lang="ru">
      <body>
        <Providers hasSession={hasSession}>
          <a href="#main" className="skip-link">
            Перейти к содержимому
          </a>
          <Header />
          <aside className="demo-banner" aria-label="Статус проекта">
            <div className="container">
              <strong>Учебный проект Qamqor.</strong> Демонстрация волонтёрской платформы. Сбор
              денег не проводится.
            </div>
          </aside>
          <noscript>
            <style>{noScriptStyles}</style>
            <p className="container notice">
              JavaScript отключён. Публичные материалы доступны для чтения. Для входа, отправки
              форм, записи и загрузки следующих страниц включите JavaScript в настройках браузера.
            </p>
          </noscript>
          <main id="main">{children}</main>
          <Footer />
        </Providers>
      </body>
    </html>
  );
}

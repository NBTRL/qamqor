import type { Metadata } from 'next';
import { cookies } from 'next/headers';
import { REFRESH_COOKIE_NAME } from '@club/shared';
import { Providers } from '@/components/providers';
import { Header, Footer } from '@/components/shell';
import './globals.css';
export const metadata: Metadata = {
  metadataBase: new URL(process.env.WEB_URL ?? 'http://localhost:3000'),
  title: { default: 'Клуб волонтеров', template: '%s | Клуб волонтеров' },
  icons: { icon: '/logo.svg' },
  description:
    'Сообщество волонтеров. Помогаем детям и взрослым в учреждениях, объединяем людей и добрые дела.',
  openGraph: {
    title: 'Клуб волонтеров',
    description: 'Помощь, которая становится дружбой.',
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
          <main id="main">{children}</main>
          <Footer />
        </Providers>
      </body>
    </html>
  );
}

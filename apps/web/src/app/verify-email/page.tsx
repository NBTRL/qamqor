import Link from 'next/link';
import { serverApi } from '@/lib/api/server';
export const metadata = { title: 'Подтверждение e-mail', robots: { index: false, follow: false } };
export default async function Page({
  searchParams,
}: {
  searchParams: Promise<{ token?: string }>;
}) {
  const { token } = await searchParams;
  const client = await serverApi();
  const response = token
    ? await client.GET('/api/v1/auth/verify-email', {
        params: { query: { token } },
        cache: 'no-store',
      })
    : null;
  return (
    <section className="container section">
      <h1>Подтверждение e-mail</h1>
      <p>
        {response?.data
          ? 'E-mail подтвержден. Теперь он доступен для уведомлений и резервного входа.'
          : 'Ссылка недействительна или срок подтверждения истек. Запросите новое письмо в профиле.'}
      </p>
      <Link href="/cabinet/profile">Вернуться в профиль</Link>
    </section>
  );
}

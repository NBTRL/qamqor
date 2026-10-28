import { Suspense } from 'react';
import { Login } from '@/components/login';
export const metadata = {
  title: 'Вход через Telegram',
  description: 'Войдите или присоединитесь к Клубу волонтеров через Telegram.',
};
export default function Page() {
  return (
    <Suspense fallback={<p>Загрузка входа…</p>}>
      <Login />
    </Suspense>
  );
}

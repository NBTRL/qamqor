'use client';
import { Button } from '@/components/ui';
export default function ErrorPage({ reset }: { reset: () => void }) {
  return (
    <section className="container section">
      <h1>Не удалось загрузить страницу</h1>
      <p>Проверьте, запущен ли API, и повторите запрос.</p>
      <Button onClick={reset}>Повторить</Button>
    </section>
  );
}

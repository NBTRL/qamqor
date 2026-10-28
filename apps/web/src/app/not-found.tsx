import Link from 'next/link';
export default function NotFound() {
  return (
    <section className="container section">
      <h1>Страница не найдена</h1>
      <p>Возможно, материал ещё не опубликован.</p>
      <Link href="/">На главную</Link>
    </section>
  );
}

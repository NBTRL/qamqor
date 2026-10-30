'use client';
import Image from 'next/image';
import { UserRole } from '@club/shared';
import Link from 'next/link';
import { useState, useEffect } from 'react';
import { useAuth, can } from './providers';
import { Button, Modal } from './ui';
import { ContactForm } from './public-widgets';
export const publicLinks = [
  ['/o-klube-volonterov', 'О Клубе'],
  ['/novosti', 'Новости'],
  ['/proekty', 'Проекты'],
  ['/interv-yu-s-volonterami', 'Волонтеры'],
  ['/partners', 'Партнеры'],
  ['/fotoalbomy', 'Фото'],
  ['/video', 'Видео'],
  ['/otchety', 'Отчеты'],
  ['/smi-o-nas', 'СМИ о нас'],
  ['/kontakty', 'Контакты'],
] as const;
export function Header() {
  const [open, setOpen] = useState(false);
  const { me } = useAuth();
  useEffect(() => {
    if (!open) return;
    const previous = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const close = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false);
    };
    window.addEventListener('keydown', close);
    return () => {
      document.body.style.overflow = previous;
      window.removeEventListener('keydown', close);
    };
  }, [open]);
  return (
    <header className="header">
      <div className="container header__top">
        <Link href="/" className="logo" aria-label="Клуб волонтеров — главная">
          <Image unoptimized src="/logo.svg" width="48" height="48" alt="" />
          <span>
            Клуб
            <br />
            волонтеров
          </span>
        </Link>
        <p className="header__slogan">
          Вместе мы сделаем
          <br />
          мир детей ярче!
        </p>
        <div className="header__actions">
          <Link className="button button--secondary" href="/stat-volonterom">
            Стать волонтером
          </Link>
          <Link className="button button--accent" href="/donation">
            Помочь Клубу
          </Link>
          <Link href={me ? '/cabinet' : '/login'}>{me ? 'Кабинет' : 'Войти'}</Link>
        </div>
        <Button
          variant="secondary"
          aria-expanded={open}
          aria-controls="main-navigation"
          onClick={() => setOpen(!open)}
          className="header__burger"
        >
          {open ? 'Закрыть' : 'Меню'}
        </Button>
      </div>
      <nav
        id="main-navigation"
        aria-label="Основная навигация"
        className={`header__nav ${open ? 'header__nav--open' : ''}`}
      >
        <div className="container">
          {publicLinks.map(([href, label]) => (
            <Link key={href} href={href} onClick={() => setOpen(false)}>
              {label}
            </Link>
          ))}
          <Link href="/kalendar" onClick={() => setOpen(false)}>
            Календарь
          </Link>
          <div className="header__mobile-actions">
            <Link href="/stat-volonterom" onClick={() => setOpen(false)}>
              Стать волонтером
            </Link>
            <Link className="button button--accent" href="/donation" onClick={() => setOpen(false)}>
              Помочь Клубу
            </Link>
            <Link href={me ? '/cabinet' : '/login'} onClick={() => setOpen(false)}>
              {me ? 'Кабинет' : 'Войти'}
            </Link>
          </div>
        </div>
      </nav>
    </header>
  );
}
export function Footer() {
  const [contact, setContact] = useState(false);
  return (
    <footer className="footer">
      <div className="container footer__grid">
        <div>
          <Link className="logo" href="/">
            Клуб волонтеров
          </Link>
          <p>Помощь, которая становится дружбой.</p>
        </div>
        <nav aria-label="Ссылки в подвале">
          <Link href="/uchrezhdeniya">Учреждения</Link>
          <Link href="/stat-volonterom">Стать волонтером</Link>
          <Link href="/donation">Помочь Клубу</Link>
          <Link href="/kontakty">Контакты</Link>
          <Button variant="secondary" onClick={() => setContact(true)}>
            Связаться с нами
          </Button>
          <Link href="/policy">Политика обработки данных</Link>
        </nav>
        <p>
          © {new Date().getFullYear()} Клуб волонтеров
          <br />
          Учебный проект Qamqor.
        </p>
      </div>
      <div className="container footer__legal">
        Демонстрационный сайт для учебных целей. Реальные пожертвования не принимаются.
      </div>
      <Modal open={contact} onClose={() => setContact(false)} title="Связаться с Клубом">
        <ContactForm />
      </Modal>
    </footer>
  );
}
export function WorkspaceNav() {
  const { me, logout } = useAuth();
  return (
    <nav className="workspace-nav" aria-label="Личный раздел">
      {[
        ['/cabinet', 'Обзор'],
        ['/cabinet/application', 'Анкета'],
        ['/cabinet/profile', 'Профиль'],
        ['/cabinet/notifications', 'Уведомления'],
        ['/cabinet/registrations', 'Мои записи'],
        ['/trips', 'Поездки'],
        ['/events', 'Мероприятия'],
        ...(can(me, 'trip.create') ? [['/curator', 'Куратор']] : []),
        ...(me?.role === UserRole.ADMIN ? [['/admin', 'Админка']] : []),
      ].map(([href, label]) => (
        <Link key={href} href={href!}>
          {label}
        </Link>
      ))}
      <Button variant="secondary" onClick={() => void logout()}>
        Выйти
      </Button>
    </nav>
  );
}

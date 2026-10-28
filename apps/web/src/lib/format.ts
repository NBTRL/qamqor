import { DISPLAY_TIME_ZONE } from '@club/shared';
export const date = (value?: string | null, time = true) =>
  value
    ? new Intl.DateTimeFormat('ru-RU', {
        timeZone: DISPLAY_TIME_ZONE,
        day: '2-digit',
        month: '2-digit',
        year: 'numeric',
        ...(time ? { hour: '2-digit', minute: '2-digit' } : {}),
      }).format(new Date(value))
    : '—';
export const localDateTime = (value: string) => new Date(`${value}:00+03:00`).toISOString();
export const inputDateTime = (value: string) =>
  new Intl.DateTimeFormat('sv-SE', {
    timeZone: DISPLAY_TIME_ZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  })
    .format(new Date(value))
    .replace(' ', 'T');
export const safeReturn = (path: string | null) =>
  path?.startsWith('/') &&
  !path.startsWith('//') &&
  !path.startsWith('/api/') &&
  !path.startsWith('/login')
    ? path
    : '/cabinet';

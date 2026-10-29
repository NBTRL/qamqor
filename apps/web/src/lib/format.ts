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
export function safeReturn(path: string | null): string {
  const fallback = '/cabinet';
  // URL parsing strips some controls and treats backslashes as separators.
  if (!path?.startsWith('/') || path.startsWith('//') || /[\\\p{Cc}]/u.test(path)) return fallback;
  try {
    // Only root-relative paths are accepted; this fixed origin also works during SSR.
    const base = 'https://qamqor.invalid';
    const url = new URL(path, base);
    // Reject encoded separators and nested encoding before routing can decode them.
    if (url.origin !== base || url.pathname.startsWith('//') || /%(?:2f|5c|25)/i.test(url.pathname))
      return fallback;
    const pathname = decodeURIComponent(url.pathname);
    if (
      /[\\\p{Cc}]/u.test(pathname) ||
      pathname === '/api' ||
      pathname.startsWith('/api/') ||
      pathname.startsWith('/login')
    )
      return fallback;
    return url.pathname + url.search + url.hash;
  } catch {
    return fallback;
  }
}

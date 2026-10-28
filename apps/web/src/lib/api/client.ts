import createClient from 'openapi-fetch';
import { errorMessages, ErrorCode } from '@club/shared';
import type { components, paths } from './schema';
export type Model<N extends keyof components['schemas']> = components['schemas'][N];
export type Page<T> = { items: T[]; total: number; page: number; limit: number };
export class ApiError extends Error {
  constructor(
    public code: string,
    public status: number,
    public details?: Record<string, unknown>,
  ) {
    super(errorMessages[code as ErrorCode] ?? 'Не удалось выполнить запрос. Повторите позже.');
  }
}
let access: string | undefined;
let refreshFlight: Promise<string | undefined> | undefined;
export const setAccessToken = (token?: string) => {
  access = token;
  if (typeof window !== 'undefined')
    window.dispatchEvent(new CustomEvent('club:session', { detail: !!token }));
};
export async function refreshSession(): Promise<string | undefined> {
  if (!refreshFlight)
    refreshFlight = (async () => {
      const response = await fetch('/api/v1/auth/refresh', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: '{}',
      });
      if (!response.ok) {
        access = undefined;
        return undefined;
      }
      const body: Model<'SessionResponseDto'> = await response.json();
      access = body.accessToken;
      return access;
    })().finally(() => {
      refreshFlight = undefined;
    });
  return refreshFlight;
}
async function sessionFetch(input: Request) {
  const request = input.clone();
  const sentToken = access;
  if (access) request.headers.set('Authorization', `Bearer ${access}`);
  let response = await fetch(request);
  if (response.status === 401 && !new URL(request.url).pathname.includes('/auth/')) {
    const token = access && access !== sentToken ? access : await refreshSession();
    if (token) {
      const retry = input.clone();
      retry.headers.set('Authorization', `Bearer ${token}`);
      response = await fetch(retry);
    }
  }
  if (response.status === 403) {
    const body: unknown = await response
      .clone()
      .json()
      .catch(() => null);
    if (
      body &&
      typeof body === 'object' &&
      'code' in body &&
      body.code === ErrorCode.ONBOARDING_REQUIRED &&
      typeof window !== 'undefined'
    )
      window.location.assign('/onboarding');
  }
  return response;
}
export const api = createClient<paths>({
  baseUrl: typeof window === 'undefined' ? 'http://localhost:3000' : window.location.origin,
  credentials: 'include',
  fetch: sessionFetch,
});
export async function result<T>(
  promise: Promise<{ data?: T; error?: unknown; response: Response }>,
): Promise<T> {
  const { data, error, response } = await promise;
  if (error || !response.ok) {
    const body = error as { code?: string; details?: Record<string, unknown> } | undefined;
    throw new ApiError(body?.code ?? ErrorCode.VALIDATION_ERROR, response.status, body?.details);
  }
  return data as T;
}
export const message = (error: unknown) =>
  error instanceof TypeError
    ? 'Не удалось связаться с сервером. Проверьте подключение и запуск API.'
    : error instanceof Error
      ? error.message
      : 'Не удалось выполнить запрос.';
export function clearPrivateStorage() {
  setAccessToken();
  for (const key of Object.keys(sessionStorage))
    if (key.startsWith('club:')) sessionStorage.removeItem(key);
}

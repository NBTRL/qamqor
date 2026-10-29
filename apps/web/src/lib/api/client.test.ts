import { beforeEach, describe, expect, it, vi } from 'vitest';
import { api, result, setAccessToken } from './client';
const json = (value: unknown, status = 200) =>
  new Response(JSON.stringify(value), { status, headers: { 'Content-Type': 'application/json' } });
beforeEach(() => setAccessToken('expired'));
describe('Session client', () => {
  it('shares refresh between parallel 401 responses and retries with the new token', async () => {
    let refreshes = 0;
    let gets = 0;
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: Request | string) => {
        const request =
          typeof input === 'string'
            ? new Request(new URL(input, 'http://localhost:3000'), { method: 'POST' })
            : input;
        if (request.url.endsWith('/auth/refresh')) {
          refreshes++;
          await new Promise((resolve) => setTimeout(resolve, 5));
          return json({ accessToken: 'rotated' });
        }
        gets++;
        return request.headers.get('Authorization') === 'Bearer rotated'
          ? json({ id: 'me' })
          : json({ code: 'UNAUTHORIZED' }, 401);
      }),
    );
    const responses = await Promise.all([
      result(api.GET('/api/v1/me')),
      result(api.GET('/api/v1/me')),
    ]);
    expect(responses.every((row) => row.id === 'me')).toBe(true);
    expect(refreshes).toBe(1);
    expect(gets).toBe(4);
  });
  it('retries once and never loops when the new access token is rejected', async () => {
    let refreshes = 0;
    let gets = 0;
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: Request | string) => {
        if (typeof input === 'string') {
          refreshes++;
          return json({ accessToken: 'rotated' });
        }
        gets++;
        return json({ code: 'UNAUTHORIZED' }, 401);
      }),
    );
    await expect(result(api.GET('/api/v1/me'))).rejects.toMatchObject({ status: 401 });
    expect(refreshes).toBe(1);
    expect(gets).toBe(2);
  });
});

describe('Cross-tab refresh coordination', () => {
  it('holds an origin-wide lock until the response body has been consumed', async () => {
    const events: string[] = [];
    vi.stubGlobal('navigator', {
      locks: {
        request: vi.fn(async (name: string, callback: () => Promise<unknown>) => {
          events.push(`lock:${name}`);
          const value = await callback();
          events.push('unlock');
          return value;
        }),
      },
    });
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        events.push('fetch');
        return {
          ok: true,
          json: async () => {
            events.push('body');
            return { accessToken: 'locked-access' };
          },
        };
      }),
    );
    const { refreshSession } = await import('./client');
    await expect(refreshSession()).resolves.toBe('locked-access');
    expect(events).toEqual(['lock:club:refresh', 'fetch', 'body', 'unlock']);
  });

  it('releases the lock and permits a retry after a network failure', async () => {
    const request = vi.fn(async (_name: string, callback: () => Promise<unknown>) => callback());
    vi.stubGlobal('navigator', { locks: { request } });
    const fetch = vi
      .fn()
      .mockRejectedValueOnce(new TypeError('offline'))
      .mockResolvedValueOnce(json({ accessToken: 'retry-access' }));
    vi.stubGlobal('fetch', fetch);
    const { refreshSession } = await import('./client');
    await expect(refreshSession()).rejects.toThrow('offline');
    await expect(refreshSession()).resolves.toBe('retry-access');
    expect(request).toHaveBeenCalledTimes(2);
  });

  it('keeps single-tab deduplication when Web Locks are unavailable', async () => {
    vi.stubGlobal('navigator', {});
    const fetch = vi.fn(async () => json({ accessToken: 'fallback-access' }));
    vi.stubGlobal('fetch', fetch);
    const { refreshSession } = await import('./client');
    const values = await Promise.all([refreshSession(), refreshSession()]);
    expect(values).toEqual(['fallback-access', 'fallback-access']);
    expect(fetch).toHaveBeenCalledTimes(1);
  });
});

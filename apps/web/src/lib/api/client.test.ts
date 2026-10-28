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

import 'reflect-metadata';
import { describe, expect, it, vi } from 'vitest';
import type { Request, Response } from 'express';
import { AuthController } from './auth.controller.js';
import type { AuthService } from './auth.service.js';

vi.mock('../config/environment.js', () => ({
  getEnvironment: () => ({ WEB_URL: 'https://club.example.test' }),
}));

function fixture(origin?: string) {
  const verify = vi.fn().mockResolvedValue({
    accessToken: 'synthetic-access',
    refreshToken: 'synthetic-refresh',
  });
  const controller = new AuthController({ emailLoginVerify: verify } as unknown as AuthService);
  const request = {
    headers: { ...(origin === undefined ? {} : { origin }), 'user-agent': 'Test browser' },
  } as Request;
  const cookie = vi.fn();
  const response = { cookie } as unknown as Response;
  return { controller, request, response, verify, cookie };
}

describe('Email login origin protection', () => {
  it.each([
    undefined,
    'null',
    'https://untrusted.example',
    'https://club.example.test.attacker.test',
  ])('rejects origin %s before consuming the code or setting a session', async (origin) => {
    const f = fixture(origin);
    await expect(
      f.controller.emailVerify(
        { email: 'member@example.test', code: '123456' },
        f.request,
        f.response,
      ),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
    expect(f.verify).not.toHaveBeenCalled();
    expect(f.cookie).not.toHaveBeenCalled();
  });

  it('keeps the regular same-origin login and secure refresh cookie', async () => {
    const f = fixture('https://club.example.test');
    const body = await f.controller.emailVerify(
      { email: 'member@example.test', code: '123456' },
      f.request,
      f.response,
    );
    expect(f.verify).toHaveBeenCalledWith('member@example.test', '123456', 'Test browser');
    expect(body).toEqual({ accessToken: 'synthetic-access' });
    expect(f.cookie).toHaveBeenCalledWith(
      'club_refresh',
      'synthetic-refresh',
      expect.objectContaining({ httpOnly: true, secure: true, sameSite: 'lax', path: '/' }),
    );
  });
});

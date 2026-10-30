import { execFileSync } from 'node:child_process';
import { fileURLToPath, URL as NodeURL } from 'node:url';
import { lazy, Suspense, type ComponentType } from 'react';
import { hydrateRoot, type Root } from 'react-dom/client';
import { act, waitFor, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { Providers, Protected, useAuth } from './providers';
import { setAccessToken } from '@/lib/api/client';

const { replace } = vi.hoisted(() => ({ replace: vi.fn() }));
vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace }),
  usePathname: () => '/curator',
}));
const fixture = fileURLToPath(
  new NodeURL('../test/fixtures/auth-hydration-ssr.mjs', import.meta.url),
);
function AuthState() {
  const auth = useAuth();
  return <p id="auth-state">{auth.me ? 'READY' : 'LOADING'}</p>;
}
const json = (data: unknown) =>
  new Response(JSON.stringify(data), { headers: { 'Content-Type': 'application/json' } });

describe('Authentication during selective hydration', () => {
  it.each([
    { area: 'curator' as const, role: 'CANDIDATE', heading: 'Нет доступа' },
    { area: 'admin' as const, role: 'ADMIN', heading: 'Allowed' },
  ])(
    'hydrates a delayed $area boundary after the $role session is ready',
    async ({ area, role, heading }) => {
      replace.mockClear();
      const requests: string[] = [];
      vi.stubGlobal(
        'fetch',
        vi.fn(async (input: Request | string) => {
          const path = new URL(typeof input === 'string' ? input : input.url, location.origin)
            .pathname;
          requests.push(path);
          if (path === '/api/v1/auth/refresh')
            return json({ status: 'USED', accessToken: 'test-only-access' });
          expect(path).toBe('/api/v1/me');
          return json({
            id: 'test-user',
            role,
            fullName: 'Hydration fixture',
            curatorPlaceIds: [],
            onboardingCompleted: true,
          });
        }),
      );
      const container = document.createElement('div');
      document.body.append(container);
      container.innerHTML = execFileSync(process.execPath, [fixture, area], { encoding: 'utf8' });
      expect(within(container).getByRole('status')).toHaveTextContent('Загрузка профиля…');
      let release!: (module: { default: ComponentType }) => void;
      const Delayed = lazy(
        () =>
          new Promise<{ default: ComponentType }>((resolve) => {
            release = resolve;
          }),
      );
      const errors: unknown[] = [];
      let root: Root | undefined;
      try {
        await act(async () => {
          root = hydrateRoot(
            container,
            <Providers hasSession>
              <AuthState />
              <Suspense fallback={<p>Loading component</p>}>
                <Delayed />
              </Suspense>
            </Providers>,
            { onRecoverableError: (error) => errors.push(error) },
          );
        });
        await waitFor(() =>
          expect(container.querySelector('#auth-state')).toHaveTextContent('READY'),
        );
        expect(requests).toEqual(['/api/v1/auth/refresh', '/api/v1/me']);
        expect(within(container).getByRole('status')).toHaveTextContent('Загрузка профиля…');
        expect(replace).not.toHaveBeenCalled();
        await act(async () => {
          release({
            default: () => (
              <Protected area={area}>
                <h1>Allowed</h1>
              </Protected>
            ),
          });
        });
        expect(await within(container).findByRole('heading', { name: heading })).toBeVisible();
        expect(errors).toEqual([]);
        expect(replace).not.toHaveBeenCalled();
      } finally {
        await act(async () => root?.unmount());
        container.remove();
        setAccessToken();
      }
    },
  );
});

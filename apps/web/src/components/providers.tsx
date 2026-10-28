'use client';
import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import { QueryClient, QueryClientProvider, useQuery, useQueryClient } from '@tanstack/react-query';
import { z } from 'zod';
import { usePathname, useRouter } from 'next/navigation';
import {
  permissionMatrix,
  curatorPermissions,
  UserRole,
  type PermissionAction,
} from '@club/shared';
import { api, clearPrivateStorage, refreshSession, result, type Model } from '@/lib/api/client';
z.config(z.locales.ru());
type Auth = {
  me: Model<'MeResponseDto'> | null;
  loading: boolean;
  reload: () => Promise<unknown>;
  logout: () => Promise<void>;
};
const Context = createContext<Auth | null>(null);
export function useAuth() {
  const auth = useContext(Context);
  if (!auth) throw new Error('AuthProvider required');
  return auth;
}
export function can(me: Auth['me'], action: PermissionAction) {
  return (
    !!me &&
    (permissionMatrix[me.role].some((grant) => grant.action === '*' || grant.action === action) ||
      (me.role === UserRole.VOLUNTEER &&
        me.curatorPlaceIds.length > 0 &&
        curatorPermissions.some((grant) => grant.action === action)))
  );
}
function AuthProvider({ children, hasSession }: { children: ReactNode; hasSession: boolean }) {
  const [ready, setReady] = useState(false);
  const [authenticated, setAuthenticated] = useState(false);
  const queryClient = useQueryClient();
  useEffect(() => {
    const changed = (event: Event) =>
      setAuthenticated(Boolean((event as CustomEvent<boolean>).detail));
    window.addEventListener('club:session', changed);
    return () => window.removeEventListener('club:session', changed);
  }, []);
  useEffect(() => {
    let active = true;
    void (hasSession ? refreshSession() : Promise.resolve(undefined))
      .then((token) => {
        if (active) setAuthenticated(!!token);
      })
      .catch(() => undefined)
      .finally(() => {
        if (active) setReady(true);
      });
    return () => {
      active = false;
    };
  }, [hasSession]);
  const query = useQuery({
    queryKey: ['me'],
    queryFn: () => result(api.GET('/api/v1/me')),
    enabled: ready && authenticated,
    retry: false,
    staleTime: 60000,
    refetchOnWindowFocus: 'always',
  });
  const logout = async () => {
    await result(api.POST('/api/v1/auth/logout'));
    clearPrivateStorage();
    queryClient.clear();
    window.location.assign('/');
  };
  return (
    <Context.Provider
      value={{
        me: query.data ?? null,
        loading: !ready || query.isLoading,
        reload: query.refetch,
        logout,
      }}
    >
      {children}
    </Context.Provider>
  );
}
export function Providers({
  children,
  hasSession = false,
}: {
  children: ReactNode;
  hasSession?: boolean;
}) {
  const [client] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: { staleTime: 30000, retry: 1, refetchOnWindowFocus: true },
          mutations: { retry: false },
        },
      }),
  );
  return (
    <QueryClientProvider client={client}>
      <AuthProvider hasSession={hasSession}>{children}</AuthProvider>
    </QueryClientProvider>
  );
}
export function Protected({
  children,
  area,
}: {
  children: ReactNode;
  area?: 'admin' | 'curator' | 'onboarding';
}) {
  const auth = useAuth();
  const router = useRouter();
  const path = usePathname();
  useEffect(() => {
    if (auth.loading) return;
    if (!auth.me) router.replace(`/login?next=${encodeURIComponent(path)}`);
    else if (!auth.me.onboardingCompleted && area !== 'onboarding') router.replace('/onboarding');
  }, [auth.loading, auth.me, router, path, area]);
  if (auth.loading)
    return (
      <div className="skeleton" role="status">
        Загрузка профиля…
      </div>
    );
  if (!auth.me || (!auth.me.onboardingCompleted && area !== 'onboarding')) return null;
  if (
    (area === 'admin' && auth.me.role !== UserRole.ADMIN) ||
    (area === 'curator' && !can(auth.me, 'trip.create'))
  )
    return (
      <section className="notice" role="alert">
        <h1>Нет доступа</h1>
        <p>Этот раздел недоступен для вашего аккаунта.</p>
      </section>
    );
  return children;
}

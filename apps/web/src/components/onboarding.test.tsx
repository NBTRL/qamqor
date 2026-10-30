import { beforeEach, describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { CONSENT_VERSION } from '@club/shared';
import { OnboardingForm } from './onboarding';
const { replace } = vi.hoisted(() => ({ replace: vi.fn() }));
vi.mock('next/navigation', () => ({ useRouter: () => ({ replace }) }));
beforeEach(() => replace.mockClear());
function mount(next?: string) {
  render(
    <QueryClientProvider
      client={new QueryClient({ defaultOptions: { mutations: { retry: false } } })}
    >
      <OnboardingForm next={next} />
    </QueryClientProvider>,
  );
}
describe('Onboarding', () => {
  it('requires consent and rejects an underage date locally', async () => {
    const fetch = vi.fn();
    vi.stubGlobal('fetch', fetch);
    mount();
    expect(screen.getByRole('button', { name: 'Продолжить' })).toBeDisabled();
    fireEvent.change(screen.getByLabelText('Дата рождения'), { target: { value: '2020-01-01' } });
    fireEvent.click(screen.getByRole('checkbox'));
    fireEvent.submit(screen.getByRole('button', { name: 'Продолжить' }).closest('form')!);
    expect(await screen.findByRole('alert')).toHaveTextContent('18 лет');
    expect(fetch).not.toHaveBeenCalled();
  });
  it.each([
    [undefined, '/cabinet'],
    [
      '/events/selected-event?source=calendar#registration',
      '/events/selected-event?source=calendar#registration',
    ],
    ['/\\example.org', '/cabinet'],
    ['/onboarding?next=/events/selected-event', '/cabinet'],
  ])(
    'posts the shared consent and safely returns from onboarding for %j',
    async (next, expected) => {
      const fetch = vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ id: 'user', onboardingCompleted: true }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }),
      );
      vi.stubGlobal('fetch', fetch);
      mount(next);
      fireEvent.change(screen.getByLabelText('Дата рождения'), { target: { value: '2000-01-01' } });
      fireEvent.click(screen.getByRole('checkbox'));
      fireEvent.submit(screen.getByRole('button', { name: 'Продолжить' }).closest('form')!);
      await waitFor(() => expect(replace).toHaveBeenCalledWith(expected));
      const request = fetch.mock.calls[0]![0] as Request;
      expect(await request.json()).toEqual({
        birthDate: '2000-01-01',
        consentVersion: CONSENT_VERSION,
      });
    },
  );
});

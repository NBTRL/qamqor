import { afterEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ApplicationStatus, applicationStatusLabels } from '@club/shared';
import type { Model } from '@/lib/api/client';
import { ApplicationDecision } from './admin';

const clients: QueryClient[] = [];
afterEach(() => {
  for (const client of clients) client.clear();
  clients.length = 0;
});
const questionnaire = {
  motivation: 'Хочу регулярно помогать и делиться полезными знаниями.',
  volunteeringExperience: 'Многолетний опыт.',
  helpAreas: ['EDUCATION'],
  availableWeekdays: ['SATURDAY'],
  referralSource: 'Друзья',
  rulesAccepted: true,
};
const json = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json' } });
function fixture({
  status = ApplicationStatus.QUESTIONNAIRE_DONE,
  attended = false,
  filled = true,
} = {}) {
  let row = {
    id: 'application',
    status,
    questionnaire: filled ? questionnaire : null,
    hasOpenDayAttended: attended,
    history: [],
  };
  const writes: Model<'ApplicationDecisionDto'>[] = [];
  const server = { fail: false };
  vi.stubGlobal(
    'fetch',
    vi.fn(async (request: Request) => {
      if (request.method === 'GET') return json(row);
      const body = (await request.json()) as Model<'ApplicationDecisionDto'>;
      writes.push(body);
      if (server.fail) return json({ code: 'VALIDATION_ERROR' }, 400);
      row = { ...row, status: body.status as ApplicationStatus };
      return json(row);
    }),
  );
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  clients.push(client);
  render(
    <QueryClientProvider client={client}>
      <ApplicationDecision id="application" />
    </QueryClientProvider>,
  );
  return { writes, server };
}
const accept = () => screen.getByRole('button', { name: applicationStatusLabels.ACCEPTED });
const exception = () =>
  screen.getByRole('checkbox', { name: 'Принять как исключение по решению администратора' });

describe('Ordinary admission and explicit administrative exceptions', () => {
  it.each([
    { attended: false, filled: true },
    { attended: true, filled: false },
  ])('disables ordinary acceptance when a prerequisite is missing: %j', async (options) => {
    fixture(options);
    await screen.findByRole('checkbox');
    expect(accept()).toBeDisabled();
    expect(screen.getByRole('button', { name: applicationStatusLabels.INTERVIEW })).toBeDisabled();
  });
  it('submits an ordinary complete application without the exception flag', async () => {
    const f = fixture({ attended: true });
    await screen.findByRole('checkbox');
    fireEvent.click(accept());
    await waitFor(() => expect(f.writes).toHaveLength(1));
    expect(f.writes[0]).toEqual({ status: 'ACCEPTED', comment: '' });
  });
  it.each([ApplicationStatus.NEW, ApplicationStatus.REJECTED])(
    'offers an explicit, reasoned exception for %s',
    async (status) => {
      const f = fixture({ status, filled: false });
      await screen.findByRole('checkbox');
      fireEvent.click(exception());
      const submit = screen.getByRole('button', { name: 'Принять как исключение' });
      expect(submit).toBeDisabled();
      fireEvent.change(screen.getByLabelText('Причина исключения'), {
        target: { value: 'Личное решение основателя' },
      });
      fireEvent.click(submit);
      await waitFor(() => expect(f.writes).toHaveLength(1));
      expect(f.writes[0]).toEqual({
        status: 'ACCEPTED',
        adminOverride: true,
        comment: 'Личное решение основателя',
      });
      await waitFor(() => expect(screen.queryByRole('checkbox')).not.toBeInTheDocument());
      expect(screen.getByText('ДОД не посещен')).toBeInTheDocument();
    },
  );
  it('retains the reason after an error and can return to the ordinary mode', async () => {
    const f = fixture();
    f.server.fail = true;
    await screen.findByRole('checkbox');
    fireEvent.click(exception());
    fireEvent.change(screen.getByLabelText('Причина исключения'), { target: { value: 'Причина' } });
    fireEvent.click(screen.getByRole('button', { name: 'Принять как исключение' }));
    await screen.findByRole('alert');
    expect(screen.getByLabelText('Причина исключения')).toHaveValue('Причина');
    fireEvent.click(exception());
    expect(accept()).toBeDisabled();
    expect(
      screen.queryByRole('button', { name: 'Принять как исключение' }),
    ).not.toBeInTheDocument();
  });
});

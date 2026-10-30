import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { RecordForm } from './record-form';

describe('Event record form validation', () => {
  it('exposes generated field limits and does not submit an invalid time range', async () => {
    const save = vi.fn(async (_body: unknown) => ({ ok: true }));
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={client}>
        <RecordForm
          schemaName="EventWriteDto"
          onSave={save}
          initial={{
            type: 'CLUB_EVENT',
            title: 'Учебная встреча',
            description: 'Описание',
            location: 'Учебная площадка',
            capacity: 2,
            startsAt: '2026-11-01T12:00:00+03:00',
            endsAt: '2026-11-01T11:00:00+03:00',
          }}
        />
      </QueryClientProvider>,
    );
    const capacity = screen.getByLabelText('Количество мест');
    expect(capacity).toHaveAttribute('min', '1');
    expect(capacity).toHaveAttribute('max', '1000');
    expect(capacity).not.toHaveAttribute('step', 'any');
    expect(screen.getByLabelText('Название')).toHaveAttribute('minlength', '2');
    expect(screen.getByLabelText('Название')).toHaveAttribute('maxlength', '200');
    expect(screen.getByLabelText('Описание')).toHaveAttribute('maxlength', '20000');
    fireEvent.submit(screen.getByRole('button', { name: /^Сохранить$/ }).closest('form')!);
    await screen.findByText('Время окончания должно быть позже начала.');
    expect(save).not.toHaveBeenCalled();
    fireEvent.change(screen.getByLabelText('Окончание (МСК)'), {
      target: { value: '2026-11-01T13:00' },
    });
    fireEvent.submit(screen.getByRole('button', { name: /^Сохранить$/ }).closest('form')!);
    await waitFor(() => expect(save).toHaveBeenCalledOnce());
    expect(save.mock.calls[0]?.[0]).toMatchObject({ capacity: 2 });
    client.clear();
  });
});

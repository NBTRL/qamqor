import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import type { Model } from '@/lib/api/client';
import { tripStatusLabels, TripStatus } from '@club/shared';
import { TripCard } from './trips';
const trip: Model<'TripResponseDto'> = {
  id: 'trip',
  title: 'Поездка к друзьям',
  description: 'Встреча',
  startsAt: '2026-11-01T09:00:00Z',
  endsAt: '2026-11-01T12:00:00Z',
  capacity: 10,
  confirmedCount: 4,
  status: TripStatus.OPEN,
  place: {
    id: 'place',
    slug: 'place',
    name: 'Учреждение',
    type: 'ORPHANAGE',
    region: { id: 'region', slug: 'region', name: 'Регион' },
    city: 'Город',
    description: '',
    coverImage: null,
    beneficiariesCount: 10,
  },
};
describe('TripCard', () => {
  it('uses shared status labels, Moscow time and participant counts', () => {
    render(<TripCard trip={trip} />);
    expect(screen.getByText(tripStatusLabels[TripStatus.OPEN])).toBeInTheDocument();
    expect(screen.getByText(/12:00/)).toBeInTheDocument();
    expect(screen.getByText('Подтверждено: 4 / 10')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: trip.title })).toHaveAttribute('href', '/trips/trip');
  });
  it('explains candidate access', () => {
    render(<TripCard trip={trip} candidate />);
    expect(screen.getByText('Доступно после вступления в Клуб')).toBeInTheDocument();
  });
});

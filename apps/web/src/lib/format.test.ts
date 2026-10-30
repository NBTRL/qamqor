import { describe, expect, it } from 'vitest';
import { safeReturn } from './format';

describe('safeReturn', () => {
  it.each([
    null,
    '',
    'cabinet/profile',
    'https://example.org',
    'https://qamqor.invalid/cabinet',
    'javascript:alert(1)',
    '//example.org',
    '/\\example.org',
    '/cabinet\\profile',
    ' /cabinet',
    '/\t/example.org',
    '/cabinet\n/profile',
    '/cabinet\r/profile',
    '/cabinet\u0000',
    '/cabinet\u007f',
    '/cabinet\u0085',
    '/%2fexample.org',
    '/%5cexample.org',
    '/%255cexample.org',
    '/%252fexample.org',
    '/%00cabinet',
    '/%0acabinet',
    '/%',
    '/%FF',
    '/login',
    '/login?next=/cabinet',
    '/login/again',
    '/onboarding',
    '/onboarding?next=/events/example',
    '/%6fnboarding',
    '/cabinet/../onboarding',
    '/api',
    '/api/v1/me',
    '/cabinet/../login',
    '/cabinet/%2e%2e/api/v1/me',
    '/%6cogin',
    '/%61pi/v1/me',
    '/cabinet/..//example.org',
  ])('falls back to the cabinet for %j', (path) => {
    expect(safeReturn(path)).toBe('/cabinet');
  });

  it.each([
    ['/', '/'],
    ['/cabinet/profile', '/cabinet/profile'],
    ['/trips/trip-id?tab=report#photos', '/trips/trip-id?tab=report#photos'],
    ['/cabinet/../events?type=TRIP#calendar', '/events?type=TRIP#calendar'],
    [
      '/cabinet?next=https%3A%2F%2Fexample.org#profile',
      '/cabinet?next=https%3A%2F%2Fexample.org#profile',
    ],
    ['/cabinet?search=100%25', '/cabinet?search=100%25'],
    ['/news/%D1%82%D0%B5%D1%81%D1%82', '/news/%D1%82%D0%B5%D1%81%D1%82'],
  ])('returns a normalized internal URL for %j', (path, expected) => {
    expect(safeReturn(path)).toBe(expected);
  });
});

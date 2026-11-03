/** Pin node-postgres' current certificate verification before pg 9 changes aliases. */
export function databaseUrlForPg(connectionString: string): string {
  const url = new URL(connectionString);
  if (
    url.searchParams.get('uselibpqcompat') !== 'true' &&
    ['prefer', 'require', 'verify-ca'].includes(url.searchParams.get('sslmode') ?? '')
  ) {
    url.searchParams.set('sslmode', 'verify-full');
    return url.href;
  }
  return connectionString;
}

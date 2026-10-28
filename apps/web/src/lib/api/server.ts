import 'server-only';
import createClient from 'openapi-fetch';
import { cookies } from 'next/headers';
import type { paths } from './schema';
export async function serverApi() {
  const jar = await cookies();
  return createClient<paths>({
    baseUrl: process.env.PUBLIC_API_URL ?? 'http://localhost:4000',
    headers: { cookie: jar.toString() },
    fetch: (request) =>
      fetch(
        request,
        request.cache === 'no-store' ? { cache: 'no-store' } : { next: { revalidate: 60 } },
      ),
  });
}

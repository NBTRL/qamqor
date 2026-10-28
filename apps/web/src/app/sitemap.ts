import type { MetadataRoute } from 'next';
import { sections, publicList } from '@/lib/public-content';
import { serverApi } from '@/lib/api/server';
import { result } from '@/lib/api/client';
export const dynamic = 'force-dynamic';
export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const base = process.env.WEB_URL ?? 'http://localhost:3000';
  const entries: MetadataRoute.Sitemap = ['', ...Object.keys(sections)].map((path) => ({
    url: `${base}/${path}`,
    changeFrequency: 'weekly',
    priority: path ? 0.6 : 1,
  }));
  for (const section of ['novosti', 'interv-yu-s-volonterami', 'fotoalbomy']) {
    try {
      let page = 1;
      while (page <= 100) {
        const data = await publicList(section, page);
        for (const item of data.items)
          if (item.slug)
            entries.push({
              url: `${base}/${section}/${item.slug}`,
              ...(item.publishedAt ? { lastModified: item.publishedAt } : {}),
            });
        if (page * data.limit >= data.total) break;
        page++;
      }
    } catch {
      /* Static routes stay available while the API is offline. */
    }
  }
  try {
    const api = await serverApi();
    let page = 1;
    while (true) {
      const data = await result(
        api.GET('/api/v1/places', { params: { query: { page, limit: 100 } } }),
      );
      for (const item of data.items) entries.push({ url: `${base}/uchrezhdeniya/${item.slug}` });
      if (page * 100 >= data.total) break;
      page++;
    }
  } catch {
    /* An unavailable API does not remove static routes. */
  }
  return entries;
}

import type { MetadataRoute } from 'next';
export default function robots(): MetadataRoute.Robots {
  return {
    rules: {
      userAgent: '*',
      allow: '/',
      disallow: [
        '/api/',
        '/cabinet',
        '/curator',
        '/admin',
        '/trips',
        '/events',
        '/login',
        '/onboarding',
        '/verify-email',
      ],
    },
    sitemap: `${process.env.WEB_URL ?? 'http://localhost:3000'}/sitemap.xml`,
  };
}

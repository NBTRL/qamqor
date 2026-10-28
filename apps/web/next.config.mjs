import { assertProductionSafety } from '@club/shared/server';

assertProductionSafety(process.env);
const upstream = (process.env.PUBLIC_API_URL ?? 'http://localhost:4000').replace(/\/$/, '');
/** @type {import('next').NextConfig} */
const config = {
  transpilePackages: ['@club/shared'],
  poweredByHeader: false,
  // SEO-метаданные всегда находятся в head, включая проверку без JavaScript.
  htmlLimitedBots: /.*/,
  async rewrites() {
    return [
      { source: '/api/v1/:path*', destination: `${upstream}/api/v1/:path*` },
      { source: '/api/docs', destination: `${upstream}/api/docs` },
      { source: '/api/docs/:path*', destination: `${upstream}/api/docs/:path*` },
      { source: '/api/docs-json', destination: `${upstream}/api/docs-json` },
    ];
  },
};
export default config;

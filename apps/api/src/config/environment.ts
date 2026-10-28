import { parseServerEnvironment } from '@club/shared/server';

export const getEnvironment = () => {
  const previewOrigin =
    process.env.VERCEL_ENV === 'preview' && process.env.VERCEL_URL
      ? `https://${process.env.VERCEL_URL}`
      : undefined;
  return parseServerEnvironment({
    ...process.env,
    ...(previewOrigin ? { WEB_URL: previewOrigin, PUBLIC_API_URL: previewOrigin } : {}),
  });
};

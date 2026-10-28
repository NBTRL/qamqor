import sanitizeHtml from 'sanitize-html';
import type { PrismaService } from '../prisma/prisma.service.js';

type Asset = { id: string };
type FileEnvironment = { WEB_URL: string; PUBLIC_API_URL: string };

export function referencesFile(
  value: string | null | undefined,
  asset: Asset,
  env: FileEnvironment,
) {
  if (!value) return false;
  try {
    const url = new URL(value, env.WEB_URL);
    const origins = [new URL(env.WEB_URL).origin, new URL(env.PUBLIC_API_URL).origin];
    return (
      origins.includes(url.origin) &&
      url.pathname.replace(/\/$/, '').toLowerCase() === `/api/v1/files/${asset.id.toLowerCase()}`
    );
  } catch {
    return false;
  }
}

export function htmlReferencesFile(html: string, asset: Asset, env: FileEnvironment): boolean {
  let found = false;
  sanitizeHtml(html, {
    allowedTags: ['img', 'a'],
    allowedAttributes: { img: ['src'], a: ['href'] },
    exclusiveFilter: (frame) => {
      const value = frame.tag === 'img' ? frame.attribs.src : frame.attribs.href;
      if (referencesFile(value, asset, env)) found = true;
      return false;
    },
  });
  return found;
}

// Проверяем текущие публикации при каждой выдаче ссылки. Файл может использоваться
// несколькими материалами: достаточно одной актуальной публичной ссылки.
export async function isCmsFilePublic(
  prisma: PrismaService,
  asset: Asset,
  env: FileEnvironment,
): Promise<boolean> {
  const containsId = { contains: asset.id, mode: 'insensitive' as const };
  const publishedAt = { lte: new Date() };
  const [places, news, pages, albums, media, interviews, projects, partners, press, reports] =
    await Promise.all([
      prisma.place.findMany({
        where: { isActive: true, coverImageUrl: containsId },
        select: { coverImageUrl: true },
      }),
      prisma.newsPost.findMany({
        where: {
          status: 'PUBLISHED',
          publishedAt,
          OR: [{ coverUrl: containsId }, { bodyHtml: containsId }],
        },
        select: { coverUrl: true, bodyHtml: true },
      }),
      prisma.page.findMany({ where: { bodyHtml: containsId }, select: { bodyHtml: true } }),
      prisma.mediaAlbum.findMany({
        where: { publishedAt, coverUrl: containsId },
        select: { coverUrl: true },
      }),
      prisma.mediaItem.findMany({
        where: { isPublic: true, album: { publishedAt }, url: containsId },
        select: { url: true },
      }),
      prisma.interview.findMany({
        where: { publishedAt, OR: [{ coverUrl: containsId }, { bodyHtml: containsId }] },
        select: { coverUrl: true, bodyHtml: true },
      }),
      prisma.project.findMany({
        where: { isActive: true, OR: [{ coverUrl: containsId }, { bodyHtml: containsId }] },
        select: { coverUrl: true, bodyHtml: true },
      }),
      prisma.partner.findMany({
        where: { isActive: true, OR: [{ logoUrl: containsId }, { websiteUrl: containsId }] },
        select: { logoUrl: true, websiteUrl: true },
      }),
      prisma.pressMention.findMany({
        where: { publishedAt, url: containsId },
        select: { url: true },
      }),
      prisma.clubReport.findMany({
        where: { publishedAt, fileUrl: containsId },
        select: { fileUrl: true },
      }),
    ]);
  const urls = [
    ...places.map((row) => row.coverImageUrl),
    ...news.map((row) => row.coverUrl),
    ...albums.map((row) => row.coverUrl),
    ...media.map((row) => row.url),
    ...interviews.map((row) => row.coverUrl),
    ...projects.map((row) => row.coverUrl),
    ...partners.flatMap((row) => [row.logoUrl, row.websiteUrl]),
    ...press.map((row) => row.url),
    ...reports.map((row) => row.fileUrl),
  ];
  if (urls.some((value) => referencesFile(value, asset, env))) return true;
  return [...news, ...pages, ...interviews, ...projects].some((row) =>
    htmlReferencesFile(row.bodyHtml, asset, env),
  );
}

import sanitizeHtml from 'sanitize-html';
import { isUUID } from 'class-validator';
import { ErrorCode } from '@club/shared';
import type { Tx } from '../common/audit.service.js';
import { ApiException } from '../common/api-exception.js';

type FileEnvironment = {
  WEB_URL: string;
  PUBLIC_API_URL: string;
  S3_BUCKET: string;
  S3_ENDPOINT?: string;
};
type Reference = { id: string } | { key: string };
export async function lockFileReferences(tx: Tx): Promise<void> {
  await tx.$queryRaw`SELECT 1::int AS locked FROM pg_advisory_xact_lock(73142, 6)`;
}
export function fileReferences(
  value: unknown,
  env: FileEnvironment,
  includeForeignOrigins = false,
): Reference[] {
  const found = new Map<string, Reference>();
  const add = (text?: string) => {
    if (!text) return;
    if (text.startsWith(`s3://${env.S3_BUCKET}/`)) {
      const key = text.slice(`s3://${env.S3_BUCKET}/`.length);
      if (key && !key.includes('..')) found.set(`key:${key}`, { key });
      return;
    }
    try {
      const url = new URL(text, env.WEB_URL);
      if (env.S3_ENDPOINT) {
        const endpoint = new URL(env.S3_ENDPOINT);
        const prefix = `${endpoint.pathname.replace(/\/$/, '')}/${env.S3_BUCKET}/`;
        if (url.origin === endpoint.origin && url.pathname.startsWith(prefix)) {
          const key = decodeURIComponent(url.pathname.slice(prefix.length));
          if (key && !key.includes('..')) found.set(`key:${key}`, { key });
          return;
        }
      }
      if (
        !includeForeignOrigins &&
        ![new URL(env.WEB_URL).origin, new URL(env.PUBLIC_API_URL).origin].includes(url.origin)
      )
        return;
      const match = /^\/api\/v1\/files\/([^/]+)\/?$/i.exec(decodeURIComponent(url.pathname));
      if (match?.[1] && isUUID(match[1])) {
        const id = match[1].toLowerCase();
        found.set(`id:${id}`, { id });
      }
    } catch {
      /* External or non-URL text cannot identify a managed asset. */
    }
  };
  const visit = (entry: unknown) => {
    if (typeof entry === 'string') {
      add(entry);
      if (entry.includes('<'))
        sanitizeHtml(entry, {
          allowedTags: ['img', 'a'],
          allowedAttributes: { img: ['src'], a: ['href'] },
          exclusiveFilter: (frame) => {
            add(frame.tag === 'img' ? frame.attribs.src : frame.attribs.href);
            return false;
          },
        });
    } else if (Array.isArray(entry)) entry.forEach(visit);
    else if (entry && typeof entry === 'object' && !(entry instanceof Date))
      Object.values(entry).forEach(visit);
  };
  visit(value);
  return [...found.values()];
}
// Caller holds lockFileReferences in the same transaction as the material write.
export async function retainFileReferences(
  tx: Tx,
  value: unknown,
  env: FileEnvironment,
): Promise<void> {
  const refs = fileReferences(value, env);
  if (!refs.length) return;
  const rows = await tx.uploadAsset.findMany({ where: { OR: refs } });
  if (
    refs.some(
      (ref) => !rows.some((row) => ('id' in ref ? row.id === ref.id : row.key === ref.key)),
    ) ||
    rows.some((row) => row.deletedAt)
  )
    throw new ApiException(ErrorCode.VALIDATION_ERROR, {
      reason: 'Файл удалён или ожидает удаления. Загрузите его заново.',
    });
  for (const row of rows) {
    const retained = await tx.uploadAsset.updateMany({
      where: { id: row.id, deletedAt: null },
      data: { orphanedAt: null, completedAt: row.completedAt ?? new Date() },
    });
    if (retained.count !== 1) throw new ApiException(ErrorCode.VALIDATION_ERROR);
  }
}
export async function isFileReferenced(
  tx: Tx,
  asset: { id: string; key: string },
  env: FileEnvironment,
): Promise<boolean> {
  const filter = {
    OR: [
      { contains: asset.id, mode: 'insensitive' as const },
      { contains: asset.key },
      { contains: '/api/v1/files/', mode: 'insensitive' as const },
    ],
  };
  // String fields do not support a nested OR; use the same candidates on each column.
  const candidate = (field: string) => filter.OR.map((test) => ({ [field]: test }));
  const rows = await Promise.all([
    tx.user.findMany({ where: { OR: candidate('avatarUrl') }, select: { avatarUrl: true } }),
    tx.place.findMany({
      where: { OR: candidate('coverImageUrl') },
      select: { coverImageUrl: true },
    }),
    tx.newsPost.findMany({
      where: { OR: [...candidate('coverUrl'), ...candidate('bodyHtml')] },
      select: { coverUrl: true, bodyHtml: true },
    }),
    tx.page.findMany({ where: { OR: candidate('bodyHtml') }, select: { bodyHtml: true } }),
    tx.mediaAlbum.findMany({ where: { OR: candidate('coverUrl') }, select: { coverUrl: true } }),
    tx.mediaItem.findMany({ where: { OR: candidate('url') }, select: { url: true } }),
    tx.interview.findMany({
      where: { OR: [...candidate('coverUrl'), ...candidate('bodyHtml')] },
      select: { coverUrl: true, bodyHtml: true },
    }),
    tx.project.findMany({
      where: { OR: [...candidate('coverUrl'), ...candidate('bodyHtml')] },
      select: { coverUrl: true, bodyHtml: true },
    }),
    tx.partner.findMany({
      where: { OR: [...candidate('logoUrl'), ...candidate('websiteUrl')] },
      select: { logoUrl: true, websiteUrl: true },
    }),
    tx.pressMention.findMany({ where: { OR: candidate('url') }, select: { url: true } }),
    tx.clubReport.findMany({ where: { OR: candidate('fileUrl') }, select: { fileUrl: true } }),
    tx.reportPhoto.findMany({ where: { OR: candidate('url') }, select: { url: true } }),
  ]);
  // Unknown/old origins are retained conservatively too. A reference containing the
  // asset's UUID or unique key is never a reason to delete a potentially shared file.
  const text = JSON.stringify(rows).toLowerCase();
  return (
    text.includes(asset.id.toLowerCase()) ||
    text.includes(asset.key.toLowerCase()) ||
    fileReferences(rows, env, true).some((ref) =>
      'id' in ref ? ref.id === asset.id : ref.key === asset.key,
    )
  );
}

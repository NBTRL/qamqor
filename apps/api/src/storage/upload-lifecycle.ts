import { getEnvironment } from '../config/environment.js';
import type { PrismaService } from '../prisma/prisma.service.js';
import { isFileReferenced, lockFileReferences } from './file-references.js';

export const UNFINISHED_UPLOAD_TTL_MS = 24 * 60 * 60 * 1000;
export const UNUSED_UPLOAD_GRACE_MS = 7 * 24 * 60 * 60 * 1000;
const purposes = ['AVATAR', 'CONTENT', 'REPORT_PHOTO', 'CLUB_REPORT'];
export async function inspectUnusedUploads(
  prisma: PrismaService,
  { dryRun = true, now = new Date(), limit = 25 } = {},
) {
  const rows = await prisma.uploadAsset.findMany({
    where: {
      deletedAt: null,
      purpose: { in: purposes },
      createdAt: { lte: new Date(now.getTime() - UNFINISHED_UPLOAD_TTL_MS) },
    },
    orderBy: [{ checkedAt: 'asc' }, { id: 'asc' }],
    take: Math.max(1, Math.min(limit, 100)),
  });
  const results: Array<{ id: string; state: 'referenced' | 'waiting' | 'ready' | 'skipped' }> = [];
  for (const candidate of rows)
    results.push(
      await prisma.$transaction(
        async (tx) => {
          await lockFileReferences(tx);
          const asset = await tx.uploadAsset.findUnique({ where: { id: candidate.id } });
          if (!asset || asset.deletedAt) return { id: candidate.id, state: 'skipped' as const };
          const referenced = await isFileReferenced(tx, asset, getEnvironment());
          const orphanedAt = referenced
            ? null
            : (asset.orphanedAt ?? (asset.completedAt ? now : asset.createdAt));
          const ready =
            !referenced &&
            now.getTime() - orphanedAt!.getTime() >=
              (asset.completedAt ? UNUSED_UPLOAD_GRACE_MS : UNFINISHED_UPLOAD_TTL_MS);
          if (!dryRun) {
            const changed = await tx.uploadAsset.updateMany({
              where: { id: asset.id, deletedAt: null, completedAt: asset.completedAt },
              data: {
                checkedAt: now,
                orphanedAt,
                ...(referenced && !asset.completedAt ? { completedAt: now } : {}),
                ...(ready ? { deletedAt: now, deletionReason: 'UNUSED' } : {}),
              },
            });
            if (changed.count !== 1) return { id: asset.id, state: 'skipped' as const };
          }
          return {
            id: asset.id,
            state: referenced
              ? ('referenced' as const)
              : ready
                ? ('ready' as const)
                : ('waiting' as const),
          };
        },
        { timeout: 15000 },
      ),
    );
  return results;
}
export async function prepareFileDeletion(prisma: PrismaService, id: string) {
  return prisma.$transaction(
    async (tx) => {
      await lockFileReferences(tx);
      const asset = await tx.uploadAsset.findUnique({ where: { id } });
      if (!asset?.deletedAt) return null;
      if (
        asset.deletionReason === 'UNUSED' &&
        (await isFileReferenced(tx, asset, getEnvironment()))
      ) {
        const restored = await tx.uploadAsset.updateMany({
          where: { id, deletionReason: 'UNUSED', deletedAt: asset.deletedAt },
          data: {
            deletedAt: null,
            deletionReason: null,
            orphanedAt: null,
            completedAt: asset.completedAt ?? new Date(),
          },
        });
        if (restored.count === 1) return null;
        // Anonymization may have changed the reason without taking the file lock.
        const current = await tx.uploadAsset.findUnique({ where: { id } });
        return current?.deletedAt ? current : null;
      }
      // The committed deletedAt tombstone prevents all writers from attaching this asset.
      return asset;
    },
    { timeout: 15000 },
  );
}

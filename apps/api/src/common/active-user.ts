import { ErrorCode } from '@club/shared';
import { ApiException } from './api-exception.js';
import type { Tx } from './audit.service.js';

/** Берется перед блокировкой предметной записи: удаление не может очистить данные раньше их записи. */
export async function lockActiveUser(tx: Tx, id: string) {
  await tx.$queryRaw`SELECT "id" FROM "users" WHERE "id"=${id}::uuid FOR NO KEY UPDATE`;
  const user = await tx.user.findUnique({ where: { id } });
  if (!user || user.isBlocked || user.anonymizedAt)
    throw new ApiException(ErrorCode.ACCOUNT_BLOCKED);
  return user;
}

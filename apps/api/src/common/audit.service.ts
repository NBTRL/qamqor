import { Injectable } from '@nestjs/common';
import type { Prisma } from '../generated/prisma/client.js';
import { transitions, ErrorCode, type TransitionTable } from '@club/shared';
import { ApiException } from './api-exception.js';

export type Tx = Prisma.TransactionClient;
@Injectable()
export class AuditService {
  async record(
    tx: Tx,
    actorId: string | null,
    action: string,
    entity: string,
    entityId: string,
    diff: Prisma.InputJsonObject = {},
  ): Promise<void> {
    await tx.auditLog.create({ data: { actorId, action, entity, entityId, diff } });
  }
  async transition(
    tx: Tx,
    actorId: string | null,
    entity: string,
    entityId: string,
    table: keyof typeof transitions,
    from: string,
    to: string,
  ): Promise<void> {
    this.assertTransition(table, from, to);
    await this.record(tx, actorId, 'STATUS_CHANGED', entity, entityId, { from, to });
  }
  assertTransition(table: keyof typeof transitions, from: string, to: string): void {
    const edges = transitions[table] as TransitionTable<string>;
    if (!edges[from]?.includes(to)) throw new ApiException(ErrorCode.INVALID_TRANSITION);
  }
}

import { Injectable } from '@nestjs/common';
import {
  ErrorCode,
  applicationStatusLabels,
  questionnaireSchema,
  type ApplicationStatus,
} from '@club/shared';
import { Prisma } from '../generated/prisma/client.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { AuditService } from '../common/audit.service.js';
import { lockActiveUser } from '../common/active-user.js';
import { retryTransaction } from '../common/transaction-retry.js';
import { cancelFutureRegistrations } from './registration-cleanup.js';
import { ApiException } from '../common/api-exception.js';
import type { Actor } from '../common/http.js';
import { pageArgs, pageResult } from '../common/query.dto.js';
import { NotificationService } from '../notifications/notification.service.js';
import { assertDecision } from './rules.js';
import type { ApplicationDecisionDto, ApplicationQueryDto, QuestionnaireDto } from './club.dto.js';
const applicationInclude = {
  user: {
    select: {
      id: true,
      fullName: true,
      phone: true,
      email: true,
      openDayRegistrations: { where: { attended: true }, select: { id: true }, take: 1 },
    },
  },
  history: { orderBy: [{ createdAt: 'asc' }, { id: 'asc' }] },
} satisfies Prisma.CandidateApplicationInclude;
function adminApplication(
  row: Prisma.CandidateApplicationGetPayload<{ include: typeof applicationInclude }>,
) {
  const { openDayRegistrations, ...user } = row.user;
  return { ...row, user, hasOpenDayAttended: openDayRegistrations.length > 0 };
}

@Injectable()
export class ApplicationsService {
  async detail(id: string) {
    const row = await this.prisma.candidateApplication.findUniqueOrThrow({
      where: { id },
      include: applicationInclude,
    });
    return adminApplication(row);
  }
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly notifications: NotificationService,
  ) {}
  async mine(actor: Actor) {
    const row = await this.prisma.candidateApplication.upsert({
      where: { userId: actor.id },
      create: { userId: actor.id, status: 'NEW' },
      update: {},
      include: { history: { orderBy: { createdAt: 'asc' } } },
    });
    return {
      id: row.id,
      status: row.status,
      questionnaire: row.questionnaire,
      hasOpenDayAttended:
        (await this.prisma.openDayRegistration.count({
          where: { userId: actor.id, attended: true },
        })) > 0,
      history: row.history.map((item) => ({
        fromStatus: item.fromStatus,
        toStatus: item.toStatus,
        createdAt: item.createdAt,
        ...(item.toStatus === 'REJECTED' ? { comment: item.comment } : {}),
      })),
    };
  }
  async questionnaire(actor: Actor, input: QuestionnaireDto) {
    if (actor.role !== 'CANDIDATE') throw new ApiException(ErrorCode.FORBIDDEN);
    const questionnaire = questionnaireSchema.parse(input);
    await this.prisma.$transaction(async (tx) => {
      const user = await lockActiveUser(tx, actor.id);
      if (user.role !== 'CANDIDATE') throw new ApiException(ErrorCode.FORBIDDEN);
      const row = await tx.candidateApplication.upsert({
        where: { userId: actor.id },
        create: { userId: actor.id },
        update: {},
      });
      if (row.status !== 'NEW' && row.status !== 'QUESTIONNAIRE_DONE')
        throw new ApiException(ErrorCode.INVALID_TRANSITION);
      if (row.status === 'NEW') {
        await this.audit.transition(
          tx,
          actor.id,
          'CandidateApplication',
          row.id,
          'ApplicationStatus',
          row.status,
          'QUESTIONNAIRE_DONE',
        );
        await tx.applicationHistory.create({
          data: {
            applicationId: row.id,
            actorId: actor.id,
            fromStatus: 'NEW',
            toStatus: 'QUESTIONNAIRE_DONE',
          },
        });
      } else
        await this.audit.record(
          tx,
          actor.id,
          'QUESTIONNAIRE_UPDATED',
          'CandidateApplication',
          row.id,
          { fields: Object.keys(questionnaire) },
        );
      await tx.candidateApplication.update({
        where: { id: row.id },
        data: { status: 'QUESTIONNAIRE_DONE', questionnaire },
      });
    });
    return this.mine(actor);
  }
  async list(query: ApplicationQueryDto) {
    const where: Prisma.CandidateApplicationWhereInput = {
      status: query.status,
      ...(query.search
        ? { user: { fullName: { contains: query.search, mode: 'insensitive' } } }
        : {}),
    };
    const [items, total] = await Promise.all([
      this.prisma.candidateApplication.findMany({
        where,
        include: applicationInclude,
        orderBy: [{ createdAt: 'desc' }, { id: 'asc' }],
        ...pageArgs(query),
      }),
      this.prisma.candidateApplication.count({ where }),
    ]);
    return pageResult(items.map(adminApplication), total, query);
  }
  async decision(actor: Actor, id: string, dto: ApplicationDecisionDto) {
    return retryTransaction(() =>
      this.prisma.$transaction(async (tx) => {
        const initial = await tx.candidateApplication.findUnique({ where: { id } });
        if (!initial) throw new ApiException(ErrorCode.NOT_FOUND);
        await tx.$queryRaw`SELECT "id" FROM "users" WHERE "id"=${initial.userId}::uuid FOR UPDATE`;
        await tx.$queryRaw`SELECT "id" FROM "candidate_applications" WHERE "id"=${id}::uuid FOR UPDATE`;
        const row = await tx.candidateApplication.findUniqueOrThrow({
          where: { id },
          include: { user: true },
        });
        if (row.user.anonymizedAt || row.user.isBlocked)
          throw new ApiException(ErrorCode.ACCOUNT_BLOCKED);
        const attended =
          (await tx.openDayRegistration.count({ where: { userId: row.userId, attended: true } })) >
          0;
        assertDecision(dto.status, row.questionnaire, attended, dto.comment);
        this.audit.assertTransition('ApplicationStatus', row.status, dto.status);
        await this.audit.transition(
          tx,
          actor.id,
          'CandidateApplication',
          id,
          'ApplicationStatus',
          row.status,
          dto.status,
        );
        await tx.candidateApplication.update({
          where: { id },
          data: { status: dto.status, adminComment: dto.comment, reviewedById: actor.id },
        });
        await tx.applicationHistory.create({
          data: {
            applicationId: id,
            actorId: actor.id,
            fromStatus: row.status,
            toStatus: dto.status,
            comment: dto.comment,
          },
        });
        if (dto.status === 'ACCEPTED' && row.user.role === 'CANDIDATE') {
          await tx.user.update({ where: { id: row.userId }, data: { role: 'VOLUNTEER' } });
          await this.audit.record(tx, actor.id, 'ROLE_CHANGED', 'User', row.userId, {
            from: row.user.role,
            to: 'VOLUNTEER',
          });
        }
        if (
          dto.status === 'REJECTED' &&
          row.status === 'ACCEPTED' &&
          row.user.role === 'VOLUNTEER'
        ) {
          await tx.placeCurator.deleteMany({ where: { userId: row.userId } });
          await tx.user.update({ where: { id: row.userId }, data: { role: 'CANDIDATE' } });
          await this.audit.record(tx, actor.id, 'ROLE_CHANGED', 'User', row.userId, {
            from: 'VOLUNTEER',
            to: 'CANDIDATE',
          });
          await cancelFutureRegistrations(
            tx,
            this.audit,
            this.notifications,
            row.userId,
            actor.id,
            new Date(),
            'VOLUNTEER_ONLY',
          );
        }
        await this.notifications.notify(tx, [row.userId], 'ApplicationStatusChanged', {
          title: 'Заявка в Клуб волонтеров',
          statusLabel: applicationStatusLabels[dto.status as ApplicationStatus],
        });
        return adminApplication(
          await tx.candidateApplication.findUniqueOrThrow({
            where: { id },
            include: applicationInclude,
          }),
        );
      }),
    );
  }
}

import {
  createParamDecorator,
  SetMetadata,
  type ExecutionContext,
  type NestInterceptor,
  Injectable,
  type CallHandler,
} from '@nestjs/common';
import type { Request } from 'express';
import type { User } from '../generated/prisma/client.js';
import type { Observable } from 'rxjs';
import { map } from 'rxjs';
import { UserRole } from '@club/shared';

export const PUBLIC = 'club.public';
export const ROLES = 'club.roles';
export const Public = () => SetMetadata(PUBLIC, true);
export const Roles = (...roles: UserRole[]) => SetMetadata(ROLES, roles);
export type Actor = User & { sessionId: string; adminVerified: boolean };
export type AuthRequest = Request & { user?: Actor };
export const CurrentUser = createParamDecorator(
  (_data: unknown, context: ExecutionContext): Actor =>
    context.switchToHttp().getRequest<AuthRequest>().user!,
);
export const hasPrivateAccess = (user?: Pick<User, 'role'>): boolean =>
  user?.role === UserRole.VOLUNTEER || user?.role === UserRole.ADMIN;
@Injectable()
export class JsonSerializer implements NestInterceptor {
  intercept(_context: ExecutionContext, next: CallHandler): Observable<unknown> {
    return next
      .handle()
      .pipe(
        map((value: unknown) =>
          value === undefined
            ? undefined
            : (JSON.parse(
                JSON.stringify(value, (_key, item: unknown) =>
                  typeof item === 'bigint' ? item.toString() : item,
                ),
              ) as unknown),
        ),
      );
  }
}

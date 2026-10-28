import { Injectable, SetMetadata, type CanActivate, type ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { ErrorCode, UserRole } from '@club/shared';
import { isUUID } from 'class-validator';
import { AuthService } from './auth.service.js';
import { PUBLIC, ROLES, type AuthRequest } from '../common/http.js';
import { ApiException } from '../common/api-exception.js';
import { PrismaService } from '../prisma/prisma.service.js';

@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly auth: AuthService,
  ) {}
  async canActivate(context: ExecutionContext): Promise<boolean> {
    if (
      this.reflector.getAllAndOverride<boolean>(PUBLIC, [context.getHandler(), context.getClass()])
    )
      return true;
    const request = context.switchToHttp().getRequest<AuthRequest>();
    const token = /^Bearer ([^ ]+)$/i.exec(request.headers.authorization ?? '')?.[1];
    if (!token) throw new ApiException(ErrorCode.UNAUTHORIZED);
    request.user = await this.auth.authenticate(token);
    return true;
  }
}
@Injectable()
export class OptionalJwtGuard implements CanActivate {
  constructor(private readonly auth: AuthService) {}
  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<AuthRequest>();
    if (!request.headers.authorization) return true;
    const token = /^Bearer ([^ ]+)$/i.exec(request.headers.authorization)?.[1];
    if (!token) throw new ApiException(ErrorCode.UNAUTHORIZED);
    const user = await this.auth.authenticate(token);
    if (user.birthDate && user.consentAt && user.consentVersion) request.user = user;
    return true;
  }
}
@Injectable()
export class OnboardingGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}
  canActivate(context: ExecutionContext): boolean {
    if (
      this.reflector.getAllAndOverride<boolean>(PUBLIC, [context.getHandler(), context.getClass()])
    )
      return true;
    const request = context.switchToHttp().getRequest<AuthRequest>();
    if (/^\/api\/v1\/me(?:\/onboarding)?\/?$/.test(request.path)) return true;
    if (!request.user?.birthDate || !request.user.consentAt || !request.user.consentVersion)
      throw new ApiException(ErrorCode.ONBOARDING_REQUIRED);
    return true;
  }
}
@Injectable()
export class RolesGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}
  canActivate(context: ExecutionContext): boolean {
    const roles = this.reflector.getAllAndOverride<UserRole[]>(ROLES, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (!roles) return true;
    const user = context.switchToHttp().getRequest<AuthRequest>().user;
    if (!user || (user.role !== 'ADMIN' && !roles.some((role) => role === user.role)))
      throw new ApiException(ErrorCode.FORBIDDEN);
    return true;
  }
}
type CuratorTarget = 'place' | 'trip' | 'registration' | 'createTrip' | 'any';
export const CuratorScope = (target: CuratorTarget) => SetMetadata('club.curatorTarget', target);
@Injectable()
export class CuratorOfPlaceGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly prisma: PrismaService,
  ) {}
  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<AuthRequest>();
    if (request.user?.role === 'ADMIN' && request.user.adminVerified) return true;
    if (request.user?.role !== 'VOLUNTEER') throw new ApiException(ErrorCode.FORBIDDEN_PLACE);
    const target = this.reflector.getAllAndOverride<CuratorTarget>('club.curatorTarget', [
      context.getHandler(),
      context.getClass(),
    ]);
    if (target === 'any') {
      if (await this.prisma.placeCurator.count({ where: { userId: request.user.id } })) return true;
      throw new ApiException(ErrorCode.FORBIDDEN_PLACE);
    }
    const id =
      target === 'createTrip'
        ? (request.body as Record<string, unknown> | undefined)?.placeId
        : (request.params.id ?? (request.body as Record<string, unknown> | undefined)?.id);
    if (typeof id !== 'string' || !isUUID(id)) throw new ApiException(ErrorCode.VALIDATION_ERROR);
    let placeId: string | undefined;
    if (target === 'createTrip' || target === 'place') placeId = id;
    if (target === 'trip')
      placeId = (await this.prisma.trip.findUnique({ where: { id }, select: { placeId: true } }))
        ?.placeId;
    if (target === 'registration')
      placeId = (
        await this.prisma.tripRegistration.findUnique({
          where: { id },
          select: { trip: { select: { placeId: true } } },
        })
      )?.trip.placeId;
    if (
      !placeId ||
      !(await this.prisma.placeCurator.findUnique({
        where: { userId_placeId: { userId: request.user.id, placeId } },
      }))
    )
      throw new ApiException(ErrorCode.FORBIDDEN_PLACE);
    return true;
  }
}

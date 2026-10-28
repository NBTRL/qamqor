import { ArgumentsHost, Catch, HttpException, type ExceptionFilter } from '@nestjs/common';
import { ErrorCode, errorMessages, type ApiError } from '@club/shared';
import type { Response } from 'express';
import { ApiException } from './api-exception.js';
import { Prisma } from '../generated/prisma/client.js';
import { ZodError } from 'zod';

const statusCodes: Record<number, ErrorCode> = {
  400: ErrorCode.VALIDATION_ERROR,
  401: ErrorCode.UNAUTHORIZED,
  403: ErrorCode.FORBIDDEN,
  404: ErrorCode.NOT_FOUND,
  422: ErrorCode.VALIDATION_ERROR,
  429: ErrorCode.RATE_LIMITED,
};
function object(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === 'object'
    ? (value as Record<string, unknown>)
    : undefined;
}
function emailUniqueConflict(meta: Record<string, unknown> | undefined): boolean {
  // Prisma 7 + adapter-pg передает constraint в driverAdapterError.cause вместо meta.target.
  const constraint = object(object(object(meta?.driverAdapterError)?.cause)?.constraint);
  const target = meta?.target ?? constraint?.fields ?? constraint?.index;
  return Array.isArray(target)
    ? target.includes('email')
    : target === 'email' || target === 'users_email_key' || target === 'User_email_key';
}
@Catch()
export class ApiExceptionFilter implements ExceptionFilter {
  catch(exception: unknown, host: ArgumentsHost): void {
    if (
      exception &&
      typeof exception === 'object' &&
      'type' in exception &&
      [
        'entity.too.large',
        'entity.parse.failed',
        'encoding.unsupported',
        'charset.unsupported',
      ].includes(String(exception.type))
    )
      exception = new ApiException(ErrorCode.VALIDATION_ERROR);
    if (exception instanceof Prisma.PrismaClientValidationError)
      exception = new ApiException(ErrorCode.VALIDATION_ERROR);
    if (exception instanceof Prisma.PrismaClientKnownRequestError) {
      const code =
        exception.code === 'P2025'
          ? ErrorCode.NOT_FOUND
          : exception.code === 'P2034'
            ? ErrorCode.CONFLICT
            : exception.code === 'P2002'
              ? emailUniqueConflict(exception.meta)
                ? ErrorCode.EMAIL_ALREADY_USED
                : ErrorCode.CONFLICT
              : ['P2000', 'P2003', 'P2004', 'P2011', 'P2020', 'P2023'].includes(exception.code)
                ? ErrorCode.VALIDATION_ERROR
                : ErrorCode.INTERNAL_ERROR;
      exception = new ApiException(code);
    }
    if (exception instanceof ZodError)
      exception = new ApiException(ErrorCode.VALIDATION_ERROR, {
        fields: exception.issues.map((issue) => ({
          path: issue.path.map(String).join('.'),
          message: issue.message,
        })),
      });
    const statusCode = exception instanceof HttpException ? exception.getStatus() : 500;
    const code =
      exception instanceof ApiException
        ? exception.code
        : (statusCodes[statusCode] ??
          (statusCode >= 500 ? ErrorCode.INTERNAL_ERROR : ErrorCode.VALIDATION_ERROR));
    const body: ApiError = { statusCode, code, message: errorMessages[code] };
    if (exception instanceof ApiException && exception.details !== undefined)
      body.details = exception.details;
    host.switchToHttp().getResponse<Response>().status(statusCode).json(body);
  }
}

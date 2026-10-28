import { describe, expect, it, vi } from 'vitest';
import { NotFoundException, type ArgumentsHost } from '@nestjs/common';
import { ErrorCode, errorMessages, questionnaireSchema } from '@club/shared';
import { ApiExceptionFilter } from './api-exception.filter.js';
import { ApiException } from './api-exception.js';
import { ZodValidationPipe } from './zod-validation.pipe.js';
import { Prisma } from '../generated/prisma/client.js';

function responseFor(error: unknown) {
  const json = vi.fn();
  const response = { status: vi.fn().mockReturnValue({ json }) };
  const host = {
    switchToHttp: () => ({ getResponse: () => response }),
  } as unknown as ArgumentsHost;
  new ApiExceptionFilter().catch(error, host);
  return {
    status: response.status.mock.calls[0]?.[0] as number,
    body: json.mock.calls[0]?.[0] as Record<string, unknown>,
  };
}

describe('Инфраструктурные ошибки API', () => {
  it('распознает unique email в метаданных Prisma 7 без раскрытия ошибки БД', () => {
    for (const meta of [
      { target: ['email'] },
      { driverAdapterError: { cause: { constraint: { fields: ['email'] } } } },
    ]) {
      const result = responseFor(
        new Prisma.PrismaClientKnownRequestError('sensitive-database-message', {
          code: 'P2002',
          clientVersion: '7.10.1',
          meta,
        }),
      );
      expect(result.body.code).toBe(ErrorCode.EMAIL_ALREADY_USED);
      expect(JSON.stringify(result)).not.toContain('sensitive-database-message');
    }
    expect(
      responseFor(
        new Prisma.PrismaClientKnownRequestError('internal', {
          code: 'P2002',
          clientVersion: '7.10.1',
          meta: {
            driverAdapterError: { cause: { constraint: { index: 'email_tokens_tokenHash_key' } } },
          },
        }),
      ).body.code,
    ).toBe(ErrorCode.CONFLICT);
  });
  it('возвращает VALIDATION_ERROR для слишком большого JSON без исходного тела', () => {
    const result = responseFor({ type: 'entity.too.large', status: 413, body: 'private-body' });
    expect(result.status).toBe(400);
    expect(result.body.code).toBe(ErrorCode.VALIDATION_ERROR);
    expect(JSON.stringify(result)).not.toContain('private-body');
  });
  it('приводит 404 к контракту и не раскрывает внутренние ошибки', () => {
    expect(responseFor(new NotFoundException('internal path'))).toEqual({
      status: 404,
      body: { statusCode: 404, code: ErrorCode.NOT_FOUND, message: errorMessages.NOT_FOUND },
    });
    const result = responseFor(new Error('DATABASE_URL=never-disclose-this'));
    expect(result.status).toBe(500);
    expect(JSON.stringify(result.body)).not.toContain('never-disclose-this');
  });
  it('сохраняет машинный код и безопасные details', () => {
    expect(responseFor(new ApiException(ErrorCode.RATE_LIMITED, { retryAfter: 30 })).body).toEqual({
      statusCode: 429,
      code: ErrorCode.RATE_LIMITED,
      message: errorMessages.RATE_LIMITED,
      details: { retryAfter: 30 },
    });
  });
  it('валидирует анкету shared-схемой без раскрытия исходных значений', () => {
    try {
      new ZodValidationPipe(questionnaireSchema).transform({
        motivation: 'private-value',
        role: 'ADMIN',
      });
      throw new Error('Validation should fail');
    } catch (error) {
      expect(error).toBeInstanceOf(ApiException);
      const result = responseFor(error);
      expect(result.status).toBe(400);
      expect(result.body.code).toBe(ErrorCode.VALIDATION_ERROR);
      expect(JSON.stringify(result.body)).not.toContain('private-value');
    }
  });
});

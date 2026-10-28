import type { PipeTransform } from '@nestjs/common';
import type { ZodType } from 'zod';
import { ErrorCode } from '@club/shared';
import { ApiException } from './api-exception.js';

export class ZodValidationPipe<T> implements PipeTransform<unknown, T> {
  constructor(private readonly schema: ZodType<T>) {}
  transform(value: unknown): T {
    const result = this.schema.safeParse(value);
    if (!result.success)
      throw new ApiException(ErrorCode.VALIDATION_ERROR, {
        fields: result.error.issues.map((issue) => ({
          path: issue.path.map(String).join('.'),
          message: issue.message,
        })),
      });
    return result.data;
  }
}

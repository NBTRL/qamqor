import { HttpException } from '@nestjs/common';
import { ErrorCode, errorMessages, errorHttpStatus, type ApiError } from '@club/shared';

export class ApiException extends HttpException {
  constructor(
    readonly code: ErrorCode,
    readonly details?: ApiError['details'],
  ) {
    super(errorMessages[code], errorHttpStatus[code]);
  }
}

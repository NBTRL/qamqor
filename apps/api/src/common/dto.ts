import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { ErrorCode, type ApiError, type HealthResponse } from '@club/shared';

export class ApiErrorDto implements ApiError {
  @ApiProperty({ type: Number, example: 400 }) statusCode!: number;
  @ApiProperty({ enum: ErrorCode, enumName: 'ErrorCode' }) code!: ErrorCode;
  @ApiProperty({ type: String }) message!: string;
  @ApiPropertyOptional({
    type: 'object',
    additionalProperties: true,
    description: 'JSON-объект без исходных значений, PII и секретов.',
  })
  details?: ApiError['details'];
}
export class HealthResponseDto implements HealthResponse {
  @ApiProperty({ type: String, enum: ['ok'] }) status!: 'ok';
  @ApiProperty({ type: String, format: 'date-time' }) timestamp!: string;
}

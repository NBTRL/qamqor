import {
  ApiExtraModels,
  ApiOkResponse,
  ApiProperty,
  ApiPropertyOptional,
  getSchemaPath,
} from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsInt, IsOptional, IsString, Max, MaxLength, Min } from 'class-validator';
import { applyDecorators, type Type as ClassType } from '@nestjs/common';
import { DEFAULT_PAGE, DEFAULT_PAGE_LIMIT, MAX_PAGE, MAX_PAGE_LIMIT } from '@club/shared';

export class PageQueryDto {
  @ApiPropertyOptional({ default: DEFAULT_PAGE, minimum: 1, maximum: MAX_PAGE })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(MAX_PAGE)
  page: number = DEFAULT_PAGE;
  @ApiPropertyOptional({ default: DEFAULT_PAGE_LIMIT, minimum: 1, maximum: MAX_PAGE_LIMIT })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(MAX_PAGE_LIMIT)
  limit: number = DEFAULT_PAGE_LIMIT;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(100) search?: string;
}
export class PaginationMetaDto {
  @ApiProperty() total!: number;
  @ApiProperty() page!: number;
  @ApiProperty() limit!: number;
}
export const pageArgs = (query: PageQueryDto) => ({
  skip: (query.page - 1) * query.limit,
  take: query.limit,
});
export function pageResult<T>(items: T[], total: number, query: PageQueryDto) {
  return { items, total, page: query.page, limit: query.limit };
}
export function ApiPage(model: ClassType<unknown>) {
  return applyDecorators(
    ApiExtraModels(PaginationMetaDto, model),
    ApiOkResponse({
      schema: {
        allOf: [
          { $ref: getSchemaPath(PaginationMetaDto) },
          {
            type: 'object',
            properties: { items: { type: 'array', items: { $ref: getSchemaPath(model) } } },
            required: ['items'],
          },
        ],
      },
    }),
  );
}
export class OkDto {
  @ApiProperty({ enum: [true] }) ok!: true;
}
export class ResourceDto {
  @ApiProperty({ format: 'uuid' }) id!: string;
  @ApiPropertyOptional({
    additionalProperties: true,
    type: 'object',
    description: 'Поля выбранного ресурса; схемы полей описаны в DTO запроса.',
  })
  data?: Record<string, unknown>;
}

import { ValidationPipe, type ArgumentMetadata } from '@nestjs/common';

function omitUndefined(value: unknown): unknown {
  if (!value || typeof value !== 'object' || value instanceof Date) return value;
  if (Array.isArray(value)) {
    for (const item of value) omitUndefined(item);
    return value;
  }
  const record = value as Record<string, unknown>;
  for (const key of Object.keys(record)) {
    if (record[key] === undefined) delete record[key];
    else omitUndefined(record[key]);
  }
  return value;
}
// class-transformer создает поля класса со значением undefined: PATCH не должен ими затирать текущие данные.
export class StrictValidationPipe extends ValidationPipe {
  override async transform(value: unknown, metadata: ArgumentMetadata): Promise<unknown> {
    return omitUndefined(await super.transform(value, metadata));
  }
}

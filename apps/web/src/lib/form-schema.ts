import { z } from 'zod';
import definitions from './form-definitions.json';
import type { components } from './api/schema';
import { localDateTime } from './format';
import { dateTimeSchema, telegramIdSchema } from '@club/shared';
export type Definition = {
  type?: string;
  format?: string;
  nullable?: boolean;
  enum?: unknown[];
  properties?: Record<string, Definition>;
  required?: string[];
  items?: Definition;
  allOf?: Definition[];
  $ref?: string;
  minimum?: number;
  maximum?: number;
  minLength?: number;
  maxLength?: number;
  minItems?: number;
  maxItems?: number;
  pattern?: string;
  default?: unknown;
};
export const definition = (name: string): Definition =>
  (definitions as Record<string, Definition>)[name] ?? {};
export function resolve(node: Definition): Definition {
  if (node.$ref) return resolve(definition(node.$ref.split('/').pop()!));
  if (node.allOf) {
    return node.allOf.reduce<Definition>(
      (result, next) => {
        const merged = resolve(next);
        return {
          ...result,
          ...merged,
          properties: { ...result.properties, ...merged.properties },
          required: [...(result.required ?? []), ...(merged.required ?? [])],
        };
      },
      { ...node, allOf: undefined },
    );
  }
  return node;
}
function valueSchema(raw: Definition): z.ZodType {
  const node = resolve(raw);
  let schema: z.ZodType;
  if (node.enum) {
    schema = z.custom((value) => node.enum!.includes(value), 'Выберите значение из списка.');
  } else if (node.type === 'object') {
    const shape: Record<string, z.ZodType> = {};
    for (const [key, value] of Object.entries(node.properties ?? {})) {
      let field = valueSchema(value);
      if (!node.required?.includes(key)) field = field.optional();
      shape[key] = field;
    }
    schema = z.object(shape).strict();
  } else if (node.type === 'array') {
    let array = z.array(valueSchema(node.items ?? {}));
    if (node.minItems !== undefined) array = array.min(node.minItems);
    if (node.maxItems !== undefined) array = array.max(node.maxItems);
    schema = array;
  } else if (node.type === 'boolean') schema = z.boolean();
  else if (node.type === 'number' || node.type === 'integer') {
    let number = z.coerce.number();
    if (node.type === 'integer') number = number.int();
    if (node.minimum !== undefined) number = number.min(node.minimum);
    if (node.maximum !== undefined) number = number.max(node.maximum);
    schema = z.preprocess(
      (value) =>
        typeof value === 'number' || (typeof value === 'string' && value.trim())
          ? value
          : undefined,
      number,
    );
  } else {
    let text = z.string();
    if (node.format === 'uuid') text = text.uuid('Выберите запись из списка.');
    if (node.format === 'email')
      text = text.trim().toLowerCase().email('Введите корректный e-mail.');
    if (node.minLength !== undefined) text = text.min(node.minLength);
    if (node.maxLength !== undefined) text = text.max(node.maxLength);
    if (node.pattern) text = text.regex(new RegExp(node.pattern));
    schema = text;
    if (node.format === 'uri')
      schema = text.refine((value) => {
        try {
          const url = new URL(value);
          return ['http:', 'https:'].includes(url.protocol) && Boolean(url.hostname);
        } catch {
          return false;
        }
      }, 'Введите ссылку с http:// или https://.');
    if (node.format === 'date-time')
      schema = z.preprocess(
        (value) =>
          typeof value === 'string' && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(value)
            ? localDateTime(value)
            : value,
        dateTimeSchema,
      );
  }
  return node.nullable ? schema.nullable() : schema;
}
export function schemaFor<N extends keyof components['schemas'] & keyof typeof definitions>(
  name: N,
): z.ZodType<components['schemas'][N], components['schemas'][N]> {
  let schema = valueSchema(definition(name));
  if (name === 'UserCreateDto')
    schema = schema.refine(
      (value) => telegramIdSchema.safeParse((value as Record<string, unknown>).telegramId).success,
      { path: ['telegramId'], message: 'Telegram ID выходит за диапазон bigint.' },
    );
  if (name === 'DonationWriteDto')
    schema = schema.refine(
      (value) => {
        const amount = (value as Record<string, unknown>).amount;
        return (
          typeof amount === 'string' &&
          /^(?:0|[1-9]\d{0,11})(?:\.\d{1,2})?$/.test(amount) &&
          Number(amount) > 0
        );
      },
      {
        path: ['amount'],
        message: 'Укажите положительную сумму до 999999999999.99 с двумя знаками после запятой.',
      },
    );
  if (['EventWriteDto', 'EventPatchDto', 'TripCreateDto', 'TripPatchDto'].includes(name))
    schema = schema.refine(
      (value) => {
        const event = value as Record<string, unknown>;
        if (typeof event.startsAt !== 'string' || typeof event.endsAt !== 'string') return true;
        const startsAt = Date.parse(event.startsAt),
          endsAt = Date.parse(event.endsAt);
        return !Number.isFinite(startsAt) || !Number.isFinite(endsAt) || endsAt > startsAt;
      },
      { path: ['endsAt'], message: 'Время окончания должно быть позже начала.' },
    );
  return schema as z.ZodType<components['schemas'][N], components['schemas'][N]>;
}

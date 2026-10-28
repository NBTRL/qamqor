import { z } from 'zod';
import definitions from './form-definitions.json';
import type { components } from './api/schema';
import { localDateTime } from './format';
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
  } else if (node.type === 'array') schema = z.array(valueSchema(node.items ?? {}));
  else if (node.type === 'boolean') schema = z.boolean();
  else if (node.type === 'number' || node.type === 'integer') {
    let number = z.coerce.number();
    if (node.type === 'integer') number = number.int();
    if (node.minimum !== undefined) number = number.min(node.minimum);
    if (node.maximum !== undefined) number = number.max(node.maximum);
    schema = number;
  } else {
    let text = z.string();
    if (node.format === 'uuid') text = text.uuid('Выберите запись из списка.');
    if (node.minLength !== undefined) text = text.min(node.minLength);
    if (node.maxLength !== undefined) text = text.max(node.maxLength);
    if (node.pattern) text = text.regex(new RegExp(node.pattern));
    schema = text;
    if (node.format === 'date-time')
      schema = z.preprocess(
        (value) =>
          typeof value === 'string' && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(value)
            ? localDateTime(value)
            : value,
        z.iso.datetime({ offset: true }),
      );
  }
  return node.nullable ? schema.nullable() : schema;
}
export function schemaFor<N extends keyof components['schemas'] & keyof typeof definitions>(
  name: N,
): z.ZodType<components['schemas'][N], components['schemas'][N]> {
  return valueSchema(definition(name)) as z.ZodType<
    components['schemas'][N],
    components['schemas'][N]
  >;
}

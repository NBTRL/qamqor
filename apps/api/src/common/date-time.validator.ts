import { ValidateBy, type ValidationOptions } from 'class-validator';
import { dateTimeSchema } from '@club/shared';

// Validate the calendar date before any Date/Prisma conversion can normalize it.
export function IsDateTime(options?: ValidationOptions): PropertyDecorator {
  return ValidateBy(
    {
      name: 'isDateTime',
      validator: {
        validate: (value: unknown) => dateTimeSchema.safeParse(value).success,
        defaultMessage: () => '$property must be a valid ISO date-time with seconds and a timezone',
      },
    },
    options,
  );
}

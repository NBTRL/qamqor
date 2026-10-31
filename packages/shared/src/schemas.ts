import { z } from 'zod';
import {
  CONSENT_VERSION,
  DEFAULT_PAGE,
  DEFAULT_PAGE_LIMIT,
  DISPLAY_TIME_ZONE,
  HELP_AREAS,
  MAX_PAGE,
  MAX_PAGE_LIMIT,
  MIN_VOLUNTEER_AGE,
  WEEKDAYS,
} from './constants.js';
import { ErrorCode } from './errors.js';

const unique = (items: readonly string[]) => new Set(items).size === items.length;
export const emailSchema = z.string().trim().toLowerCase().max(254).pipe(z.email());
export const dateTimeSchema = z.iso.datetime({ offset: true }).regex(/T\d{2}:\d{2}:\d{2}/);
export const questionnaireSchema = z
  .object({
    motivation: z.string().trim().min(20, 'Расскажите о мотивации подробнее.').max(5000),
    volunteeringExperience: z
      .string()
      .trim()
      .min(1, 'Опишите опыт или укажите, что его пока нет.')
      .max(5000),
    helpAreas: z
      .array(z.enum(HELP_AREAS))
      .min(1, 'Выберите вариант помощи.')
      .max(HELP_AREAS.length)
      .refine(unique, 'Варианты не должны повторяться.'),
    availableWeekdays: z
      .array(z.enum(WEEKDAYS))
      .min(1, 'Выберите удобный день.')
      .max(7)
      .refine(unique, 'Дни не должны повторяться.'),
    referralSource: z.string().trim().min(1, 'Укажите, откуда вы узнали о Клубе.').max(500),
    rulesAccepted: z.literal(true, { error: 'Необходимо ознакомиться с правилами Клуба.' }),
  })
  .strict();
export type QuestionnaireInput = z.infer<typeof questionnaireSchema>;

export const contactFormSchema = z
  .object({
    name: z.string().trim().min(2).max(100),
    email: emailSchema,
    message: z.string().trim().min(10).max(5000),
    personalDataConsent: z.literal(true),
    consentVersion: z.literal(CONSENT_VERSION),
  })
  .strict();
export type ContactFormInput = z.infer<typeof contactFormSchema>;
export const contactRequestSchema = contactFormSchema
  .omit({ email: true })
  .extend({ contact: z.string().trim().min(3).max(254) })
  .strict();
export type ContactRequestInput = z.infer<typeof contactRequestSchema>;

export function moscowDate(date = new Date()): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: DISPLAY_TIME_ZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(date);
  const part = (type: string) => parts.find((item) => item.type === type)?.value ?? '';
  return `${part('year')}-${part('month')}-${part('day')}`;
}

export function createOnboardingSchema(today: () => string = moscowDate) {
  return z
    .object({
      birthDate: z.iso.date().refine(
        (value) => {
          const currentDate = today();
          const adultYear = Number(value.slice(0, 4)) + MIN_VOLUNTEER_AGE;
          const currentYear = Number(currentDate.slice(0, 4));
          return (
            adultYear < currentYear ||
            (adultYear === currentYear && value.slice(4) <= currentDate.slice(4))
          );
        },
        { message: 'Участие доступно только с 18 лет.', params: { code: ErrorCode.UNDERAGE } },
      ),
      consentVersion: z.literal(CONSENT_VERSION),
    })
    .strict();
}
export const onboardingSchema = createOnboardingSchema();
export type OnboardingInput = z.infer<typeof onboardingSchema>;
export const telegramIdSchema = z
  .string()
  .regex(/^[1-9]\d{0,18}$/, 'Telegram ID передается строкой.')
  .refine(
    (value) => /^[1-9]\d{0,18}$/.test(value) && BigInt(value) <= 9223372036854775807n,
    'Telegram ID выходит за диапазон bigint.',
  );
export const emailCodeSchema = z
  .object({ email: emailSchema, code: z.string().regex(/^\d{6}$/) })
  .strict();
export const paginationSchema = z
  .object({
    page: z.coerce.number().int().min(1).max(MAX_PAGE).default(DEFAULT_PAGE),
    limit: z.coerce.number().int().min(1).max(MAX_PAGE_LIMIT).default(DEFAULT_PAGE_LIMIT),
  })
  .strict();
export const apiErrorSchema = z
  .object({
    statusCode: z.number().int().min(400).max(599),
    code: z.enum(ErrorCode),
    message: z.string(),
    details: z.record(z.string(), z.unknown()).optional(),
  })
  .strict();

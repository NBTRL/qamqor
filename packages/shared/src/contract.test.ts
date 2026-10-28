import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import * as enums from './enums.js';
import { enumLabels } from './labels.js';
import {
  transitions,
  isTransitionAllowed,
  tripStatusTransitions,
  registrationStatusTransitions,
  applicationStatusTransitions,
  loginTokenStatusTransitions,
} from './transitions.js';
import {
  questionnaireSchema,
  createOnboardingSchema,
  moscowDate,
  telegramIdSchema,
  paginationSchema,
  emailSchema,
} from './schemas.js';
import {
  CONSENT_VERSION,
  CURATOR_PARTICIPANT_FIELDS,
  CURATOR_VISIBLE_REGISTRATION_STATUSES,
  eventCalendarColors,
} from './constants.js';
import { permissionMatrix, curatorPermissions } from './permissions.js';
import { errorMessages } from './messages.js';
import { ErrorCode, errorHttpStatus } from './errors.js';
import {
  assertProductionSafety,
  parseServerEnvironment,
  serverEnvironmentSchema,
} from './server.js';

const questionnaire = {
  motivation: 'Хочу регулярно поддерживать детей и делиться своим временем.',
  volunteeringExperience: 'Опыта пока нет.',
  helpAreas: ['EDUCATION'],
  availableWeekdays: ['SATURDAY'],
  referralSource: 'Рассказали друзья',
  rulesAccepted: true,
};

describe('Согласованность контракта', () => {
  it('покрывает все enum подписями, таблицами переходов и документацией', () => {
    const doc = readFileSync(new URL('../../../docs/CONTRACT.md', import.meta.url), 'utf8');
    for (const [name, values] of Object.entries(enums)) {
      expect(Object.keys(enumLabels[name as keyof typeof enumLabels]).sort()).toEqual(
        Object.values(values).sort(),
      );
      expect(Object.keys(transitions[name as keyof typeof transitions]).sort()).toEqual(
        Object.values(values).sort(),
      );
      expect(doc).toContain(name);
      const table = doc.split(`### ${name}\n`)[1]?.split('\n### ')[0] ?? '';
      for (const value of Object.values(values)) {
        expect(value).toBe(Object.keys(values).find((key) => key === value));
        const row = table
          .split('\n')
          .find((line) => new RegExp('^\\|\\s*' + value + '\\s*\\|').test(line));
        const columns = row?.split('|').map((column) => column.trim());
        expect(columns?.[2]).toBe(
          (enumLabels[name as keyof typeof enumLabels] as Record<string, string>)[value],
        );
        const documentedTargets = columns?.[3] === '—' ? [] : columns?.[3]?.split(/,\s*/);
        expect(documentedTargets?.sort()).toEqual(
          [
            ...(transitions[name as keyof typeof transitions] as Record<string, readonly string[]>)[
              value
            ]!,
          ].sort(),
        );
      }
    }
    expect(Object.values(enums.UserRole)).toEqual(['CANDIDATE', 'VOLUNTEER', 'ADMIN']);
  });
  it('поддерживает цикл поездки и не разрешает отменить завершенную', () => {
    const { TripStatus: T } = enums;
    for (const [from, to] of [
      [T.DRAFT, T.OPEN],
      [T.OPEN, T.CLOSED],
      [T.CLOSED, T.OPEN],
      [T.CLOSED, T.DONE],
      [T.DONE, T.REPORTED],
    ] as const)
      expect(isTransitionAllowed(tripStatusTransitions, from, to)).toBe(true);
    expect(isTransitionAllowed(tripStatusTransitions, T.DONE, T.CANCELLED)).toBe(false);
    expect(isTransitionAllowed(tripStatusTransitions, T.REPORTED, T.OPEN)).toBe(false);
  });
  it('не позволяет обойти модерацию и повторно использовать login token', () => {
    const { RegistrationStatus: R, ApplicationStatus: A, LoginTokenStatus: L } = enums;
    expect(isTransitionAllowed(registrationStatusTransitions, R.WAITLIST, R.CONFIRMED)).toBe(false);
    expect(isTransitionAllowed(registrationStatusTransitions, R.WAITLIST, R.PENDING)).toBe(true);
    expect(isTransitionAllowed(applicationStatusTransitions, A.NEW, A.ACCEPTED)).toBe(false);
    expect(isTransitionAllowed(applicationStatusTransitions, A.ACCEPTED, A.REJECTED)).toBe(true);
    expect(isTransitionAllowed(loginTokenStatusTransitions, L.PENDING, L.USED)).toBe(false);
    expect(isTransitionAllowed(loginTokenStatusTransitions, L.CONFIRMED, L.USED)).toBe(true);
    expect(loginTokenStatusTransitions.USED).toHaveLength(0);
  });
  it('ограничивает кандидата и персональную проекцию куратора', () => {
    const actions = permissionMatrix.CANDIDATE.map((grant) => grant.action);
    expect(actions).not.toContain('trip.register');
    expect(actions).not.toContain('event.register.volunteersOnly');
    expect(curatorPermissions.every((grant) => grant.scope === 'OWN_PLACE')).toBe(true);
    expect(CURATOR_PARTICIPANT_FIELDS).toEqual(['fullName', 'nickname', 'phone']);
    expect(CURATOR_VISIBLE_REGISTRATION_STATUSES).toEqual(['PENDING', 'CONFIRMED', 'WAITLIST']);
    expect(new Set(Object.values(eventCalendarColors)).size).toBe(6);
  });
  it('имеет русские сообщения и HTTP-коды для каждой ошибки', () => {
    for (const code of Object.values(ErrorCode)) {
      expect(errorMessages[code]).toMatch(/[А-Яа-яЁё]/);
      expect(errorHttpStatus[code]).toBeGreaterThanOrEqual(400);
      expect(errorHttpStatus[code]).toBeLessThan(600);
    }
  });
});

describe('Общие формы', () => {
  it('принимает анкету без опыта и отклоняет дубли, неподтвержденные правила и подмену роли', () => {
    expect(questionnaireSchema.safeParse(questionnaire).success).toBe(true);
    expect(
      questionnaireSchema.safeParse({ ...questionnaire, helpAreas: ['SPORT', 'SPORT'] }).success,
    ).toBe(false);
    expect(questionnaireSchema.safeParse({ ...questionnaire, rulesAccepted: false }).success).toBe(
      false,
    );
    expect(questionnaireSchema.safeParse({ ...questionnaire, role: 'ADMIN' }).success).toBe(false);
  });
  it('проверяет 18-летие и календарную дату по Москве', () => {
    const schema = createOnboardingSchema(() => '2026-10-27');
    const form = { consentVersion: CONSENT_VERSION };
    expect(schema.safeParse({ ...form, birthDate: '2008-10-27' }).success).toBe(true);
    expect(schema.safeParse({ ...form, birthDate: '2008-10-28' }).success).toBe(false);
    expect(schema.safeParse({ ...form, birthDate: '2000-02-30' }).success).toBe(false);
    expect(
      schema.safeParse({ ...form, birthDate: '2000-01-01', consentVersion: 'outdated' }).success,
    ).toBe(false);
    expect(moscowDate(new Date('2026-10-26T21:01:00.000Z'))).toBe('2026-10-27');
  });
  it('сохраняет точность bigint, безопасно отклоняет нечисловые ID и нормализует e-mail', () => {
    expect(telegramIdSchema.parse('9223372036854775807')).toBe('9223372036854775807');
    for (const value of [123, 'abc', '0', '-1', '9223372036854775808'])
      expect(telegramIdSchema.safeParse(value).success).toBe(false);
    expect(emailSchema.parse(' TEST@EXAMPLE.COM ')).toBe('test@example.com');
    expect(paginationSchema.parse({})).toEqual({ page: 1, limit: 20 });
    expect(paginationSchema.safeParse({ page: '0', limit: '101' }).success).toBe(false);
  });
  it.each(['2026-10-28', '2040-01-01', '9982-01-01', '9999-12-31'])(
    'отклоняет будущую дату рождения %s',
    (birthDate) => {
      const schema = createOnboardingSchema(() => '2026-10-27');
      expect(
        schema.safeParse({
          birthDate,
          consentVersion: CONSENT_VERSION,
        }).success,
      ).toBe(false);
    },
  );
  it('считает 18-летие родившихся 29 февраля с 1 марта невисокосного года', () => {
    const form = {
      birthDate: '2008-02-29',
      consentVersion: CONSENT_VERSION,
    };
    expect(createOnboardingSchema(() => '2026-02-28').safeParse(form).success).toBe(false);
    expect(createOnboardingSchema(() => '2026-03-01').safeParse(form).success).toBe(true);
  });
});

describe('Конфигурация', () => {
  it('использует общую проверку bigint и нормализацию e-mail для ADMIN_*', () => {
    expect(serverEnvironmentSchema.shape.ADMIN_TELEGRAM_ID.parse('9223372036854775807')).toBe(
      '9223372036854775807',
    );
    expect(
      serverEnvironmentSchema.shape.ADMIN_TELEGRAM_ID.safeParse('9223372036854775808').success,
    ).toBe(false);
    expect(serverEnvironmentSchema.shape.ADMIN_EMAIL.parse(' ADMIN@EXAMPLE.COM ')).toBe(
      'admin@example.com',
    );
  });
  it('блокирует fake Telegram в production и не раскрывает секреты в ошибках env', () => {
    expect(() =>
      assertProductionSafety({ NODE_ENV: 'production', DEV_FAKE_TELEGRAM: 'true' }),
    ).toThrow();
    expect(() =>
      assertProductionSafety({ NODE_ENV: 'production', DEV_FAKE_TELEGRAM: ' TRUE ' }),
    ).toThrow();
    expect(() =>
      assertProductionSafety({ NODE_ENV: 'production', DEV_FAKE_TELEGRAM: 'false' }),
    ).not.toThrow();
    expect(() =>
      assertProductionSafety({ NODE_ENV: 'development', DEV_FAKE_TELEGRAM: 'true' }),
    ).not.toThrow();
    expect(() => parseServerEnvironment({ JWT_SECRET: 'never-print-this' })).toThrow(/JWT_SECRET/);
    try {
      parseServerEnvironment({ JWT_SECRET: 'never-print-this' });
    } catch (error) {
      expect(String(error)).not.toContain('never-print-this');
    }
  });
});

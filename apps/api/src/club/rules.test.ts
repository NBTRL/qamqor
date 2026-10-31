import { describe, expect, it } from 'vitest';
import { ApplicationStatus, ErrorCode, RegistrationStatus } from '@club/shared';
import { ApiException } from '../common/api-exception.js';
import {
  assertDecision,
  assertEventRegistration,
  assertFreePlace,
  assertTripRegistration,
  initialTripRegistration,
} from './rules.js';
import { AuditService } from '../common/audit.service.js';
const future = new Date(Date.now() + 86400000);
const questionnaire = {
  motivation: 'Хочу регулярно помогать и делиться полезными знаниями.',
  volunteeringExperience: 'Опыта пока нет.',
  helpAreas: ['EDUCATION'],
  availableWeekdays: ['SATURDAY'],
  referralSource: 'Друзья',
  rulesAccepted: true,
};
const code = (action: () => unknown) => {
  try {
    action();
    throw new Error('Ожидалась ошибка');
  } catch (error) {
    expect(error).toBeInstanceOf(ApiException);
    return (error as ApiException).code;
  }
};
describe('Правила поездок и кандидатов', () => {
  it('пускает на поездку только волонтера/администратора до начала открытой поездки', () => {
    expect(() => assertTripRegistration('VOLUNTEER', 'OPEN', future, false)).not.toThrow();
    expect(() => assertTripRegistration('ADMIN', 'OPEN', future, false)).not.toThrow();
    expect(code(() => assertTripRegistration('CANDIDATE', 'OPEN', future, false))).toBe(
      ErrorCode.FORBIDDEN,
    );
    expect(code(() => assertTripRegistration('VOLUNTEER', 'CLOSED', future, false))).toBe(
      ErrorCode.TRIP_NOT_OPEN,
    );
    expect(code(() => assertTripRegistration('VOLUNTEER', 'OPEN', new Date(0), false))).toBe(
      ErrorCode.TRIP_NOT_OPEN,
    );
  });
  it('отклоняет повторную запись и выбирает PENDING/WAITLIST по распределенным местам', () => {
    expect(code(() => assertTripRegistration('VOLUNTEER', 'OPEN', future, true))).toBe(
      ErrorCode.TRIP_ALREADY_REGISTERED,
    );
    expect(initialTripRegistration(0, 1)).toBe(RegistrationStatus.PENDING);
    expect(initialTripRegistration(1, 1)).toBe(RegistrationStatus.WAITLIST);
    expect(initialTripRegistration(2, 1)).toBe(RegistrationStatus.WAITLIST);
  });
  it('не подтверждает участника без места', () => {
    expect(() => assertFreePlace(0, 1)).not.toThrow();
    expect(code(() => assertFreePlace(1, 1))).toBe(ErrorCode.TRIP_FULL);
  });
  it('требует анкету и посещение ДОД для обоих решений', () => {
    for (const status of [ApplicationStatus.INTERVIEW, ApplicationStatus.ACCEPTED]) {
      expect(code(() => assertDecision(status, null, true))).toBe(ErrorCode.OPEN_DAY_REQUIRED);
      expect(code(() => assertDecision(status, questionnaire, false))).toBe(
        ErrorCode.OPEN_DAY_REQUIRED,
      );
      expect(() => assertDecision(status, questionnaire, true)).not.toThrow();
    }
    expect(code(() => assertDecision('REJECTED', questionnaire, true))).toBe(
      ErrorCode.VALIDATION_ERROR,
    );
  });
  it('не разрешает кандидату мероприятие только для волонтеров', () => {
    expect(code(() => assertEventRegistration('CANDIDATE', true))).toBe(
      ErrorCode.EVENT_VOLUNTEERS_ONLY,
    );
    expect(() => assertEventRegistration('CANDIDATE', false)).not.toThrow();
    expect(() => assertEventRegistration('VOLUNTEER', true)).not.toThrow();
  });
  it('единый сервис отвергает обход модерации и терминальные переходы', () => {
    const audit = new AuditService();
    expect(code(() => audit.assertTransition('RegistrationStatus', 'WAITLIST', 'CONFIRMED'))).toBe(
      ErrorCode.INVALID_TRANSITION,
    );
    expect(code(() => audit.assertTransition('TripStatus', 'REPORTED', 'OPEN'))).toBe(
      ErrorCode.INVALID_TRANSITION,
    );
    expect(() => audit.assertTransition('RegistrationStatus', 'WAITLIST', 'PENDING')).not.toThrow();
  });
});

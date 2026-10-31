import {
  ApplicationStatus,
  ErrorCode,
  EventType,
  RegistrationStatus,
  UserRole,
  questionnaireSchema,
} from '@club/shared';
import { ApiException } from '../common/api-exception.js';

export function assertTripRegistration(
  role: string,
  status: string,
  startsAt: Date,
  existing: boolean,
): void {
  if (role !== UserRole.VOLUNTEER && role !== UserRole.ADMIN)
    throw new ApiException(ErrorCode.FORBIDDEN);
  if (existing) throw new ApiException(ErrorCode.TRIP_ALREADY_REGISTERED);
  if (status !== 'OPEN' || startsAt.getTime() <= Date.now())
    throw new ApiException(ErrorCode.TRIP_NOT_OPEN);
}
export function initialTripRegistration(occupied: number, capacity: number): RegistrationStatus {
  return occupied < capacity ? RegistrationStatus.PENDING : RegistrationStatus.WAITLIST;
}
export function assertFreePlace(confirmed: number, capacity: number): void {
  if (confirmed >= capacity) throw new ApiException(ErrorCode.TRIP_FULL);
}
export function assertDecision(
  status: string,
  questionnaire: unknown,
  attended: boolean,
  comment?: string,
): void {
  if (
    (status === ApplicationStatus.INTERVIEW || status === ApplicationStatus.ACCEPTED) &&
    (!questionnaireSchema.safeParse(questionnaire).success || !attended)
  )
    throw new ApiException(ErrorCode.OPEN_DAY_REQUIRED);
  if (status === ApplicationStatus.REJECTED && !comment?.trim())
    throw new ApiException(ErrorCode.VALIDATION_ERROR, { reason: 'Укажите причину отказа.' });
}
export function assertEventRegistration(role: string, volunteersOnly: boolean): void {
  if (volunteersOnly && role !== UserRole.VOLUNTEER && role !== UserRole.ADMIN)
    throw new ApiException(ErrorCode.EVENT_VOLUNTEERS_ONLY);
}
export function assertEventType(type: string): void {
  if (type === EventType.TRIP)
    throw new ApiException(ErrorCode.VALIDATION_ERROR, {
      reason: 'TRIP предназначен только для отображения поездок.',
    });
}
export function assertDates(startsAt: Date, endsAt: Date): void {
  if (
    !Number.isFinite(startsAt.getTime()) ||
    !Number.isFinite(endsAt.getTime()) ||
    endsAt <= startsAt
  )
    throw new ApiException(ErrorCode.VALIDATION_ERROR, {
      reason: 'Время окончания должно быть позже начала.',
    });
}

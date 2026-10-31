import { EventType, RegistrationStatus } from './enums.js';

export const CONTRACT_VERSION = '1.1.0';
export const CONSENT_VERSION = '2026-10-27.v1';
export const API_PREFIX = '/api/v1';
export const SWAGGER_PATH = '/api/docs';
export const DISPLAY_TIME_ZONE = 'Europe/Moscow';
export const ACCESS_TOKEN_TTL_SECONDS = 15 * 60;
export const REFRESH_TOKEN_TTL_SECONDS = 30 * 24 * 60 * 60;
export const LOGIN_TOKEN_TTL_SECONDS = 5 * 60;
export const EMAIL_CODE_TTL_SECONDS = 5 * 60;
export const ADMIN_CODE_TTL_SECONDS = 10 * 60;
export const EMAIL_CODE_MAX_ATTEMPTS = 5;
export const REFRESH_COOKIE_NAME = 'club_refresh';
export const ADMIN_CHALLENGE_COOKIE_NAME = 'club_admin_challenge';
export const NOTIFICATION_TYPES = [
  'ApplicationStatusChanged',
  'RegistrationConfirmed',
  'RegistrationRejected',
  'RegistrationWaitlisted',
  'RegistrationPromotedFromWaitlist',
  'RegistrationCancelled',
  'TripCancelled',
  'TripRescheduled',
  'TripReminder24h',
  'TripReminder3h',
  'NewRegistrationForCurator',
  'ReportRequestedFromCurator',
  'OpenDayReminder',
  'EventRegistered',
  'EventCancelled',
  'OpenDayRegistered',
  'EventRescheduled',
  'OpenDayRescheduled',
] as const;
export type NotificationType = (typeof NOTIFICATION_TYPES)[number];
export const UPLOAD_IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/webp'] as const;
export const UPLOAD_IMAGE_MAX_BYTES = 10 * 1024 * 1024;
export const UPLOAD_PDF_MAX_BYTES = 20 * 1024 * 1024;
export const DEFAULT_PAGE = 1;
export const DEFAULT_PAGE_LIMIT = 20;
export const MAX_PAGE_LIMIT = 100;
// Keep every allowed (page - 1) * limit within Prisma's signed 32-bit skip range.
export const MAX_PAGE = Math.floor(2_147_483_647 / MAX_PAGE_LIMIT) + 1;
export const STAT_KEYS = [
  'places',
  'curators',
  'events12Months',
  'masterClasses12Months',
  'uniqueParticipants12Months',
  'beneficiaries',
  'trips',
] as const;
export const MIN_VOLUNTEER_AGE = 18;
export const ONBOARDING_ALLOWED_PATHS = ['/me', '/me/onboarding', '/auth/*', '/public/*'] as const;

export const eventCalendarColors = {
  [EventType.TRIP]: '#5B4BDB',
  [EventType.CHARITY_ACTION]: '#D48A0B',
  [EventType.CLUB_EVENT]: '#E47B91',
  [EventType.MASTER_CLASS]: '#4596C1',
  [EventType.SEMINAR]: '#9B70CC',
  [EventType.LEISURE]: '#E16845',
} as const satisfies Record<EventType, string>;

export const CURATOR_PARTICIPANT_FIELDS = ['fullName', 'nickname', 'phone'] as const;
export const CURATOR_VISIBLE_REGISTRATION_STATUSES = [
  RegistrationStatus.PENDING,
  RegistrationStatus.CONFIRMED,
  RegistrationStatus.WAITLIST,
] as const;
export const HELP_AREAS = [
  'CREATIVE',
  'SPORT',
  'EDUCATION',
  'EVENTS',
  'LOGISTICS',
  'HOUSEHOLD',
  'OTHER',
] as const;
export const helpAreaLabels: Record<(typeof HELP_AREAS)[number], string> = {
  CREATIVE: 'Творчество',
  SPORT: 'Спорт',
  EDUCATION: 'Обучение',
  EVENTS: 'Организация событий',
  LOGISTICS: 'Транспорт и логистика',
  HOUSEHOLD: 'Бытовая помощь',
  OTHER: 'Другое',
};
export const WEEKDAYS = [
  'MONDAY',
  'TUESDAY',
  'WEDNESDAY',
  'THURSDAY',
  'FRIDAY',
  'SATURDAY',
  'SUNDAY',
] as const;
export const weekdayLabels: Record<(typeof WEEKDAYS)[number], string> = {
  MONDAY: 'Понедельник',
  TUESDAY: 'Вторник',
  WEDNESDAY: 'Среда',
  THURSDAY: 'Четверг',
  FRIDAY: 'Пятница',
  SATURDAY: 'Суббота',
  SUNDAY: 'Воскресенье',
};

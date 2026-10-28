import { UserRole } from './enums.js';

export type PermissionScope = 'PUBLIC' | 'SELF' | 'ALL' | 'OWN_PLACE';
export type PermissionAction =
  | 'public.read'
  | 'contact.create'
  | 'auth.telegram'
  | 'auth.email'
  | 'onboarding.complete'
  | 'questionnaire.write'
  | 'openDay.register'
  | 'event.register.public'
  | 'event.register.volunteersOnly'
  | 'trip.register'
  | 'place.private.read'
  | 'profile.write'
  | 'notification.preferences.write'
  | 'trip.create'
  | 'trip.update'
  | 'trip.registrations.moderate'
  | 'trip.attendance.write'
  | 'trip.report.write'
  | 'place.needs.write'
  | 'trip.participants.read'
  | '*';
export interface PermissionGrant {
  action: PermissionAction;
  scope: PermissionScope;
}
const guest = [
  { action: 'public.read', scope: 'PUBLIC' },
  { action: 'contact.create', scope: 'PUBLIC' },
  { action: 'auth.telegram', scope: 'PUBLIC' },
  { action: 'auth.email', scope: 'PUBLIC' },
] as const satisfies readonly PermissionGrant[];
const candidate = [
  ...guest,
  { action: 'onboarding.complete', scope: 'SELF' },
  { action: 'questionnaire.write', scope: 'SELF' },
  { action: 'openDay.register', scope: 'SELF' },
  { action: 'event.register.public', scope: 'SELF' },
  { action: 'profile.write', scope: 'SELF' },
  { action: 'notification.preferences.write', scope: 'SELF' },
] as const satisfies readonly PermissionGrant[];
const volunteer = [
  ...candidate,
  { action: 'trip.register', scope: 'SELF' },
  { action: 'event.register.volunteersOnly', scope: 'SELF' },
  { action: 'place.private.read', scope: 'ALL' },
] as const satisfies readonly PermissionGrant[];

// Метаданные прав; не заменяют серверные guards и проверки текущего состояния.
export const permissionMatrix = {
  GUEST: guest,
  [UserRole.CANDIDATE]: candidate,
  [UserRole.VOLUNTEER]: volunteer,
  [UserRole.ADMIN]: [{ action: '*', scope: 'ALL' }],
} as const satisfies Record<'GUEST' | UserRole, readonly PermissionGrant[]>;

// VOLUNTEER + PlaceCurator. Регион и отдельная роль CURATOR здесь не используются.
export const curatorPermissions = [
  { action: 'trip.create', scope: 'OWN_PLACE' },
  { action: 'trip.update', scope: 'OWN_PLACE' },
  { action: 'trip.registrations.moderate', scope: 'OWN_PLACE' },
  { action: 'trip.attendance.write', scope: 'OWN_PLACE' },
  { action: 'trip.report.write', scope: 'OWN_PLACE' },
  { action: 'place.needs.write', scope: 'OWN_PLACE' },
  { action: 'trip.participants.read', scope: 'OWN_PLACE' },
] as const satisfies readonly PermissionGrant[];

import {
  PlaceType,
  UserRole,
  ApplicationStatus,
  TripStatus,
  RegistrationStatus,
  EventType,
  NewsStatus,
  ContactRequestStatus,
  NotificationChannel,
  NotificationStatus,
  LoginTokenStatus,
} from './enums.js';

export type TransitionTable<T extends string> = Readonly<Record<T, readonly T[]>>;

export const placeTypeTransitions = {
  [PlaceType.ORPHANAGE]: [],
  [PlaceType.BOARDING_SCHOOL]: [],
  [PlaceType.ADULT_BOARDING]: [],
  [PlaceType.YARD_PROGRAM]: [],
} as const satisfies TransitionTable<PlaceType>;

export const userRoleTransitions = {
  [UserRole.CANDIDATE]: [],
  [UserRole.VOLUNTEER]: [],
  [UserRole.ADMIN]: [],
} as const satisfies TransitionTable<UserRole>;

export const applicationStatusTransitions = {
  [ApplicationStatus.NEW]: [ApplicationStatus.QUESTIONNAIRE_DONE, ApplicationStatus.REJECTED],
  [ApplicationStatus.QUESTIONNAIRE_DONE]: [
    ApplicationStatus.INTERVIEW,
    ApplicationStatus.ACCEPTED,
    ApplicationStatus.REJECTED,
  ],
  [ApplicationStatus.INTERVIEW]: [ApplicationStatus.ACCEPTED, ApplicationStatus.REJECTED],
  [ApplicationStatus.ACCEPTED]: [ApplicationStatus.REJECTED],
  [ApplicationStatus.REJECTED]: [],
} as const satisfies TransitionTable<ApplicationStatus>;

export const tripStatusTransitions = {
  [TripStatus.DRAFT]: [TripStatus.OPEN, TripStatus.CANCELLED],
  [TripStatus.OPEN]: [TripStatus.CLOSED, TripStatus.CANCELLED],
  [TripStatus.CLOSED]: [TripStatus.DONE, TripStatus.CANCELLED, TripStatus.OPEN],
  [TripStatus.DONE]: [TripStatus.REPORTED],
  [TripStatus.REPORTED]: [],
  [TripStatus.CANCELLED]: [],
} as const satisfies TransitionTable<TripStatus>;

export const registrationStatusTransitions = {
  [RegistrationStatus.PENDING]: [
    RegistrationStatus.CONFIRMED,
    RegistrationStatus.REJECTED,
    RegistrationStatus.CANCELLED,
  ],
  [RegistrationStatus.CONFIRMED]: [
    RegistrationStatus.CANCELLED,
    RegistrationStatus.ATTENDED,
    RegistrationStatus.NO_SHOW,
  ],
  [RegistrationStatus.WAITLIST]: [RegistrationStatus.PENDING, RegistrationStatus.CANCELLED],
  [RegistrationStatus.REJECTED]: [],
  [RegistrationStatus.CANCELLED]: [],
  [RegistrationStatus.ATTENDED]: [],
  [RegistrationStatus.NO_SHOW]: [],
} as const satisfies TransitionTable<RegistrationStatus>;

export const eventTypeTransitions = {
  [EventType.CHARITY_ACTION]: [],
  [EventType.CLUB_EVENT]: [],
  [EventType.MASTER_CLASS]: [],
  [EventType.SEMINAR]: [],
  [EventType.LEISURE]: [],
  [EventType.TRIP]: [],
} as const satisfies TransitionTable<EventType>;

export const newsStatusTransitions = {
  [NewsStatus.DRAFT]: [NewsStatus.PUBLISHED, NewsStatus.ARCHIVED],
  [NewsStatus.PUBLISHED]: [NewsStatus.ARCHIVED],
  [NewsStatus.ARCHIVED]: [NewsStatus.DRAFT],
} as const satisfies TransitionTable<NewsStatus>;

export const contactRequestStatusTransitions = {
  [ContactRequestStatus.NEW]: [ContactRequestStatus.IN_PROGRESS, ContactRequestStatus.DONE],
  [ContactRequestStatus.IN_PROGRESS]: [ContactRequestStatus.DONE],
  [ContactRequestStatus.DONE]: [],
} as const satisfies TransitionTable<ContactRequestStatus>;

export const notificationChannelTransitions = {
  [NotificationChannel.TELEGRAM]: [],
  [NotificationChannel.EMAIL]: [],
  [NotificationChannel.IN_APP]: [],
} as const satisfies TransitionTable<NotificationChannel>;

export const notificationStatusTransitions = {
  [NotificationStatus.QUEUED]: [NotificationStatus.SENT, NotificationStatus.FAILED],
  [NotificationStatus.SENT]: [],
  [NotificationStatus.FAILED]: [NotificationStatus.QUEUED],
} as const satisfies TransitionTable<NotificationStatus>;

export const loginTokenStatusTransitions = {
  [LoginTokenStatus.PENDING]: [
    LoginTokenStatus.CONTACT_RECEIVED,
    LoginTokenStatus.DECLINED,
    LoginTokenStatus.EXPIRED,
  ],
  [LoginTokenStatus.CONTACT_RECEIVED]: [
    LoginTokenStatus.CONFIRMED,
    LoginTokenStatus.DECLINED,
    LoginTokenStatus.EXPIRED,
  ],
  [LoginTokenStatus.CONFIRMED]: [LoginTokenStatus.USED],
  [LoginTokenStatus.USED]: [],
  [LoginTokenStatus.EXPIRED]: [],
  [LoginTokenStatus.DECLINED]: [],
} as const satisfies TransitionTable<LoginTokenStatus>;

// У классификаторов нет lifecycle: их таблицы намеренно пусты.
export const transitions = {
  PlaceType: placeTypeTransitions,
  UserRole: userRoleTransitions,
  ApplicationStatus: applicationStatusTransitions,
  TripStatus: tripStatusTransitions,
  RegistrationStatus: registrationStatusTransitions,
  EventType: eventTypeTransitions,
  NewsStatus: newsStatusTransitions,
  ContactRequestStatus: contactRequestStatusTransitions,
  NotificationChannel: notificationChannelTransitions,
  NotificationStatus: notificationStatusTransitions,
  LoginTokenStatus: loginTokenStatusTransitions,
} as const;
export function isTransitionAllowed<T extends string>(
  table: TransitionTable<T>,
  from: T,
  to: T,
): boolean {
  return table[from].includes(to);
}

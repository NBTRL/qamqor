// Строковые значения являются частью публичного контракта.

export enum PlaceType {
  ORPHANAGE = 'ORPHANAGE',
  BOARDING_SCHOOL = 'BOARDING_SCHOOL',
  ADULT_BOARDING = 'ADULT_BOARDING',
  YARD_PROGRAM = 'YARD_PROGRAM',
}

export enum UserRole {
  CANDIDATE = 'CANDIDATE',
  VOLUNTEER = 'VOLUNTEER',
  ADMIN = 'ADMIN',
}

export enum ApplicationStatus {
  NEW = 'NEW',
  QUESTIONNAIRE_DONE = 'QUESTIONNAIRE_DONE',
  INTERVIEW = 'INTERVIEW',
  ACCEPTED = 'ACCEPTED',
  REJECTED = 'REJECTED',
}

export enum TripStatus {
  DRAFT = 'DRAFT',
  OPEN = 'OPEN',
  CLOSED = 'CLOSED',
  DONE = 'DONE',
  REPORTED = 'REPORTED',
  CANCELLED = 'CANCELLED',
}

export enum RegistrationStatus {
  PENDING = 'PENDING',
  CONFIRMED = 'CONFIRMED',
  WAITLIST = 'WAITLIST',
  REJECTED = 'REJECTED',
  CANCELLED = 'CANCELLED',
  ATTENDED = 'ATTENDED',
  NO_SHOW = 'NO_SHOW',
}

export enum EventType {
  CHARITY_ACTION = 'CHARITY_ACTION',
  CLUB_EVENT = 'CLUB_EVENT',
  MASTER_CLASS = 'MASTER_CLASS',
  SEMINAR = 'SEMINAR',
  LEISURE = 'LEISURE',
  TRIP = 'TRIP',
}

export enum NewsStatus {
  DRAFT = 'DRAFT',
  PUBLISHED = 'PUBLISHED',
  ARCHIVED = 'ARCHIVED',
}

export enum ContactRequestStatus {
  NEW = 'NEW',
  IN_PROGRESS = 'IN_PROGRESS',
  DONE = 'DONE',
}

export enum NotificationChannel {
  TELEGRAM = 'TELEGRAM',
  EMAIL = 'EMAIL',
  IN_APP = 'IN_APP',
}

export enum NotificationStatus {
  QUEUED = 'QUEUED',
  SENT = 'SENT',
  FAILED = 'FAILED',
}

export enum LoginTokenStatus {
  PENDING = 'PENDING',
  CONTACT_RECEIVED = 'CONTACT_RECEIVED',
  CONFIRMED = 'CONFIRMED',
  USED = 'USED',
  EXPIRED = 'EXPIRED',
  DECLINED = 'DECLINED',
}

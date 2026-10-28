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

export const placeTypeLabels = {
  [PlaceType.ORPHANAGE]: 'Детский дом',
  [PlaceType.BOARDING_SCHOOL]: 'Школа-интернат',
  [PlaceType.ADULT_BOARDING]: 'Интернат для взрослых',
  [PlaceType.YARD_PROGRAM]: 'Дворовая программа',
} as const satisfies Record<PlaceType, string>;

export const userRoleLabels = {
  [UserRole.CANDIDATE]: 'Кандидат',
  [UserRole.VOLUNTEER]: 'Волонтер',
  [UserRole.ADMIN]: 'Администратор',
} as const satisfies Record<UserRole, string>;

export const applicationStatusLabels = {
  [ApplicationStatus.NEW]: 'Новая',
  [ApplicationStatus.QUESTIONNAIRE_DONE]: 'Анкета заполнена',
  [ApplicationStatus.INTERVIEW]: 'Собеседование',
  [ApplicationStatus.ACCEPTED]: 'Принята',
  [ApplicationStatus.REJECTED]: 'Отклонена',
} as const satisfies Record<ApplicationStatus, string>;

export const tripStatusLabels = {
  [TripStatus.DRAFT]: 'Черновик',
  [TripStatus.OPEN]: 'Запись открыта',
  [TripStatus.CLOSED]: 'Запись закрыта',
  [TripStatus.DONE]: 'Проведена',
  [TripStatus.REPORTED]: 'Отчет опубликован',
  [TripStatus.CANCELLED]: 'Отменена',
} as const satisfies Record<TripStatus, string>;

export const registrationStatusLabels = {
  [RegistrationStatus.PENDING]: 'Ожидает подтверждения',
  [RegistrationStatus.CONFIRMED]: 'Подтверждена',
  [RegistrationStatus.WAITLIST]: 'Лист ожидания',
  [RegistrationStatus.REJECTED]: 'Отклонена',
  [RegistrationStatus.CANCELLED]: 'Отменена',
  [RegistrationStatus.ATTENDED]: 'Участвовал',
  [RegistrationStatus.NO_SHOW]: 'Не пришел',
} as const satisfies Record<RegistrationStatus, string>;

export const eventTypeLabels = {
  [EventType.CHARITY_ACTION]: 'Акция Клуба',
  [EventType.CLUB_EVENT]: 'Мероприятие Клуба',
  [EventType.MASTER_CLASS]: 'Мастер-класс',
  [EventType.SEMINAR]: 'Семинар',
  [EventType.LEISURE]: 'Отдых и общение',
  [EventType.TRIP]: 'Поездка',
} as const satisfies Record<EventType, string>;

export const newsStatusLabels = {
  [NewsStatus.DRAFT]: 'Черновик',
  [NewsStatus.PUBLISHED]: 'Опубликована',
  [NewsStatus.ARCHIVED]: 'В архиве',
} as const satisfies Record<NewsStatus, string>;

export const contactRequestStatusLabels = {
  [ContactRequestStatus.NEW]: 'Новое',
  [ContactRequestStatus.IN_PROGRESS]: 'В работе',
  [ContactRequestStatus.DONE]: 'Обработано',
} as const satisfies Record<ContactRequestStatus, string>;

export const notificationChannelLabels = {
  [NotificationChannel.TELEGRAM]: 'Telegram',
  [NotificationChannel.EMAIL]: 'Электронная почта',
  [NotificationChannel.IN_APP]: 'В приложении',
} as const satisfies Record<NotificationChannel, string>;

export const notificationStatusLabels = {
  [NotificationStatus.QUEUED]: 'В очереди',
  [NotificationStatus.SENT]: 'Отправлено',
  [NotificationStatus.FAILED]: 'Ошибка отправки',
} as const satisfies Record<NotificationStatus, string>;

export const loginTokenStatusLabels = {
  [LoginTokenStatus.PENDING]: 'Ожидает контакта',
  [LoginTokenStatus.CONTACT_RECEIVED]: 'Контакт получен',
  [LoginTokenStatus.CONFIRMED]: 'Подтвержден в Telegram',
  [LoginTokenStatus.USED]: 'Использован',
  [LoginTokenStatus.EXPIRED]: 'Срок истек',
  [LoginTokenStatus.DECLINED]: 'Отклонен',
} as const satisfies Record<LoginTokenStatus, string>;

export const mediaTypeLabels = { PHOTO: 'Фото', VIDEO: 'Видео' } as const;
export const enumLabels = {
  MediaType: mediaTypeLabels,
  PlaceType: placeTypeLabels,
  UserRole: userRoleLabels,
  ApplicationStatus: applicationStatusLabels,
  TripStatus: tripStatusLabels,
  RegistrationStatus: registrationStatusLabels,
  EventType: eventTypeLabels,
  NewsStatus: newsStatusLabels,
  ContactRequestStatus: contactRequestStatusLabels,
  NotificationChannel: notificationChannelLabels,
  NotificationStatus: notificationStatusLabels,
  LoginTokenStatus: loginTokenStatusLabels,
} as const;

export const notificationTypeLabels: Record<import('./constants.js').NotificationType, string> = {
  ApplicationStatusChanged: 'Статус анкеты',
  RegistrationConfirmed: 'Запись подтверждена',
  RegistrationRejected: 'Запись отклонена',
  RegistrationWaitlisted: 'Лист ожидания',
  RegistrationPromotedFromWaitlist: 'Место освободилось',
  RegistrationCancelled: 'Запись отменена',
  TripCancelled: 'Поездка отменена',
  TripRescheduled: 'Поездка перенесена',
  TripReminder24h: 'Поездка через сутки',
  TripReminder3h: 'Поездка через 3 часа',
  NewRegistrationForCurator: 'Новая заявка на поездку',
  ReportRequestedFromCurator: 'Напоминание об отчете',
  OpenDayReminder: 'Напоминание о Дне открытых дверей',
  EventRegistered: 'Запись на мероприятие',
  EventCancelled: 'Отмена мероприятия',
  OpenDayRegistered: 'Запись на День открытых дверей',
};

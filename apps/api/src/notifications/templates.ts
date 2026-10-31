import { DISPLAY_TIME_ZONE, type NotificationType } from '@club/shared';
import type { Prisma } from '../generated/prisma/client.js';

export function notificationMessage(
  type: NotificationType,
  payload: Prisma.JsonValue,
  webUrl: string,
): { subject: string; text: string } {
  const data = payload && typeof payload === 'object' && !Array.isArray(payload) ? payload : {};
  const title = typeof data.title === 'string' ? data.title : 'Событие Клуба';
  const formatDate = (value: Prisma.JsonValue | undefined) => {
    const parsed = typeof value === 'string' ? new Date(value) : null;
    return parsed && !Number.isNaN(parsed.getTime())
      ? new Intl.DateTimeFormat('ru-RU', {
          timeZone: DISPLAY_TIME_ZONE,
          dateStyle: 'long',
          timeStyle: 'short',
        }).format(parsed)
      : '';
  };
  const date = formatDate(data.startsAt);
  const end = formatDate(data.endsAt);
  const location =
    typeof data.location === 'string' && data.location ? `\nМесто: ${data.location}` : '';
  const subjects: Record<NotificationType, string> = {
    ApplicationStatusChanged: 'Изменился статус вашей заявки',
    RegistrationConfirmed: 'Запись на поездку подтверждена',
    RegistrationRejected: 'Запись на поездку отклонена',
    RegistrationWaitlisted: 'Вы в листе ожидания',
    RegistrationPromotedFromWaitlist: 'Вас пригласили из листа ожидания',
    RegistrationCancelled: 'Запись на поездку отменена',
    TripCancelled: 'Поездка отменена',
    TripRescheduled: 'Изменилось время поездки',
    TripReminder24h: 'Поездка завтра',
    TripReminder3h: 'До поездки три часа',
    NewRegistrationForCurator: 'Новая запись на вашу поездку',
    ReportRequestedFromCurator: 'Пожалуйста, заполните отчет о поездке',
    OpenDayReminder: 'Напоминание о Дне открытых дверей',
    EventRegistered: 'Вы записаны на мероприятие',
    EventCancelled: 'Запись на мероприятие отменена',
    EventRescheduled: 'Изменились время или место мероприятия',
    OpenDayRegistered: 'Вы записаны на День открытых дверей',
    OpenDayRescheduled: 'Изменились время или место Дня открытых дверей',
  };
  const link =
    type === 'ApplicationStatusChanged'
      ? '/cabinet/application'
      : type === 'OpenDayRegistered' || type === 'OpenDayReminder' || type === 'OpenDayRescheduled'
        ? '/cabinet/registrations'
        : typeof data.tripId === 'string'
          ? `/trips/${data.tripId}`
          : typeof data.eventId === 'string'
            ? `/events/${data.eventId}`
            : '/cabinet/notifications';
  const status = typeof data.statusLabel === 'string' ? `\nНовый статус: ${data.statusLabel}.` : '';
  return {
    subject: subjects[type],
    text: `Клуб волонтеров\n\n${subjects[type]}.\n${title}${date ? `\n${date} (Москва)` : ''}${end ? `\nОкончание: ${end} (Москва)` : ''}${location}${status}\n\nПодробнее: ${webUrl}${link}`,
  };
}

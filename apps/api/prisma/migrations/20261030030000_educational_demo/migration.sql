-- One-time content for the educational deployment, separate from the local db:seed.
-- Stable IDs/slugs preserve edits and registrations if this script is reapplied.
-- The author is a blocked tombstone with no login identifiers or credentials.
-- Its system name follows the existing users_identity_check invariant.
DO $demo$
DECLARE
  author_id uuid := 'd30e0000-0000-4000-8000-000000000002';
  region_id uuid;
  demo_day timestamptz := date_trunc('day', CURRENT_TIMESTAMP AT TIME ZONE 'UTC') AT TIME ZONE 'UTC';
BEGIN
  INSERT INTO "regions" ("id", "slug", "name", "updatedAt")
  VALUES ('d30e0000-0000-4000-8000-000000000001', 'edu-region', 'Учебный регион', now())
  ON CONFLICT ("slug") DO NOTHING;
  SELECT "id" INTO STRICT region_id FROM "regions" WHERE "slug" = 'edu-region';

  INSERT INTO "users" ("id", "fullName", "role", "isBlocked", "anonymizedAt", "updatedAt")
  VALUES (author_id, 'Удаленный пользователь', 'CANDIDATE', true, now(), now())
  ON CONFLICT ("id") DO NOTHING;

  INSERT INTO "places" ("id", "slug", "name", "type", "regionId", "city", "district", "address", "description", "updatedAt") VALUES
    ('d30e0000-0000-4000-8000-000000000101', 'edu-solnechny', 'Демо: детский дом «Солнечный»', 'ORPHANAGE', region_id, 'Учебный город', NULL, 'Демо: реального адреса нет',
     'Вымышленное учреждение для демонстрации каталога и списка нужд. Здесь показан сценарий творческих занятий с детьми. Реального учреждения и выездов по этому адресу нет.', now()),
    ('d30e0000-0000-4000-8000-000000000102', 'edu-horizont', 'Демо: школа-интернат «Горизонт»', 'BOARDING_SCHOOL', region_id, 'Учебный город', NULL, 'Демо: реального адреса нет',
     'Вымышленная школа для учебного сценария помощи с занятиями и подготовки мастер-классов. Название и потребности приведены для демонстрации приложения.', now()),
    ('d30e0000-0000-4000-8000-000000000103', 'edu-teply-dom', 'Демо: пансионат «Тёплый дом»', 'ADULT_BOARDING', region_id, 'Учебный город', NULL, 'Демо: реального адреса нет',
     'Вымышленный пансионат для демонстрации совместного досуга и настольных игр. Передача вещей и реальное посещение не организуются.', now()),
    ('d30e0000-0000-4000-8000-000000000104', 'edu-dobry-dvor', 'Демо: программа «Добрый двор»', 'YARD_PROGRAM', region_id, 'Учебный город', 'Демонстрационный район', NULL,
     'Вымышленная дворовая программа: пример открытых игр и творческих встреч. Это учебная карточка, а не приглашение на реальное мероприятие.', now())
  ON CONFLICT ("slug") DO NOTHING;

  INSERT INTO "need_items" ("id", "placeId", "title", "description")
  SELECT item.id::uuid, place."id", item.title, 'Учебный пример потребности. Реальный сбор вещей не проводится.'
  FROM (VALUES
    ('d30e0000-0000-4000-8000-000000000201', 'edu-solnechny', 'Демо: цветная бумага'),
    ('d30e0000-0000-4000-8000-000000000202', 'edu-solnechny', 'Демо: альбомы для рисования'),
    ('d30e0000-0000-4000-8000-000000000203', 'edu-solnechny', 'Демо: наборы карандашей'),
    ('d30e0000-0000-4000-8000-000000000204', 'edu-horizont', 'Демо: тетради'),
    ('d30e0000-0000-4000-8000-000000000205', 'edu-horizont', 'Демо: книги для чтения'),
    ('d30e0000-0000-4000-8000-000000000206', 'edu-horizont', 'Демо: наборы для опытов'),
    ('d30e0000-0000-4000-8000-000000000207', 'edu-teply-dom', 'Демо: настольные игры'),
    ('d30e0000-0000-4000-8000-000000000208', 'edu-teply-dom', 'Демо: пазлы'),
    ('d30e0000-0000-4000-8000-000000000209', 'edu-teply-dom', 'Демо: материалы для рукоделия'),
    ('d30e0000-0000-4000-8000-000000000210', 'edu-dobry-dvor', 'Демо: мячи'),
    ('d30e0000-0000-4000-8000-000000000211', 'edu-dobry-dvor', 'Демо: мелки для рисования'),
    ('d30e0000-0000-4000-8000-000000000212', 'edu-dobry-dvor', 'Демо: скакалки')
  ) AS item(id, slug, title)
  JOIN "places" place ON place."slug" = item.slug
  ON CONFLICT ("id") DO NOTHING;

  INSERT INTO "events" ("id", "type", "title", "description", "startsAt", "endsAt", "location", "capacity", "isPublic", "volunteersOnly", "createdById") VALUES
    ('d30e0000-0000-4000-8000-000000000301', 'CLUB_EVENT', 'Демо: знакомство с Qamqor',
     'Учебная встреча для проверки записи и отмены в личном кабинете. Доступна кандидату после входа и заполнения профиля. Реальной встречи нет.',
     demo_day + interval '7 days 9 hours', demo_day + interval '7 days 10 hours', 'Демо: учебное пространство, без реального адреса', 25, true, false, author_id),
    ('d30e0000-0000-4000-8000-000000000302', 'MASTER_CLASS', 'Демо: творческая мастерская',
     'Учебный мастер-класс: пример мероприятия для кандидатов и волонтёров. Запись сохраняется в приложении, реальное занятие не проводится.',
     demo_day + interval '14 days 9 hours', demo_day + interval '14 days 11 hours', 'Демо: учебное пространство, без реального адреса', 12, true, false, author_id),
    ('d30e0000-0000-4000-8000-000000000303', 'SEMINAR', 'Демо: подготовка волонтёров',
     'Учебный пример события с ограничением по роли. Запись доступна принятому волонтёру. Реального семинара нет.',
     demo_day + interval '21 days 9 hours', demo_day + interval '21 days 11 hours', 'Демо: учебное пространство, без реального адреса', 15, true, true, author_id)
  ON CONFLICT ("id") DO NOTHING;

  INSERT INTO "trips" ("id", "placeId", "createdById", "title", "description", "startsAt", "endsAt", "meetingPoint", "capacity", "status", "updatedAt")
  SELECT 'd30e0000-0000-4000-8000-000000000401', "id", author_id, 'Демо: творческий выезд в «Солнечный»',
    'Учебная поездка для демонстрации записи волонтёра, подтверждения куратором и листа ожидания. Реальная поездка не организуется.',
    demo_day + interval '28 days 9 hours', demo_day + interval '28 days 12 hours',
    'Демо: условное место сбора, приезжать не нужно', 3, 'OPEN', now()
  FROM "places" WHERE "slug" = 'edu-solnechny'
  ON CONFLICT ("id") DO NOTHING;

  INSERT INTO "open_day_sessions" ("id", "startsAt", "location", "capacity", "notes") VALUES
    ('d30e0000-0000-4000-8000-000000000501', demo_day + interval '5 days 9 hours', 'Демо: знакомство с платформой', 20, 'Учебная сессия для проверки записи кандидата. Реального Дня открытых дверей нет.'),
    ('d30e0000-0000-4000-8000-000000000502', demo_day + interval '12 days 9 hours', 'Демо: повторное знакомство с платформой', 20, 'Учебная сессия для демонстрации отмены и повторной записи. Реального Дня открытых дверей нет.')
  ON CONFLICT ("id") DO NOTHING;

  INSERT INTO "news_posts" ("id", "slug", "title", "excerpt", "bodyHtml", "status", "publishedAt", "authorId", "updatedAt") VALUES
    ('d30e0000-0000-4000-8000-000000000601', 'edu-demo-guide', 'Демо: как попробовать Qamqor',
     'Учебный маршрут от каталога учреждений до записи на демонстрационное событие.',
     '<p>Qamqor — учебный проект. Все записи с пометкой «Демо» вымышленные, реальные встречи и сборы не проводятся.</p><ol><li><a href="/uchrezhdeniya">Посмотрите учреждения и нужды.</a></li><li><a href="/kalendar">Выберите демонстрационное событие в календаре.</a></li><li>Войдите через Telegram, заполните профиль и проверьте запись в личном кабинете.</li></ol><p>Запись сохраняется на сервере. Telegram-вход использует данные выбранного аккаунта; для демонстрации можно взять отдельный тестовый аккаунт.</p>',
     'PUBLISHED', now(), author_id, now()),
    ('d30e0000-0000-4000-8000-000000000602', 'edu-demo-roles', 'Демо: роли участников платформы',
     'Как кандидат, волонтёр, куратор и администратор взаимодействуют в учебном сценарии.',
     '<p>Кандидат заполняет анкету и записывается на День открытых дверей. После проверки администратором он становится волонтёром.</p><p>Волонтёр может записываться на поездки. Назначенный куратор управляет поездками своего учреждения и участниками, администратор — контентом и заявками.</p><p>Демонстрационные данные не дают дополнительных прав. Вход и проверка доступа работают обычным способом.</p>',
     'PUBLISHED', now(), author_id, now())
  ON CONFLICT ("slug") DO NOTHING;
END;
$demo$;

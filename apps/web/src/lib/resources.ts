// Generated from OpenAPI. Regenerate with pnpm gen:client.
import { api, result } from './api/client';
import { schemaFor } from './form-schema';
import type { TableQuery } from '@/components/data-table';
export const resources = {
  users: {
    title: 'Пользователи',
    createSchema: 'UserCreateDto',
    updateSchema: 'UserPatchDto',
    list: (query: TableQuery & Record<string, string | number | boolean | undefined>) =>
      result(api.GET('/api/v1/admin/users', { params: { query } })),
    create: (body: unknown) =>
      result(api.POST('/api/v1/admin/users', { body: schemaFor('UserCreateDto').parse(body) })),
    update: (id: string, body: unknown) =>
      result(
        api.PATCH('/api/v1/admin/users/{id}', {
          params: { path: { id } },
          body: schemaFor('UserPatchDto').parse(body),
        }),
      ),
    remove: (id: string) =>
      result(api.DELETE('/api/v1/admin/users/{id}', { params: { path: { id } } })),
  },
  curators: {
    title: 'Кураторы',
    createSchema: 'CuratorAssignDto',
    updateSchema: null,
    list: (query: TableQuery & Record<string, string | number | boolean | undefined>) =>
      result(api.GET('/api/v1/admin/curators', { params: { query } })),
    create: (body: unknown) =>
      result(
        api.POST('/api/v1/admin/curators', { body: schemaFor('CuratorAssignDto').parse(body) }),
      ),
    remove: (id: string) =>
      result(api.DELETE('/api/v1/admin/curators/{id}', { params: { path: { id } } })),
  },
  regions: {
    title: 'Регионы',
    createSchema: 'RegionDto',
    updateSchema: 'RegionPatchDto',
    list: (query: TableQuery & Record<string, string | number | boolean | undefined>) =>
      result(api.GET('/api/v1/admin/regions', { params: { query } })),
    create: (body: unknown) =>
      result(api.POST('/api/v1/admin/regions', { body: schemaFor('RegionDto').parse(body) })),
    update: (id: string, body: unknown) =>
      result(
        api.PATCH('/api/v1/admin/regions/{id}', {
          params: { path: { id } },
          body: schemaFor('RegionPatchDto').parse(body),
        }),
      ),
    remove: (id: string) =>
      result(api.DELETE('/api/v1/admin/regions/{id}', { params: { path: { id } } })),
  },
  places: {
    title: 'Учреждения',
    createSchema: 'PlaceWriteDto',
    updateSchema: 'PlacePatchDto',
    list: (query: TableQuery & Record<string, string | number | boolean | undefined>) =>
      result(api.GET('/api/v1/admin/places', { params: { query } })),
    create: (body: unknown) =>
      result(api.POST('/api/v1/admin/places', { body: schemaFor('PlaceWriteDto').parse(body) })),
    update: (id: string, body: unknown) =>
      result(
        api.PATCH('/api/v1/admin/places/{id}', {
          params: { path: { id } },
          body: schemaFor('PlacePatchDto').parse(body),
        }),
      ),
    remove: (id: string) =>
      result(api.DELETE('/api/v1/admin/places/{id}', { params: { path: { id } } })),
  },
  events: {
    title: 'Мероприятия',
    createSchema: 'EventWriteDto',
    updateSchema: 'EventPatchDto',
    list: (query: TableQuery & Record<string, string | number | boolean | undefined>) =>
      result(api.GET('/api/v1/admin/events', { params: { query } })),
    create: (body: unknown) =>
      result(api.POST('/api/v1/admin/events', { body: schemaFor('EventWriteDto').parse(body) })),
    update: (id: string, body: unknown) =>
      result(
        api.PATCH('/api/v1/admin/events/{id}', {
          params: { path: { id } },
          body: schemaFor('EventPatchDto').parse(body),
        }),
      ),
    remove: (id: string) =>
      result(api.DELETE('/api/v1/admin/events/{id}', { params: { path: { id } } })),
  },
  'open-days': {
    title: 'День открытых дверей',
    createSchema: 'OpenDayWriteDto',
    updateSchema: 'OpenDayPatchDto',
    list: (query: TableQuery & Record<string, string | number | boolean | undefined>) =>
      result(api.GET('/api/v1/admin/open-days', { params: { query } })),
    create: (body: unknown) =>
      result(
        api.POST('/api/v1/admin/open-days', { body: schemaFor('OpenDayWriteDto').parse(body) }),
      ),
    update: (id: string, body: unknown) =>
      result(
        api.PATCH('/api/v1/admin/open-days/{id}', {
          params: { path: { id } },
          body: schemaFor('OpenDayPatchDto').parse(body),
        }),
      ),
    remove: (id: string) =>
      result(api.DELETE('/api/v1/admin/open-days/{id}', { params: { path: { id } } })),
  },
  news: {
    title: 'Новости',
    createSchema: 'NewsWriteDto',
    updateSchema: 'NewsWriteDto',
    list: (query: TableQuery & Record<string, string | number | boolean | undefined>) =>
      result(api.GET('/api/v1/admin/news', { params: { query } })),
    create: (body: unknown) =>
      result(api.POST('/api/v1/admin/news', { body: schemaFor('NewsWriteDto').parse(body) })),
    update: (id: string, body: unknown) =>
      result(
        api.PATCH('/api/v1/admin/news/{id}', {
          params: { path: { id } },
          body: schemaFor('NewsWriteDto').parse(body),
        }),
      ),
    remove: (id: string) =>
      result(api.DELETE('/api/v1/admin/news/{id}', { params: { path: { id } } })),
  },
  pages: {
    title: 'Страницы',
    createSchema: 'PageWriteDto',
    updateSchema: 'PageWriteDto',
    list: (query: TableQuery & Record<string, string | number | boolean | undefined>) =>
      result(api.GET('/api/v1/admin/pages', { params: { query } })),
    create: (body: unknown) =>
      result(api.POST('/api/v1/admin/pages', { body: schemaFor('PageWriteDto').parse(body) })),
    update: (id: string, body: unknown) =>
      result(
        api.PATCH('/api/v1/admin/pages/{id}', {
          params: { path: { id } },
          body: schemaFor('PageWriteDto').parse(body),
        }),
      ),
    remove: (id: string) =>
      result(api.DELETE('/api/v1/admin/pages/{id}', { params: { path: { id } } })),
  },
  albums: {
    title: 'Альбомы',
    createSchema: 'AlbumWriteDto',
    updateSchema: 'AlbumWriteDto',
    list: (query: TableQuery & Record<string, string | number | boolean | undefined>) =>
      result(api.GET('/api/v1/admin/albums', { params: { query } })),
    create: (body: unknown) =>
      result(api.POST('/api/v1/admin/albums', { body: schemaFor('AlbumWriteDto').parse(body) })),
    update: (id: string, body: unknown) =>
      result(
        api.PATCH('/api/v1/admin/albums/{id}', {
          params: { path: { id } },
          body: schemaFor('AlbumWriteDto').parse(body),
        }),
      ),
    remove: (id: string) =>
      result(api.DELETE('/api/v1/admin/albums/{id}', { params: { path: { id } } })),
  },
  'media-items': {
    title: 'Фото и видео',
    createSchema: 'MediaItemWriteDto',
    updateSchema: 'MediaItemWriteDto',
    list: (query: TableQuery & Record<string, string | number | boolean | undefined>) =>
      result(api.GET('/api/v1/admin/media-items', { params: { query } })),
    create: (body: unknown) =>
      result(
        api.POST('/api/v1/admin/media-items', { body: schemaFor('MediaItemWriteDto').parse(body) }),
      ),
    update: (id: string, body: unknown) =>
      result(
        api.PATCH('/api/v1/admin/media-items/{id}', {
          params: { path: { id } },
          body: schemaFor('MediaItemWriteDto').parse(body),
        }),
      ),
    remove: (id: string) =>
      result(api.DELETE('/api/v1/admin/media-items/{id}', { params: { path: { id } } })),
  },
  interviews: {
    title: 'Интервью',
    createSchema: 'InterviewWriteDto',
    updateSchema: 'InterviewWriteDto',
    list: (query: TableQuery & Record<string, string | number | boolean | undefined>) =>
      result(api.GET('/api/v1/admin/interviews', { params: { query } })),
    create: (body: unknown) =>
      result(
        api.POST('/api/v1/admin/interviews', { body: schemaFor('InterviewWriteDto').parse(body) }),
      ),
    update: (id: string, body: unknown) =>
      result(
        api.PATCH('/api/v1/admin/interviews/{id}', {
          params: { path: { id } },
          body: schemaFor('InterviewWriteDto').parse(body),
        }),
      ),
    remove: (id: string) =>
      result(api.DELETE('/api/v1/admin/interviews/{id}', { params: { path: { id } } })),
  },
  projects: {
    title: 'Проекты',
    createSchema: 'ProjectWriteDto',
    updateSchema: 'ProjectWriteDto',
    list: (query: TableQuery & Record<string, string | number | boolean | undefined>) =>
      result(api.GET('/api/v1/admin/projects', { params: { query } })),
    create: (body: unknown) =>
      result(
        api.POST('/api/v1/admin/projects', { body: schemaFor('ProjectWriteDto').parse(body) }),
      ),
    update: (id: string, body: unknown) =>
      result(
        api.PATCH('/api/v1/admin/projects/{id}', {
          params: { path: { id } },
          body: schemaFor('ProjectWriteDto').parse(body),
        }),
      ),
    remove: (id: string) =>
      result(api.DELETE('/api/v1/admin/projects/{id}', { params: { path: { id } } })),
  },
  partners: {
    title: 'Партнеры',
    createSchema: 'PartnerWriteDto',
    updateSchema: 'PartnerWriteDto',
    list: (query: TableQuery & Record<string, string | number | boolean | undefined>) =>
      result(api.GET('/api/v1/admin/partners', { params: { query } })),
    create: (body: unknown) =>
      result(
        api.POST('/api/v1/admin/partners', { body: schemaFor('PartnerWriteDto').parse(body) }),
      ),
    update: (id: string, body: unknown) =>
      result(
        api.PATCH('/api/v1/admin/partners/{id}', {
          params: { path: { id } },
          body: schemaFor('PartnerWriteDto').parse(body),
        }),
      ),
    remove: (id: string) =>
      result(api.DELETE('/api/v1/admin/partners/{id}', { params: { path: { id } } })),
  },
  press: {
    title: 'СМИ',
    createSchema: 'PressWriteDto',
    updateSchema: 'PressWriteDto',
    list: (query: TableQuery & Record<string, string | number | boolean | undefined>) =>
      result(api.GET('/api/v1/admin/press', { params: { query } })),
    create: (body: unknown) =>
      result(api.POST('/api/v1/admin/press', { body: schemaFor('PressWriteDto').parse(body) })),
    update: (id: string, body: unknown) =>
      result(
        api.PATCH('/api/v1/admin/press/{id}', {
          params: { path: { id } },
          body: schemaFor('PressWriteDto').parse(body),
        }),
      ),
    remove: (id: string) =>
      result(api.DELETE('/api/v1/admin/press/{id}', { params: { path: { id } } })),
  },
  'club-reports': {
    title: 'Отчеты Клуба',
    createSchema: 'ClubReportWriteDto',
    updateSchema: 'ClubReportWriteDto',
    list: (query: TableQuery & Record<string, string | number | boolean | undefined>) =>
      result(api.GET('/api/v1/admin/club-reports', { params: { query } })),
    create: (body: unknown) =>
      result(
        api.POST('/api/v1/admin/club-reports', {
          body: schemaFor('ClubReportWriteDto').parse(body),
        }),
      ),
    update: (id: string, body: unknown) =>
      result(
        api.PATCH('/api/v1/admin/club-reports/{id}', {
          params: { path: { id } },
          body: schemaFor('ClubReportWriteDto').parse(body),
        }),
      ),
    remove: (id: string) =>
      result(api.DELETE('/api/v1/admin/club-reports/{id}', { params: { path: { id } } })),
  },
  donations: {
    title: 'Пожертвования',
    createSchema: 'DonationWriteDto',
    updateSchema: 'DonationWriteDto',
    list: (query: TableQuery & Record<string, string | number | boolean | undefined>) =>
      result(api.GET('/api/v1/admin/donations', { params: { query } })),
    create: (body: unknown) =>
      result(
        api.POST('/api/v1/admin/donations', { body: schemaFor('DonationWriteDto').parse(body) }),
      ),
    update: (id: string, body: unknown) =>
      result(
        api.PATCH('/api/v1/admin/donations/{id}', {
          params: { path: { id } },
          body: schemaFor('DonationWriteDto').parse(body),
        }),
      ),
    remove: (id: string) =>
      result(api.DELETE('/api/v1/admin/donations/{id}', { params: { path: { id } } })),
  },
  'contact-requests': {
    title: 'Обращения',
    createSchema: null,
    updateSchema: 'ContactPatchDto',
    list: (query: TableQuery & Record<string, string | number | boolean | undefined>) =>
      result(api.GET('/api/v1/admin/contact-requests', { params: { query } })),
    update: (id: string, body: unknown) =>
      result(
        api.PATCH('/api/v1/admin/contact-requests/{id}', {
          params: { path: { id } },
          body: schemaFor('ContactPatchDto').parse(body),
        }),
      ),
  },
} as const;

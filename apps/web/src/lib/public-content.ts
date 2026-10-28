import { serverApi } from './api/server';
import { result, type Page } from './api/client';
export const sections = {
  novosti: 'Новости',
  'o-klube-volonterov': 'О Клубе волонтеров',
  proekty: 'Проекты',
  'interv-yu-s-volonterami': 'Интервью с волонтерами',
  partners: 'Партнеры',
  fotoalbomy: 'Фотоальбомы',
  video: 'Видео',
  otchety: 'Отчеты',
  'smi-o-nas': 'СМИ о нас',
  kontakty: 'Контакты',
  donation: 'Помочь Клубу',
  'stat-volonterom': 'Стать волонтером',
  uchrezhdeniya: 'Учреждения',
  kalendar: 'Календарь',
  policy: 'Политика обработки персональных данных',
} as const;
export type PublicItem = {
  id: string;
  title?: string;
  slug?: string;
  name?: string;
  description?: string;
  bodyHtml?: string;
  excerpt?: string;
  coverUrl?: string | null;
  logoUrl?: string | null;
  url?: string;
  websiteUrl?: string | null;
  fileUrl?: string;
  publishedAt?: string | null;
  year?: number;
  text?: string;
  caption?: string;
  hoursSpent?: string;
  photos?: { id: string; url: string; isPublic: boolean }[];
};
export async function publicList(section: string, page = 1): Promise<Page<PublicItem>> {
  const api = await serverApi();
  const options = { params: { query: { page, limit: 12 } } };
  switch (section) {
    case 'novosti':
      return result(api.GET('/api/v1/news', options));
    case 'proekty':
      return result(api.GET('/api/v1/projects', options));
    case 'interv-yu-s-volonterami':
      return result(api.GET('/api/v1/interviews', options));
    case 'partners':
      return result(api.GET('/api/v1/partners', options));
    case 'fotoalbomy':
      return result(api.GET('/api/v1/albums', options));
    case 'video':
      return result(api.GET('/api/v1/videos', options));
    case 'otchety':
      return result(api.GET('/api/v1/public/reports', options));
    case 'smi-o-nas':
      return result(api.GET('/api/v1/press', options));
    default:
      throw new Error('Неизвестный раздел');
  }
}
export async function publicDetail(section: string, slug: string) {
  const api = await serverApi();
  const options = { params: { path: { slug } } };
  switch (section) {
    case 'novosti':
      return result(api.GET('/api/v1/news/{slug}', options));
    case 'interv-yu-s-volonterami':
      return result(api.GET('/api/v1/interviews/{slug}', options));
    case 'fotoalbomy':
      return result(api.GET('/api/v1/albums/{slug}', options));
    case 'uchrezhdeniya':
      return result(api.GET('/api/v1/places/{slug}', options));
    default:
      return null;
  }
}

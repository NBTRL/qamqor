import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import Page from './page';
const get = vi.hoisted(() => vi.fn());
vi.mock('@/lib/api/server', () => ({ serverApi: async () => ({ GET: get }) }));
vi.mock('@/components/public-widgets', () => ({
  ContactForm: () => <div data-testid="contact-form">Контактная форма</div>,
  OpenDays: () => null,
  StepList: () => null,
  PlaceCard: () => null,
}));
async function show(section: string) {
  return render(
    await Page({ params: Promise.resolve({ section }), searchParams: Promise.resolve({}) }),
  );
}
beforeEach(() => {
  get.mockReset();
});
describe('Managed public pages', () => {
  it.each(['policy', 'donation', 'kontakty'])('renders CMS content for %s', async (section) => {
    get.mockResolvedValue({
      data: {
        id: 'page-id',
        slug: section,
        title: 'CMS title',
        bodyHtml: '<p>Опубликованный текст администратора</p>',
      },
      response: new Response('{}'),
    });
    await show(section);
    expect(screen.getByText('Опубликованный текст администратора')).toBeInTheDocument();
    expect(screen.queryByText('Данные в учебном проекте')).not.toBeInTheDocument();
    expect(screen.queryByText('Учебная демонстрация помощи')).not.toBeInTheDocument();
    expect(get).toHaveBeenCalledWith('/api/v1/pages/{slug}', {
      params: { path: { slug: section } },
    });
    if (section === 'kontakty') expect(screen.getByTestId('contact-form')).toBeInTheDocument();
    if (section === 'donation')
      expect(screen.getByRole('link', { name: 'Перейти к тестовой форме' })).toHaveAttribute(
        'href',
        '/kontakty',
      );
  });
  it.each([
    ['policy', 'Данные в учебном проекте'],
    ['donation', 'Учебная демонстрация помощи'],
    ['kontakty', /Это учебный проект Qamqor/],
  ])('renders the educational fallback when %s is not configured', async (section, fallback) => {
    get.mockResolvedValue({
      error: { code: 'NOT_FOUND' },
      response: new Response('{}', { status: 404 }),
    });
    await show(section as string);
    expect(screen.getByText(fallback as string | RegExp)).toBeInTheDocument();
    if (section === 'kontakty') expect(screen.getByTestId('contact-form')).toBeInTheDocument();
  });
  it.each(['policy', 'donation', 'kontakty'])(
    'does not mistake an API failure for missing %s content',
    async (section) => {
      get.mockResolvedValue({
        error: { code: 'INTERNAL_ERROR' },
        response: new Response('{}', { status: 503 }),
      });
      await show(section);
      expect(screen.getByRole('alert')).toHaveTextContent(
        'Не удалось загрузить содержимое страницы',
      );
      expect(screen.queryByText('Данные в учебном проекте')).not.toBeInTheDocument();
      expect(screen.queryByText('Учебная демонстрация помощи')).not.toBeInTheDocument();
      if (section === 'kontakty') expect(screen.getByTestId('contact-form')).toBeInTheDocument();
    },
  );
  it('keeps the educational fallback for an empty policy instead of rendering a blank document', async () => {
    get.mockResolvedValue({ data: { bodyHtml: '  ' }, response: new Response('{}') });
    await show('policy');
    expect(screen.getByText('Данные в учебном проекте')).toBeInTheDocument();
  });
});

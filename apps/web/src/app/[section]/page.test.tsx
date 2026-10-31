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
  it.each(['policy', 'donation', 'kontakty', 'o-klube-volonterov'])(
    'renders CMS content for %s',
    async (section) => {
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
    },
  );
  it.each([
    ['policy', 'Данные в учебном проекте'],
    ['donation', 'Учебная демонстрация помощи'],
    ['kontakty', /Это учебный проект Qamqor/],
    ['o-klube-volonterov', /Клуб волонтеров — сообщество людей/],
  ])('renders the educational fallback when %s is not configured', async (section, fallback) => {
    get.mockResolvedValue({
      error: { code: 'NOT_FOUND' },
      response: new Response('{}', { status: 404 }),
    });
    await show(section as string);
    expect(screen.getByText(fallback as string | RegExp)).toBeInTheDocument();
    if (section === 'kontakty') expect(screen.getByTestId('contact-form')).toBeInTheDocument();
  });
  it.each(['policy', 'donation', 'kontakty', 'o-klube-volonterov'])(
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
  it.each(['', '<p></p>', '<p><br></p>', '<p>&nbsp; &#160; &#xA0;</p>', '<p><img src=""></p>'])(
    'shows the about fallback for empty editor HTML %s',
    async (bodyHtml) => {
      get.mockResolvedValue({ data: { bodyHtml }, response: new Response('{}') });
      await show('o-klube-volonterov');
      expect(screen.getByText(/Клуб волонтеров — сообщество людей/)).toBeInTheDocument();
    },
  );
  it('keeps image-only CMS content', async () => {
    get.mockResolvedValue({
      data: {
        bodyHtml: '<p><img src="https://images.example/test.png" alt="CMS illustration"></p>',
      },
      response: new Response('{}'),
    });
    await show('o-klube-volonterov');
    expect(screen.getByAltText('CMS illustration')).toBeInTheDocument();
    expect(screen.queryByText(/Клуб волонтеров — сообщество людей/)).not.toBeInTheDocument();
  });
  it('shows an error when the about request rejects', async () => {
    get.mockRejectedValue(new Error('network failure'));
    await show('o-klube-volonterov');
    expect(screen.getByRole('alert')).toHaveTextContent('Не удалось загрузить содержимое страницы');
    expect(screen.queryByRole('link', { name: 'Присоединиться' })).not.toBeInTheDocument();
  });
});

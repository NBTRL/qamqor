import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import Page, { generateMetadata } from './page';

const { get, missing } = vi.hoisted(() => ({ get: vi.fn(), missing: vi.fn() }));
vi.mock('@/lib/api/server', () => ({ serverApi: async () => ({ GET: get }) }));
vi.mock('next/navigation', () => ({ notFound: missing }));
vi.mock('@/components/place-needs', () => ({ PlaceNeeds: () => null }));
vi.mock('@/components/public-widgets', () => ({ PrivatePlace: () => null }));

const params = () => Promise.resolve({ section: 'novosti', slug: 'existing-news' });
const notFoundError = new Error('NEXT_HTTP_ERROR_FALLBACK;404');
beforeEach(() => {
  get.mockReset();
  missing.mockReset().mockImplementation(() => {
    throw notFoundError;
  });
});

describe('Public material errors', () => {
  it('renders published content and metadata normally', async () => {
    get.mockResolvedValue({
      data: {
        id: 'news-id',
        slug: 'existing-news',
        title: 'Опубликованная новость',
        bodyHtml: '<p>Текст новости</p>',
      },
      response: new Response('{}'),
    });
    render(await Page({ params: params() }));
    expect(screen.getByRole('heading', { name: 'Опубликованная новость' })).toBeInTheDocument();
    expect(screen.getByText('Текст новости')).toBeInTheDocument();
    expect(await generateMetadata({ params: params() })).toMatchObject({
      title: 'Опубликованная новость',
    });
    expect(missing).not.toHaveBeenCalled();
  });

  it('uses the not-found page only for a missing API resource', async () => {
    get.mockResolvedValue({
      error: { code: 'NOT_FOUND' },
      response: new Response('{}', { status: 404 }),
    });
    await expect(Page({ params: params() })).rejects.toBe(notFoundError);
    expect(missing).toHaveBeenCalledOnce();
    expect(await generateMetadata({ params: params() })).toEqual({ title: 'Материал не найден' });
  });

  it('keeps unsupported detail sections as not-found pages', async () => {
    await expect(
      Page({ params: Promise.resolve({ section: 'unknown', slug: 'resource' }) }),
    ).rejects.toBe(notFoundError);
    expect(missing).toHaveBeenCalledOnce();
    expect(get).not.toHaveBeenCalled();
  });

  it('propagates server outages to the error boundary instead of returning a 404', async () => {
    get.mockResolvedValue({
      error: { code: 'INTERNAL_ERROR' },
      response: new Response('{}', { status: 503 }),
    });
    await expect(Page({ params: params() })).rejects.toMatchObject({
      status: 503,
    });
    await expect(generateMetadata({ params: params() })).rejects.toMatchObject({
      status: 503,
    });
    expect(missing).not.toHaveBeenCalled();
  });

  it('preserves network failures in both page and metadata requests', async () => {
    const offline = new TypeError('fetch failed');
    get.mockRejectedValue(offline);
    await expect(Page({ params: params() })).rejects.toBe(offline);
    await expect(generateMetadata({ params: params() })).rejects.toBe(offline);
    expect(missing).not.toHaveBeenCalled();
  });
});

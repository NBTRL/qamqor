import { createServer } from 'node:http';
const id = '11111111-1111-4111-8111-111111111111';
const emptyId = '22222222-2222-4222-8222-222222222222';
const needs = Array.from({ length: 25 }, (_, i) => ({
  id: String(i + 1),
  placeId: id,
  title: `Нужда ${i + 1}`,
  description: 'Опубликованная потребность учреждения.',
  isActive: true,
}));
const place = (empty = false, limit = 20) => ({
  id: empty ? emptyId : id,
  slug: empty ? 'empty-place' : 'test-place',
  name: empty ? 'Пустое учреждение' : 'Тестовое учреждение',
  type: 'ORPHANAGE',
  region: { id, name: 'Регион', slug: 'region' },
  city: 'Город',
  description: 'Описание учреждения',
  coverImage: null,
  beneficiariesCount: 5,
  needs: empty ? [] : needs.slice(0, limit),
  needsTotal: empty ? 0 : 25,
});
createServer((req, res) => {
  const url = new URL(req.url ?? '/', 'http://localhost');
  let body;
  let status = 200;
  if (url.pathname === '/api/v1/health') body = { ok: true };
  else if (url.pathname === '/api/v1/places')
    body = { items: [place(false, 3), place(true, 3)], page: 1, limit: 12, total: 2 };
  else if (url.pathname === '/api/v1/places/test-place') body = place();
  else if (url.pathname === '/api/v1/places/empty-place') body = place(true);
  else if (url.pathname === '/api/v1/needs') {
    const page = Number(url.searchParams.get('page') ?? 1),
      limit = Number(url.searchParams.get('limit') ?? 20);
    const items = url.searchParams.get('placeId') === id ? needs : [];
    body = {
      items: items.slice((page - 1) * limit, page * limit),
      page,
      limit,
      total: items.length,
    };
  } else if (url.pathname.startsWith('/api/v1/pages/')) {
    status = 404;
    body = { code: 'NOT_FOUND' };
  } else body = { items: [], page: 1, limit: 20, total: 0 };
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(body));
}).listen(4100, '127.0.0.1');

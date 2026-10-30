import { createServer } from 'node:http';
let scenario = { total: 205, failNextPage: false };
const member = {
  id: '11111111-1111-4111-8111-111111111111',
  fullName: 'Тестовый участник',
  role: 'VOLUNTEER',
  onboardingCompleted: true,
  curatorPlaceIds: [],
};
createServer(async (req, res) => {
  const url = new URL(req.url ?? '/', 'http://localhost');
  let status = 200,
    body = { items: [], total: 0, page: 1, limit: 20 };
  if (url.pathname === '/__scenario' && req.method === 'POST') {
    let json = '';
    for await (const chunk of req) json += chunk;
    scenario = { ...scenario, ...JSON.parse(json) };
    body = { ok: true };
  } else if (url.pathname === '/api/v1/health') body = { ok: true };
  else if (url.pathname === '/api/v1/public/stats')
    body = {
      places: 0,
      curators: 0,
      events12Months: 0,
      masterClasses12Months: 0,
      uniqueParticipants12Months: 0,
      beneficiaries: 0,
      trips: 0,
    };
  else if (url.pathname === '/api/v1/news')
    body = {
      items: [
        {
          id: 'test-news',
          slug: 'test-news',
          title: 'Новость для публичного чтения',
          excerpt: 'Анонс опубликованной новости.',
          publishedAt: '2026-10-27T10:00:00.000Z',
          coverUrl: null,
        },
      ],
      page: 1,
      limit: 6,
      total: 1,
    };
  else if (url.pathname === '/api/v1/auth/refresh')
    body = { status: 'USED', accessToken: 'test-memory-access' };
  else if (url.pathname === '/api/v1/me') body = member;
  else if (['/api/v1/public/calendar', '/api/v1/calendar'].includes(url.pathname)) {
    const authenticated = req.headers.authorization === 'Bearer test-memory-access';
    if (url.pathname === '/api/v1/calendar' && !authenticated) {
      status = 401;
      body = { code: 'UNAUTHORIZED' };
    } else {
      const page = Number(url.searchParams.get('page') ?? 1),
        limit = Number(url.searchParams.get('limit') ?? 100);
      const privateCalendar = url.pathname === '/api/v1/calendar';
      const from = Date.parse(url.searchParams.get('from') ?? new Date().toISOString());
      const items = Array.from({ length: scenario.total }, (_, i) => ({
        id: String(i + 1).padStart(4, '0'),
        title: `Событие ${i + 1}`,
        type: 'CLUB_EVENT',
        startsAt: new Date(from + (i + 1) * 60000).toISOString(),
      }));
      if (privateCalendar)
        items.unshift({
          id: 'private-event',
          title: 'Закрытое событие',
          type: 'CLUB_EVENT',
          startsAt: new Date(from).toISOString(),
        });
      if (page > 1 && scenario.failNextPage) {
        status = 500;
        body = { code: 'INTERNAL_ERROR' };
      } else
        body = {
          items: items.slice((page - 1) * limit, page * limit),
          total: items.length,
          page,
          limit,
        };
    }
  }
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(body));
}).listen(4200, '127.0.0.1');

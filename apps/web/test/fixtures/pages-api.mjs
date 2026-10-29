import { createServer } from 'node:http';
let mode = 'ready';
createServer(async (req, res) => {
  const url = new URL(req.url ?? '/', 'http://localhost');
  let status = 200,
    body = { items: [], total: 0, page: 1, limit: 20 };
  if (url.pathname === '/__scenario' && req.method === 'POST') {
    let json = '';
    for await (const chunk of req) json += chunk;
    mode = JSON.parse(json).mode;
    body = { ok: true };
  } else if (url.pathname === '/api/v1/health') body = { ok: true };
  else if (url.pathname.startsWith('/api/v1/pages/')) {
    const slug = url.pathname.split('/').at(-1);
    if (mode === 'missing') {
      status = 404;
      body = { code: 'NOT_FOUND' };
    } else if (mode === 'error') {
      status = 503;
      body = { code: 'INTERNAL_ERROR' };
    } else
      body = {
        id: '11111111-1111-4111-8111-111111111111',
        slug,
        title: 'CMS page',
        bodyHtml: `<p>Содержимое CMS для ${slug}</p>`,
      };
  }
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(body));
}).listen(4400, '127.0.0.1');

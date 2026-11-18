// Zero-dependency server: serves the page in /public and a JSON API that
// proxies the NHL web API (it sends no CORS headers, so browsers can't call it directly).
import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';
import { getScoreboard } from './src/nhlApi.js';
import { normalizeScoreboard } from './src/normalize.js';

const PORT = Number(process.env.PORT) || 3000;
const PUBLIC = join(fileURLToPath(new URL('.', import.meta.url)), 'public');
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml' };

function sendJson(res, status, body) {
  res.writeHead(status, { 'content-type': 'application/json', 'cache-control': 'no-store' });
  res.end(JSON.stringify(body));
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost');
  try {
    if (url.pathname === '/api/scores') {
      const date = url.searchParams.get('date');
      if (date && !/^\d{4}-\d{2}-\d{2}$/.test(date)) return sendJson(res, 400, { error: 'date must be YYYY-MM-DD' });
      return sendJson(res, 200, normalizeScoreboard(await getScoreboard(date || undefined)));
    }

    const rel = url.pathname === '/' ? 'index.html' : url.pathname.slice(1);
    const file = normalize(join(PUBLIC, rel));
    if (!file.startsWith(PUBLIC)) return sendJson(res, 403, { error: 'forbidden' });
    const body = await readFile(file);
    res.writeHead(200, { 'content-type': TYPES[extname(file)] ?? 'application/octet-stream' });
    res.end(body);
  } catch (err) {
    if (err.code === 'ENOENT') return sendJson(res, 404, { error: 'not found' });
    console.error(err);
    sendJson(res, 502, { error: err.message });
  }
});

server.listen(PORT, () => console.log(`NHL scores running at http://localhost:${PORT}`));

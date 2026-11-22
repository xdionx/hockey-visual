// Local development server. Zero dependencies.
//
// The hosted site (GitHub Pages) is static: a GitHub Action saves the score files
// under data/ (see scripts/update-data.js). Locally, this server answers the same
// data/ URLs live from the NHL API, so the page works without running the script.
import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';
import { getScoreboard, getGameDetailRaw } from './src/nhlApi.js';
import { normalizeGameDetail } from './src/gameDetail.js';
import { shotAttempts } from './src/sat.js';
import { getPlayByPlay } from './src/nhlApi.js';
import { normalizeScoreboard } from './src/normalize.js';
import { getPlayer } from './src/nhlApi.js';
import { normalizePlayer } from './src/player.js';

const PORT = Number(process.env.PORT) || 3000;
const ROOT = fileURLToPath(new URL('.', import.meta.url));
const PUBLIC = join(ROOT, 'public');
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png' };

function sendJson(res, status, body) {
  res.writeHead(status, { 'content-type': 'application/json', 'cache-control': 'no-store' });
  res.end(JSON.stringify(body));
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost');
  try {
    if (url.pathname === '/data/latest.json') {
      const board = await getScoreboard();
      return sendJson(res, 200, { date: board.currentDate });
    }
    const m = url.pathname.match(/^\/data\/scores\/(\d{4}-\d{2}-\d{2})\.json$/);
    if (m) return sendJson(res, 200, normalizeScoreboard(await getScoreboard(m[1])));
    const g = url.pathname.match(/^\/data\/games\/(\d{10})\.json$/);
    if (g) return sendJson(res, 200, normalizeGameDetail(await getGameDetailRaw(g[1])));

    const sat = url.pathname.match(/^\/data\/sat\/(\d{10})\.json$/);
    if (sat) return sendJson(res, 200, shotAttempts(await getPlayByPlay(sat[1])));
    const pl = url.pathname.match(/^\/data\/players\/(\d{7,8})\.json$/);
    if (pl) return sendJson(res, 200, normalizePlayer(await getPlayer(pl[1])));
    // Season totals: whatever the data scripts saved under ./data/seasons (see scripts/update-data.js).
    if (url.pathname === '/data/odds.json') {
      try { return sendJson(res, 200, JSON.parse(await readFile(join(ROOT, 'data', 'odds.json'), 'utf8'))); } catch { return sendJson(res, 404, { error: 'no odds saved yet' }); }
    }
    const se = url.pathname.match(/^\/data\/seasons\/(\d{8})\.json$/);
    if (se) return sendJson(res, 200, JSON.parse(await readFile(join(ROOT, 'data', 'seasons', `${se[1]}.json`), 'utf8')));
    const r = url.pathname.match(/^\/data\/raw\/(\d{10})\.json$/);
    if (r) return sendJson(res, 200, await getGameDetailRaw(r[1]));
    if (url.pathname.startsWith('/src/')) { // the shared modules the replay runs in the browser
      const f = normalize(join(ROOT, url.pathname.slice(1)));
      if (!f.startsWith(join(ROOT, 'src'))) return sendJson(res, 403, { error: 'forbidden' });
      res.writeHead(200, { 'content-type': 'text/javascript' });
      return res.end(await readFile(f));
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

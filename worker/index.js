// Live data service (Cloudflare Worker) for the hosted site.
//
// GitHub Pages is static and its scheduler runs at most every 5 minutes, so live
// games come from here instead. The Worker answers the same paths as the static
// data/ folder, fetches the NHL API on demand and caches each answer at the edge:
//
//   live game (or a date with a live game) ........ 5 seconds
//   not started yet ................................ 60 seconds
//   finished, from yesterday or today .............. 1 hour
//   finished, 2 or more days old ................... 30 days (never changes)
//
// Routes: /players/<playerId>.json (profile, seasons, last 5 games; 30 minutes), /sat/<gameId>.json (shot attempts per team, for the Scores page), /latest.json, /scores/<YYYY-MM-DD>.json, /games/<gameId>.json, /raw/<gameId>.json (the raw
// NHL responses, for the replay simulator)
import { normalizeScoreboard } from '../src/normalize.js';
import { normalizeGameDetail } from '../src/gameDetail.js';
import { shotAttempts } from '../src/sat.js';
import { normalizePlayer } from '../src/player.js';

// Bump this whenever the shape or wording of what src/ produces changes (labels, new fields):
// finished games are cached at the edge for 30 days, so old answers must be left behind.
const CACHE_VERSION = 9;

const NHL = 'https://api-web.nhle.com/v1';
const SECOND = 1;
const HOUR = 3600;
const DAY = 86400;

/** Seconds to cache, from game state and how old the game date is. */
export function ttlFor(state, gameDate, today, settling = false) {
  if (state === 'live') return 5 * SECOND;
  // Just ended (NHL state OVER): keep checking each minute until the league marks it FINAL.
  if (state === 'pre' || settling) return 60 * SECOND;
  const ageDays = (Date.parse(`${today}T12:00:00Z`) - Date.parse(`${gameDate}T12:00:00Z`)) / (DAY * 1000);
  return ageDays >= 2 ? 30 * DAY : HOUR;
}

/** Scoreboard TTL: the shortest of its games (an empty date counts as finished). */
export function scoreboardTtl(board, today) {
  const states = board.games.map((g) => g.status.state);
  if (states.includes('live') || board.games.some((g) => g.status.imminent)) return 5 * SECOND;
  if (states.includes('pre') || board.games.some((g) => g.status.settling)) return 60 * SECOND;
  return ttlFor('final', board.date, today);
}

async function nhl(path) {
  for (let attempt = 0; ; attempt++) {
    const res = await fetch(`${NHL}/${path}`, { headers: { accept: 'application/json', 'user-agent': 'hockey-visual-live/1.0' } });
    if (res.status === 429 && attempt < 2) {
      await new Promise((r) => setTimeout(r, 500 * 2 ** attempt));
      continue;
    }
    if (!res.ok) throw Object.assign(new Error(`NHL API ${res.status} for /${path}`), { status: res.status });
    return res.json();
  }
}

// "Today" in the NHL's sense (it follows North American evenings). Cached briefly.
async function nhlToday() {
  const board = await nhl('score/now');
  return { today: board.currentDate, board };
}

const CORS = { 'access-control-allow-origin': '*', 'access-control-allow-methods': 'GET, OPTIONS' };

function json(body, ttl) {
  return new Response(JSON.stringify(body), {
    headers: {
      ...CORS,
      'content-type': 'application/json; charset=utf-8',
      // Browsers re-ask every time for live data; the edge cache below does the heavy lifting.
      'cache-control': ttl <= 5 ? 'no-store' : `public, max-age=${Math.min(ttl, 300)}`,
      'x-edge-ttl': String(ttl),
    },
  });
}

async function build(path) {
  if (path === '/latest.json') {
    const { today } = await nhlToday();
    return { body: { date: today }, ttl: 60 };
  }
  let m = path.match(/^\/scores\/(\d{4}-\d{2}-\d{2})\.json$/);
  if (m) {
    const { today, board: now } = await nhlToday();
    const raw = m[1] === today ? now : await nhl(`score/${m[1]}`);
    const board = normalizeScoreboard(raw);
    return { body: board, ttl: scoreboardTtl(board, today) };
  }
  m = path.match(/^\/players\/(\d{7,8})\.json$/);
  if (m) return { body: normalizePlayer(await nhl(`player/${m[1]}/landing`)), ttl: 30 * 60 };
  m = path.match(/^\/sat\/(\d{10})\.json$/);
  if (m) {
    const pbp = await nhl(`gamecenter/${m[1]}/play-by-play`);
    const state = ['LIVE', 'CRIT', 'OVER'].includes(pbp.gameState) ? 'live' : ['FINAL', 'OFF'].includes(pbp.gameState) ? 'final' : 'pre';
    const today = new Date(Date.now() - 10 * HOUR * 1000).toISOString().slice(0, 10);
    return { body: shotAttempts(pbp), ttl: ttlFor(state, pbp.gameDate, today) };
  }
  m = path.match(/^\/(games|raw)\/(\d{10})\.json$/);
  if (m) {
    const id = m[2];
    const [box, landing, rightRail, pbp, shifts] = await Promise.all([
      nhl(`gamecenter/${id}/boxscore`), nhl(`gamecenter/${id}/landing`), nhl(`gamecenter/${id}/right-rail`), nhl(`gamecenter/${id}/play-by-play`),
      // Shifts (for on-ice shot attempts) live on the stats API; the box score works without them.
      // A replay never uses them, so it doesn't wait on that slower API.
      m[1] === 'raw' ? null : fetch(`https://api.nhle.com/stats/rest/en/shiftcharts?cayenneExp=gameId=${id}`, { headers: { accept: 'application/json', 'user-agent': 'hockey-visual-live/1.0' } })
        .then((r) => (r.ok ? r.json() : null)).catch(() => null),
    ]);
    if (m[1] === 'raw') {
      // Only finished games can be replayed; they never change, so they cache for a long time.
      if (!['OFF', 'FINAL'].includes(box.gameState)) throw Object.assign(new Error('Game not finished'), { status: 404 });
      return { body: { box, landing, rightRail, pbp }, ttl: 30 * DAY };
    }
    const game = normalizeGameDetail({ box, landing, rightRail, pbp, shifts });
    const today = new Date(Date.now() - 10 * HOUR * 1000).toISOString().slice(0, 10); // close enough to the NHL day for ageing
    return { body: game, ttl: ttlFor(game.status.imminent ? 'live' : game.status.state, game.gameDate, today, game.status.settling) };
  }
  return null;
}

export default {
  async fetch(request, env, ctx) {
    if (request.method === 'OPTIONS') return new Response(null, { headers: CORS });
    if (request.method !== 'GET') return new Response('Method not allowed', { status: 405, headers: CORS });
    const url = new URL(request.url);
    const cacheKey = new Request(`${url.origin}${url.pathname}?cv=${CACHE_VERSION}`, { method: 'GET' });
    const cache = globalThis.caches?.default;

    const hit = cache && (await cache.match(cacheKey));
    if (hit) return hit;

    try {
      const out = await build(url.pathname);
      if (!out) return new Response(JSON.stringify({ error: 'not found' }), { status: 404, headers: { ...CORS, 'content-type': 'application/json' } });
      const res = json(out.body, out.ttl);
      if (cache) {
        // The edge copy lives for the full TTL even when browsers are told not to store it.
        const edge = new Response(res.clone().body, res);
        edge.headers.set('cache-control', `public, max-age=${out.ttl}`);
        ctx?.waitUntil?.(cache.put(cacheKey, edge));
      }
      return res;
    } catch (err) {
      const status = err.status === 404 ? 404 : 502;
      return new Response(JSON.stringify({ error: err.message }), { status, headers: { ...CORS, 'content-type': 'application/json', 'cache-control': 'no-store' } });
    }
  },
};

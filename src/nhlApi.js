// Thin client for the public NHL web API (https://api-web.nhle.com).
// Keep this file free of UI concerns so later scorecard/season/career code can reuse it.

const BASE = 'https://api-web.nhle.com/v1';

// Small in-memory cache. Live data gets a short TTL, finished games a long one.
const cache = new Map();

async function getJson(path, ttlMs = 15_000) {
  const hit = cache.get(path);
  if (hit && hit.expires > Date.now()) return hit.data;

  let res;
  for (let attempt = 0; ; attempt++) {
    res = await fetch(`${BASE}/${path}`, { headers: { accept: 'application/json' } });
    // The API rate-limits bursts (429). Back off and retry a few times.
    if (res.status !== 429 || attempt === 4) break;
    const wait = Number(res.headers.get('retry-after')) * 1000 || 2000 * 2 ** attempt;
    await new Promise((r) => setTimeout(r, wait));
  }
  if (!res.ok) {
    const err = new Error(`NHL API ${res.status} for /${path}`);
    err.status = res.status;
    throw err;
  }
  const data = await res.json();
  cache.set(path, { data, expires: Date.now() + ttlMs });
  return data;
}

/** Scores for one date (YYYY-MM-DD), or the NHL's "current" date when omitted. */
export function getScoreboard(date) {
  return getJson(`score/${date ?? 'now'}`);
}

/** Full boxscore for one game: per-player stats (skaters + goalies). */
export function getBoxscore(gameId) {
  return getJson(`gamecenter/${gameId}/boxscore`);
}

/** Every event in a game (shots, hits, penalties, faceoffs, goals...). */
export function getPlayByPlay(gameId) {
  return getJson(`gamecenter/${gameId}/play-by-play`);
}

/** Game summary incl. official linescore and shots by period. */
export function getRightRail(gameId) {
  return getJson(`gamecenter/${gameId}/right-rail`);
}

/** Game center landing: scoring and penalty summaries, three stars. */
export function getLanding(gameId) {
  return getJson(`gamecenter/${gameId}/landing`);
}

/** Everything a box score page needs, fetched one after another to stay under the rate limit. */
export async function getGameDetailRaw(gameId) {
  const box = await getBoxscore(gameId);
  const landing = await getLanding(gameId);
  const rightRail = await getRightRail(gameId);
  const pbp = await getPlayByPlay(gameId);
  return { box, landing, rightRail, pbp };
}

/** A player's profile and career stats. */
export function getPlayer(playerId) {
  return getJson(`player/${playerId}/landing`, 60 * 60_000);
}

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

/** Every player shift in a game (stats API, a different host). Used for on-ice shot attempts. */
export async function getShifts(gameId) {
  const res = await fetch(`https://api.nhle.com/stats/rest/en/shiftcharts?cayenneExp=gameId=${gameId}`, { headers: { accept: 'application/json' } });
  if (!res.ok) throw new Error(`NHL stats API ${res.status} for shiftcharts ${gameId}`);
  return res.json();
}

/** Everything a box score page needs, fetched one after another to stay under the rate limit. */
export async function getGameDetailRaw(gameId) {
  const box = await getBoxscore(gameId);
  const landing = await getLanding(gameId);
  const rightRail = await getRightRail(gameId);
  const pbp = await getPlayByPlay(gameId);
  // Shifts are optional: without them on-ice impact falls back to plus/minus.
  const shifts = await getShifts(gameId).catch(() => null);
  return { box, landing, rightRail, pbp, shifts };
}

/** A player's profile and career stats. */
export function getPlayer(playerId) {
  return getJson(`player/${playerId}/landing`, 60 * 60_000);
}

/** League standings right now (api-web follows a redirect to the dated URL). */
export function getStandings() {
  return getJson('standings/now', 60_000);
}

/** One team's full regular-season schedule, as { id, date, home, away, state } in date order. */
export async function getClubSchedule(abbrev) {
  const json = await getJson(`club-schedule-season/${abbrev}/now`, 6 * 3600_000);
  return (json.games ?? [])
    .filter((g) => g.gameType === 2)
    .map((g) => ({ id: g.id, date: g.gameDate, home: g.homeTeam.abbrev, away: g.awayTeam.abbrev, state: g.gameState }))
    .sort((a, b) => a.date.localeCompare(b.date) || a.id - b.id);
}

// Season rollups of the per-game numbers we compute ourselves (SAT and momentum).
// Pure functions, no fetching, safe in the browser (the player pages and a future
// stats page import this file) and in Node (the data scripts).
//
// One season file holds a running total per player, so a new game is just added in:
//
//   { season: 20262027, gameType: 2, v: SEASON_VERSION, games: 312, updated: "...",
//     players: { "8478402": { n: "Connor McDavid", t: "EDM", p: "C", gp: 24, sat: 98, sog: 66,
//                             mom: 41.3, mp: 55.0, mn: -13.7, toi: 33840 } } }
//
// n name, t team (latest), p position, gp games played, sat own shot attempts (on goal, missed
// or blocked), sog shots on goal, mom momentum impact (mp the positive part, mn the negative
// part), toi seconds on ice (only when the game had a box score; older seasons are built from
// play-by-play alone and leave it out).
import { computeMomentum } from './momentum.js';

// Bump when how a game line is computed changes (momentum weights, what counts as an attempt):
// the backfill then rebuilds the saved seasons instead of mixing old and new numbers.
export const SEASON_VERSION = 2; // 2: backup goalies who never went in no longer count as a game played

/** First season the NHL play-by-play has every event with rink coordinates (needed for momentum). */
export const FIRST_FULL_SEASON = 20092010;

const t = (v) => (v && typeof v === 'object' ? v.default : v) ?? '';
const round1 = (n) => Math.round(n * 10) / 10;
const ATTEMPTS = new Set(['goal', 'shot-on-goal', 'missed-shot', 'blocked-shot']);

/** "20262027" -> "2026-27" */
export function seasonLabel(season) {
  const s = String(season);
  return `${s.slice(0, 4)}-${s.slice(6, 8)}`;
}

/** The season a date (YYYY-MM-DD) falls in: from September on it's the new season. */
export function seasonOf(date) {
  const [y, m] = String(date).split('-').map(Number);
  const start = m >= 9 ? y : y - 1;
  return Number(`${start}${start + 1}`);
}

/**
 * One line per player who dressed, from a box score we built (src/gameDetail.js).
 * Goalies come back with gp only: SAT and momentum are skater numbers.
 */
export function linesFromDetail(detail) {
  const out = [];
  for (const side of ['away', 'home']) {
    const team = detail?.[side]?.abbrev ?? '';
    const p = detail?.players?.[side] ?? {};
    for (const s of [...(p.forwards ?? []), ...(p.defense ?? [])]) {
      out.push({
        id: s.id, name: s.fullName ?? s.name, team, pos: s.position,
        sat: s.attempts ?? 0, sog: s.sog ?? 0,
        mom: s.momentum ?? 0, mp: s.momentumParts?.pos ?? Math.max(0, s.momentum ?? 0), mn: s.momentumParts?.neg ?? Math.min(0, s.momentum ?? 0),
        toi: s.toiSeconds ?? null,
      });
    }
    for (const g of p.goalies ?? []) if (g.played) out.push({ id: g.id, name: g.fullName ?? g.name, team, pos: 'G', toi: g.toiSeconds ?? null });
  }
  return out;
}

/**
 * The same lines from the raw NHL play-by-play alone (used for past seasons, one request a game).
 * Every dressed player counts as a game played, like the NHL's own GP. No time on ice.
 */
export function linesFromPbp(pbp) {
  if (!pbp?.plays?.length) return [];
  const awayId = pbp.awayTeam?.id;
  const abbrev = { [pbp.awayTeam?.id]: pbp.awayTeam?.abbrev, [pbp.homeTeam?.id]: pbp.homeTeam?.abbrev };
  const momentum = computeMomentum(pbp, awayId).players;
  const att = new Map();
  for (const e of pbp.plays) {
    if (!ATTEMPTS.has(e.typeDescKey) || e.periodDescriptor?.periodType === 'SO') continue;
    const id = e.details?.shootingPlayerId ?? e.details?.scoringPlayerId;
    if (!id) continue;
    const a = att.get(id) ?? { sat: 0, sog: 0 };
    a.sat++;
    if (e.typeDescKey === 'goal' || e.typeDescKey === 'shot-on-goal') a.sog++;
    att.set(id, a);
  }
  // A dressed backup goalie who never went in didn't play (the NHL doesn't count that as a game).
  const inNet = new Set(pbp.plays.map((e) => e.details?.goalieInNetId).filter(Boolean));
  return (pbp.rosterSpots ?? []).filter((r) => r.positionCode !== 'G' || inNet.has(r.playerId)).map((r) => {
    const base = { id: r.playerId, name: `${t(r.firstName)} ${t(r.lastName)}`.trim(), team: abbrev[r.teamId] ?? '', pos: r.positionCode };
    if (r.positionCode === 'G') return { ...base, toi: null };
    const m = momentum[r.playerId];
    const a = att.get(r.playerId) ?? { sat: 0, sog: 0 };
    return { ...base, sat: a.sat, sog: a.sog, mom: m?.impact ?? 0, mp: m?.pos ?? 0, mn: m?.neg ?? 0, toi: null };
  });
}

export function emptySeason(season, gameType = 2) {
  return { season: Number(season), gameType, v: SEASON_VERSION, games: 0, updated: null, players: {} };
}

/** Adds one game's lines into a season total (in place) and returns it. */
export function addGame(total, lines) {
  total.games++;
  for (const l of lines) {
    const key = String(l.id);
    const p = total.players[key] ?? (total.players[key] = { n: l.name, t: l.team, p: l.pos, gp: 0 });
    p.n = l.name || p.n;
    p.t = l.team || p.t;
    p.p = l.pos || p.p;
    p.gp++;
    if (l.pos !== 'G') {
      p.sat = (p.sat ?? 0) + (l.sat ?? 0);
      p.sog = (p.sog ?? 0) + (l.sog ?? 0);
      p.mom = round1((p.mom ?? 0) + (l.mom ?? 0));
      p.mp = round1((p.mp ?? 0) + (l.mp ?? 0));
      p.mn = round1((p.mn ?? 0) + (l.mn ?? 0));
    }
    if (l.toi != null) p.toi = (p.toi ?? 0) + l.toi;
  }
  return total;
}

/** Per-game averages for one player's season row (null when the player has no games). */
export function perGame(row) {
  if (!row?.gp) return null;
  const skater = row.p !== 'G';
  return {
    gp: row.gp,
    satPerGame: skater ? (row.sat ?? 0) / row.gp : null,
    sogPerGame: skater ? (row.sog ?? 0) / row.gp : null,
    momPerGame: skater ? (row.mom ?? 0) / row.gp : null,
    momPosPerGame: skater ? (row.mp ?? 0) / row.gp : null,
    momNegPerGame: skater ? (row.mn ?? 0) / row.gp : null,
    // Only where every game had time on ice (the current season); per 60 minutes.
    satPer60: skater && row.toi ? ((row.sat ?? 0) * 3600) / row.toi : null,
    momPer60: skater && row.toi ? ((row.mom ?? 0) * 3600) / row.toi : null,
    toiPerGame: row.toi ? row.toi / row.gp : null,
  };
}

/** Fewest games to make a leaderboard: a quarter of the most anyone has played, at least 1. */
export function minGames(total) {
  const most = Math.max(0, ...Object.values(total?.players ?? {}).map((p) => p.gp));
  return Math.max(1, Math.ceil(most / 4));
}

/**
 * Skaters ranked by a per-game number ('satPerGame', 'momPerGame', ...), best first.
 * Options: pos 'F' | 'D' | null, minGp (defaults to minGames).
 */
export function leaderboard(total, key, { pos = null, minGp = minGames(total) } = {}) {
  const rows = [];
  for (const [id, row] of Object.entries(total?.players ?? {})) {
    if (row.p === 'G' || row.gp < minGp) continue;
    if (pos === 'D' && row.p !== 'D') continue;
    if (pos === 'F' && row.p === 'D') continue;
    const avg = perGame(row);
    if (avg[key] == null) continue;
    rows.push({ id: Number(id), ...row, ...avg, value: avg[key] });
  }
  rows.sort((a, b) => b.value - a.value);
  rows.forEach((r, i) => { r.rank = i && rows[i - 1].value === r.value ? rows[i - 1].rank : i + 1; });
  return rows;
}

/** { rank, of } for one player on a leaderboard, or null when they don't qualify. */
export function rankOf(total, id, key, opts) {
  const board = leaderboard(total, key, opts);
  const hit = board.find((r) => r.id === Number(id));
  return hit ? { rank: hit.rank, of: board.length } : null;
}

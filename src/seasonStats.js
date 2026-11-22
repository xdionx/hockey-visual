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
//
// `g` keeps one short row per game (see GAME_FIELDS) so the momentum stats page can test the model
// against results: who won, team momentum with and without goals, team shot attempts.
import { computeMomentum } from './momentum.js';
import { shotXg, finishingPct } from './xg.js';

// Bump when how a game line is computed changes (momentum weights, what counts as an attempt):
// the backfill then rebuilds the saved seasons instead of mixing old and new numbers.
// 2: backup goalies who never went in no longer count as a game played. 3: game rows (`g`).
// 4: momentum model v4 (shots and penalties only, home plate 3x, goals count as shots in "no goals").
// 5: finishing (xg = expected goals from the player's shots on a goalie, xgg = goals on a goalie), goalie
//    goals against vs expected (ga, xga, gs = games started), and each game's starting goalies (ags, hgs).
export const SEASON_VERSION = 5;

/** First season the NHL play-by-play has every event with rink coordinates (needed for momentum). */
export const FIRST_FULL_SEASON = 20092010;

const t = (v) => (v && typeof v === 'object' ? v.default : v) ?? '';
const round1 = (n) => Math.round(n * 10) / 10;
const ATTEMPTS = new Set(['goal', 'shot-on-goal', 'missed-shot', 'blocked-shot']);

/**
 * Order of the values in a game row (total.g): game number, away and home team, goals, team momentum
 * (every push), team momentum without goals, team shot attempts, how it ended ('REG' | 'OT' | 'SO'), and
 * each team's starting goalie id (null when unknown).
 */
export const GAME_FIELDS = ['n', 'away', 'home', 'ag', 'hg', 'am', 'hm', 'an', 'hn', 'as', 'hs', 'end', 'ags', 'hgs'];
export const gameObj = (row) => Object.fromEntries(GAME_FIELDS.map((k, i) => [k, row[i]]));

const teamSat = (lines, team) => lines.reduce((n, l) => n + (l.team === team && l.pos !== 'G' ? l.sat ?? 0 : 0), 0);
const gameNo = (id) => Number(String(id).slice(-4));

/** A game row from a box score we built, or null when it has no momentum. */
export function gameFromDetail(detail, lines = linesFromDetail(detail)) {
  const m = detail?.momentum;
  if (!m?.totals) return null;
  const a = detail.away?.abbrev;
  const h = detail.home?.abbrev;
  const labels = (detail.linescore?.periods ?? []).map((p) => p.label);
  const end = detail.outcome ?? (labels.includes('SO') ? 'SO' : labels.some((l) => /OT/.test(l)) ? 'OT' : 'REG');
  return [gameNo(detail.id), a, h, detail.away?.score ?? 0, detail.home?.score ?? 0, m.totals.away, m.totals.home,
    m.totalsNoGoals?.away ?? null, m.totalsNoGoals?.home ?? null, teamSat(lines, a), teamSat(lines, h), end,
    starterOf(detail.players?.away?.goalies), starterOf(detail.players?.home?.goalies)];
}
const starterOf = (goalies) => (goalies ?? []).find((g) => g.starter)?.id ?? (goalies ?? []).find((g) => g.played)?.id ?? null;

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
        sat: s.attempts ?? 0, sog: s.sog ?? 0, ...(s.xg != null ? { xg: s.xg, xgg: s.xgGoals ?? 0 } : {}),
        mom: s.momentum ?? 0, mp: s.momentumParts?.pos ?? Math.max(0, s.momentum ?? 0), mn: s.momentumParts?.neg ?? Math.min(0, s.momentum ?? 0),
        toi: s.toiSeconds ?? null,
      });
    }
    for (const g of p.goalies ?? []) {
      if (!g.played) continue;
      out.push({ id: g.id, name: g.fullName ?? g.name, team, pos: 'G', toi: g.toiSeconds ?? null,
        ...(g.xga != null ? { ga: g.goalsAgainst ?? 0, xga: g.xga } : {}), st: g.starter ? 1 : 0 });
    }
  }
  return out;
}

/**
 * The same lines from the raw NHL play-by-play alone (used for past seasons, one request a game).
 * Every dressed player counts as a game played, like the NHL's own GP. No time on ice.
 */
export function linesFromPbp(pbp) {
  return fromPbp(pbp).lines;
}

/** Player lines and the game row from one raw play-by-play (momentum computed once). */
export function fromPbp(pbp) {
  if (!pbp?.plays?.length) return { lines: [], game: null };
  const awayId = pbp.awayTeam?.id;
  const abbrev = { [pbp.awayTeam?.id]: pbp.awayTeam?.abbrev, [pbp.homeTeam?.id]: pbp.homeTeam?.abbrev };
  const mom = computeMomentum(pbp, awayId);
  const momentum = mom.players;
  const att = new Map();
  for (const e of pbp.plays) {
    if (!ATTEMPTS.has(e.typeDescKey) || e.periodDescriptor?.periodType === 'SO') continue;
    const id = e.details?.shootingPlayerId ?? e.details?.scoringPlayerId;
    if (!id) continue;
    const a = att.get(id) ?? { sat: 0, sog: 0, xg: 0, xgg: 0 };
    a.sat++;
    if (e.typeDescKey === 'goal' || e.typeDescKey === 'shot-on-goal') {
      a.sog++;
      // Finishing only counts shots with a goalie in net (an empty-net goal says nothing about finishing).
      const p = e.details?.goalieInNetId ? shotXg({ x: e.details.xCoord, y: e.details.yCoord, shotType: e.details.shotType }) : null;
      if (p != null) { a.xg += p; if (e.typeDescKey === 'goal') a.xgg++; }
    }
    att.set(id, a);
  }
  // A dressed backup goalie who never went in didn't play (the NHL doesn't count that as a game).
  const inNet = new Set(pbp.plays.map((e) => e.details?.goalieInNetId).filter(Boolean));
  // Goals against and expected goals against per goalie, and who started for each team.
  const gk = new Map();
  const starters = {};
  const teamOf = new Map((pbp.rosterSpots ?? []).map((r) => [r.playerId, r.teamId]));
  for (const e of [...pbp.plays].sort((x, y) => (x.sortOrder ?? 0) - (y.sortOrder ?? 0))) {
    if ((e.typeDescKey !== 'goal' && e.typeDescKey !== 'shot-on-goal') || e.periodDescriptor?.periodType === 'SO') continue;
    const d = e.details ?? {};
    if (!d.goalieInNetId) continue;
    const team = teamOf.get(d.goalieInNetId);
    if (team != null && starters[team] == null) starters[team] = d.goalieInNetId;
    const p = shotXg({ x: d.xCoord, y: d.yCoord, shotType: d.shotType });
    if (p == null) continue;
    const g = gk.get(d.goalieInNetId) ?? { ga: 0, xga: 0 };
    g.xga += p;
    if (e.typeDescKey === 'goal') g.ga++;
    gk.set(d.goalieInNetId, g);
  }
  const lines = (pbp.rosterSpots ?? []).filter((r) => r.positionCode !== 'G' || inNet.has(r.playerId)).map((r) => {
    const base = { id: r.playerId, name: `${t(r.firstName)} ${t(r.lastName)}`.trim(), team: abbrev[r.teamId] ?? '', pos: r.positionCode };
    if (r.positionCode === 'G') {
      const g = gk.get(r.playerId) ?? { ga: 0, xga: 0 };
      return { ...base, toi: null, ga: g.ga, xga: Math.round(g.xga * 100) / 100, st: starters[r.teamId] === r.playerId ? 1 : 0 };
    }
    const m = momentum[r.playerId];
    const a = att.get(r.playerId) ?? { sat: 0, sog: 0, xg: 0, xgg: 0 };
    return { ...base, sat: a.sat, sog: a.sog, xg: Math.round(a.xg * 100) / 100, xgg: a.xgg, mom: m?.impact ?? 0, mp: m?.pos ?? 0, mn: m?.neg ?? 0, toi: null };
  });
  const a = pbp.awayTeam?.abbrev;
  const h = pbp.homeTeam?.abbrev;
  const game = [gameNo(pbp.id), a, h, pbp.awayTeam?.score ?? 0, pbp.homeTeam?.score ?? 0, mom.totals.away, mom.totals.home,
    mom.totalsNoGoals.away, mom.totalsNoGoals.home, teamSat(lines, a), teamSat(lines, h),
    pbp.gameOutcome?.lastPeriodType ?? pbp.plays.at(-1)?.periodDescriptor?.periodType ?? 'REG',
    starters[pbp.awayTeam?.id] ?? null, starters[pbp.homeTeam?.id] ?? null];
  return { lines, game };
}

export function emptySeason(season, gameType = 2) {
  return { season: Number(season), gameType, v: SEASON_VERSION, games: 0, updated: null, players: {}, g: [] };
}

/** Adds one game's lines (and its game row, when given) into a season total (in place) and returns it. */
export function addGame(total, lines, game = null) {
  total.games++;
  if (game) (total.g ??= []).push(game);
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
      if (l.xg != null) { p.xg = Math.round(((p.xg ?? 0) + l.xg) * 100) / 100; p.xgg = (p.xgg ?? 0) + (l.xgg ?? 0); }
      p.mom = round1((p.mom ?? 0) + (l.mom ?? 0));
      p.mp = round1((p.mp ?? 0) + (l.mp ?? 0));
      p.mn = round1((p.mn ?? 0) + (l.mn ?? 0));
    } else if (l.xga != null) {
      p.ga = (p.ga ?? 0) + (l.ga ?? 0);
      p.xga = Math.round(((p.xga ?? 0) + l.xga) * 100) / 100;
      p.gs = (p.gs ?? 0) + (l.st ?? 0);
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
    // Finishing: goals on a goalie per expected goal x 100 (100 = average), and goals above expected.
    xg: skater && row.xg != null ? row.xg : null,
    finPct: skater && row.xg != null ? finishingPct(row.xgg ?? 0, row.xg) : null,
    gax: skater && row.xg != null ? (row.xgg ?? 0) - row.xg : null,
  };
}

/** Fewest games to make a leaderboard: a quarter of the most anyone has played, at least 1. */
export function minGames(total) {
  const most = Math.max(0, ...Object.values(total?.players ?? {}).map((p) => p.gp));
  return Math.max(1, Math.ceil(most / 4));
}

/**
 * Skaters ranked by a per-game number ('satPerGame', 'momPerGame', ...), best first.
 * Options: pos 'F' | 'D' | null, minGp (defaults to minGames), minXg (fewest expected goals, for finishing ranks).
 */
export function leaderboard(total, key, { pos = null, minGp = minGames(total), minXg = 0 } = {}) {
  const rows = [];
  for (const [id, row] of Object.entries(total?.players ?? {})) {
    if (row.p === 'G' || row.gp < minGp || (minXg && (row.xg ?? 0) < minXg)) continue;
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

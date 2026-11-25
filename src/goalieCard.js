// Goalie card v2: pure helpers for the grouped goalie page (league table, per-start rows from game files,
// summaries for All games / Last 10). Nothing here touches the DOM.
import { shotXg } from './xg.js';
import { plateArea } from './momentum.js';
import { goalieLineOf, leagueRate, leagueSavePct, qualityStarts, isQualityStart, gameObj, SOFT_XG } from './seasonStats.js';
import { areaBase } from './areas.js';

export const LEAGUE_MIN_STARTS = 5;

/** Is the shot from inside the home plate? (inner or outer plate) */
export const insidePlate = (x, y) => {
  const a = plateArea(x, y);
  return a === 'inner' || a === 'outer';
};

/**
 * Every goalie with enough starts, with the numbers the league-rank strips compare, plus league totals.
 * { rows: [{ id, name, gp, gs, sv, gsaxPerGame, gsax, qsPct, inSv, outSv, softPer }], lgQsPct, lgSv, inRate, outRate, rate, median }
 */
export function leagueGoalies(total, minStarts = LEAGUE_MIN_STARTS) {
  const rate = leagueRate(total);
  const lgSv = leagueSavePct(total);
  const base = areaBase(total);
  const rows = [];
  let qs = 0;
  let starts = 0;
  for (const [id, r] of Object.entries(total?.players ?? {})) {
    if (r.p !== 'G') continue;
    const q = qualityStarts(r, lgSv);
    if (q) { qs += q.qs; starts += q.starts; }
    if ((r.gs ?? 0) < minStarts) continue;
    const l = goalieLineOf(r, rate, lgSv);
    const has = r.psa != null;
    rows.push({
      id: Number(id), name: r.n, team: r.t, gp: r.gp, gs: r.gs, gsax: l.gsax, gsaxPerGame: l.gsaxPerGame, qsPct: l.qsPct,
      sv: r.sa ? 1 - (r.sg ?? 0) / r.sa : null,
      inSv: has && r.psa ? 1 - (r.pga ?? 0) / r.psa : null,
      outSv: has && r.osa ? 1 - (r.oga ?? 0) / r.osa : null,
      softPer: has && r.gs ? (r.sf ?? 0) / r.gs : null,
      rating: (r.rn ?? 0) >= 3 ? r.rt / r.rn : null, rated: r.rn ?? 0,
    });
  }
  return { rows, lgQsPct: starts ? qs / starts : null, lgSv, rate, inRate: base.inRate, outRate: base.outRate };
}

/** Where a value sits among the league's: { rank, of } (1 = best), higher or lower being better. Nulls are ignored. */
export function rankAmong(values, v, higherBetter = true) {
  const vals = values.filter((x) => x != null);
  if (v == null || !vals.length) return null;
  return { rank: 1 + vals.filter((x) => (higherBetter ? x > v : x < v)).length, of: vals.length, tied: vals.filter((x) => x === v).length > 1 };
}

export const median = (values) => {
  const v = values.filter((x) => x != null).sort((a, b) => a - b);
  return v.length ? v[Math.floor(v.length / 2)] : null;
};

/** Game ids (regular season) a team played in a season file, oldest first. Playoff game numbers are not series ids, so those return []. */
export function teamGameIds(total, team) {
  if (!total?.g || (total.gameType ?? 2) !== 2) return [];
  const season = String(total.season).slice(0, 4);
  return total.g.map(gameObj).filter((g) => g.away === team || g.home === team).map((g) => ({ id: `${season}02${String(g.n).padStart(4, '0')}`, starter: g.away === team ? g.ags : g.hgs }));
}

const clock = (t) => String(t ?? '').trim();

/**
 * One goalie's start from a saved game file (data/games/<id>.json): shots with the plate / soft flags, goals
 * with their highlight clip, and expected goals. Returns null when he never faced a shot.
 */
export function startFromGame(game, id, rate = 1, lgSv = null) {
  const mine = (game?.shots ?? []).filter((s) => Number(s.goalieId) === Number(id) && (s.kind === 'sog' || s.kind === 'goal'));
  if (!mine.length) return null;
  const goalTeam = mine[0].team; // the shooting side
  const oppSide = goalTeam;
  const mySide = goalTeam === 'away' ? 'home' : 'away';
  const scoring = new Map((game.scoring ?? []).map((s) => [`${s.period}|${clock(s.time)}`, s]));
  let xga = 0;
  const shots = [];
  const goals = [];
  for (const s of mine) {
    const p = shotXg({ x: s.x, y: s.y, shotType: s.shotType });
    xga += p ?? 0;
    const goal = s.kind === 'goal';
    const inside = insidePlate(s.x, s.y);
    const soft = goal && !inside && p != null && p < SOFT_XG;
    shots.push({ x: s.x, y: s.y, goal, inside, soft, p, type: s.shotType });
    if (goal) {
      const sc = scoring.get(`${s.period}|${clock(s.time)}`);
      goals.push({ period: s.period, time: clock(s.time), x: s.x, y: s.y, p, inside, soft, type: s.shotType, scorer: sc?.scorer?.fullName ?? sc?.scorer?.name ?? null, clipId: sc?.highlightId ?? null, clipHref: sc?.highlight ?? null, shotType: s.shotType });
      shots[shots.length - 1].gi = goals.length - 1; // index into goals[]
    }
  }
  const sa = shots.length;
  const ga = goals.length;
  const expected = xga * rate;
  return {
    id: game.id, date: game.gameDate, opp: game[oppSide]?.abbrev ?? '', home: mySide === 'home', sa, ga, xga: expected, gsax: expected - ga,
    qs: lgSv == null ? null : isQualityStart([sa, ga], lgSv), shots, goals,
  };
}

/** Totals for a list of starts (the card's All games / Last 10 numbers). */
export function summarize(starts) {
  const a = { n: starts.length, sa: 0, ga: 0, xga: 0, qs: 0, inSa: 0, inGa: 0, outSa: 0, outGa: 0, soft: 0, bad: 0, so: 0 };
  for (const s of starts) {
    a.sa += s.sa; a.ga += s.ga; a.xga += s.xga;
    if (s.qs) a.qs++;
    if (s.gsax <= -2) a.bad++;
    if (s.ga === 0) a.so++;
    for (const sh of s.shots) {
      if (sh.inside) { a.inSa++; if (sh.goal) a.inGa++; } else { a.outSa++; if (sh.goal) a.outGa++; }
      if (sh.soft) a.soft++;
    }
  }
  a.gsax = a.xga - a.ga;
  a.sv = a.sa ? 1 - a.ga / a.sa : null;
  a.expSv = a.sa ? 1 - a.xga / a.sa : null;
  return a;
}

/** Goals kept out (+) or let in (-) in a zone against the league goal rate there. */
export const zoneVs = (sa, ga, rate) => (rate == null ? null : sa * rate - ga);

/** Spider graph axes: each is the share of the league's goalies (5+ starts) he is ahead of, 0-100 (100 = best of all). */
export const RADAR_AXES = [
  { key: 'gsax', label: 'Saves vs exp', tip: 'GSAx per game', get: (g) => g.gsaxPerGame, hi: true },
  { key: 'sv', label: 'Save %', tip: 'Save %', get: (g) => g.sv, hi: true },
  { key: 'qs', label: 'Quality starts', tip: 'Quality start %', get: (g) => g.qsPct, hi: true },
  { key: 'inn', label: 'Inside plate', tip: 'Save % inside the home plate', get: (g) => g.inSv, hi: true },
  { key: 'out', label: 'Outside plate', tip: 'Save % outside the home plate', get: (g) => g.outSv, hi: true },
  { key: 'soft', label: 'Perimeter goals', tip: 'Perimeter goals per start (fewer is better)', get: (g) => g.softPer, hi: false },
];

/** [{ key, label, tip, value, pct, rank }] for the axes this goalie has numbers for (league table from leagueGoalies). */
export function radarPoints(lg, id) {
  const me = lg.rows.find((g) => g.id === Number(id));
  if (!me) return [];
  return RADAR_AXES.map((a) => {
    const vals = lg.rows.map(a.get).filter((v) => v != null);
    const value = a.get(me);
    if (value == null || vals.length < 3) return null;
    const rank = rankAmong(vals, value, a.hi);
    return { key: a.key, label: a.label, tip: a.tip, value, pct: Math.round(((rank.of - rank.rank) / (rank.of - 1)) * 100), rank };
  }).filter(Boolean);
}

/** The Stats page goalie table: one row per goalie with enough starts, each stat with its NHL rank, plus the NHL averages. */
export const GOALIE_COLS = [
  ['rating', 'Game score', true], ['sv', 'SV%', true], ['gsax', 'GSAx', true], ['svx', 'SV% vs exp', true],
  ['inSv', 'Home plate SV%', true], ['outSv', 'Perimeter SV%', true], ['sfPer', 'Perimeter goals/start', false], ['qsPct', 'QS%', true],
];

/**
 * total = the season file, win = a window total (each team's last games, from recentAll) or null for the whole season.
 * Ranks are among the goalies shown (before any team filter): { rank, of, tied }, 1 = best.
 * { rows: [{ id, name, team, gp, gs, rating, sv, gsax, svx, inSv, outSv, sf, sfPer, qs, qsStarts, qsPct, rank: { key: {rank, of, tied} } }], avg, min }
 */
export function goalieTable(total, { win = null, minStarts = null } = {}) {
  const src = win ?? total;
  if (!src?.players) return null;
  const rate = leagueRate(total);
  const lgSv = leagueSavePct(total);
  const min = minStarts ?? (win ? 2 : (total.gameType === 3 ? 2 : LEAGUE_MIN_STARTS));
  const ratingMin = win ? 3 : 5;
  const rows = [];
  const sum = { sa: 0, sg: 0, psa: 0, pga: 0, osa: 0, oga: 0, sf: 0, gs: 0, rt: 0, rn: 0, qs: 0, st: 0 };
  for (const [id, r] of Object.entries(src.players)) {
    if (r.p !== 'G' || !r.t || (r.gs ?? 0) < min || r.xga == null) continue;
    const l = goalieLineOf(r, rate, lgSv);
    const q = qualityStarts(r, lgSv);
    const has = r.psa != null;
    rows.push({
      id: Number(id), name: r.n, team: r.t, gp: r.gp, gs: r.gs,
      rating: (r.rn ?? 0) >= ratingMin ? r.rt / r.rn : null,
      sv: r.sa ? 1 - (r.sg ?? 0) / r.sa : null, gsax: l.gsax, svx: r.sa ? l.gsax / r.sa : null,
      inSv: has && r.psa ? 1 - (r.pga ?? 0) / r.psa : null, outSv: has && r.osa ? 1 - (r.oga ?? 0) / r.osa : null,
      sf: has ? r.sf ?? 0 : null, sfPer: has && r.gs ? (r.sf ?? 0) / r.gs : null,
      qs: q?.qs ?? null, qsStarts: q?.starts ?? null, qsPct: q?.qsPct ?? null, rank: {},
    });
    for (const k of ['sa', 'sg', 'psa', 'pga', 'osa', 'oga', 'sf', 'gs', 'rt', 'rn']) sum[k] += r[k] ?? 0;
    if (q) { sum.qs += q.qs; sum.st += q.starts; }
  }
  for (const [key, , hi] of GOALIE_COLS) {
    const vals = rows.map((r) => r[key]);
    for (const r of rows) r.rank[key] = rankAmong(vals, r[key], hi);
  }
  const avg = {
    rating: sum.rn ? sum.rt / sum.rn : null, sv: sum.sa ? 1 - sum.sg / sum.sa : null, gsax: 0, svx: 0,
    inSv: sum.psa ? 1 - sum.pga / sum.psa : null, outSv: sum.osa ? 1 - sum.oga / sum.osa : null,
    sfPer: sum.psa && sum.gs ? sum.sf / sum.gs : null, qsPct: sum.st ? sum.qs / sum.st : null,
  };
  return { rows, avg, min, lgSv };
}

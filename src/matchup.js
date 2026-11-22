// Pregame matchup numbers from a season file: each team's season-to-date play driving, chances,
// finishing and goaltending with league ranks, goalie ranks, and each team's top skaters.
// Pure; no fetching. Used by the box score's Pregame view (public/game/d6-pregame.js).
import { gameObj, perGame } from './seasonStats.js';

/** How each team metric reads: true when fewer is better. */
export const LOWER_BETTER = { satAgPg: true, xgaPg: true };

const METRICS = {
  momShare: (t) => t.momF / (t.momF + t.momA), // momentum share, goals left out
  satShare: (t) => t.satF / (t.satF + t.satA),
  satPg: (t) => t.satF / t.gp,
  satAgPg: (t) => t.satA / t.gp,
  xgPg: (t, r) => (t.xgF * r) / t.gp, // goals an average shooter would score on these shots
  xgaPg: (t, r) => (t.xgA * r) / t.gp,
  finish: (t, r) => (t.ggF - t.xgF * r) / t.gp, // goals above an average shooter, per game
  saveAbove: (t, r) => (t.xgA * r - t.ggA) / t.gp, // goals saved above expected, per game
};

/**
 * Every team's metrics with league ranks (1 = best): Map(abbrev -> { gp, [metric]: { v, rank } }).
 * Rows before game number n only, so an old game shows the numbers as they stood that day.
 */
export function teamTable(total, rate = 1, n = Infinity) {
  const T = new Map();
  const get = (k) => T.get(k) ?? (T.set(k, { gp: 0, momF: 0, momA: 0, satF: 0, satA: 0, xgF: 0, xgA: 0, ggF: 0, ggA: 0, fin: 0 }), T.get(k));
  for (const g of (total?.g ?? []).map(gameObj)) {
    if (g.n >= n || g.an == null || g.hn == null) continue;
    for (const [s, o, team] of [['a', 'h', g.away], ['h', 'a', g.home]]) {
      const t = get(team);
      t.gp++;
      t.momF += g[`${s}n`]; t.momA += g[`${o}n`];
      t.satF += g[`${s}s`] ?? 0; t.satA += g[`${o}s`] ?? 0;
      if (g.axg != null && g.hxg != null) {
        t.fin++;
        t.xgF += g[`${s}xg`]; t.xgA += g[`${o}xg`]; t.ggF += g[`${s}gg`] ?? 0; t.ggA += g[`${o}gg`] ?? 0;
      }
    }
  }
  const out = new Map([...T].map(([k, t]) => [k, { gp: t.gp }]));
  for (const [key, f] of Object.entries(METRICS)) {
    const finishing = ['xgPg', 'xgaPg', 'finish', 'saveAbove'].includes(key);
    const vals = [...T].map(([k, t]) => [k, finishing ? (t.fin ? f({ ...t, gp: t.fin }, rate) : null) : f(t, rate)]).filter(([, v]) => v != null && Number.isFinite(v));
    vals.sort((a, b) => (LOWER_BETTER[key] ? a[1] - b[1] : b[1] - a[1]));
    vals.forEach(([k, v], i) => { out.get(k)[key] = { v, rank: i + 1 }; });
  }
  out.teams = T.size;
  return out;
}

/** Goals saved above expected for one goalie this season and rank among goalies with minStarts+. */
export function goalieLine(total, id, rate = 1, minStarts = 5) {
  const players = total?.players ?? {};
  const gsax = (p) => (p?.xga != null ? p.xga * rate - (p.ga ?? 0) : null);
  const p = players[String(id)];
  if (!p) return null;
  const list = Object.entries(players).filter(([, q]) => q.p === 'G' && (q.gs ?? 0) >= minStarts && q.xga != null)
    .map(([k, q]) => [k, gsax(q)]).sort((a, b) => b[1] - a[1]);
  const at = list.findIndex(([k]) => k === String(id));
  return { id: Number(id), name: p.n, gp: p.gp ?? 0, gs: p.gs ?? 0, gsax: gsax(p), rank: at >= 0 ? at + 1 : null, of: list.length };
}

/** A team's goalies who started this season, most starts first. */
export function teamGoalies(total, team, rate = 1) {
  return Object.entries(total?.players ?? {}).filter(([, p]) => p.p === 'G' && p.t === team && (p.gs ?? 0) > 0)
    .map(([id]) => goalieLine(total, id, rate)).sort((a, b) => b.gs - a.gs);
}

/** A team's skaters by momentum per game (minGp+ games): [{ id, name, pos, gp, momPg, satPg, gax, above, below }]. */
export function teamSkaters(total, team, rate = 1, { n = 6, minGp = 5 } = {}) {
  return Object.entries(total?.players ?? {})
    .filter(([, p]) => p.t === team && p.p !== 'G' && (p.gp ?? 0) >= minGp)
    .map(([id, p]) => {
      const pg = perGame(p, rate);
      return { id: Number(id), name: p.n, pos: p.p, gp: p.gp, momPg: pg.momPerGame, satPg: pg.satPerGame, gax: pg.gaa, above: pg.abovePct, below: pg.belowPct };
    })
    .sort((a, b) => b.momPg - a.momPg).slice(0, n);
}

// Compare view: every skater, goalie and team side by side on each area, colored by league percentile within the
// position group so the good ones show up next to the bad ones. Pure; works on a season-shaped total
// (a season file or recentAll()), plus deficiencies() for the team columns.
import { leagueRate, minGames, perGame, scoringBase } from './seasonStats.js';
import { areaBase, skaterAreas, goalieAreas, MIN } from './areas.js';
import { deficiencies } from './deficiencies.js';

// [key, label, short label, kind, higher is better, tooltip]
export const COLS = {
  skaters: [
    ['fin', 'Finishing', 'Fin', 'signed1', 1, 'Goals above an average shooter on the same shots'],
    ['vol', 'Shot volume', 'Shots', 'pct0', 1, 'Share of shot attempts that reach the net'],
    ['mom', 'Driving play', 'Play', 'signed1', 1, 'Momentum per game'],
    ['pen', 'Penalties', 'Pen', 'signed2', 1, 'Penalties drawn minus taken per game'],
    ['fo', 'Faceoffs', 'FO', 'pct0', 1, 'Faceoff win % (centers only)'],
    ['give', 'Giveaways', 'Give', 'dec1', -1, 'Giveaways per game (context only)'],
    ['rating', 'Game rating', 'Rtg', 'dec1', 1, 'Average game rating: our scorecard score (6.0 is an average night). Blends the other areas, so it is context for Overall.'],
  ],
  goalies: [
    ['gsax', 'Saved vs exp.', 'GSAx', 'signed1', 1, 'Goals saved above an average goalie on the same shots'],
    ['sv', 'Save %', 'Sv%', 'pct1', 1, 'Save percentage'],
    ['out', 'Outside plate', 'Out', 'signed1', 1, 'Goals saved vs average on shots from outside the home plate'],
    ['inn', 'Inside plate', 'In', 'signed1', 1, 'Goals saved vs average on shots in the home plate'],
    ['soft', 'Perimeter goals', 'Perim.', 'dec2', -1, 'Goals from outside the plate on shots worth under 6%, per start'],
  ],
  teams: [
    ['pts', 'Pts %', 'Pts', 'pct0', 1, 'Share of points'],
    ['play', 'Driving play', 'Play', 'signed2', 1, 'Goals per game vs an average team'],
    ['fin', 'Finishing', 'Fin', 'signed2', 1, 'Goals per game vs an average team'],
    ['gk', 'Goaltending', 'Goalie', 'signed2', 1, 'Goals per game vs an average team'],
    ['pp', 'Power play', 'PP', 'signed2', 1, 'Goals per game vs the league power-play rate'],
    ['pk', 'Penalty kill', 'PK', 'signed2', 1, 'Goals per game vs the league penalty-kill rate'],
    ['net', 'Net penalties', 'Net', 'signed1', -1, 'Penalties taken minus drawn per game'],
    ['fo', 'Faceoffs', 'FO', 'pct0', 1, 'Team faceoff win %'],
  ],
};
// Columns that do not count toward Overall or the standout chips.
const CONTEXT = new Set(['give', 'pts', 'rating']);

/** Rows for every qualifying skater / goalie / team: { id, name, team, pos, group, gp, v: { key: value|null } }. */
export function compareRows(total, { last = null, recent = null, recentTotal = null } = {}) {
  if (!total?.players) return null;
  const win = last ? recentTotal : null;
  const src = win ?? total;
  const rate = leagueRate(total);
  const sbase = scoringBase(total);
  const base = areaBase(src, { win: !!win });
  const w = win ? 1 : 0;
  const minGp = win ? 5 : Math.max(5, minGames(total));
  const skaters = [];
  const goalies = [];
  for (const [id, row] of Object.entries(src.players)) {
    if (!row.t) continue;
    if (row.p === 'G') {
      if ((row.gs ?? 0) < MIN.goalieStarts[w] || row.xga == null) continue;
      const pg = perGame(row, rate, sbase);
      const a = goalieAreas(row, base);
      goalies.push({ id: Number(id), name: row.n, team: row.t, pos: 'G', group: 'G', gp: row.gs, v: {
        gsax: pg.gsax ?? null, sv: row.sa ? 1 - (row.sg ?? row.ga) / row.sa : null, out: a?.out.ok ? a.out.vs : null, inn: a?.inn.ok ? a.inn.vs : null, soft: a && row.gs ? a.soft / row.gs : null, rating: (row.rn ?? 0) >= (win ? 3 : 5) ? row.rt / row.rn : null } });
      continue;
    }
    if (row.gp < minGp) continue;
    const pg = perGame(row, rate, sbase);
    const a = skaterAreas(row, base);
    skaters.push({ id: Number(id), name: row.n, team: row.t, pos: row.p, group: row.p === 'D' ? 'D' : 'F', gp: row.gp, v: {
      fin: row.xg != null ? pg.gaa : null, vol: a.vol?.share ?? null, mom: pg.momPerGame, pen: a.pen?.perGame ?? null, fo: a.fo?.pct ?? null, give: a.give?.perGame ?? null, rating: (row.rn ?? 0) >= (win ? 3 : 5) ? row.rt / row.rn : null } });
  }
  const d = deficiencies(total, win ? { last, recent } : {});
  const teams = (d?.teams ?? []).map((t) => ({ id: t.abbrev, name: t.abbrev, team: t.abbrev, pos: '', group: 'T', gp: t.gp, v: {
    pts: t.ptsPct, play: t.areas.play.value, fin: t.areas.finishing.value, gk: t.areas.goaltending.value,
    pp: t.special?.pp.value ?? null, pk: t.special?.pk.value ?? null, net: t.special?.disc.value ?? null, fo: t.special?.fo?.value ?? null } }));
  return { skaters, goalies, teams };
}

/** Adds r.pct[key] (0 = worst, 1 = best, within the row's group), r.overall, and r.good / r.bad (area labels in the top / bottom 15%). */
export function withPercentiles(rows, cols) {
  const groups = new Map();
  for (const r of rows) (groups.get(r.group) ?? groups.set(r.group, []).get(r.group)).push(r);
  for (const r of rows) { r.pct = {}; r.good = []; r.bad = []; }
  for (const [key, , , , hi] of cols) {
    for (const rs of groups.values()) {
      const vals = rs.filter((r) => r.v[key] != null);
      const sorted = vals.map((r) => r.v[key]).sort((a, b) => a - b);
      const den = Math.max(1, sorted.length - 1);
      for (const r of vals) {
        const below = sorted.filter((x) => x < r.v[key]).length / den;
        r.pct[key] = Math.min(1, hi > 0 ? below : 1 - below);
      }
    }
  }
  for (const r of rows) {
    const used = cols.filter((c) => !CONTEXT.has(c[0]));
    const ps = used.map((c) => r.pct[c[0]]).filter((p) => p != null);
    r.overall = ps.length ? ps.reduce((a, b) => a + b, 0) / ps.length : null;
    for (const c of used) {
      if (r.pct[c[0]] >= 0.85) r.good.push(c[1]);
      else if (r.pct[c[0]] <= 0.15) r.bad.push(c[1]);
    }
  }
  return rows;
}

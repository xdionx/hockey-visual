// How well the momentum model explains results, from a season file's game rows (seasonStats.js `g`).
// Pure functions, no fetching; the momentum stats page runs them in the browser.
import { gameObj, leagueRate, finishingLine } from './seasonStats.js';

export const games = (total) => (total?.g ?? []).map(gameObj).sort((a, b) => a.n - b.n);

const winner = (g) => (g.ag > g.hg ? 'away' : g.hg > g.ag ? 'home' : null);

/**
 * How often the team that won each battle won the game. Ties in a battle are left out.
 * mom: all momentum, ng: momentum without goals (the fair test: it can't count the result),
 * sat: shot attempts (the classic Corsi baseline), home: home team (the floor any model should beat).
 */
export function winRates(list) {
  const out = {};
  const battle = (key, pick) => {
    let n = 0;
    let won = 0;
    for (const g of list) {
      const w = winner(g);
      const side = pick(g);
      if (!w || !side) continue;
      n++;
      if (side === w) won++;
    }
    out[key] = { n, won, pct: n ? won / n : null };
  };
  const lead = (a, h) => (a == null || h == null || a === h ? null : a > h ? 'away' : 'home');
  battle('mom', (g) => lead(g.am, g.hm));
  battle('ng', (g) => lead(g.an, g.hn));
  battle('sat', (g) => lead(g.as, g.hs));
  battle('home', () => 'home');
  return out;
}

/**
 * Win % by how big a share of the game's momentum (without goals) or shot attempts a team had.
 * Every game counts twice, once from each side. Returns [{ lo, hi, ng: {n, pct}, sat: {n, pct} }].
 */
export const SHARE_BINS = [[0, 40], [40, 45], [45, 50], [50, 55], [55, 60], [60, 100]];
export function winByShare(list) {
  const bins = SHARE_BINS.map(([lo, hi]) => ({ lo, hi, ng: { n: 0, won: 0 }, sat: { n: 0, won: 0 } }));
  const put = (key, share, won) => {
    if (share == null || Number.isNaN(share)) return;
    const pct = share * 100;
    const b = bins.find((x) => pct >= x.lo && (pct < x.hi || (x.hi === 100 && pct <= 100)));
    b[key].n++;
    if (won) b[key].won++;
  };
  for (const g of list) {
    const w = winner(g);
    if (!w) continue;
    for (const side of ['away', 'home']) {
      const won = side === w;
      const [ngF, ngA] = side === 'away' ? [g.an, g.hn] : [g.hn, g.an];
      const [sF, sA] = side === 'away' ? [g.as, g.hs] : [g.hs, g.as];
      if (ngF != null && ngA != null && ngF + ngA > 0) put('ng', ngF / (ngF + ngA), won);
      if (sF + sA > 0) put('sat', sF / (sF + sA), won);
    }
  }
  for (const b of bins) for (const k of ['ng', 'sat']) b[k].pct = b[k].n ? b[k].won / b[k].n : null;
  return bins;
}

function blankTeam(abbrev) {
  return { abbrev, gp: 0, w: 0, l: 0, otw: 0, otl: 0, gf: 0, ga: 0, momF: 0, momA: 0, ngF: 0, ngA: 0, ngGp: 0, satF: 0, satA: 0, xgF: 0, ggF: 0, xgA: 0, ggA: 0, sogF: 0, finGp: 0 };
}

/**
 * Per-team season totals and shares from game rows. Regular season: l is regulation losses and otl
 * overtime/shootout losses (each earns a point, so ptsPct is points %). Playoffs (opts.playoffs): no points,
 * an overtime loss is a plain loss (l counts it), otw/otl are the overtime record, and ptsPct is the win %.
 */
export function teamTable(list, { playoffs = false } = {}) {
  const teams = new Map();
  const get = (a) => teams.get(a) ?? (teams.set(a, blankTeam(a)), teams.get(a));
  for (const g of list) {
    const w = winner(g);
    for (const side of ['away', 'home']) {
      const away = side === 'away';
      const t = get(away ? g.away : g.home);
      t.gp++;
      const gf = away ? g.ag : g.hg;
      const ga = away ? g.hg : g.ag;
      t.gf += gf;
      t.ga += ga;
      const over = g.end === 'OT' || g.end === 'SO';
      if (w === side) { t.w++; if (over) t.otw++; }
      else if (over) { t.otl++; if (playoffs) t.l++; }
      else t.l++;
      t.momF += away ? g.am : g.hm;
      t.momA += away ? g.hm : g.am;
      if (g.an != null && g.hn != null) {
        t.ngF += away ? g.an : g.hn;
        t.ngA += away ? g.hn : g.an;
        t.ngGp++;
      }
      t.satF += away ? g.as : g.hs;
      t.satA += away ? g.hs : g.as;
      if (g.axg != null && g.hxg != null) {
        t.xgF += away ? g.axg : g.hxg;
        t.xgA += away ? g.hxg : g.axg;
        t.ggF += away ? g.agg : g.hgg;
        t.ggA += away ? g.hgg : g.agg;
        t.sogF += (away ? g.asog : g.hsog) ?? 0;
        t.finGp++;
      }
    }
  }
  return [...teams.values()].map((t) => ({
    ...t,
    pts: 2 * t.w + t.otl,
    ptsPct: t.gp ? (playoffs ? t.w / t.gp : (2 * t.w + t.otl) / (2 * t.gp)) : null,
    winPct: t.gp ? t.w / t.gp : null,
    gdPerGame: t.gp ? (t.gf - t.ga) / t.gp : null,
    momShare: t.momF + t.momA ? t.momF / (t.momF + t.momA) : null,
    ngShare: t.ngF + t.ngA ? t.ngF / (t.ngF + t.ngA) : null,
    satShare: t.satF + t.satA ? t.satF / (t.satF + t.satA) : null,
    gfShare: t.gf + t.ga ? t.gf / (t.gf + t.ga) : null,
    momPerGame: t.gp ? (t.momF - t.momA) / t.gp : null,
  }));
}

/** Team finishing numbers against an average shooter (rate = leagueRate), nulls without xG. */
function finishing(goals, xg, sog, gp, rate) {
  if (!gp || !xg) return { finGoals: null, finSog: null, shPct: null, xShPct: null, gaa: null, gaaPerGame: null };
  const f = finishingLine(goals, xg, sog, rate);
  return { finGoals: goals, finSog: sog, shPct: f.shPct, xShPct: f.xShPct, gaa: f.gaa, gaaPerGame: f.gaa / gp };
}

/**
 * Team finishing from the skaters' season rows, grouped by each player's latest team. Used for seasons
 * saved before game rows carried team xG: close, but a traded player's whole season counts for his last team.
 */
export function teamFinishingFromPlayers(total, teams, rate = leagueRate(total)) {
  const sums = new Map();
  for (const p of Object.values(total?.players ?? {})) {
    if (p.p === 'G' || p.xg == null) continue;
    const s = sums.get(p.t) ?? { xg: 0, g: 0, sog: 0 };
    s.xg += p.xg;
    s.g += p.xgg ?? 0;
    s.sog += p.sog ?? 0;
    sums.set(p.t, s);
  }
  return teams.map((t) => {
    const s = sums.get(t.abbrev);
    return { ...t, ...(s ? finishing(s.g, s.xg, s.sog, t.gp, rate) : finishing(0, 0, 0, 0, rate)) };
  });
}

/** Pearson correlation of two equal-length number lists (null when it can't be computed). */
export function pearson(xs, ys) {
  const pairs = xs.map((x, i) => [x, ys[i]]).filter(([x, y]) => x != null && y != null && !Number.isNaN(x) && !Number.isNaN(y));
  const n = pairs.length;
  if (n < 3) return null;
  const mx = pairs.reduce((a, [x]) => a + x, 0) / n;
  const my = pairs.reduce((a, [, y]) => a + y, 0) / n;
  let sxy = 0;
  let sxx = 0;
  let syy = 0;
  for (const [x, y] of pairs) {
    sxy += (x - mx) * (y - my);
    sxx += (x - mx) ** 2;
    syy += (y - my) ** 2;
  }
  return sxx && syy ? sxy / Math.sqrt(sxx * syy) : null;
}

/**
 * Does a team's first-half share predict its second-half points %? The standard test for whether a
 * stat measures something real (luck doesn't carry over). Null until every team has 10+ games in each half.
 */
export function predictive(list) {
  if (!list.length) return null;
  const mid = list[Math.floor(list.length / 2)].n;
  const first = teamTable(list.filter((g) => g.n < mid));
  const second = new Map(teamTable(list.filter((g) => g.n >= mid)).map((t) => [t.abbrev, t]));
  const rows = first.filter((t) => second.has(t.abbrev));
  if (rows.length < 8 || rows.some((t) => t.gp < 10 || second.get(t.abbrev).gp < 10)) return null;
  const later = rows.map((t) => second.get(t.abbrev).ptsPct);
  return {
    teams: rows.length,
    ng: pearson(rows.map((t) => t.ngShare), later),
    mom: pearson(rows.map((t) => t.momShare), later),
    sat: pearson(rows.map((t) => t.satShare), later),
    gf: pearson(rows.map((t) => t.gfShare), later),
    pts: pearson(rows.map((t) => t.ptsPct), later),
  };
}

/** Everything the page shows for one season's games. */
export function seasonModel(total) {
  const list = games(total);
  const playoffs = total?.gameType === 3;
  // Team finishing comes from the game rows when every row has it, else from the player rows (approximate).
  const exactFin = list.length > 0 && list.every((g) => g.asog != null);
  const rate = leagueRate(total);
  const teams = exactFin
    ? teamTable(list, { playoffs }).map((t) => ({ ...t, ...finishing(t.ggF, t.xgF, t.sogF, t.finGp, rate) }))
    : teamFinishingFromPlayers(total, teamTable(list, { playoffs }), rate);
  const pts = teams.map((t) => t.ptsPct);
  return {
    playoffs,
    games: list.length,
    noGoalGames: list.filter((g) => g.an != null && g.hn != null).length,
    wins: winRates(list),
    bins: winByShare(list),
    teams,
    fit: {
      ng: pearson(teams.map((t) => t.ngShare), pts),
      mom: pearson(teams.map((t) => t.momShare), pts),
      sat: pearson(teams.map((t) => t.satShare), pts),
      fin: pearson(teams.map((t) => t.gaaPerGame), pts),
    },
    finRate: rate,
    finSource: teams.some((t) => t.gaa != null) ? (exactFin ? 'games' : 'players') : null,
    predictive: predictive(list),
    league: list.length ? {
      momPerTeamGame: list.reduce((a, g) => a + g.am + g.hm, 0) / (2 * list.length),
      satPerTeamGame: list.reduce((a, g) => a + g.as + g.hs, 0) / (2 * list.length),
      goalsPerTeamGame: list.reduce((a, g) => a + g.ag + g.hg, 0) / (2 * list.length),
    } : null,
  };
}

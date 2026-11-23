// Team deficiencies: where each team loses ground and which players it shows up in. Pure, no fetching;
// works on one season file (data/seasons/<season>.json, see src/seasonStats.js).
//
// Three areas in one unit, goals per game against an average team, so they can be ranked against each other
// (the same split as scripts/impact-lab: chances, own shooters, own goalie):
//   play        momentum built minus momentum allowed (goals left out), x 0.023 goals per momentum point
//   finishing   goals on a goalie minus what average NHL shooters would score from the same shots
//   goaltending what average NHL goalies would allow on the shots faced minus goals actually allowed
// Plus a few situational checks (home/road, the last 10 games, one-goal games) and the players behind it.
import { gameObj, leagueRate, minGames, perGame, scoringBase } from './seasonStats.js';
import { teamTable } from './momentumModel.js';
import { IMPACT } from './impact.js';

export const AREAS = [
  ['play', 'Driving play'],
  ['finishing', 'Finishing'],
  ['goaltending', 'Goaltending'],
];
const TROUBLE_GOALS = -0.1; // goals per game below average that count as a trouble spot on their own
const RECENT = 10;

/** 1 = best. Ties share a rank; null values are left unranked. */
function ranks(rows, key) {
  const vals = rows.map((r) => r[key]).filter((v) => v != null).sort((a, b) => b - a);
  return (v) => (v == null ? null : vals.indexOf(v) + 1);
}
/** Share of values strictly below v (0..1). */
const pctBelow = (vals, v) => (vals.length ? vals.filter((x) => x < v).length / vals.length : null);
const wavg = (rows, k) => {
  const gp = rows.reduce((a, r) => a + r.gp, 0);
  return gp ? rows.reduce((a, r) => a + r[k] * r.gp, 0) / gp : 0;
};
const isD = (p) => p === 'D';

function points(rows) {
  let pts = 0;
  for (const r of rows) pts += r.win ? 2 : r.otl ? 1 : 0;
  return { gp: rows.length, pts, ptsPct: rows.length ? pts / (2 * rows.length) : null, w: rows.filter((r) => r.win).length };
}

/** One row per team-game, oldest first: side, result, momentum (no goals) for and against. */
function teamGames(list) {
  const out = new Map();
  for (const g of list) {
    const homeWon = g.hg > g.ag;
    for (const side of ['away', 'home']) {
      const away = side === 'away';
      const t = away ? g.away : g.home;
      const gf = away ? g.ag : g.hg;
      const ga = away ? g.hg : g.ag;
      const win = away ? !homeWon : homeWon;
      const row = { n: g.n, home: !away, gf, ga, win, otl: !win && (g.end === 'OT' || g.end === 'SO'), close: Math.abs(gf - ga) === 1 || g.end === 'SO',
        ngF: away ? g.an : g.hn, ngA: away ? g.hn : g.an };
      (out.get(t) ?? out.set(t, []).get(t)).push(row);
    }
  }
  for (const rows of out.values()) rows.sort((a, b) => a.n - b.n);
  return out;
}

/** League numbers every team is compared with: per-position averages for skaters, per-team-game for teams. */
function leagueBase(total, rate, minGp, sbase) {
  const sk = { F: [], D: [] };
  for (const [id, row] of Object.entries(total.players ?? {})) {
    if (row.p === 'G' || row.gp < minGp) continue;
    const pg = perGame(row, rate, sbase);
    sk[isD(row.p) ? 'D' : 'F'].push({ id, gp: row.gp, mom: pg.momPerGame, mn: pg.momNegPerGame, fin: row.xg != null ? scoreOf(pg) / row.gp : null, below: pg.belowPct });
  }
  const pos = {};
  for (const k of ['F', 'D']) {
    const rows = sk[k];
    const fin = rows.filter((r) => r.fin != null);
    const below = rows.filter((r) => r.below != null);
    pos[k] = { n: rows.length, mom: wavg(rows, 'mom'), fin: fin.length ? wavg(fin, 'fin') : 0, below: below.length ? wavg(below, 'below') : null,
      moms: rows.map((r) => r.mom), mns: rows.map((r) => r.mn) };
  }
  return pos;
}

// A skater's scoring in goals vs average: finishing plus playmaking (assists) once the season file has assists,
// finishing alone before that.
const scoreOf = (pg) => pg.scoringVsAvg ?? pg.gaa;

function skaterRows(total, team, rate, minGp, pos, sbase) {
  const out = [];
  for (const [id, row] of Object.entries(total.players ?? {})) {
    if (row.t !== team || row.p === 'G' || row.gp < minGp) continue;
    const pg = perGame(row, rate, sbase);
    const P = pos[isD(row.p) ? 'D' : 'F'];
    const momGoals = (pg.momPerGame - P.mom) * IMPACT.momGoals;
    const finGoals = row.xg != null ? scoreOf(pg) / row.gp - P.fin : 0;
    out.push({
      id: Number(id), name: row.n, pos: row.p, gp: row.gp, toiPg: pg.toiPerGame,
      momPg: pg.momPerGame, posMom: P.mom, momPct: pctBelow(P.moms, pg.momPerGame),
      mnPg: pg.momNegPerGame, mnPct: pctBelow(P.mns, pg.momNegPerGame), // low pct = gives away more than most
      mnMore: P.mns.length ? P.mns.filter((x) => x > pg.momNegPerGame).length / P.mns.length : null,
      goals: row.xgg ?? null, avgGoals: pg.avgGoals ?? null, gaa: pg.gaa, shPct: pg.shPct, xShPct: pg.xShPct,
      allGoals: pg.goals, assists: pg.assists, playVsAvg: pg.playVsAvg, scoringVsAvg: pg.scoringVsAvg,
      belowPct: pg.belowPct, posBelow: P.below,
      momCost: momGoals * row.gp, finCost: finGoals * row.gp, cost: (momGoals + finGoals) * row.gp,
    });
  }
  // Ice time rank within the team's forwards / defense (only when time on ice is known).
  for (const d of [true, false]) {
    const grp = out.filter((r) => isD(r.pos) === d && r.toiPg != null).sort((a, b) => b.toiPg - a.toiPg);
    grp.forEach((r, i) => { r.toiRank = i + 1; r.toiOf = grp.length; });
  }
  return out;
}

/** Plain reasons a skater is costing the team, strongest first. Each: { k, cost (goals), text }. */
export function skaterReasons(p) {
  const out = [];
  const posName = isD(p.pos) ? 'defensemen' : 'forwards';
  if (p.momCost <= -0.5) {
    out.push({ k: 'mom', cost: p.momCost, text: `Momentum ${sign(p.momPg)} a game against ${sign(p.posMom)} for a typical ${isD(p.pos) ? 'defenseman' : 'forward'}${p.momPct != null && p.momPct <= 0.25 ? ` (bottom ${Math.max(1, Math.round(p.momPct * 100))}% of ${posName})` : ''}: about ${goals(-p.momCost)} of goal difference lost so far.` });
  }
  if (p.mnPct != null && p.mnPct <= 0.15) {
    out.push({ k: 'mn', cost: p.momCost, text: `Gives momentum away: ${sign(p.mnPg)} a game from penalties, giveaways and lost draws, more than ${Math.min(99, Math.round(p.mnMore * 100))}% of ${posName}.` });
  }
  if (p.finCost <= -1 && p.goals != null && p.avgGoals != null) {
    const kind = isD(p.pos) ? 'defenseman' : 'forward';
    const finish = `${p.goals} goal${p.goals === 1 ? '' : 's'} on shots an average shooter would turn into ${p.avgGoals.toFixed(1)} (shooting ${pctTxt(p.shPct)} where ${pctTxt(p.xShPct)} is normal)`;
    out.push({ k: 'fin', cost: p.finCost, text: p.scoringVsAvg == null
      ? `Finishing: ${finish}.`
      : `Scoring: ${finish}, and ${p.assists} assist${p.assists === 1 ? '' : 's'}, ${p.playVsAvg >= 0 ? 'which only partly makes up for it' : `fewer than a typical ${kind} gets in ${p.gp} games`}. Goals and assists together come to ${sign(p.scoringVsAvg)} goals against an average ${kind}.` });
  }
  if (p.belowPct != null && p.posBelow != null && p.belowPct >= Math.max(0.28, p.posBelow + 0.1)) {
    out.push({ k: 'below', cost: 0, text: `Well below a typical ${isD(p.pos) ? 'defenseman' : 'forward'}'s game in ${pctTxt(p.belowPct, 0)} of games (most ${posName}: ${pctTxt(p.posBelow, 0)}).` });
  }
  if (out.length && p.toiRank && p.toiRank <= (isD(p.pos) ? 4 : 6)) {
    out.push({ k: 'toi', cost: 0, text: `Big minutes make it count: ${toi(p.toiPg)} a night, ${ord(p.toiRank)} among the team's ${posName}.` });
  }
  return out;
}

/** Goalies who started for the team, worst goals saved above expected first. */
function goalieRows(total, team, rate) {
  return Object.entries(total.players ?? {})
    .filter(([, p]) => p.p === 'G' && p.t === team && (p.gs ?? 0) > 0 && p.xga != null)
    .map(([id, p]) => {
      const exp = p.xga * rate;
      return { id: Number(id), name: p.n, gs: p.gs ?? 0, gp: p.gp, ga: p.ga ?? 0, expGa: exp, gsax: exp - (p.ga ?? 0) };
    })
    .sort((a, b) => b.gs - a.gs);
}

/**
 * Every team's deficiencies for one season file. Returns null when the file has no game rows.
 * { rate, teams: [{ abbrev, gp, w, l, otl, ptsPct, ptsRank, areas: { play, finishing, goaltending }, trouble, strengths,
 *   checks: [...], players: [...], goalies: [...] }], n }
 */
export function deficiencies(total) {
  const list = (total?.g ?? []).map(gameObj);
  if (!list.length) return null;
  const rate = leagueRate(total);
  const minGp = Math.max(5, minGames(total));
  const sbase = scoringBase(total);
  const pos = leagueBase(total, rate, minGp, sbase);
  const byTeam = teamGames(list);
  const base = teamTable(list).map((t) => {
    const fin = t.finGp ? { finishing: (t.ggF - t.xgF * rate) / t.finGp, goaltending: (t.xgA * rate - t.ggA) / t.finGp } : { finishing: null, goaltending: null };
    return {
      ...t,
      play: t.ngGp ? ((t.ngF - t.ngA) / t.ngGp) * IMPACT.momGoals : null,
      ngForPg: t.ngGp ? t.ngF / t.ngGp : null,
      ngAgPg: t.ngGp ? t.ngA / t.ngGp : null,
      ...fin,
      xgFPg: t.finGp ? (t.xgF * rate) / t.finGp : null,
      ggFPg: t.finGp ? t.ggF / t.finGp : null,
      xgAPg: t.finGp ? (t.xgA * rate) / t.finGp : null,
      ggAPg: t.finGp ? t.ggA / t.finGp : null,
    };
  });
  const n = base.length;
  const rk = Object.fromEntries(['play', 'finishing', 'goaltending', 'ptsPct', 'ngShare', 'satShare', 'ngForPg'].map((k) => [k, ranks(base, k)]));
  const rkAg = ranks(base.map((t) => ({ v: t.ngAgPg == null ? null : -t.ngAgPg })), 'v');
  const avgNgFor = base.reduce((a, t) => a + (t.ngForPg ?? 0), 0) / n;

  const teams = base.map((t) => {
    const areas = {};
    for (const [k, label] of AREAS) {
      const v = t[k];
      const rank = rk[k](v);
      areas[k] = { key: k, label, value: v, rank, trouble: v != null && (rank > (2 * n) / 3 || v <= TROUBLE_GOALS) && v < 0, strength: v != null && rank <= n / 3 && v > 0 };
    }
    areas.play.share = t.ngShare;
    areas.play.shareRank = rk.ngShare(t.ngShare);
    areas.play.satShare = t.satShare;
    areas.play.satRank = rk.satShare(t.satShare);
    areas.play.forPg = t.ngForPg;
    areas.play.forRank = rk.ngForPg(t.ngForPg);
    areas.play.agPg = t.ngAgPg;
    areas.play.agRank = rkAg(t.ngAgPg == null ? null : -t.ngAgPg);
    areas.play.leagueFor = avgNgFor;
    Object.assign(areas.finishing, { goals: t.ggFPg, expected: t.xgFPg, shPct: t.sogF ? t.ggF / t.sogF : null, xShPct: t.sogF ? (t.xgF * rate) / t.sogF : null });
    Object.assign(areas.goaltending, { goals: t.ggAPg, expected: t.xgAPg });

    const games = byTeam.get(t.abbrev) ?? [];
    const checks = situational(games, t);
    const players = skaterRows(total, t.abbrev, rate, minGp, pos, sbase);
    const trouble = AREAS.map(([k]) => areas[k]).filter((a) => a.trouble).sort((a, b) => a.value - b.value);
    const strengths = AREAS.map(([k]) => areas[k]).filter((a) => a.strength).sort((a, b) => b.value - a.value);
    const dragging = players.map((p) => ({ ...p, reasons: skaterReasons(p) }))
      .filter((p) => p.cost <= -1.5 && p.reasons.length)
      .sort((a, b) => a.cost - b.cost);
    return {
      abbrev: t.abbrev, gp: t.gp, w: t.w, l: t.l, otl: t.otl, ptsPct: t.ptsPct, ptsRank: rk.ptsPct(t.ptsPct), gdPerGame: t.gdPerGame,
      areas, trouble, strengths, checks, players: dragging, goalies: goalieRows(total, t.abbrev, rate),
    };
  });
  return { rate, n, minGp, pos: { F: { mom: pos.F.mom, below: pos.F.below }, D: { mom: pos.D.mom, below: pos.D.below } }, teams };
}

/**
 * League deficiency list: every skater across the league who is costing their team, worst first.
 * Same numbers and wording as a team card. { minGp, n (skaters judged), players: [{ ...skater, team, reasons }] }
 */
export function leaguePlayers(total, { minCost = 1.5 } = {}) {
  if (!total?.players) return null;
  const rate = leagueRate(total);
  const minGp = Math.max(5, minGames(total));
  const sbase = scoringBase(total);
  const pos = leagueBase(total, rate, minGp, sbase);
  const teams = [...new Set(Object.values(total.players).filter((p) => p.p !== 'G' && p.t).map((p) => p.t))];
  const all = teams.flatMap((t) => skaterRows(total, t, rate, minGp, pos, sbase).map((p) => ({ ...p, team: t })));
  const players = all.map((p) => ({ ...p, reasons: skaterReasons(p) })).filter((p) => p.cost <= -minCost && p.reasons.length).sort((a, b) => a.cost - b.cost);
  return { minGp, n: all.length, players };
}

/** Home/road, the last 10 games and one-goal games: only returned when they stand out. */
function situational(games, t) {
  const out = [];
  const home = points(games.filter((g) => g.home));
  const road = points(games.filter((g) => !g.home));
  if (home.gp >= 8 && road.gp >= 8 && Math.abs(home.ptsPct - road.ptsPct) >= 0.2) {
    const worse = home.ptsPct < road.ptsPct ? 'home' : 'road';
    out.push({ k: worse, home, road, text: worse === 'home'
      ? `Struggles at home: ${pctTxt(home.ptsPct, 0)} of points at home against ${pctTxt(road.ptsPct, 0)} on the road.`
      : `Struggles on the road: ${pctTxt(road.ptsPct, 0)} of points away against ${pctTxt(home.ptsPct, 0)} at home.` });
  }
  const last = games.slice(-RECENT).filter((g) => g.ngF != null && g.ngA != null);
  if (games.length >= RECENT * 2 && last.length >= RECENT - 2 && t.ngShare != null) {
    const f = last.reduce((a, g) => a + g.ngF, 0);
    const a = last.reduce((x, g) => x + g.ngA, 0);
    const share = f / (f + a);
    const p = points(games.slice(-RECENT));
    if (share <= t.ngShare - 0.03) {
      out.push({ k: 'slide', share, season: t.ngShare, rec: p, text: `Sliding lately: ${pctTxt(share)} of the momentum over the last ${RECENT} games (${p.w} wins), down from ${pctTxt(t.ngShare)} for the season.` });
    }
  }
  const close = points(games.filter((g) => g.close));
  if (close.gp >= 6 && close.ptsPct <= 0.4) {
    out.push({ k: 'close', rec: close, text: `Losing the coin flips: ${close.w} wins in ${close.gp} one-goal or shootout games (${pctTxt(close.ptsPct, 0)} of points). Close-game records are mostly luck and tend to even out.` });
  }
  return out;
}

/** One plain sentence on where a team loses most, for the overview and the team card. */
export function headline(team) {
  const name = team.abbrev;
  if (!team.trouble.length) {
    const worst = AREAS.map(([k]) => team.areas[k]).filter((a) => a.value != null).sort((a, b) => a.value - b.value)[0];
    return worst ? `${name} has no big leak. Its weakest area is ${worst.label.toLowerCase()} (${ord(worst.rank)} in the league).` : `${name}: not enough games yet.`;
  }
  const [a, b] = team.trouble;
  const one = `${name}'s biggest leak is ${a.label.toLowerCase()}: ${goals(-a.value)} a game below an average team (${ord(a.rank)}).`;
  return b ? `${one} Next is ${b.label.toLowerCase()} (${sign(b.value, 2)} a game, ${ord(b.rank)}).` : one;
}

// Formatting used by the text above (kept here so tests see exactly what the page shows).
export const sign = (v, d = 1) => {
  if (v == null || Number.isNaN(v)) return '-';
  const r = Number(v.toFixed(d));
  return `${r > 0 ? '+' : r < 0 ? '−' : ''}${Math.abs(v).toFixed(d)}`;
};
const goals = (v) => `${v.toFixed(v >= 10 ? 0 : v >= 1 ? 1 : 2)} goal${Math.abs(v - 1) < 0.005 ? '' : 's'}`;
const pctTxt = (v, d = 1) => (v == null ? '-' : `${(v * 100).toFixed(d)}%`);
const toi = (s) => `${Math.floor(s / 60)}:${String(Math.round(s % 60)).padStart(2, '0')}`;
export const ord = (n) => {
  if (n == null) return '-';
  const s = n % 100 >= 11 && n % 100 <= 13 ? 'th' : ['th', 'st', 'nd', 'rd'][n % 10] ?? 'th';
  return `${n}${s}`;
};

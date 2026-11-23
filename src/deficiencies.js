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
        ngF: away ? g.an : g.hn, ngA: away ? g.hn : g.an, gk: (away ? g.ags : g.hgs) ?? null };
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
// Finishing is mostly luck over a few dozen shots (scripts/scoring-lab: half of a finishing number is skill only
// once a player has about 22 expected goals), so only that share of the gap counts; assists are counted in full.
export const FIN_TRUST_XG = 22;
export const finTrust = (pg) => (pg.avgGoals == null ? 1 : pg.avgGoals / (pg.avgGoals + FIN_TRUST_XG));
const scoreOf = (pg) => (pg.gaa == null ? 0 : finTrust(pg) * pg.gaa) + (pg.playVsAvg ?? 0);

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
      allGoals: pg.goals, assists: pg.assists, playVsAvg: pg.playVsAvg, scoringVsAvg: pg.scoringVsAvg, trust: finTrust(pg), counted: scoreOf(pg),
      belowPct: pg.belowPct, posBelow: P.below,
      oi: row.oto ? { sec: row.oto, cf: row.ocf, ca: row.oca, gf: row.ogf, ga: row.oga } : null,
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
    const hot = p.gaa >= 0;
    const finish = `${p.goals} goal${p.goals === 1 ? '' : 's'} on shots an average shooter would turn into ${p.avgGoals.toFixed(1)} (shooting ${pctTxt(p.shPct)} where ${pctTxt(p.xShPct)} is normal${hot ? ', so the goals are fine' : ''})`;
    out.push({ k: 'fin', cost: p.finCost, text: p.scoringVsAvg == null
      ? `Finishing: ${finish}. Mostly luck this early, so only ${Math.round(p.trust * 100)}% of the gap is counted.`
      : `Scoring: ${finish}, and ${p.assists} assist${p.assists === 1 ? '' : 's'}, ${p.playVsAvg >= 0 ? 'which only partly makes up for it' : `fewer than a typical ${kind} gets in ${p.gp} games`}. Goals and assists together come to ${sign(p.scoringVsAvg)} goals against an average ${kind}. Finishing is mostly luck this early, so only ${Math.round(p.trust * 100)}% of the finishing difference is counted: ${sign(p.counted)} goals.` });
  }
  if (p.belowPct != null && p.posBelow != null && p.belowPct >= Math.max(0.28, p.posBelow + 0.1)) {
    out.push({ k: 'below', cost: 0, text: `Well below a typical ${isD(p.pos) ? 'defenseman' : 'forward'}'s game in ${pctTxt(p.belowPct, 0)} of games (most ${posName}: ${pctTxt(p.posBelow, 0)}).` });
  }
  if (out.length && p.toiRank && p.toiRank <= (isD(p.pos) ? 4 : 6)) {
    out.push({ k: 'toi', cost: 0, text: `Big minutes make it count: ${toi(p.toiPg)} a night, ${ord(p.toiRank)} among the team's ${posName}.` });
  }
  return out;
}

// "The team does worse with him on the ice": on-ice shot-attempt share against the team's other skaters at the
// position (forwards / defensemen), with enough minutes, for players who are also below a typical player on
// their own numbers. Shot attempts are the steady part (odd vs even games r .76 for defensemen); goals on ice are noisy.
export const ONICE_MIN_SEC = 150 * 60;
export const ONICE_GAP = 0.10; // share of attempts, 10 points: depth lines normally trail the top lines by a few points
export const ONICE_TOI = { F: 11.5 * 60, D: 14 * 60 }; // regulars only: top nine forwards, top two or three pairs
export const ONICE_MAX = 3;
export function onIceRows(players) {
  const share = (r) => r.oi.cf / (r.oi.cf + r.oi.ca);
  const per60 = (r) => ((r.oi.gf - r.oi.ga) * 3600) / r.oi.sec;
  const out = [];
  for (const r of players) {
    if (!r.oi || r.oi.sec < ONICE_MIN_SEC || (r.toiPg ?? 0) < ONICE_TOI[isD(r.pos) ? 'D' : 'F']) continue;
    const mates = players.filter((m) => m.id !== r.id && m.oi && isD(m.pos) === isD(r.pos) && m.oi.sec >= 20 * 60);
    const w = mates.reduce((a, m) => a + m.oi.sec, 0);
    if (!w) continue;
    const mateShare = mates.reduce((a, m) => a + share(m) * m.oi.sec, 0) / w;
    const mateGd = mates.reduce((a, m) => a + per60(m) * m.oi.sec, 0) / w;
    out.push({ id: r.id, name: r.name, pos: r.pos, gp: r.gp, min: r.oi.sec / 60, share: share(r), mateShare, gap: share(r) - mateShare,
      gd60: per60(r), mateGd60: mateGd, gdGap: per60(r) - mateGd, cost: r.cost });
  }
  return out.sort((a, b) => a.gap - b.gap);
}

/** Plain sentence for an on-ice row. */
export function onIceText(r) {
  const kind = isD(r.pos) ? 'defensemen' : 'forwards';
  const pts = Math.round(-r.gap * 100);
  const gd = r.gdGap <= -0.5 ? ` Goals: ${sign(r.gdGap)} per 60 minutes against the others (noisier than shots).` : '';
  return `With him on the ice the team gets ${pctTxt(r.share, 0)} of the shot attempts, ${pts} point${pts === 1 ? '' : 's'} fewer than with its other ${kind} (${pctTxt(r.mateShare, 0)}), over ${Math.round(r.min)} minutes.${gd}`;
}

/** Goalies who started for the team, worst goals saved above expected first; with the team's record in their starts. */
function goalieRows(total, team, rate, games = []) {
  return Object.entries(total.players ?? {})
    .filter(([, p]) => p.p === 'G' && p.t === team && (p.gs ?? 0) > 0 && p.xga != null)
    .map(([id, p]) => {
      const exp = p.xga * rate;
      const mine = games.filter((g) => g.gk === Number(id));
      const rest = games.filter((g) => g.gk !== Number(id) && g.gk != null);
      return { id: Number(id), name: p.n, gs: p.gs ?? 0, gp: p.gp, ga: p.ga ?? 0, expGa: exp, gsax: exp - (p.ga ?? 0), withHim: points(mine), without: points(rest) };
    })
    .sort((a, b) => b.gs - a.gs);
}

export const GOALIE_MIN_STARTS = 3;
export const GOALIE_COST = -1.5; // goals below an average goalie on the same shots

/** Goalies for the "Underperforming so far" list: goals saved above expected, counted in full. */
function goalieDragging(goalies) {
  return goalies.filter((g) => g.gs >= GOALIE_MIN_STARTS && g.gsax <= GOALIE_COST).map((g) => {
    const w = g.withHim;
    const rec = w.gp ? ` The team has ${w.w} win${w.w === 1 ? '' : 's'} in his ${w.gp} starts (${pctTxt(w.ptsPct, 0)} of points).` : '';
    return { id: g.id, name: g.name, pos: 'G', gp: g.gs, cost: g.gsax, goalie: true,
      reasons: [{ k: 'gsax', cost: g.gsax, text: `Goaltending: ${g.ga} goals against on shots an average goalie would allow ${g.expGa.toFixed(1)} on, in ${g.gs} start${g.gs === 1 ? '' : 's'}: ${goals(-g.gsax)} worse than an average goalie.${rec}` }] };
  }).sort((a, b) => a.cost - b.cost);
}

/** Goalies the team does worse with: a clearly lower share of points in his starts than in the others, and below an average goalie. */
function goalieOnIce(goalies) {
  return goalies.filter((g) => g.gsax <= GOALIE_COST && g.withHim.gp >= 4 && g.without.gp >= 4 && g.withHim.ptsPct <= g.without.ptsPct - 0.15).map((g) => ({
    id: g.id, name: g.name, pos: 'G', gp: g.gs, goalie: true, gap: g.withHim.ptsPct - g.without.ptsPct, tag: `${sign((g.withHim.ptsPct - g.without.ptsPct) * 100, 0)} pts %`,
    text: `The team earns ${pctTxt(g.withHim.ptsPct, 0)} of the points in his ${g.withHim.gp} starts, against ${pctTxt(g.without.ptsPct, 0)} in its other games, and he has let in ${goals(-g.gsax)} more than an average goalie would. Records in a few starts are partly luck.`,
  })).sort((a, b) => a.gap - b.gap);
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
    const goalies = goalieRows(total, t.abbrev, rate, games);
    const dragging = [...players.map((p) => ({ ...p, reasons: skaterReasons(p) })).filter((p) => p.cost <= -1.5 && p.reasons.length), ...goalieDragging(goalies)]
      .sort((a, b) => a.cost - b.cost);
    const onIce = [...onIceRows(players.map((p) => ({ ...p })))
      .filter((r) => r.gap <= -ONICE_GAP && r.cost < 0).slice(0, ONICE_MAX), ...goalieOnIce(goalies)];
    return {
      onIce,
      abbrev: t.abbrev, gp: t.gp, w: t.w, l: t.l, otl: t.otl, ptsPct: t.ptsPct, ptsRank: rk.ptsPct(t.ptsPct), gdPerGame: t.gdPerGame,
      areas, trouble, strengths, checks, players: dragging, goalies,
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

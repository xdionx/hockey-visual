// Momentum model versions and the checks that compare them (scripts/model-lab.js runs them over
// past seasons; the momentum stats page shows the results). Pure functions, no fetching.
//
// A version scores every game into the same row as the season files (seasonStats.js GAME_FIELDS):
// team momentum with goals, without goals, and shot attempts. The checks then ask how well the
// "no goals" number explains and predicts results, next to shot attempts (SAT).
import { pushes, MOMENTUM_WEIGHTS, HOME_PLATE_BONUS, inHomePlate, elapsedOf } from './momentum.js';
import { shotXg, LEAGUE_GOAL_RATE } from './xg.js';
import { winRates, teamTable, pearson, predictive } from './momentumModel.js';
import { contextModel } from './modelContext.js';

const SHOTS = new Set(['goal', 'sog', 'miss', 'block-attempt']);
const plate = (e, bonus = HOME_PLATE_BONUS) => (inHomePlate(e.x, e.y) ? bonus : 1);

/** Skaters and goalies for one side from situationCode ("1551" = away goalie, away, home, home goalie). */
function onIce(sit, side) {
  const s = String(sit ?? '');
  if (s.length !== 4) return null;
  return side === 'away' ? { goalie: +s[0], us: +s[1], them: +s[2], theirGoalie: +s[3] } : { goalie: +s[3], us: +s[2], them: +s[1], theirGoalie: +s[0] };
}

/**
 * Model versions. `weights` override MOMENTUM_WEIGHTS; `value(e, ctx)` can reprice any push
 * (ctx.lead = the pushing team's goal lead before the play, ctx.ice = who is on the ice);
 * `goalAsShot` counts a goal as the shot it was in the "no goals" total instead of leaving it out.
 */
const LEAN = { faceoff: { O: 0, N: 0, D: 0 }, takeaway: 0, giveaway: 0, hit: 0 };
const noEmptyNet = (e, c) => (c.ice && (!c.ice.goalie || !c.ice.theirGoalie) && e.kind !== 'goal' ? 0 : e.w);
const ppShots = (m) => (e, c) => (SHOTS.has(e.kind) && e.kind !== 'goal' && c.ice && c.ice.us > c.ice.them ? e.w * m : e.w);
/** Runs value functions one after another, each seeing the push as the last one priced it. */
const chain = (...fns) => (e, c) => fns.reduce((w, f) => f({ ...e, w }, c), e.w);

export const VERSIONS = [
  { id: 'v3', name: 'v3 (live)', live: true, note: 'The model on the site today.' },
  { id: 'v3-gs', name: 'v3, goals count as shots', goalAsShot: true, note: 'In "no goals", a goal still counts as the shot on goal it was, like SAT does. v3 drops it completely, which takes shots away from the team that scored.' },
  { id: 'v3-nopk', name: 'v3, goals as shots, no kill credit', goalAsShot: true, weights: { penaltyKilled: 0 }, note: 'A penalty killed off is only credited when the power play did not score, so it partly counts goals. This leaves it out.' },
  { id: 'v3-lean', name: 'v3, shots and penalties only', goalAsShot: true, weights: LEAN, note: 'Drops faceoffs, hits, takeaways and giveaways.' },
  { id: 'v3-noen', name: 'v3, empty net left out', goalAsShot: true, value: noEmptyNet, note: 'Pushes while a goalie is pulled do not count: the trailing team throws everything at the net then. A goalie is pulled because a team is losing, so its same-game number gets a small unfair boost.' },
  { id: 'v3-xg', name: 'Shot quality (xG)', goalAsShot: true, goalShot: 'xg', value: xgValue(), note: 'Shots are worth their chance of going in (distance, angle, shot type) instead of a flat 1.0 with a home-plate bonus.' },
  { id: 'v3-pp', name: 'v3, power-play shots 0.6x', goalAsShot: true, value: ppShots(0.6), note: 'Power-play shots are easier to get; the penalty drawn already earned the credit.' },
  { id: 'v3-plate3', name: 'v3, home plate 3x', goalAsShot: true, weights: { plate: 3 }, note: 'Shots from the home plate area (posts to dots to top of circles) count 3x instead of 1.5x.' },
  { id: 'v4', name: 'v4 candidate', goalAsShot: true, weights: { ...LEAN, plate: 3 }, note: 'Goals count as shots, faceoffs, hits, takeaways and giveaways left out, home plate shots 3x. Found by searching weights on 2021-24 and checked on 2024-26, where it beat v3 and SAT in every season.' },
  { id: 'v5', name: 'v5 candidate', goalAsShot: true, weights: { ...LEAN, plate: 3 }, context: contextModel, note: 'v4, plus three things known before puck drop: shots count more for players who have finished above expected so far (shrunk hard toward average), and the next-game prediction adds the starting goalie\'s goals saved above expected and a back-to-back penalty. The goalie and back-to-back parts only affect "Predicts next game". Weights fit on 2021-24; 2024-25 on is the fair test.' },
  { id: 'v4-score', name: 'v4, score-adjusted', goalAsShot: true, leaky: true, weights: { ...LEAN, plate: 3 }, value: scoreAdjusted(0.1), note: 'v4 with pushes by the leading team counted a little more (10% per goal of lead). Better at prediction, but uses the score, so not fair for the same-game test.' },
];

/** Prices shots by expected goals, scaled so an average shot on goal is still worth about 1.0. */
export function xgValue({ sog = 1, miss = 0.35, block = 0.2 } = {}) {
  return (e) => {
    if (!SHOTS.has(e.kind)) return e.w;
    if (e.kind === 'block-attempt') return block;
    const p = shotXg({ x: e.x, y: e.y, shotType: e.shotType });
    const q = p == null ? 1 : p / LEAGUE_GOAL_RATE;
    return e.kind === 'miss' ? miss * q : e.kind === 'goal' ? e.w : sog * q;
  };
}
/** What a goal is worth as a shot in the "no goals" total: flat (sog with the home-plate bonus) or by xG. */
function shotValueOfGoal(e, version) {
  if (version.goalShot === 'xg') {
    const p = shotXg({ x: e.x, y: e.y, shotType: e.shotType });
    return p == null ? 1 : p / LEAGUE_GOAL_RATE;
  }
  return (version.weights?.sog ?? MOMENTUM_WEIGHTS.sog) * plate(e, version.weights?.plate);
}
export function scoreAdjusted(a) {
  return (e, c) => {
    if (e.kind === 'goal') return e.w;
    const lead = Math.max(-2, Math.min(2, c.lead));
    return e.w * (lead >= 0 ? 1 + a * lead : 1 / (1 - a * lead));
  };
}

/** One game row for a version, from a (slim or raw) play-by-play. Null when the game has no plays. */
export function scoreGame(pbp, version) {
  if (!pbp?.plays?.length) return null;
  // A version with `context` learns from game to game only when the caller hands it a running state (scripts/model-lab.js does).
  const ctx0 = version.context ? (version.ctxState ?? version.context()) : null;
  const pre = ctx0 ? ctx0.pregame(pbp) : 0;
  const awayId = pbp.awayTeam.id;
  const plays = [...pbp.plays].sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0));
  const rosterTeam = new Map((pbp.rosterSpots ?? []).map((r) => [r.playerId, r.teamId]));
  const list = pushes(plays, awayId, rosterTeam, { ...MOMENTUM_WEIGHTS, ...(version.weights ?? {}) });
  const goals = { away: 0, home: 0 };
  const mom = { away: 0, home: 0 };
  const ng = { away: 0, home: 0 };
  const sat = { away: 0, home: 0 };
  // The decayed momentum line, only to give a fight's spark to the team that was behind (as momentum.js does).
  const level = { away: 0, home: 0 };
  let tPrev = 0;
  for (const e of list) {
    const f = Math.exp((-Math.LN2 / 75) * (e.t - tPrev));
    level.away *= f; level.home *= f; tPrev = e.t;
    if (e.kind === 'fight-spark') e.team = level.away < level.home - 0.5 ? 'away' : level.home < level.away - 0.5 ? 'home' : null;
    if (!e.team) continue;
    level[e.team] += e.w;
    const other = e.team === 'away' ? 'home' : 'away';
    if (SHOTS.has(e.kind)) sat[e.team]++;
    const ctx = { lead: goals[e.team] - goals[other], ice: e.sit ? onIce(e.sit, e.team) : null };
    let v = version.value ? version.value(e, ctx) : e.w;
    const mult = ctx0 && SHOTS.has(e.kind) ? ctx0.shotMult(e) : 1;
    if (e.kind !== 'goal') v *= mult;
    mom[e.team] += v;
    if (e.kind === 'goal') {
      if (version.goalAsShot) ng[e.team] += shotValueOfGoal(e, version) * mult;
      goals[e.team]++;
    } else if (e.kind !== 'pp-goal-against') ng[e.team] += v;
  }
  ctx0?.learn(pbp);
  const r1 = (n) => Math.round(n * 10) / 10;
  return {
    n: Number(String(pbp.id).slice(-4)), date: pbp.gameDate, away: pbp.awayTeam.abbrev, home: pbp.homeTeam.abbrev,
    ag: pbp.awayTeam.score ?? 0, hg: pbp.homeTeam.score ?? 0,
    am: r1(mom.away), hm: r1(mom.home), an: r1(ng.away), hn: r1(ng.home), as: sat.away, hs: sat.home,
    end: pbp.gameOutcome?.lastPeriodType ?? 'REG',
    ...(ctx0 ? { pre } : {}),
  };
}

const winner = (g) => (g.ag > g.hg ? 'away' : g.hg > g.ag ? 'home' : null);

/**
 * Each game picked from what both teams had done before it: the team with the bigger season-to-date
 * share wins. A fair test of any stat (it never sees the game it picks). Both teams need `minGp` games.
 */
export function pickAhead(list, key, minGp = 10) {
  const [f, a] = key === 'sat' ? ['as', 'hs'] : ['an', 'hn'];
  const tot = new Map();
  const get = (t) => tot.get(t) ?? (tot.set(t, { gp: 0, f: 0, a: 0 }), tot.get(t));
  let n = 0;
  let won = 0;
  for (const g of [...list].sort((x, y) => (x.date ?? '').localeCompare(y.date ?? '') || x.n - y.n)) {
    const A = get(g.away);
    const H = get(g.home);
    const w = winner(g);
    if (w && A.gp >= minGp && H.gp >= minGp) {
      const sa = A.f / (A.f + A.a) + (key === 'sat' ? 0 : g.pre ?? 0);
      const sh = H.f / (H.f + H.a);
      if (sa !== sh) { n++; if ((sa > sh ? 'away' : 'home') === w) won++; }
    }
    A.gp++; A.f += g[f]; A.a += g[a];
    H.gp++; H.f += g[a]; H.a += g[f];
  }
  return n ? won / n : null;
}

/**
 * Raw pairs behind the prediction checks, kept so seasons can be pooled into one bigger test:
 * half: per team [ngShare, satShare] in the first half of the season and [goal share, points %] in the second.
 * ahead: per game, the season-to-date share gap (away minus home, both teams 10+ games) and the game's goal gap.
 */
export function predictionPairs(list, minGp = 10) {
  const sorted = [...list].sort((x, y) => (x.date ?? '').localeCompare(y.date ?? '') || x.n - y.n);
  const half = [];
  if (sorted.length) {
    const mid = sorted[Math.floor(sorted.length / 2)].n;
    const first = new Map(teamTable(sorted.filter((g) => g.n < mid)).map((t) => [t.abbrev, t]));
    for (const t of teamTable(sorted.filter((g) => g.n >= mid))) {
      const f = first.get(t.abbrev);
      if (f && f.gp >= 10 && t.gp >= 10) half.push([f.ngShare, f.satShare, t.gfShare, t.ptsPct]);
    }
  }
  const ahead = [];
  const tot = new Map();
  const get = (t) => tot.get(t) ?? (tot.set(t, { gp: 0, nf: 0, na: 0, sf: 0, sa: 0 }), tot.get(t));
  const share = (f, a) => (f + a ? f / (f + a) : 0.5);
  for (const g of sorted) {
    const A = get(g.away);
    const H = get(g.home);
    if (A.gp >= minGp && H.gp >= minGp) ahead.push([share(A.nf, A.na) - share(H.nf, H.na) + (g.pre ?? 0), share(A.sf, A.sa) - share(H.sf, H.sa), g.ag - g.hg]);
    A.gp++; A.nf += g.an; A.na += g.hn; A.sf += g.as; A.sa += g.hs;
    H.gp++; H.nf += g.hn; H.na += g.an; H.sf += g.hs; H.sa += g.as;
  }
  return { half, ahead };
}

/** One correlation per prediction check over pairs from any number of seasons. */
export function pooledPrediction({ half, ahead }) {
  const col = (rows, i) => rows.map((r) => r[i]);
  return {
    halfPtsNg: pearson(col(half, 0), col(half, 3)), halfPtsSat: pearson(col(half, 1), col(half, 3)),
    halfGfNg: pearson(col(half, 0), col(half, 2)), halfGfSat: pearson(col(half, 1), col(half, 2)),
    aheadGdNg: pearson(col(ahead, 0), col(ahead, 2)), aheadGdSat: pearson(col(ahead, 1), col(ahead, 2)),
  };
}

/** The checks for one version over one season's game rows. */
export function summarize(rows) {
  const wins = winRates(rows);
  const teams = teamTable(rows);
  const pts = teams.map((t) => t.ptsPct);
  const pred = predictive(rows);
  return {
    games: rows.length,
    checks: {
      pickNg: wins.ng.pct, pickSat: wins.sat.pct, pickMom: wins.mom.pct,
      fitNg: pearson(teams.map((t) => t.ngShare), pts), fitSat: pearson(teams.map((t) => t.satShare), pts),
      predNg: pred?.ng ?? null, predSat: pred?.sat ?? null,
      aheadNg: pickAhead(rows, 'ng'), aheadSat: pickAhead(rows, 'sat'),
      ...pooledPrediction(predictionPairs(rows)),
    },
  };
}
export { elapsedOf };

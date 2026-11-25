// Expected goals for the shots a goalie faces. Built on our xG (src/xg.js) plus what that model misses about
// how hard a save was: power plays, 3v3, rebounds 1 to 3 s after a shot, shot type and where in the home plate area.
// Fit on 328k shots 2022-23 to 2026-27 (scripts/goalie-score-lab/fit.py). Held-out log loss .3093 -> .2978.
// Only the goalie's expected goals (GSAx, game score) use it; skater xG and finishing keep src/xg.js.
import { shotXg } from './xg.js';
import { plateArea } from './momentum.js';

const B = { icpt: 0.349, lx: 1.158, pp: 0.2909, t3v3: 0.4376, reb: 0.6475, slap: 0.8227, snap: 0.3435, backhand: -0.3079, 'tip-in': -0.908, deflected: -0.6197, 'wrap-around': 0.0177, inner: 0.0044, outer: 0.3765, wide: -0.3949 };
// Per-season shift so each season's expected goals equal its goals (goal rates drift). Unlisted seasons use the latest.
const SHIFT = { 2022: -0.0684, 2023: 0.01, 2024: 0.0403, 2025: 0.0102, 2026: 0.0488 };
const secs = (t) => { const [m, s] = String(t ?? '0:0').split(':').map(Number); return (m || 0) * 60 + (s || 0); };

/** Chance a shot is a goal. f: { x, y, shotType, shooterSkaters, goalieSkaters, rebound }. Year = season start year. */
export function goalieShotXg(f, year) {
  const base = shotXg(f);
  if (base == null) return null;
  const area = plateArea(f.x, f.y);
  let z = B.icpt + B.lx * Math.log(base / (1 - base)) + (SHIFT[year] ?? SHIFT[2026]);
  if (f.shooterSkaters > f.goalieSkaters) z += B.pp;
  if (f.shooterSkaters === 3 && f.goalieSkaters === 3) z += B.t3v3;
  if (f.rebound) z += B.reb;
  z += B[f.shotType] ?? 0;
  if (area === 'inner') z += B.inner; else if (area === 'outer') z += B.outer; else if (area === 'wide') z += B.wide;
  return 1 / (1 + Math.exp(-z));
}

/** Per-shot goalie xG from raw play-by-play (shots on goal and goals with a goalie in net, shootouts left out), in event order. */
export function* goalieShots(pbp) {
  const year = Math.floor(Number(pbp?.id ?? 0) / 1e6) || 2026;
  const away = pbp?.awayTeam?.id;
  const last = new Map(); // `${team}:${period}` -> seconds of that team's previous shot on goal
  const plays = [...(pbp?.plays ?? [])].sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0));
  for (const e of plays) {
    if ((e.typeDescKey !== 'goal' && e.typeDescKey !== 'shot-on-goal') || e.periodDescriptor?.periodType === 'SO') continue;
    const d = e.details ?? {};
    if (!d.goalieInNetId || d.xCoord == null || d.yCoord == null) continue;
    const t = secs(e.timeInPeriod);
    const key = `${d.eventOwnerTeamId}:${e.periodDescriptor?.number}`;
    const prev = last.get(key);
    last.set(key, t);
    const sit = String(e.situationCode ?? '');
    const as = Number(sit[1]), hs = Number(sit[2]);
    const shooterAway = d.eventOwnerTeamId === away;
    const ok = sit.length === 4;
    const p = goalieShotXg({
      x: d.xCoord, y: d.yCoord, shotType: d.shotType,
      shooterSkaters: ok ? (shooterAway ? as : hs) : 5, goalieSkaters: ok ? (shooterAway ? hs : as) : 5,
      rebound: prev != null && t - prev > 1 && t - prev <= 3,
    }, year);
    if (p != null) yield { e, goalieId: d.goalieInNetId, goal: e.typeDescKey === 'goal', p };
  }
}

/** Per-goalie expected results: Map(goalieId -> { shots, goals, xga }), same shape as goalieExpected in xg.js. */
export function goalieExpectedCtx(pbp) {
  const out = new Map();
  for (const s of goalieShots(pbp)) {
    const e = out.get(s.goalieId) ?? { shots: 0, goals: 0, xga: 0 };
    e.shots++; if (s.goal) e.goals++; e.xga += s.p;
    out.set(s.goalieId, e);
  }
  return out;
}

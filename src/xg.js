// A small expected goals (xG) model for shots on goal, from where and how the shot was taken.
//
// This is our own estimate, not the NHL's: it uses only shot distance, angle and type (no
// rebound, rush or pre-shot movement data, which the public feed doesn't carry). It's
// calibrated so an average shot on goal is a goal about 9.5% of the time (a .905 save
// percentage). Use it to compare goalies in one game, not as an official stat.

const NET_X = 89;
const LEAGUE_GOAL_RATE = 0.095;

// How much a shot type changes the odds, from typical results: close-in tips and deflections go
// in far more often than wrap-arounds or long slap shots.
const TYPE = {
  'tip-in': 1.55, deflected: 1.35, 'bat': 1.2, poke: 1.1, 'wrap-around': 0.55, backhand: 0.95,
  wrist: 1.0, snap: 1.05, slap: 0.9, cradle: 0.9,
};

/** Probability a shot on goal from (x, y) is a goal; (x, y) in rink feet, either end. */
export function shotXg({ x, y, shotType } = {}) {
  if (x == null || y == null) return null;
  const dx = Math.max(0, NET_X - Math.abs(x));
  const d = Math.hypot(dx, y);
  const angle = (Math.atan2(Math.abs(y), Math.max(dx, 0.5)) * 180) / Math.PI; // 0 = straight on
  const base = 0.27 * Math.exp(-d / 21) + 0.018;
  const angleFactor = 1 - 0.5 * Math.min(1, (angle / 85) ** 1.4);
  const p = base * angleFactor * (TYPE[shotType] ?? 1) * 0.97;
  return Math.min(0.6, Math.max(0.01, p));
}

/**
 * Per-goalie expected results from the shots they faced (shots on goal and goals, empty net
 * excluded). Returns Map(goalieId -> { shots, goals, xga }).
 */
export function goalieExpected(shots) {
  const out = new Map();
  for (const s of shots ?? []) {
    if ((s.kind !== 'sog' && s.kind !== 'goal') || !s.goalieId) continue;
    const p = shotXg(s);
    if (p == null) continue;
    const e = out.get(s.goalieId) ?? { shots: 0, goals: 0, xga: 0 };
    e.shots++;
    if (s.kind === 'goal') e.goals++;
    e.xga += p;
    out.set(s.goalieId, e);
  }
  return out;
}

/**
 * Per-shooter expected goals from shots on goal and goals with a goalie in net (empty-net goals left
 * out, so a finisher isn't credited for an open net). Map(shooterId -> { shots, goals, xg }).
 */
export function shooterExpected(shots) {
  const out = new Map();
  for (const s of shots ?? []) {
    if ((s.kind !== 'sog' && s.kind !== 'goal') || !s.goalieId || !s.shooterId) continue;
    const p = shotXg(s);
    if (p == null) continue;
    const e = out.get(s.shooterId) ?? { shots: 0, goals: 0, xg: 0 };
    e.shots++;
    if (s.kind === 'goal') e.goals++;
    e.xg += p;
    out.set(s.shooterId, e);
  }
  return out;
}

/** Finishing %: goals per expected goal x 100 (100 = an average finisher). Null with no expected goals. */
export function finishingPct(goals, xg) {
  return xg > 0 ? Math.round((100 * goals) / xg) : null;
}

export { LEAGUE_GOAL_RATE };

// Player impact in one game, in goals: momentum converted to goals plus finishing (goals vs an average
// shooter). Used to sort a game into above average, average or below average for that position.
// Constants from scripts/impact-lab (6,932 games, 2021-22 to 2026-27): one momentum point is worth
// about 0.023 goals of goal differential; per-game impact averages and spreads by position barely
// move from season to season.

export const IMPACT = {
  momGoals: 0.023,
  rate: 1.17, // league goals per our expected goal, when the season's own rate isn't at hand
  F: { mean: 0.143, sd: 0.438 },
  D: { mean: 0.080, sd: 0.271 },
  band: 0.5, // above / below = more than half a standard deviation from the position's average
};

/** Impact in goals from momentum and finishing; null without expected goals. */
export function gameImpact({ mom, xg, xgg }, rate = IMPACT.rate) {
  if (xg == null) return null;
  return (mom ?? 0) * IMPACT.momGoals + ((xgg ?? 0) - xg * rate);
}

/** 1 above average, 0 average, -1 below average for the position ('D' or any forward), null when unknown. */
export function tierOf(line, pos, rate = IMPACT.rate) {
  const v = gameImpact(line, rate);
  if (v == null) return null;
  const { mean, sd } = pos === 'D' ? IMPACT.D : IMPACT.F;
  if (v > mean + IMPACT.band * sd) return 1;
  if (v < mean - IMPACT.band * sd) return -1;
  return 0;
}

/** A player's average impact per game this season (season file row), or null with too few games. */
export function seasonImpact(row, rate = IMPACT.rate, minGp = 5) {
  if (!row || (row.gp ?? 0) < minGp || row.xg == null) return null;
  return ((row.mom ?? 0) * IMPACT.momGoals + ((row.xgg ?? 0) - row.xg * rate)) / row.gp;
}

/** 1 above the player's own season average, -1 below it, 0 close to it (same band as tierOf), null when unknown. */
export function tierVsSeason(line, pos, row, rate = IMPACT.rate) {
  const v = gameImpact(line, rate);
  const avg = seasonImpact(row, rate);
  if (v == null || avg == null) return null;
  const { sd } = pos === 'D' ? IMPACT.D : IMPACT.F;
  if (v > avg + IMPACT.band * sd) return 1;
  if (v < avg - IMPACT.band * sd) return -1;
  return 0;
}

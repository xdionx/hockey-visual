// Which goals has the horn already sounded for? Decided by the goals themselves, never by a count, so a
// stale or out-of-order scores response (fewer goals than the last one) can't make an old goal "new" again.
export const FRESH_MS = 10 * 60_000; // a saved record older than this is a fresh baseline

/** One goal's identity: stable across polls, different for a replacement after a disallowed goal. */
export const goalKey = (x) => `${x.period}|${x.time}|${x.scorer?.id ?? x.scorer?.name ?? ''}`;

/** Regulation/overtime goals by one team (shootout goals never sound a horn). */
export const teamGoals = (game, abbrev) => (game.goals ?? game.scoring ?? []).filter((x) => x.period !== 'SO' && x.team === abbrev);

/**
 * Compare a team's goals now with what was saved. Returns { fresh, newCount, record }:
 * newCount = goals not seen before (only when the saved record is fresh); record = what to save
 * (every goal ever seen, so a goal that blinks out of a stale response and back doesn't honk twice).
 */
export function compareGoals(before, goals, now) {
  const keys = goals.map(goalKey);
  const fresh = !!before && now - before.t < FRESH_MS;
  const known = new Set(before?.k ?? []);
  let newCount;
  if (!fresh) newCount = 0;
  else if (before.k) newCount = keys.filter((k) => !known.has(k)).length;
  else newCount = Math.max(0, goals.length - before.n); // record saved by the old count-only code
  return { fresh, newCount, record: { n: goals.length, t: now, k: [...new Set([...(fresh ? before.k ?? [] : []), ...keys])] } };
}

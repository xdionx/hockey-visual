// Shot attempts (SAT) per team: shots on goal, goals, misses and blocks, from the play-by-play.
// The scoreboard feed doesn't carry them, so the Scores page asks for this small summary per game.
import { shotList, rosterMap } from './gameDetail.js';

/** { away, home } shot attempts so far (a shootout doesn't count). */
export function shotAttempts(pbp) {
  const awayId = pbp?.awayTeam?.id;
  const out = { away: 0, home: 0 };
  for (const s of shotList(pbp, awayId, rosterMap(pbp))) out[s.team]++;
  return out;
}

// What kind of penalty a play-by-play (or landing) penalty entry is.
//   fight            matched fighting majors: a momentum spark, not a mistake
//   major            5 minutes, the penalized team plays short for the full time even if scored on
//   match            match penalty: a major plus ejection
//   game-misconduct  ejection (10 minutes); the team is short only with a separate penalty
//   misconduct       10 minutes in the box, no skater lost
//   bench            bench minor served by another player
//   penalty-shot     awarded penalty shot, no time
//   minor            everything else (2 and 4 minutes)
export function penaltyKind(d = {}) {
  const code = String(d.typeCode ?? d.type ?? '').toUpperCase();
  const key = String(d.descKey ?? '').toLowerCase();
  if (key === 'fighting') return 'fight';
  if (code === 'MAT' || key.includes('match-penalty')) return 'match';
  if (code === 'GAM' || code === 'GMIS' || key.includes('game-misconduct')) return 'game-misconduct';
  if (code === 'MIS' || key === 'misconduct') return 'misconduct';
  if (code === 'MAJ' || (Number(d.duration) === 5 && code !== 'BEN')) return 'major';
  if (code === 'BEN') return 'bench';
  if (code === 'PS' || key.startsWith('ps-')) return 'penalty-shot';
  return 'minor';
}

/** Short label for badges. */
export const PENALTY_BADGE = { fight: 'Fight', major: 'Major', match: 'Match', 'game-misconduct': 'Game misconduct', misconduct: 'Misconduct', bench: 'Bench', 'penalty-shot': 'Penalty shot', minor: '' };

/** Extra Game Score points for the severe ones, on top of the usual penalty taken. */
export const SEVERITY_SCORE = { major: -0.75, match: -1.5, 'game-misconduct': -0.75, misconduct: -0.1 };

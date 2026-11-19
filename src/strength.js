// Current strength of play for live games, e.g. "5v4 power play" or "6v5 empty net".
//
// The NHL feeds carry a `situation` object only when strength is uneven:
//   { awayTeam: { abbrev, strength, situationDescriptions: ['PP'] }, homeTeam: {...},
//     situationCode: '1451', timeRemaining: '1:45' }
// situationCode digits: away goalie in net, away skaters, home skaters, home goalie in net.
// With no situation the game is at full even strength (5v5, or 3v3 in regular-season OT).

/** Parse "1451" into skater counts and goalies. */
export function parseSituationCode(code) {
  const s = String(code ?? '');
  if (!/^\d{4}$/.test(s)) return null;
  return { awayGoalie: +s[0], away: +s[1], home: +s[2], homeGoalie: +s[3] };
}

/**
 * @param {object} opts
 * @param {object} [opts.situation] the feed's situation object, if any
 * @param {string} [opts.code] fallback situationCode (e.g. from the latest play)
 * @param {string} [opts.period] period label: '1'..'3', 'OT', '2OT', 'SO'
 * @param {number} [opts.gameType] 2 regular season, 3 playoffs
 * @param {boolean} [opts.intermission]
 * @param {boolean} [opts.penaltyActive] false when every power-play penalty has run out on the
 *   game clock; a stale power play from the last play is then shown as even strength
 * @returns {{ away: number, home: number, label: string, kind: 'even'|'pp'|'empty-net',
 *   pp: 'away'|'home'|null, emptyNet: 'away'|'home'|null, remaining: string|null } | null}
 */
export function strengthOf({ situation, code, period, gameType, intermission, penaltyActive } = {}) {
  if (intermission || period === 'SO') return null;
  const evenSkaters = period === 'OT' && gameType !== 3 ? 3 : 5;
  const even = { awayGoalie: 1, away: evenSkaters, home: evenSkaters, homeGoalie: 1 };
  let st = parseSituationCode(situation?.situationCode ?? code) ?? even;
  // The situation code only changes with the next recorded play, so after a penalty runs out it
  // can say "power play" for a while. Trust the penalty clock instead.
  const expired = penaltyActive === false || /^0?0:00$/.test(String(situation?.timeRemaining ?? ''));
  if (expired && st.away !== st.home && st.awayGoalie && st.homeGoalie) st = even;
  const emptyNet = !st.awayGoalie ? 'away' : !st.homeGoalie ? 'home' : null;
  const pp = st.away > st.home ? 'away' : st.home > st.away ? 'home' : null;
  const remaining = !expired && situation?.timeRemaining ? String(situation.timeRemaining).replace(/^0(?=\d:)/, '') : null;
  // Skater counts; a pulled goalie's extra attacker is already counted (e.g. 6v5).
  const a = st.away;
  const h = st.home;
  let kind = 'even';
  if (emptyNet) kind = 'empty-net';
  else if (pp) kind = 'pp';
  return { away: a, home: h, label: `${a}v${h}`, kind, pp: emptyNet ? null : pp, emptyNet, remaining };
}

const NO_PP = new Set(['MIS', 'GMIS', 'GAM']); // misconducts don't change the skater count

/**
 * Whether any penalty that changes the skater count is still running at `now` (seconds since the
 * start of the game). Minors end early on a power-play goal; the next play's code covers that.
 */
export function penaltyRunning(plays, now) {
  const at = (p) => {
    const n = p.periodDescriptor?.number ?? 1;
    const [m, sec] = String(p.timeInPeriod ?? '0:00').split(':').map(Number);
    return (n - 1) * 1200 + m * 60 + sec;
  };
  return (plays ?? []).some((p) => {
    if (p.typeDescKey !== 'penalty') return false;
    const d = p.details ?? {};
    if (NO_PP.has(d.typeCode) || !d.duration) return false;
    const start = at(p);
    return now >= start && now < start + d.duration * 60;
  });
}

/** Seconds since the start of the game from the boxscore clock. */
export function gameElapsed(periodNumber, timeRemaining, gameType) {
  const n = periodNumber ?? 1;
  const len = n > 3 && gameType !== 3 ? 300 : 1200;
  const [m, sec] = String(timeRemaining ?? '0:00').split(':').map(Number);
  return (n - 1) * 1200 + (len - (m * 60 + sec));
}

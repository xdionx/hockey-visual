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
 * @returns {{ away: number, home: number, label: string, kind: 'even'|'pp'|'empty-net',
 *   pp: 'away'|'home'|null, emptyNet: 'away'|'home'|null, remaining: string|null } | null}
 */
export function strengthOf({ situation, code, period, gameType, intermission } = {}) {
  if (intermission || period === 'SO') return null;
  const parsed = parseSituationCode(situation?.situationCode ?? code);
  const evenSkaters = period === 'OT' && gameType !== 3 ? 3 : 5;
  const st = parsed ?? { awayGoalie: 1, away: evenSkaters, home: evenSkaters, homeGoalie: 1 };
  const emptyNet = !st.awayGoalie ? 'away' : !st.homeGoalie ? 'home' : null;
  const pp = st.away > st.home ? 'away' : st.home > st.away ? 'home' : null;
  const remaining = situation?.timeRemaining ? String(situation.timeRemaining).replace(/^0(?=\d:)/, '') : null;
  // Skater counts; a pulled goalie's extra attacker is already counted (e.g. 6v5).
  const a = st.away;
  const h = st.home;
  let kind = 'even';
  if (emptyNet) kind = 'empty-net';
  else if (pp) kind = 'pp';
  return { away: a, home: h, label: `${a}v${h}`, kind, pp: emptyNet ? null : pp, emptyNet, remaining };
}

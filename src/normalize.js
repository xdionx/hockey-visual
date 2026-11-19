import { strengthOf } from './strength.js';
// Turns raw NHL API game objects into a small, stable shape the UI (and future
// scorecard code) can rely on. Pure functions only: easy to test, no fetching.

const t = (v) => (v && typeof v === 'object' ? v.default : v) ?? '';

const LIVE_STATES = new Set(['LIVE', 'CRIT']);
const FINAL_STATES = new Set(['FINAL', 'OFF']);

/** "1", "2", "3", "OT", "2OT", "SO" */
export function periodLabel(pd) {
  if (!pd) return '';
  if (pd.periodType === 'SO') return 'SO';
  const max = pd.maxRegulationPeriods ?? 3;
  if (pd.periodType === 'OT' || pd.number > max) {
    const n = pd.number - max;
    return n === 1 ? 'OT' : `${n}OT`;
  }
  return String(pd.number);
}

function ordinal(n) {
  return ({ 1: '1st', 2: '2nd', 3: '3rd' })[n] ?? `${n}th`;
}

/** Long label used for goal-list headings: "1st Period", "Overtime", "2nd Overtime", "Shootout". */
export function periodName(pd) {
  const s = periodLabel(pd);
  if (s === 'SO') return 'Shootout';
  if (s === 'OT') return 'Overtime';
  if (s.endsWith('OT')) return `${ordinal(Number(s.slice(0, -2)))} Overtime`;
  return `${ordinal(Number(s))} Period`;
}

/** Status for display + a coarse state for logic: 'pre' | 'live' | 'final' | 'postponed'. */
export function gameStatus(g) {
  if (g.gameScheduleState && g.gameScheduleState !== 'OK') {
    const map = { PPD: 'Postponed', SUSP: 'Suspended', CNCL: 'Cancelled' };
    return { state: 'postponed', label: map[g.gameScheduleState] ?? g.gameScheduleState };
  }
  if (FINAL_STATES.has(g.gameState)) {
    const last = g.gameOutcome?.lastPeriodType;
    let suffix = '';
    if (last === 'SO') suffix = '/SO';
    else if (last === 'OT') suffix = (g.gameOutcome.otPeriods ?? 1) > 1 ? `/${g.gameOutcome.otPeriods}OT` : '/OT';
    return { state: 'final', label: `Final${suffix}` };
  }
  if (LIVE_STATES.has(g.gameState)) {
    const p = periodLabel(g.periodDescriptor);
    const pText = /^\d$/.test(p) ? ordinal(Number(p)) : p;
    if (g.clock?.inIntermission) return { state: 'live', label: `${pText} Intermission` };
    if (p === 'SO') return { state: 'live', label: 'Shootout' };
    return { state: 'live', label: `${pText} ${(g.clock?.timeRemaining ?? '').replace(/^0(?=\d:)/, '')}`.trim() };
  }
  return { state: 'pre', label: 'Scheduled', startTimeUTC: g.startTimeUTC };
}

/**
 * Goals by period, built from the scoreboard's goal list.
 * Columns: 1, 2, 3 always; OT/2OT.. and SO only when the game reached them.
 * The scoreboard lists only the deciding shootout goal, so SO shows 1-0 like nhl.com.
 */
export function buildLinescore(g) {
  const awayAbbrev = g.awayTeam.abbrev;
  const goals = g.goals ?? [];
  const maxReg = g.periodDescriptor?.maxRegulationPeriods ?? 3;
  const currentPeriod = g.periodDescriptor?.number ?? 0;

  const periods = new Map(); // label -> { label, away, home }
  const add = (pd) => {
    const label = periodLabel(pd);
    if (!periods.has(label)) periods.set(label, { label, number: pd.number, away: 0, home: 0 });
    return periods.get(label);
  };
  for (let n = 1; n <= maxReg; n++) add({ number: n, periodType: 'REG', maxRegulationPeriods: maxReg });
  for (let n = maxReg + 1; n <= currentPeriod; n++) {
    const isSO = g.periodDescriptor?.periodType === 'SO' && n === currentPeriod;
    add({ number: n, periodType: isSO ? 'SO' : 'OT', maxRegulationPeriods: maxReg });
  }
  for (const goal of goals) {
    const row = add(goal.periodDescriptor ?? { number: goal.period, periodType: 'REG' });
    row[goal.teamAbbrev === awayAbbrev ? 'away' : 'home'] += 1;
  }

  const cols = [...periods.values()].sort((a, b) => a.number - b.number);
  return {
    periods: cols.map(({ label, away, home }) => ({ label, away, home })),
    totals: { away: g.awayTeam.score ?? 0, home: g.homeTeam.score ?? 0 },
    shots: { away: g.awayTeam.sog ?? null, home: g.homeTeam.sog ?? null },
  };
}

/**
 * Official nhl.com video page for a clip, or null. Only https links on nhl.com are kept,
 * because the page puts them in href attributes. Relative paths ("/video/...") are resolved.
 */
export function nhlVideoUrl(link) {
  if (!link || typeof link !== 'string') return null;
  try {
    const u = new URL(link, 'https://www.nhl.com');
    if (!/^(www\.)?nhl\.com$/.test(u.hostname)) return null;
    u.protocol = 'https:';
    u.hostname = 'www.nhl.com';
    return u.href;
  } catch {
    return null;
  }
}

/** Brightcove video id: the numeric id field, else the trailing number of an nhl.com video URL. */
export function videoId(id, link) {
  if (id != null && /^\d{6,20}$/.test(String(id))) return String(id);
  const m = typeof link === 'string' ? link.match(/-(\d{6,20})\/?$/) : null;
  return m ? m[1] : null;
}

function normalizeGoal(goal) {
  const strength = (goal.strength ?? 'ev').toUpperCase();
  const tags = [];
  if (strength === 'PP') tags.push('PPG');
  if (strength === 'SH') tags.push('SHG');
  if (goal.goalModifier === 'empty-net') tags.push('EN');
  if (goal.goalModifier === 'penalty-shot') tags.push('PS');
  if (goal.goalModifier === 'own-goal') tags.push('OG');
  return {
    period: periodLabel(goal.periodDescriptor),
    periodName: periodName(goal.periodDescriptor),
    time: (goal.timeInPeriod ?? '').replace(/^0(?=\d:)/, ''),
    team: goal.teamAbbrev,
    scorer: { id: goal.playerId, name: t(goal.name), firstName: t(goal.firstName), lastName: t(goal.lastName), goalsToDate: goal.goalsToDate ?? null, mugshot: goal.mugshot ?? null },
    assists: (goal.assists ?? []).map((a) => ({ id: a.playerId, name: t(a.name), assistsToDate: a.assistsToDate ?? null })),
    tags,
    score: { away: goal.awayScore, home: goal.homeScore },
    highlight: nhlVideoUrl(goal.highlightClipSharingUrl),
    highlightId: videoId(goal.highlightClip, goal.highlightClipSharingUrl),
  };
}

function normalizeTeam(team) {
  return {
    id: team.id,
    abbrev: team.abbrev,
    name: t(team.name),
    logo: team.logo,
    score: team.score ?? null,
    sog: team.sog ?? null,
    record: team.record ?? null,
  };
}

export function normalizeGame(g) {
  const status = gameStatus(g);
  return {
    id: g.id,
    season: g.season,
    gameType: g.gameType, // 1 preseason, 2 regular, 3 playoffs
    gameDate: g.gameDate,
    startTimeUTC: g.startTimeUTC,
    venue: t(g.venue),
    status,
    strength: status.state === 'live'
      ? strengthOf({ situation: g.situation, period: periodLabel(g.periodDescriptor), gameType: g.gameType, intermission: g.clock?.inIntermission })
      : null,
    away: normalizeTeam(g.awayTeam),
    home: normalizeTeam(g.homeTeam),
    linescore: buildLinescore(g),
    goals: (g.goals ?? []).map(normalizeGoal),
    video: {
      recap: nhlVideoUrl(g.threeMinRecap),
      recapId: videoId(null, g.threeMinRecap),
      condensed: nhlVideoUrl(g.condensedGame),
      condensedId: videoId(null, g.condensedGame),
    },
  };
}

export function normalizeScoreboard(raw) {
  return {
    date: raw.currentDate,
    prevDate: raw.prevDate,
    nextDate: raw.nextDate,
    games: (raw.games ?? []).map(normalizeGame),
  };
}

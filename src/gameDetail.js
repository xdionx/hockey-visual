// Builds one game's box score from the NHL API's game center endpoints
// (boxscore, landing, right-rail, play-by-play). Pure functions, no fetching.
//
// Output feeds the box score page designs and, later, per-player scorecards.
import { gameStatus, periodLabel, periodName, nhlVideoUrl, videoId } from './normalize.js';
import { computeMomentum, onIceAttempts, inHomePlate } from './momentum.js';
import { strengthOf } from './strength.js';

const t = (v) => (v && typeof v === 'object' ? v.default : v) ?? '';
const clockTime = (s) => (s ?? '').replace(/^0(?=\d:)/, '');
const round = (n, d = 2) => Math.round(n * 10 ** d) / 10 ** d;
const toSeconds = (mmss) => {
  const [m, s] = String(mmss ?? '0:0').split(':').map(Number);
  return (m || 0) * 60 + (s || 0);
};
const humanize = (key) => String(key ?? '').replace(/-/g, ' ').replace(/\b\w/, (c) => c.toUpperCase());

// Game Score weights (Dom Luszczyszyn's public model). On-ice shot attempts come from
// shift charts, weighted by result; when shifts are missing, on-ice goals use plus/minus.
export const GAME_SCORE_WEIGHTS = {
  goals: 0.75, primaryAssists: 0.7, secondaryAssists: 0.55, shots: 0.075, blocks: 0.05,
  penaltiesDrawn: 0.15, penaltiesTaken: -0.15, faceoffWins: 0.01, faceoffLosses: -0.01, plusMinus: 0.15, onIceAttempts: 0.05,
  homePlate: 0.04, // per shot attempt from the home plate area; our addition
  momentum: 0.05, // per point of momentum impact (see momentum.js); our addition to the public model
};

/** Skater game score, split into groups the scorecard can chart. */
export function skaterGameScore(s) {
  const w = GAME_SCORE_WEIGHTS;
  const parts = {
    scoring: s.goals * w.goals + s.a1 * w.primaryAssists + s.a2 * w.secondaryAssists,
    shooting: s.sog * w.shots + (s.homePlate ?? 0) * w.homePlate,
    defense: s.blocks * w.blocks,
    discipline: s.penaltiesDrawn * w.penaltiesDrawn + s.penaltiesTaken * w.penaltiesTaken,
    faceoffs: s.fow * w.faceoffWins + s.fol * w.faceoffLosses,
    // With shift data: weighted on-ice attempts and goals for minus against. Without: plus/minus.
    onIce: s.onIce ? (s.onIce.cf - s.onIce.ca) * w.onIceAttempts + (s.onIce.gf - s.onIce.ga) * w.plusMinus : s.plusMinus * w.plusMinus,
    momentum: (s.momentum ?? 0) * w.momentum,
  };
  const total = Object.values(parts).reduce((a, b) => a + b, 0);
  return { total: round(total), parts: Object.fromEntries(Object.entries(parts).map(([k, v]) => [k, round(v)])) };
}

/** Goalie game score: -0.75 per goal against, +0.1 per save. */
export function goalieGameScore(g) {
  return round(-0.75 * g.goalsAgainst + 0.1 * g.saves);
}

/** A 3.0-10.0 rating from a game score, like the ratings in soccer apps. 0 game score = 6.0. */
export function rating(gameScore) {
  return round(Math.min(10, Math.max(3, 6 + 1.5 * gameScore)), 1);
}

const TEAM_STAT_LABELS = {
  sog: 'Shots on goal', faceoffWinningPctg: 'Faceoff %', powerPlay: 'Power play', pim: 'Penalty minutes',
  hits: 'Hits', blockedShots: 'Blocked shots', giveaways: 'Giveaways', takeaways: 'Takeaways',
};

function teamStats(rightRail) {
  const out = [];
  for (const s of rightRail?.teamGameStats ?? []) {
    if (!TEAM_STAT_LABELS[s.category]) continue;
    let { awayValue: away, homeValue: home } = s;
    let awayNum = Number(away);
    let homeNum = Number(home);
    if (s.category === 'faceoffWinningPctg') {
      awayNum = round(away * 100, 1);
      homeNum = round(home * 100, 1);
      away = `${awayNum.toFixed(1)}%`;
      home = `${homeNum.toFixed(1)}%`;
    } else if (s.category === 'powerPlay') {
      const [ag, ao] = String(away).split('/').map(Number);
      const [hg, ho] = String(home).split('/').map(Number);
      awayNum = ag || 0;
      homeNum = hg || 0;
      away = `${ag}/${ao}`;
      home = `${hg}/${ho}`;
    }
    out.push({ key: s.category, label: TEAM_STAT_LABELS[s.category], away: String(away), home: String(home), awayNum, homeNum });
  }
  return out;
}

function linescore(box, rightRail) {
  const shots = new Map((rightRail?.shotsByPeriod ?? []).map((p) => [periodLabel(p.periodDescriptor), p]));
  const by = rightRail?.linescore?.byPeriod ?? [];
  const periods = by.map((p) => {
    const label = periodLabel(p.periodDescriptor);
    const s = shots.get(label);
    return { label, away: p.away, home: p.home, shotsAway: s?.away ?? null, shotsHome: s?.home ?? null };
  });
  // Before puck drop the right rail has no periods yet; show the regulation columns empty.
  if (!periods.length) for (let n = 1; n <= (box.regPeriods ?? 3); n++) periods.push({ label: String(n), away: null, home: null, shotsAway: null, shotsHome: null });
  const so = rightRail?.linescore?.shootout;
  return {
    periods,
    totals: { away: box.awayTeam.score ?? 0, home: box.homeTeam.score ?? 0 },
    shots: { away: box.awayTeam.sog ?? null, home: box.homeTeam.sog ?? null },
    shootout: so ? { away: `${so.awayConversions}/${so.awayAttempts}`, home: `${so.homeConversions}/${so.homeAttempts}` } : null,
  };
}

/** Per-player event counts from play-by-play that the boxscore doesn't carry. */
function eventCounts(pbp) {
  const counts = new Map();
  const get = (id) => {
    if (!counts.has(id)) counts.set(id, { a1: 0, a2: 0, fow: 0, fol: 0, penaltiesDrawn: 0, penaltiesTaken: 0, missed: 0, blockedAgainst: 0, homePlate: 0 });
    return counts.get(id);
  };
  for (const e of pbp?.plays ?? []) {
    if (e.periodDescriptor?.periodType === 'SO') continue;
    const d = e.details ?? {};
    const shooter = d.shootingPlayerId ?? d.scoringPlayerId;
    if (shooter && ['goal', 'shot-on-goal', 'missed-shot', 'blocked-shot'].includes(e.typeDescKey) && inHomePlate(d.xCoord, d.yCoord)) get(shooter).homePlate++;
    switch (e.typeDescKey) {
      case 'goal':
        if (d.assist1PlayerId) get(d.assist1PlayerId).a1++;
        if (d.assist2PlayerId) get(d.assist2PlayerId).a2++;
        break;
      case 'faceoff':
        if (d.winningPlayerId) get(d.winningPlayerId).fow++;
        if (d.losingPlayerId) get(d.losingPlayerId).fol++;
        break;
      case 'penalty':
        if (d.committedByPlayerId && d.typeCode !== 'BEN') get(d.committedByPlayerId).penaltiesTaken++;
        if (d.drawnByPlayerId) get(d.drawnByPlayerId).penaltiesDrawn++;
        break;
      case 'missed-shot':
        if (d.shootingPlayerId) get(d.shootingPlayerId).missed++;
        break;
      case 'blocked-shot':
        if (d.shootingPlayerId) get(d.shootingPlayerId).blockedAgainst++;
        break;
      default:
    }
  }
  return counts;
}

/**
 * Offensive-zone area a shot came from, measured from the net the shooter attacks.
 * dx = feet out from the goal line, lateral = feet left (+) or right (-) of center from the shooter's view.
 */
export function shotZone(team, x, y) {
  const dx = team === 'home' ? 89 - x : x + 89;
  const lateral = team === 'home' ? y : -y;
  const side = lateral >= 0 ? 'left' : 'right';
  if (dx < 0) return 'behind-net';
  if (dx > 64) return 'outside';
  // Home plate (posts to faceoff dots to top of the circles), one zone on each side of it,
  // and the area from the top of the circles to the blue line split into left and right.
  if (inHomePlate(89 - dx, y)) return 'home-plate';
  if (dx > 35) return `point-${side}`;
  return `side-${side}`;
}

const SHOT_TYPES = { goal: 'goal', 'shot-on-goal': 'sog', 'missed-shot': 'miss', 'blocked-shot': 'block' };

/**
 * Every unblocked and blocked shot attempt, with rink coordinates turned so the
 * away team always shoots at the left net and the home team at the right net.
 * x is -100..100 feet, y is -42.5..42.5 feet.
 */
function shotList(pbp, awayId, roster) {
  const out = [];
  for (const e of pbp?.plays ?? []) {
    const kind = SHOT_TYPES[e.typeDescKey];
    if (!kind || e.periodDescriptor?.periodType === 'SO') continue;
    const d = e.details ?? {};
    if (d.xCoord == null || d.yCoord == null) continue;
    // Use the shooter's roster team: a blocked shot's owner team isn't always the shooter's.
    const shooterId = d.shootingPlayerId ?? d.scoringPlayerId ?? null;
    const teamId = roster.get(shooterId)?.teamId ?? d.eventOwnerTeamId;
    const shooterTeam = teamId === awayId ? 'away' : 'home';
    const flip = e.homeTeamDefendingSide === 'right' ? -1 : 1;
    let x = d.xCoord * flip;
    let y = d.yCoord * flip;
    // Keep each team's shots in its attacking half view even on odd coordinates (e.g. long dump-ins).
    if (kind !== 'block' && d.zoneCode === 'O' && (shooterTeam === 'away') === (x > 0)) { x = -x; y = -y; }
    out.push({
      team: shooterTeam,
      kind,
      x,
      y,
      period: periodLabel(e.periodDescriptor),
      time: clockTime(e.timeInPeriod),
      elapsed: (e.periodDescriptor.number - 1) * 1200 + toSeconds(e.timeInPeriod),
      shooterId,
      ...(kind === 'goal' ? { assistIds: [d.assist1PlayerId, d.assist2PlayerId].filter(Boolean), goalieId: d.goalieInNetId ?? null } : {}),
      shotType: d.shotType ?? null,
      zone: shotZone(shooterTeam, x, y),
      homePlate: inHomePlate(x, y),
    });
  }
  return out;
}

function rosterMap(pbp) {
  return new Map((pbp?.rosterSpots ?? []).map((r) => [r.playerId, {
    firstName: t(r.firstName), lastName: t(r.lastName), headshot: r.headshot ?? null, teamId: r.teamId,
  }]));
}

function skater(raw, counts, roster, momentum, onIce) {
  const c = counts.get(raw.playerId) ?? { a1: 0, a2: 0, fow: 0, fol: 0, penaltiesDrawn: 0, penaltiesTaken: 0, missed: 0, blockedAgainst: 0, homePlate: 0 };
  const r = roster.get(raw.playerId);
  const s = {
    id: raw.playerId,
    number: raw.sweaterNumber ?? null,
    name: t(raw.name),
    fullName: r ? `${r.firstName} ${r.lastName}` : t(raw.name),
    lastName: r?.lastName ?? t(raw.name).replace(/^.*?\.\s*/, ''),
    headshot: r?.headshot ?? null,
    position: raw.position,
    goals: raw.goals ?? 0,
    assists: raw.assists ?? 0,
    points: raw.points ?? 0,
    plusMinus: raw.plusMinus ?? 0,
    pim: raw.pim ?? 0,
    hits: raw.hits ?? 0,
    ppg: raw.powerPlayGoals ?? 0,
    sog: raw.sog ?? 0,
    blocks: raw.blockedShots ?? 0,
    giveaways: raw.giveaways ?? 0,
    takeaways: raw.takeaways ?? 0,
    shifts: raw.shifts ?? 0,
    toi: raw.toi ?? '0:00',
    toiSeconds: toSeconds(raw.toi),
    a1: c.a1,
    a2: c.a2,
    fow: c.fow,
    fol: c.fol,
    foPct: c.fow + c.fol ? round((100 * c.fow) / (c.fow + c.fol), 1) : null,
    attempts: (raw.sog ?? 0) + c.missed + c.blockedAgainst,
    homePlate: c.homePlate,
    penaltiesDrawn: c.penaltiesDrawn,
    penaltiesTaken: c.penaltiesTaken,
  };
  const mom = momentum?.players?.[raw.playerId] ?? { impact: 0, swingPlays: 0 };
  s.momentum = mom.impact;
  s.onIce = onIce?.get(raw.playerId) ?? null;
  s.swingPlays = mom.swingPlays;
  const gs = skaterGameScore(s);
  s.gameScore = gs.total;
  s.gameScoreParts = gs.parts;
  s.rating = rating(gs.total);
  return s;
}

function goalie(raw, roster) {
  const r = roster.get(raw.playerId);
  const g = {
    id: raw.playerId,
    number: raw.sweaterNumber ?? null,
    name: t(raw.name),
    fullName: r ? `${r.firstName} ${r.lastName}` : t(raw.name),
    lastName: r?.lastName ?? t(raw.name).replace(/^.*?\.\s*/, ''),
    headshot: r?.headshot ?? null,
    position: 'G',
    starter: !!raw.starter,
    decision: raw.decision ?? null,
    shotsAgainst: raw.shotsAgainst ?? 0,
    saves: raw.saves ?? 0,
    goalsAgainst: raw.goalsAgainst ?? 0,
    savePct: raw.savePctg ?? null,
    evenStrength: raw.evenStrengthShotsAgainst ?? null,
    powerPlay: raw.powerPlayShotsAgainst ?? null,
    shorthanded: raw.shorthandedShotsAgainst ?? null,
    pim: raw.pim ?? 0,
    toi: raw.toi ?? '0:00',
    toiSeconds: toSeconds(raw.toi),
  };
  g.played = g.toiSeconds > 0;
  g.gameScore = goalieGameScore(g);
  g.rating = rating(g.gameScore);
  return g;
}

function teamPlayers(stats, counts, roster, momentum, onIce) {
  if (!stats) return { forwards: [], defense: [], goalies: [] };
  return {
    forwards: (stats.forwards ?? []).map((p) => skater(p, counts, roster, momentum, onIce)),
    defense: (stats.defense ?? []).map((p) => skater(p, counts, roster, momentum, onIce)),
    goalies: (stats.goalies ?? []).map((p) => goalie(p, roster)),
  };
}

function strengthTags(goal) {
  const tags = [];
  const strength = (goal.strength ?? 'ev').toUpperCase();
  if (strength === 'PP') tags.push('PPG');
  if (strength === 'SH') tags.push('SHG');
  if (goal.goalModifier === 'empty-net') tags.push('EN');
  if (goal.goalModifier === 'penalty-shot') tags.push('PS');
  if (goal.goalModifier === 'own-goal') tags.push('OG');
  return tags;
}

/** ".../sprites/20262027/2026020312/ev76.json" -> "https://www.nhl.com/ppt-replay/goal/2026020312/76" */
function visualizerUrl(gameId, ppt) {
  const m = /\/ev(\d+)\.json/.exec(ppt ?? '');
  return m && gameId ? `https://www.nhl.com/ppt-replay/goal/${gameId}/${m[1]}` : null;
}

function scoring(landing) {
  const out = [];
  for (const p of landing?.summary?.scoring ?? []) {
    for (const g of p.goals ?? []) {
      out.push({
        period: periodLabel(p.periodDescriptor),
        periodName: periodName(p.periodDescriptor),
        time: clockTime(g.timeInPeriod),
        team: t(g.teamAbbrev),
        scorer: { id: g.playerId, name: t(g.name), fullName: `${t(g.firstName)} ${t(g.lastName)}`, headshot: g.headshot ?? null, goalsToDate: g.goalsToDate ?? null },
        assists: (g.assists ?? []).map((a) => ({ id: a.playerId, name: t(a.name), fullName: `${t(a.firstName)} ${t(a.lastName)}`, assistsToDate: a.assistsToDate ?? null })),
        tags: strengthTags(g),
        shotType: g.shotType ?? null,
        score: { away: g.awayScore, home: g.homeScore },
        highlight: nhlVideoUrl(g.highlightClipSharingUrl),
        highlightId: videoId(g.highlightClip, g.highlightClipSharingUrl),
        // NHL.com's goal visualizer (puck and player tracking replay), when tracking exists.
        visualizer: visualizerUrl(landing.id, g.pptReplayUrl),
      });
    }
  }
  return out;
}

function shootout(landing) {
  const events = landing?.summary?.shootout?.events ?? landing?.summary?.shootout ?? [];
  if (!Array.isArray(events)) return [];
  return events.map((e) => ({
    sequence: e.sequence,
    team: t(e.teamAbbrev),
    shooter: `${t(e.firstName)} ${t(e.lastName)}`.trim(),
    headshot: e.headshot ?? null,
    result: e.result,
    shotType: e.shotType ?? null,
    gameWinner: !!e.gameWinner,
  }));
}

function penalties(landing) {
  const out = [];
  for (const p of landing?.summary?.penalties ?? []) {
    for (const pen of p.penalties ?? []) {
      const who = pen.committedByPlayer;
      out.push({
        period: periodLabel(p.periodDescriptor),
        periodName: periodName(p.periodDescriptor),
        time: clockTime(pen.timeInPeriod),
        team: t(pen.teamAbbrev),
        player: who ? (typeof who === 'string' ? who : `${t(who.firstName)} ${t(who.lastName)}`.trim()) : (pen.type === 'BEN' ? 'Bench' : 'Team'),
        number: who?.sweaterNumber ?? null,
        infraction: humanize(pen.descKey),
        minutes: pen.duration ?? null,
        type: pen.type ?? null,
        drawnBy: pen.drawnBy ? `${t(pen.drawnBy.firstName)} ${t(pen.drawnBy.lastName)}`.trim() : null,
        servedBy: pen.servedBy ? t(pen.servedBy) : null,
      });
    }
  }
  return out;
}

function threeStars(landing) {
  return (landing?.summary?.threeStars ?? []).map((s) => ({
    star: s.star,
    id: s.playerId,
    name: t(s.name),
    team: s.teamAbbrev,
    number: s.sweaterNo ?? null,
    position: s.position,
    headshot: s.headshot ?? null,
    line: s.position === 'G'
      ? `${s.savePctg != null ? s.savePctg.toFixed(3).replace(/^0/, '') : '-'} SV%`
      : `${s.goals ?? 0} G, ${s.assists ?? 0} A`,
  }));
}

function team(boxTeam, info) {
  return {
    id: boxTeam.id,
    abbrev: boxTeam.abbrev,
    name: `${t(boxTeam.placeName)} ${t(boxTeam.commonName)}`.trim(),
    placeName: t(boxTeam.placeName),
    commonName: t(boxTeam.commonName),
    logo: boxTeam.logo ?? null,
    darkLogo: boxTeam.darkLogo ?? null,
    score: boxTeam.score ?? null,
    sog: boxTeam.sog ?? null,
    coach: t(info?.headCoach) || null,
    scratches: (info?.scratches ?? []).map((s) => `${t(s.firstName)} ${t(s.lastName)}`.trim()),
  };
}

/** One game's box score from the raw endpoint responses. Any of landing/rightRail/pbp may be missing. */
export function normalizeGameDetail({ box, landing = null, rightRail = null, pbp = null, shifts = null }) {
  const counts = eventCounts(pbp);
  const roster = rosterMap(pbp);
  const momentum = pbp ? computeMomentum(pbp, box.awayTeam.id) : null;
  const goalieIds = new Set(['awayTeam', 'homeTeam'].flatMap((k) => (box.playerByGameStats?.[k]?.goalies ?? []).map((g) => g.playerId)));
  const onIce = onIceAttempts(pbp, shifts, goalieIds);
  const nameOf = (id) => (roster.get(id) ? `${roster.get(id).firstName} ${roster.get(id).lastName}` : null);
  const info = rightRail?.gameInfo ?? {};
  const video = rightRail?.gameVideo ?? {};
  const series = rightRail?.seasonSeriesWins;
  const status = gameStatus(box);
  const lastPlay = (pbp?.plays ?? []).at(-1);
  const strength = status.state === 'live'
    ? strengthOf({
      situation: landing?.situation ?? pbp?.situation ?? box.situation,
      code: lastPlay?.situationCode,
      period: periodLabel(box.periodDescriptor),
      gameType: box.gameType,
      intermission: box.clock?.inIntermission,
    })
    : null;
  return {
    id: box.id,
    season: box.season,
    gameType: box.gameType,
    gameDate: box.gameDate,
    startTimeUTC: box.startTimeUTC,
    venue: t(box.venue),
    venueLocation: t(box.venueLocation),
    broadcasts: (box.tvBroadcasts ?? []).map((b) => `${b.network}${b.countryCode ? ` (${b.countryCode})` : ''}`),
    status,
    strength,
    away: team(box.awayTeam, info.awayTeam),
    home: team(box.homeTeam, info.homeTeam),
    linescore: linescore(box, rightRail),
    teamStats: teamStats(rightRail),
    scoring: scoring(landing),
    shootout: shootout(landing),
    penalties: penalties(landing),
    threeStars: threeStars(landing),
    players: {
      away: teamPlayers(box.playerByGameStats?.awayTeam, counts, roster, momentum, onIce),
      home: teamPlayers(box.playerByGameStats?.homeTeam, counts, roster, momentum, onIce),
    },
    hasShifts: Boolean(onIce),
    shots: shotList(pbp, box.awayTeam.id, roster),
    momentum: momentum && {
      series: momentum.series,
      max: momentum.max,
      totals: momentum.totals,
      periods: momentum.periods,
      powerPlays: momentum.powerPlays,
      swings: momentum.swings.map((sw) => ({ ...sw, cause: sw.cause && { ...sw.cause, player: nameOf(sw.cause.playerId) } })),
    },
    officials: {
      referees: (info.referees ?? []).map((r) => t(r.fullName ?? r)),
      linesmen: (info.linesmen ?? []).map((r) => t(r.fullName ?? r)),
    },
    seasonSeries: series ? { away: series.awayTeamWins, home: series.homeTeamWins } : null,
    video: {
      recapId: video.threeMinRecap ? String(video.threeMinRecap) : null,
      condensedId: video.condensedGame ? String(video.condensedGame) : null,
    },
  };
}

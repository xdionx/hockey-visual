// Replay: rebuild what a finished game looked like at any moment of its clock.
//
// The NHL's play-by-play has every event with its game clock, so slicing the raw
// endpoint responses at "t seconds into the game" gives the same shape the live
// endpoints returned at that moment. normalizeGameDetail() then draws it like a live game.
// Pure functions: they run in Node (tests) and in the browser (the /sim mode of the box score).
import { penaltyKind } from './penalties.js';

const REG = 1200;
const parse = (s) => { const [m, sec] = String(s ?? '0:00').split(':').map(Number); return m * 60 + sec; };
const fmt = (sec) => `${Math.floor(sec / 60)}:${String(Math.max(0, Math.round(sec % 60))).padStart(2, '0')}`;
const pad = (sec) => { const [m, s] = fmt(sec).split(':'); return `${m.padStart(2, '0')}:${s}`; };
const at = (n, timeInPeriod) => (n - 1) * REG + parse(timeInPeriod);
const playAt = (p) => at(p.periodDescriptor?.number ?? 1, p.timeInPeriod);
const isSO = (p) => p.periodDescriptor?.periodType === 'SO';

/** Seconds of game clock a replay covers (the end of regulation or overtime; a shootout is not replayed). */
export function replayDuration(raw) {
  return Math.max(0, ...(raw?.pbp?.plays ?? []).filter((p) => !isSO(p)).map(playAt));
}

function periodAt(t, gameType, maxReg = 3) {
  let start = 0;
  for (let n = 1; ; n++) {
    const len = n > maxReg && gameType !== 3 ? 300 : REG;
    if (t < start + len || n >= 12) return { number: n, remaining: Math.max(0, start + len - t), type: n <= maxReg ? 'REG' : 'OT', maxReg };
    start += len;
  }
}

/** The raw endpoint responses as they were `t` seconds into the game. At or past the end, the finished game. */
export function sliceRaw(raw, t) {
  const dur = replayDuration(raw);
  if (t >= dur) return raw;
  const box = structuredClone(raw.box);
  const landing = structuredClone(raw.landing ?? {});
  const rightRail = structuredClone(raw.rightRail ?? {});
  const maxReg = box.periodDescriptor?.maxRegulationPeriods ?? 3;
  const plays = (raw.pbp?.plays ?? []).filter((p) => !isSO(p) && playAt(p) <= t);
  const ids = { away: box.awayTeam.id, home: box.homeTeam.id };
  const side = (teamId) => (teamId === ids.away ? 'away' : teamId === ids.home ? 'home' : null);

  // Clock and status.
  const per = periodAt(Math.max(0, t), box.gameType, maxReg);
  box.gameState = 'LIVE';
  delete box.gameOutcome;
  delete box.situation;
  box.periodDescriptor = { number: per.number, periodType: per.type, maxRegulationPeriods: maxReg };
  box.clock = { timeRemaining: pad(per.remaining), secondsRemaining: per.remaining, running: true, inIntermission: false };

  // Player counters, rebuilt from the events so far.
  const players = new Map();
  const teamOf = new Map();
  for (const k of ['awayTeam', 'homeTeam']) {
    for (const g of ['forwards', 'defense', 'goalies']) {
      for (const p of box.playerByGameStats?.[k]?.[g] ?? []) {
        players.set(p.playerId, p);
        teamOf.set(p.playerId, k === 'awayTeam' ? 'away' : 'home');
        if (g === 'goalies') {
          p.shotsAgainst = 0; p.saves = 0; p.goalsAgainst = 0; p.savePctg = null; p.decision = null;
          for (const f of ['evenStrengthShotsAgainst', 'powerPlayShotsAgainst', 'shorthandedShotsAgainst', 'saveShotsAgainst', 'evenStrengthGoalsAgainst', 'powerPlayGoalsAgainst', 'shorthandedGoalsAgainst']) delete p[f];
        } else {
          Object.assign(p, { goals: 0, assists: 0, points: 0, plusMinus: 0, pim: 0, hits: 0, powerPlayGoals: 0, sog: 0, blockedShots: 0, giveaways: 0, takeaways: 0 });
        }
      }
    }
  }
  const strengthOfGoal = new Map();
  for (const per2 of landing.summary?.scoring ?? []) for (const g of per2.goals ?? []) strengthOfGoal.set(g.eventId, g.strength);
  const bump = (id, field, n = 1) => { const p = players.get(id); if (p && field in p) { p[field] += n; } };
  const team = { away: { sog: 0, goals: 0, hits: 0, blocked: 0, give: 0, take: 0, pim: 0, fow: 0, fol: 0, ppGoals: 0, ppOpp: 0 }, home: { sog: 0, goals: 0, hits: 0, blocked: 0, give: 0, take: 0, pim: 0, fow: 0, fol: 0, ppGoals: 0, ppOpp: 0 } };
  const byPeriod = new Map(); // period number -> {goals:{away,home}, shots:{away,home}}
  const slot = (n) => { if (!byPeriod.has(n)) byPeriod.set(n, { goals: { away: 0, home: 0 }, shots: { away: 0, home: 0 } }); return byPeriod.get(n); };
  for (let n = 1; n <= per.number; n++) slot(n);

  for (const p of plays) {
    const d = p.details ?? {};
    const s = side(d.eventOwnerTeamId);
    const n = p.periodDescriptor?.number ?? 1;
    switch (p.typeDescKey) {
      case 'goal': case 'shot-on-goal': {
        const goal = p.typeDescKey === 'goal';
        const shooter = d.scoringPlayerId ?? d.shootingPlayerId;
        bump(shooter, 'sog');
        if (s) { team[s].sog++; slot(n).shots[s]++; }
        if (goal) {
          bump(d.scoringPlayerId, 'goals'); bump(d.scoringPlayerId, 'points');
          bump(d.assist1PlayerId, 'assists'); bump(d.assist1PlayerId, 'points');
          bump(d.assist2PlayerId, 'assists'); bump(d.assist2PlayerId, 'points');
          if (s) { team[s].goals++; slot(n).goals[s]++; }
          if (strengthOfGoal.get(p.eventId) === 'pp') { bump(d.scoringPlayerId, 'powerPlayGoals'); if (s) team[s].ppGoals++; }
        }
        const gk = players.get(d.goalieInNetId);
        if (gk) { gk.shotsAgainst++; if (goal) gk.goalsAgainst++; else gk.saves++; }
        break;
      }
      case 'hit': bump(d.hittingPlayerId, 'hits'); if (s) team[s].hits++; break;
      case 'blocked-shot': bump(d.blockingPlayerId, 'blockedShots'); if (teamOf.get(d.blockingPlayerId)) team[teamOf.get(d.blockingPlayerId)].blocked++; break;
      case 'giveaway': bump(d.playerId, 'giveaways'); if (s) team[s].give++; break;
      case 'takeaway': bump(d.playerId, 'takeaways'); if (s) team[s].take++; break;
      case 'faceoff': if (s) { team[s].fow++; team[s === 'away' ? 'home' : 'away'].fol++; } break;
      case 'penalty': {
        const kind = penaltyKind(d);
        if (d.committedByPlayerId) bump(d.committedByPlayerId, 'pim', d.duration ?? 0);
        if (s) {
          team[s].pim += d.duration ?? 0;
          if (d.duration >= 2 && !['fight', 'bench'].includes(kind)) team[s === 'away' ? 'home' : 'away'].ppOpp++;
        }
        break;
      }
      default:
    }
  }
  for (const k of ['away', 'home']) {
    box[`${k}Team`].score = team[k].goals;
    box[`${k}Team`].sog = team[k].sog;
  }
  for (const gk of players.values()) if (gk.position === 'G') gk.savePctg = gk.shotsAgainst ? gk.saves / gk.shotsAgainst : null;

  // Time on ice: starters play from the first whistle; a backup takes over where the starter's real total ends.
  const frac = Math.min(1, t / dur);
  for (const k of ['awayTeam', 'homeTeam']) {
    const st = box.playerByGameStats?.[k];
    for (const g of ['forwards', 'defense']) {
      for (const p of st?.[g] ?? []) { p.toi = fmt(parse(p.toi) * frac); p.shifts = Math.round((p.shifts ?? 0) * frac); }
    }
    const gks = [...(st?.goalies ?? [])].sort((a, b) => b.starter - a.starter || parse(b.toi) - parse(a.toi));
    let used = 0;
    for (const gk of gks) {
      const full = parse(gk.toi);
      const here = Math.max(0, Math.min(full, t - used));
      gk.toi = fmt(here);
      used += here;
    }
  }

  // Landing: only the goals and penalties so far.
  const keep = (groups, listKey) => (groups ?? []).map((g) => ({
    ...g,
    [listKey]: (g[listKey] ?? []).filter((x) => at(g.periodDescriptor?.number ?? 1, x.timeInPeriod) <= t),
  })).filter((g) => g.periodDescriptor?.periodType !== 'SO' && g[listKey].length);
  if (landing.summary) {
    landing.summary.scoring = keep(landing.summary.scoring, 'goals');
    landing.summary.penalties = keep(landing.summary.penalties, 'penalties');
    landing.summary.threeStars = [];
    delete landing.summary.shootout;
  }
  delete landing.situation;

  // Right rail: period tables and team totals from the same events.
  const periodDesc = (n) => ({ number: n, periodType: n <= maxReg ? 'REG' : 'OT', maxRegulationPeriods: maxReg });
  rightRail.linescore = { byPeriod: [...byPeriod].map(([n, v]) => ({ periodDescriptor: periodDesc(n), away: v.goals.away, home: v.goals.home })) };
  rightRail.shotsByPeriod = [...byPeriod].map(([n, v]) => ({ periodDescriptor: periodDesc(n), away: v.shots.away, home: v.shots.home }));
  const fo = (s) => (team[s].fow + team[s].fol ? team[s].fow / (team[s].fow + team[s].fol) : 0);
  rightRail.teamGameStats = [
    { category: 'sog', awayValue: team.away.sog, homeValue: team.home.sog },
    { category: 'faceoffWinningPctg', awayValue: fo('away'), homeValue: fo('home') },
    { category: 'powerPlay', awayValue: `${team.away.ppGoals}/${team.away.ppOpp}`, homeValue: `${team.home.ppGoals}/${team.home.ppOpp}` },
    { category: 'pim', awayValue: team.away.pim, homeValue: team.home.pim },
    { category: 'hits', awayValue: team.away.hits, homeValue: team.home.hits },
    { category: 'blockedShots', awayValue: team.away.blocked, homeValue: team.home.blocked },
    { category: 'giveaways', awayValue: team.away.give, homeValue: team.home.give },
    { category: 'takeaways', awayValue: team.away.take, homeValue: team.home.take },
  ];
  delete rightRail.gameVideo;

  return { box, landing, rightRail, pbp: { ...raw.pbp, plays }, shifts: null };
}

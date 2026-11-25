// Weighted game momentum from play-by-play. Pure functions, no fetching.
//
// Every play gives one team a push. A push fades over time (half-life about a minute), so the
// momentum at any moment is the sum of recent pushes for each team. The chart shows home minus away.
//
// Weights (one shot on goal = 1.0):
//   goal 3.0 (the first goal of the game 1.5x; a goal that ties the game or takes the lead 1.25x), shot on goal 1.0, missed shot 0.35, blocked attempt 0.2 (and 0.2 to the blocking team)
//   attempts from the home plate area (posts to faceoff dots to top of circles) count 1.5x
//   faceoff win 0.3 defensive zone (breaks up possession) / 0.2 offensive (SAT starts) / 0.1 neutral
//   takeaway 0.15, giveaway 0.15 to the other team (low: scorers count them differently from rink to rink), hit 0.1
//   penalty drawn 1.0, plus 0.1 every 10 seconds of power play (extended possession)
//   penalty killed off 2.5 to the shorthanded team; a shorthanded goal counts 1.5x (4.5)
//
// Taking a penalty hurts the player who took it: they lose the 1.0 the other team gained, every
// power-play push the penalty led to, and a further 1.5 if the power play scored. Drawing one
// works the other way: the player who drew it gets the 1.0, every power-play push, and 0.75 more
// if the power play scored.
//
// Each push is credited to the player who made it (goal: scorer 60%, assists 25% / 15%).
// A push made while that player's team was behind on momentum counts 1.5x and is a "swing play".
//
// Severe penalties: a major (5 min) or match penalty counts 2.5x a minor; a game misconduct costs the
// player 2.0 and the team 0.5 more; a misconduct costs the player 0.15 plus 8% of the momentum they had
// built up (capped at 1.2) and costs the team no skater. Fighting majors are a spark, not a penalty.
import { penaltyKind } from './penalties.js';

/**
 * "Home plate": the most dangerous scoring area. From 8 ft either side of centre at the goal line the
 * edges run out to PLATE_HALF_WIDTH feet from centre at PLATE_SHOULDER feet from centre ice, then straight
 * out to the top of the faceoff circles (54 ft). Works on either end (rink feet, centre ice = 0).
 * Nov 2026: 8 ft each side at the goal line (was 4, the posts): the strip 4-8 ft out scores 16% of shots on goal, as dangerous as the outer plate.
 * Nov 2026 (v6): narrowed from 22 ft (the faceoff dots) to 19 ft each side, which tested slightly better.
 */
export const HOME_PLATE_BONUS = 1.5;
export const PLATE_HALF_WIDTH = 19;
export const PLATE_GOAL_LINE_WIDTH = 8; // plate half-width at the goal line (Nov 2026: was 4, the posts)
export const PLATE_SHOULDER = 69; // where the angled edges meet the straight sides
export const PLATE_INNER_X = 79; // inner plate: within 10 ft of the goal line
export function inHomePlate(x, y) {
  if (x == null || y == null) return false;
  const ax = Math.abs(x);
  const ay = Math.abs(y);
  if (ax > 89 || ax < 54) return false;
  if (ax >= PLATE_SHOULDER) return ay <= PLATE_GOAL_LINE_WIDTH + ((89 - ax) * (PLATE_HALF_WIDTH - PLATE_GOAL_LINE_WIDTH)) / (89 - PLATE_SHOULDER);
  return ay <= PLATE_HALF_WIDTH;
}
/** Shot-location area: 'inner' and 'outer' plate, 'wide' (outside the circles' width / the point wings), or 'other'. */
export function plateArea(x, y) {
  if (x == null || y == null) return 'other';
  if (inHomePlate(x, y)) return Math.abs(x) >= PLATE_INNER_X ? 'inner' : 'outer';
  const ax = Math.abs(x);
  const ay = Math.abs(y);
  if (ax >= 25 && ax <= 89 && ay > 22) return 'wide';
  if (ax >= 25 && ax < 54 && ay > 15) return 'wide';
  return 'other';
}
// Shot multipliers by area relative to the plate bonus (3x in the momentum model): the inner plate is
// 2/3 of it, the outer plate 7/6, wide shots 0.5x. Tested on 5 seasons: see the Model versions card.
const AREA_MULT = { inner: 2 / 3, outer: 7 / 6 };
export const plateMult = (d, bonus = HOME_PLATE_BONUS) => {
  const area = plateArea(d.xCoord, d.yCoord);
  if (area === 'wide') return 0.5;
  return AREA_MULT[area] ? bonus * AREA_MULT[area] : 1;
};

// Model v4 (Nov 2026): faceoffs, hits, takeaways and giveaways no longer count (tested over 6 seasons, they
// either added nothing or went with the losing team), and home-plate shots count 3x instead of 1.5x.
// Model v6 (Nov 2026): narrower plate (19 ft), inner plate (within 10 ft of the goal) 2x and outer 3.5x, shots
// wide of the circles 0.5x.
// See scripts/model-lab.js and the "Model versions" card on the stats page.
export const MOMENTUM_WEIGHTS = {
  goal: 3, sog: 1, miss: 0.35, blockedShooter: 0.2, blocker: 0.2, firstGoalMult: 1.5, tieOrLeadMult: 1.25, plate: 3,
  faceoff: { O: 0, N: 0, D: 0 }, takeaway: 0, giveaway: 0, hit: 0,
  shorthandedGoalMult: 1.5, penaltyDrawn: 1, powerPlayTick: 0.1, penaltyKilled: 2.5, powerPlayGoalAgainst: 1.5, powerPlayGoalDrawn: 0.75,
  fighterCredit: 0.5, fightSpark: 1,
  majorMult: 2.5, gameMisconduct: 2, gameMisconductTeam: 0.5, misconductBase: 0.15, misconductPerPoint: 0.08, misconductMax: 1.2,
};
const HALF_LIFE = 75; // seconds
const DECAY = Math.LN2 / HALF_LIFE;
const SWING_BONUS = 1.5;
const STEP = 10; // chart resolution in seconds

const toSeconds = (mmss) => {
  const [m, s] = String(mmss ?? '0:00').split(':').map(Number);
  return (m || 0) * 60 + (s || 0);
};
const round = (n, d = 2) => Math.round(n * 10 ** d) / 10 ** d;

/** Seconds since puck drop. Regular-season OT is a 5-minute period but still starts at 60:00. */
export const elapsedOf = (play) => (play.periodDescriptor.number - 1) * 1200 + toSeconds(play.timeInPeriod);

/** Skaters on ice from situationCode "1551" = away goalie, away skaters, home skaters, home goalie. */
function strength(code) {
  const s = String(code ?? '');
  if (s.length !== 4) return null;
  return { awayGoalie: +s[0], away: +s[1], home: +s[2], homeGoalie: +s[3] };
}

/** Power plays: stretches where both goalies are in and one team has more skaters. */
export function powerPlays(plays, awayId) {
  const out = [];
  let open = null;
  for (const p of plays) {
    if (p.periodDescriptor?.periodType === 'SO') break;
    const st = strength(p.situationCode);
    if (!st) continue;
    const t = elapsedOf(p);
    const uneven = st.awayGoalie && st.homeGoalie && st.away !== st.home;
    const side = uneven ? (st.away > st.home ? 'away' : 'home') : null;
    if (open && side !== open.team) {
      open.end = t;
      out.push(open);
      open = null;
    }
    if (side && !open) open = { team: side, start: t, end: null, result: 'killed' };
    if (open && p.typeDescKey === 'goal') {
      const scorer = p.details?.eventOwnerTeamId === awayId ? 'away' : 'home';
      if (scorer === open.team) open.result = 'goal';
      else open.result = 'shorthanded-goal';
    }
  }
  if (open) { open.end = null; open.result = 'ongoing'; out.push(open); }
  // Very short "power plays" are line-change noise in the situation codes.
  return out.filter((pp) => pp.end == null || pp.end - pp.start >= 15);
}

/**
 * Pushes from play-by-play: [{ t, team: 'away'|'home', w, kind, credits: [{ id, share }], debit }]
 * debit = player whose mistake handed the other team the push (giveaway, penalty taken).
 */
export function pushes(plays, awayId, rosterTeam, W = MOMENTUM_WEIGHTS) {
  const plate = (d) => plateMult(d, W.plate ?? HOME_PLATE_BONUS);
  const out = [];
  const fightSeen = new Set();
  const tally = { away: 0, home: 0 }; // running score: the first goal, and any goal that ties the game or takes the lead, counts more
  const sideOf = (teamId) => (teamId === awayId ? 'away' : 'home');
  const other = (s) => (s === 'away' ? 'home' : 'away');
  for (const p of plays) {
    if (p.periodDescriptor?.periodType === 'SO') continue;
    const d = p.details ?? {};
    const t = elapsedOf(p);
    const owner = d.eventOwnerTeamId != null ? sideOf(d.eventOwnerTeamId) : null;
    const add = (team, w, kind, credits = [], debit = null) => out.push({ t, team, w, kind, credits, debit, period: p.periodDescriptor.number, time: p.timeInPeriod });
    // Shots keep where they came from, so model experiments (scripts/model-lab.js) can weigh them differently.
    const shot = (team, w, kind, credits) => out.push({ t, team, w, kind, credits, debit: null, period: p.periodDescriptor.number, time: p.timeInPeriod, x: d.xCoord, y: d.yCoord, shotType: d.shotType, sit: p.situationCode });
    switch (p.typeDescKey) {
      case 'goal': {
        const credits = [{ id: d.scoringPlayerId, share: d.assist1PlayerId ? 0.6 : 1 }];
        if (d.assist1PlayerId) credits.push({ id: d.assist1PlayerId, share: d.assist2PlayerId ? 0.25 : 0.4 });
        if (d.assist2PlayerId) credits.push({ id: d.assist2PlayerId, share: 0.15 });
        // A shorthanded goal swings a game harder than a power-play goal: 1.5x.
        const st = strength(p.situationCode);
        const sh = st && st.awayGoalie && st.homeGoalie && (owner === 'away' ? st.away < st.home : st.home < st.away);
        const first = tally.away + tally.home === 0;
        const before = tally[owner] - tally[other(owner)];
        tally[owner]++;
        const after = tally[owner] - tally[other(owner)];
        const key = first ? W.firstGoalMult : after === 0 || (after > 0 && before <= 0) ? W.tieOrLeadMult : 1; // ties it, or moves into the lead
        shot(owner, W.goal * (sh ? W.shorthandedGoalMult : 1) * key, 'goal', credits);
        break;
      }
      case 'shot-on-goal': shot(owner, W.sog * plate(d), 'sog', [{ id: d.shootingPlayerId, share: 1 }]); break;
      case 'missed-shot': shot(owner, W.miss * plate(d), 'miss', [{ id: d.shootingPlayerId, share: 1 }]); break;
      case 'blocked-shot': {
        const shooterTeam = rosterTeam.get(d.shootingPlayerId);
        const shooter = shooterTeam != null ? sideOf(shooterTeam) : owner ? other(owner) : null;
        if (!shooter) break;
        shot(shooter, W.blockedShooter * plate(d), 'block-attempt', [{ id: d.shootingPlayerId, share: 1 }]);
        if (d.blockingPlayerId && rosterTeam.get(d.blockingPlayerId) !== rosterTeam.get(d.shootingPlayerId)) {
          add(other(shooter), W.blocker, 'block', [{ id: d.blockingPlayerId, share: 1 }]);
        }
        break;
      }
      case 'faceoff': if (owner) add(owner, W.faceoff[d.zoneCode] ?? W.faceoff.N, 'faceoff', [{ id: d.winningPlayerId, share: 1 }], d.losingPlayerId); break;
      case 'takeaway': if (owner) add(owner, W.takeaway, 'takeaway', [{ id: d.playerId, share: 1 }]); break;
      case 'giveaway': if (owner) add(other(owner), W.giveaway, 'giveaway', [], d.playerId); break;
      case 'hit': if (owner) add(owner, W.hit, 'hit', [{ id: d.hittingPlayerId, share: 1 }]); break;
      case 'penalty': {
        if (!owner) break; // owner = the penalized team
        // Fighting majors come in matched pairs (one per team, same moment). A fight is not a mistake that
        // costs the team: no debit, a small credit to each fighter, and a spark for whichever team was behind
        // on momentum when it happened (resolved while the line is walked, see computeMomentum).
        if (d.descKey === 'fighting') {
          if (d.committedByPlayerId) out.push({ t, team: owner, w: 0, creditW: W.fighterCredit, kind: 'fight', credits: [{ id: d.committedByPlayerId, share: 1 }], debit: null, period: p.periodDescriptor.number, time: p.timeInPeriod });
          const key = `${p.periodDescriptor?.number}:${p.timeInPeriod}`;
          if (!fightSeen.has(key)) { fightSeen.add(key); add(null, W.fightSpark, 'fight-spark'); }
          break;
        }
        const kind = penaltyKind(d);
        const who = d.committedByPlayerId ?? null;
        const drawn = d.drawnByPlayerId ? [{ id: d.drawnByPlayerId, share: 1 }] : [];
        // A misconduct costs the player but not the team a skater. How much depends on how much the player
        // had been driving the game so far (worked out while the line is walked).
        if (kind === 'misconduct') { out.push({ t, team: other(owner), w: 0, kind: 'misconduct', credits: [], debit: who, period: p.periodDescriptor.number, time: p.timeInPeriod }); break; }
        if (kind === 'game-misconduct') {
          out.push({ t, team: other(owner), w: W.gameMisconductTeam, debitW: W.gameMisconduct, kind: 'game-misconduct', credits: [], debit: who, period: p.periodDescriptor.number, time: p.timeInPeriod });
          break;
        }
        // Majors (and match penalties) are an extremely costly play: they weigh far more than a minor.
        const mult = kind === 'major' || kind === 'match' ? W.majorMult : 1;
        add(other(owner), W.penaltyDrawn * mult, 'penalty', drawn, who);
        if (kind === 'match') out.push({ t, team: other(owner), w: W.gameMisconductTeam, debitW: W.gameMisconduct, kind: 'game-misconduct', credits: [], debit: who, period: p.periodDescriptor.number, time: p.timeInPeriod });
        break;
      }
      default:
    }
  }
  const penalties = out.filter((e) => e.kind === 'penalty');
  for (const pp of powerPlays(plays, awayId)) {
    const end = pp.end ?? pp.start;
    // The penalties that started this power play (same moment, taken by the shorthanded team).
    // Players who went off together share the cost; players who drew them share the credit.
    const started = penalties.filter((e) => e.team === pp.team && Math.abs(e.t - pp.start) <= 2);
    const offenders = [...new Set(started.map((e) => e.debit).filter(Boolean))];
    const drawers = [...new Set(started.flatMap((e) => e.credits.map((c) => c.id)).filter(Boolean))];
    const credits = drawers.map((id) => ({ id, share: 1 / drawers.length }));
    const split = (t, w, debitW, creditW, kind) => {
      if (!offenders.length) return out.push({ t, team: pp.team, w, creditW, kind, credits, debit: null });
      const n = offenders.length;
      for (const id of offenders) out.push({ t, team: pp.team, w: w / n, debitW: debitW / n, creditW: creditW / n, kind, credits, debit: id });
    };
    for (let t = pp.start + 10; t < end; t += 10) split(t, W.powerPlayTick, W.powerPlayTick, W.powerPlayTick, 'power-play');
    if (pp.result === 'goal' && (offenders.length || drawers.length)) split(end, 0, W.powerPlayGoalAgainst, W.powerPlayGoalDrawn, 'pp-goal-against');
    if (pp.result === 'killed') out.push({ t: end, team: pp.team === 'away' ? 'home' : 'away', w: W.penaltyKilled, kind: 'penalty-kill', credits: [], debit: null });
  }
  return out.sort((a, b) => a.t - b.t);
}

/** Full momentum picture for one game. */
export function computeMomentum(pbp, awayId, gameEnd = null, W = MOMENTUM_WEIGHTS) {
  const plays = [...(pbp?.plays ?? [])].sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0));
  const rosterTeam = new Map((pbp?.rosterSpots ?? []).map((r) => [r.playerId, r.teamId]));
  const list = pushes(plays, awayId, rosterTeam, W);
  const regular = plays.filter((p) => p.periodDescriptor?.periodType !== 'SO');
  const last = regular.length ? elapsedOf(regular.at(-1)) : 0;
  const end = gameEnd ?? last;

  // Walk time in steps; carry each team's decayed total.
  const level = { away: 0, home: 0 };
  let tPrev = 0;
  const decayTo = (t) => {
    const f = Math.exp(-DECAY * (t - tPrev));
    level.away *= f;
    level.home *= f;
    tPrev = t;
  };
  const series = [];
  const players = new Map();
  const credit = (id, v, swing, kind) => {
    if (!id || !v) return;
    const p = players.get(id) ?? { impact: 0, pos: 0, neg: 0, swingPlays: 0, plays: 0, kinds: {} };
    p.impact += v;
    if (v > 0) p.pos += v; else p.neg += v;
    // Group by what the player did: giveaways and penalties taken show as their own negatives.
    const k = v < 0 && kind === 'faceoff' ? 'faceoff-loss' : v < 0 && ['penalty', 'power-play', 'pp-goal-against'].includes(kind) ? 'penalty-taken'
      : v > 0 && ['penalty', 'power-play', 'pp-goal-against'].includes(kind) ? 'penalty-drawn' : kind;
    p.kinds[k] = (p.kinds[k] ?? 0) + v;
    p.plays += 1;
    if (swing && v > 0) p.swingPlays += 1;
    players.set(id, p);
  };
  const totals = { away: 0, home: 0 };
  // The same without goals (and the extra a power-play goal adds), so the season page can test
  // whether momentum predicts results without counting the result itself.
  const noGoals = { away: 0, home: 0 };
  let i = 0;
  for (let t = 0; t <= end + STEP; t += STEP) {
    while (i < list.length && list[i].t <= t) {
      const e = list[i++];
      decayTo(e.t);
      if (e.kind === 'misconduct') e.debitW = Math.min(W.misconductMax, W.misconductBase + W.misconductPerPoint * (players.get(e.debit)?.pos ?? 0));
      if (e.kind === 'fight-spark') {
        // The team that was behind gets the lift; when it's even there is nobody to wake up.
        e.team = level.away < level.home - 0.5 ? 'away' : level.home < level.away - 0.5 ? 'home' : null;
        if (!e.team) continue;
      }
      const behind = level[e.team] < level[e.team === 'away' ? 'home' : 'away'];
      const mult = behind ? SWING_BONUS : 1;
      for (const c of e.credits) credit(c.id, (e.creditW ?? e.w) * c.share * mult, behind && e.w >= 0.5, e.kind);
      if (e.debit) credit(e.debit, -(e.debitW ?? e.w), false, e.kind);
      level[e.team] += e.w;
      totals[e.team] += e.w;
      // A goal still counts as the shot on goal it was (like SAT counts it as an attempt).
      if (e.kind === 'goal') noGoals[e.team] += W.sog * plateMult({ xCoord: e.x, yCoord: e.y }, W.plate ?? HOME_PLATE_BONUS);
      else if (e.kind !== 'pp-goal-against') noGoals[e.team] += e.w;
    }
    decayTo(t);
    if (t <= end) series.push([t, round(level.home - level.away)]);
  }

  // Swings: the line changes sides and stays there.
  const runs = [];
  let prev = 0;
  for (const [t, v] of series) {
    const sign = Math.abs(v) < 0.5 ? prev : Math.sign(v);
    prev = sign;
    if (!sign) continue;
    const r = runs.at(-1);
    if (r && r.sign === sign) { r.end = t; r.peak = Math.max(r.peak, Math.abs(v)); } else runs.push({ sign, start: t, end: t, peak: Math.abs(v) });
  }
  // Only real swings: held at least 90 seconds and reaching a quarter of the game's biggest push.
  const biggest = Math.max(1, ...series.map(([, v]) => Math.abs(v)));
  const kept = [];
  for (const r of runs.filter((x) => x.end - x.start >= 90 && x.peak >= 0.25 * biggest)) {
    if (kept.at(-1)?.sign === r.sign) kept.at(-1).end = r.end;
    else kept.push({ ...r });
  }
  const swings = kept.map((r) => {
    const team = r.sign > 0 ? 'home' : 'away';
    // What caused it: the biggest push for that team in the 45 seconds before.
    const cause = list.filter((e) => e.team === team && e.t <= r.start + 10 && e.t > r.start - 60).sort((x, y) => y.w - x.w)[0];
    // What each side did during the run, so the story can say what kept the momentum going.
    const blank = () => ({ att: 0, sog: 0, goals: 0, faceoffs: 0, hits: 0, turnovers: 0, penalties: 0, ppSec: 0 });
    const mix = { away: blank(), home: blank() };
    for (const e of list) {
      if (e.t < r.start || e.t > r.end || !mix[e.team]) continue;
      const m = mix[e.team];
      if (e.kind === 'sog') { m.att++; m.sog++; } else if (e.kind === 'miss' || e.kind === 'block-attempt') m.att++;
      else if (e.kind === 'goal') { m.att++; m.sog++; m.goals++; }
      else if (e.kind === 'faceoff') m.faceoffs++;
      else if (e.kind === 'hit') m.hits++;
      else if (e.kind === 'takeaway' || e.kind === 'giveaway') m.turnovers++;
      else if (e.kind === 'penalty') m.penalties++;
      else if (e.kind === 'power-play') m.ppSec += 10;
    }
    return { t: r.start, until: r.end, team, mix, cause: cause ? { kind: cause.kind, t: cause.t, playerId: cause.credits[0]?.id ?? cause.debit ?? null } : null };
  });

  // Per period: share of momentum generated (sum of every push each team made) and how long each
  // team was in control (the line on its side, past a small dead zone).
  const nPeriods = Math.max(1, Math.ceil(Math.max(end, 1) / 1200));
  const periods = Array.from({ length: nPeriods }, () => ({ away: 0, home: 0, ctrlAway: 0, ctrlHome: 0, ctrlEven: 0 }));
  const idx = (t) => Math.max(0, Math.min(periods.length - 1, Math.floor(Math.min(t, end - 1) / 1200)));
  for (const e of list) if (e.w > 0) periods[idx(e.t)][e.team] += e.w;
  for (const [t, v] of series) {
    const p = periods[idx(t)];
    if (v > 0.5) p.ctrlHome += STEP; else if (v < -0.5) p.ctrlAway += STEP; else p.ctrlEven += STEP;
  }

  return {
    series,
    max: round(Math.max(1, ...series.map(([, v]) => Math.abs(v)))),
    swings,
    powerPlays: powerPlays(plays, awayId),
    totals: { away: round(totals.away, 1), home: round(totals.home, 1) },
    totalsNoGoals: { away: round(noGoals.away, 1), home: round(noGoals.home, 1) },
    periods: periods.map((p) => {
      const sum = p.away + p.home || 1;
      const away = Math.round((100 * p.away) / sum);
      return { away, home: 100 - away, control: { away: p.ctrlAway, home: p.ctrlHome, even: p.ctrlEven } };
    }),
    players: Object.fromEntries([...players].map(([id, p]) => [id, {
      impact: round(p.impact, 1), pos: round(p.pos, 1), neg: round(p.neg, 1), swingPlays: p.swingPlays,
      kinds: Object.fromEntries(Object.entries(p.kinds).map(([k, v]) => [k, round(v, 1)]).filter(([, v]) => v)),
    }])),
  };
}

// On-ice shot attempts, weighted by result (a shot on goal is worth more than a miss or a block).
export const ON_ICE_WEIGHTS = { goal: 1, sog: 1, miss: 0.5, block: 0.35 };
const ATTEMPT_KIND = { goal: 'goal', 'shot-on-goal': 'sog', 'missed-shot': 'miss', 'blocked-shot': 'block' };

/**
 * For every skater with shift data: weighted shot attempts for and against while on the ice,
 * and goals for and against. Returns null when there are no shifts (e.g. the stats API was down).
 */
export function onIceAttempts(pbp, shiftsRaw, goalieIds = new Set()) {
  const shifts = (shiftsRaw?.data ?? []).filter((s) => (s.typeCode == null || s.typeCode === 517) && !s.eventDescription && s.startTime && s.endTime);
  if (!shifts.length) return null;
  const byPeriod = new Map();
  for (const s of shifts) {
    if (goalieIds.has(s.playerId)) continue;
    const list = byPeriod.get(s.period) ?? [];
    list.push({ id: s.playerId, team: s.teamId, start: toSeconds(s.startTime), end: toSeconds(s.endTime) });
    byPeriod.set(s.period, list);
  }
  const rosterTeam = new Map((pbp?.rosterSpots ?? []).map((r) => [r.playerId, r.teamId]));
  const out = new Map();
  const get = (id) => {
    if (!out.has(id)) out.set(id, { cf: 0, ca: 0, gf: 0, ga: 0 });
    return out.get(id);
  };
  for (const p of pbp?.plays ?? []) {
    const kind = ATTEMPT_KIND[p.typeDescKey];
    if (!kind || p.periodDescriptor?.periodType === 'SO') continue;
    const d = p.details ?? {};
    const shooter = d.shootingPlayerId ?? d.scoringPlayerId;
    const team = rosterTeam.get(shooter) ?? d.eventOwnerTeamId;
    const t = toSeconds(p.timeInPeriod);
    // Goals already count in full; other attempts from home plate count 1.5x.
    const w = ON_ICE_WEIGHTS[kind] * (kind === 'goal' ? 1 : plateMult(p.details ?? {}));
    for (const s of byPeriod.get(p.periodDescriptor.number) ?? []) {
      if (!(s.start < t && t <= s.end) && !(t === 0 && s.start === 0)) continue;
      const row = get(s.id);
      if (s.team === team) { row.cf += w; if (kind === 'goal') row.gf++; } else { row.ca += w; if (kind === 'goal') row.ga++; }
    }
  }
  for (const r of out.values()) {
    r.cf = round(r.cf, 2);
    r.ca = round(r.ca, 2);
    r.pct = r.cf + r.ca ? round((100 * r.cf) / (r.cf + r.ca), 1) : null;
  }
  return out;
}

// Weighted game momentum from play-by-play. Pure functions, no fetching.
//
// Every play gives one team a push. A push fades over time (half-life about a minute), so the
// momentum at any moment is the sum of recent pushes for each team. The chart shows home minus away.
//
// Weights (one shot on goal = 1.0):
//   goal 3.0, shot on goal 1.0, missed shot 0.35, blocked attempt 0.2 (and 0.1 to the blocking team)
//   faceoff win 0.6 offensive zone / 0.35 neutral / 0.25 defensive (you start with the puck)
//   takeaway 0.5, giveaway 0.5 to the other team, hit 0.2
//   penalty drawn 1.0, plus 0.2 every 10 seconds of power play (extended possession)
//   penalty killed off 1.5 to the shorthanded team
//
// Each push is credited to the player who made it (goal: scorer 60%, assists 25% / 15%).
// A push made while that player's team was behind on momentum counts 1.5x and is a "swing play".

export const MOMENTUM_WEIGHTS = {
  goal: 3, sog: 1, miss: 0.35, blockedShooter: 0.2, blocker: 0.1,
  faceoff: { O: 0.6, N: 0.35, D: 0.25 }, takeaway: 0.5, giveaway: 0.5, hit: 0.2,
  penaltyDrawn: 1, powerPlayTick: 0.2, penaltyKilled: 1.5,
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
export function pushes(plays, awayId, rosterTeam) {
  const W = MOMENTUM_WEIGHTS;
  const out = [];
  const sideOf = (teamId) => (teamId === awayId ? 'away' : 'home');
  const other = (s) => (s === 'away' ? 'home' : 'away');
  for (const p of plays) {
    if (p.periodDescriptor?.periodType === 'SO') continue;
    const d = p.details ?? {};
    const t = elapsedOf(p);
    const owner = d.eventOwnerTeamId != null ? sideOf(d.eventOwnerTeamId) : null;
    const add = (team, w, kind, credits = [], debit = null) => out.push({ t, team, w, kind, credits, debit, period: p.periodDescriptor.number, time: p.timeInPeriod });
    switch (p.typeDescKey) {
      case 'goal': {
        const credits = [{ id: d.scoringPlayerId, share: d.assist1PlayerId ? 0.6 : 1 }];
        if (d.assist1PlayerId) credits.push({ id: d.assist1PlayerId, share: d.assist2PlayerId ? 0.25 : 0.4 });
        if (d.assist2PlayerId) credits.push({ id: d.assist2PlayerId, share: 0.15 });
        add(owner, W.goal, 'goal', credits);
        break;
      }
      case 'shot-on-goal': add(owner, W.sog, 'sog', [{ id: d.shootingPlayerId, share: 1 }]); break;
      case 'missed-shot': add(owner, W.miss, 'miss', [{ id: d.shootingPlayerId, share: 1 }]); break;
      case 'blocked-shot': {
        const shooterTeam = rosterTeam.get(d.shootingPlayerId);
        const shooter = shooterTeam != null ? sideOf(shooterTeam) : owner ? other(owner) : null;
        if (!shooter) break;
        add(shooter, W.blockedShooter, 'block-attempt', [{ id: d.shootingPlayerId, share: 1 }]);
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
        add(other(owner), W.penaltyDrawn, 'penalty', d.drawnByPlayerId ? [{ id: d.drawnByPlayerId, share: 1 }] : [], d.committedByPlayerId ?? null);
        break;
      }
      default:
    }
  }
  for (const pp of powerPlays(plays, awayId)) {
    const end = pp.end ?? pp.start;
    for (let t = pp.start + 10; t < end; t += 10) out.push({ t, team: pp.team, w: W.powerPlayTick, kind: 'power-play', credits: [], debit: null });
    if (pp.result === 'killed') out.push({ t: end, team: pp.team === 'away' ? 'home' : 'away', w: W.penaltyKilled, kind: 'penalty-kill', credits: [], debit: null });
  }
  return out.sort((a, b) => a.t - b.t);
}

/** Full momentum picture for one game. */
export function computeMomentum(pbp, awayId, gameEnd = null) {
  const plays = [...(pbp?.plays ?? [])].sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0));
  const rosterTeam = new Map((pbp?.rosterSpots ?? []).map((r) => [r.playerId, r.teamId]));
  const list = pushes(plays, awayId, rosterTeam);
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
  const credit = (id, v, swing) => {
    if (!id) return;
    const p = players.get(id) ?? { impact: 0, swingPlays: 0, plays: 0 };
    p.impact += v;
    p.plays += 1;
    if (swing && v > 0) p.swingPlays += 1;
    players.set(id, p);
  };
  const totals = { away: 0, home: 0 };
  let i = 0;
  for (let t = 0; t <= end + STEP; t += STEP) {
    while (i < list.length && list[i].t <= t) {
      const e = list[i++];
      decayTo(e.t);
      const behind = level[e.team] < level[e.team === 'away' ? 'home' : 'away'];
      const mult = behind ? SWING_BONUS : 1;
      for (const c of e.credits) credit(c.id, e.w * c.share * mult, behind && e.w >= 0.5);
      if (e.debit) credit(e.debit, -e.w, false);
      level[e.team] += e.w;
      totals[e.team] += e.w;
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
    return { t: r.start, until: r.end, team, cause: cause ? { kind: cause.kind, t: cause.t, playerId: cause.credits[0]?.id ?? cause.debit ?? null } : null };
  });

  // Share of momentum (area above/below zero) per period.
  const periods = [];
  for (const [t, v] of series) {
    const n = Math.floor(Math.min(t, end - 1) / 1200);
    periods[n] ??= { away: 0, home: 0 };
    if (v > 0) periods[n].home += v; else periods[n].away -= v;
  }

  return {
    series,
    max: round(Math.max(1, ...series.map(([, v]) => Math.abs(v)))),
    swings,
    powerPlays: powerPlays(plays, awayId),
    totals: { away: round(totals.away, 1), home: round(totals.home, 1) },
    periods: periods.map((p) => {
      const sum = (p?.away ?? 0) + (p?.home ?? 0) || 1;
      return { away: Math.round((100 * (p?.away ?? 0)) / sum), home: Math.round((100 * (p?.home ?? 0)) / sum) };
    }),
    players: Object.fromEntries([...players].map(([id, p]) => [id, { impact: round(p.impact, 1), swingPlays: p.swingPlays }])),
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
    const w = ON_ICE_WEIGHTS[kind];
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

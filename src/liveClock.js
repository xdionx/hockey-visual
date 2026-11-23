// Live game clock, game time and syncing a data delay to the clock on a video. Pure logic (no DOM, no storage)
// so it can be tested; public/clock.js and public/delay.js wire it to the pages.
//
// A live game's status carries the feed's clock: status.clock = { n: period number, p: "2nd", s: seconds left,
// run: clock running, int: in intermission (s then counts the intermission down, about 18:00) }.

const PERIOD_S = 1200;
/** Regulation periods are 20:00; regular-season overtime is 5:00, playoff overtime 20:00. */
const periodLen = (n, gameType) => (n > 3 && gameType !== 3 ? 300 : PERIOD_S);

/** Period number from a goal's period label: "2", "OT", "2OT", "1st OT", "SO" (shootout: null). */
export function periodNumber(label) {
  const s = String(label ?? '').trim();
  if (/^\d+$/.test(s)) return Number(s);
  if (s === 'OT') return 4;
  let m = s.match(/^(\d+)OT$/);
  if (m) return 3 + Number(m[1]);
  m = s.match(/^(\d+)(?:st|nd|rd|th) OT$/);
  if (m) return 3 + Number(m[1]);
  return null;
}

/** "12:34" -> 754 */
export function mmss(t) {
  const m = String(t ?? '').trim().match(/^(\d{1,2}):(\d{2})$/);
  return m ? Number(m[1]) * 60 + Number(m[2]) : null;
}
/** 754 -> "12:34" */
export const clockStr = (s) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;

/** Game seconds played before period n starts. */
function before(n, gameType) {
  let t = 0;
  for (let i = 1; i < n; i++) t += periodLen(i, gameType);
  return t;
}
/** Game seconds played at a goal ({ period, time } with time counting up within the period), or null. */
export function goalElapsed(goal, gameType) {
  const n = periodNumber(goal?.period);
  const s = mmss(goal?.time);
  return n == null || s == null ? null : before(n, gameType) + s;
}
/** Game seconds played as of a live clock. In an intermission the period is over. */
export function clockElapsed(clock, gameType) {
  if (!clock?.n) return null;
  const len = periodLen(clock.n, gameType);
  return before(clock.n, gameType) + (clock.int ? len : len - (clock.s ?? 0));
}

/**
 * The clock as it should read elapsedMs after it was first seen: a running clock (or an intermission) counts
 * down a second at a time, never below 0:00, and stops guessing after maxMs (no refresh came, so we don't know).
 */
export function clockNow(clock, elapsedMs, maxMs = 20_000) {
  if (!clock || clock.s == null) return null;
  const ticking = clock.run || clock.int;
  const gone = ticking ? Math.min(Math.max(0, elapsedMs), clock.int ? Math.max(maxMs, 60_000) : maxMs) / 1000 : 0;
  return Math.max(0, Math.ceil(clock.s - gone - 1e-9));
}
/** "2nd 12:34", "2nd Intermission 14:02" */
export function clockLabel(clock, secs) {
  if (clock.int) return `${clock.p} Intermission${secs > 0 ? ` ${clockStr(secs)}` : ''}`;
  return `${clock.p} ${clockStr(secs)}`;
}

/**
 * Hide goals the video can't have shown yet. Used while a delay is still filling (the page just opened, so the
 * oldest data we have is newer than the video): the video is behind by aheadS seconds of real time, and the game
 * clock never runs faster than real time, so any goal in the last aheadS (+ slack) of game time may not have
 * happened on screen yet. Works on a Scores page game: drops those goals and winds the score back.
 * Returns the same object when nothing is hidden.
 */
export function maskRecentGoals(game, aheadS, slackS = 5) {
  const goals = game?.goals;
  const now = clockElapsed(game?.status?.clock, game?.gameType);
  if (!goals?.length || now == null || !(aheadS > 0)) return game;
  const cutoff = now - aheadS - slackS;
  const keep = goals.filter((g) => { const e = goalElapsed(g, game.gameType); return e == null ? g.period !== 'SO' : e <= cutoff; });
  if (keep.length === goals.length) return game;
  const score = keep.at(-1)?.score ?? { away: 0, home: 0 };
  const ls = game.linescore;
  const periods = ls?.periods?.map((p) => ({ ...p, away: 0, home: 0 }));
  for (const g of keep) {
    const p = periods?.find((x) => periodNumber(x.label) === periodNumber(g.period));
    if (p) p[g.team === game.away.abbrev ? 'away' : 'home'] += 1;
  }
  return {
    ...game,
    goals: keep,
    away: { ...game.away, score: score.away },
    home: { ...game.home, score: score.home },
    linescore: ls && { ...ls, periods, totals: { away: score.away, home: score.home } },
    masked: goals.length - keep.length,
  };
}
/** True when a box score has a goal the video may not have shown yet (same rule as maskRecentGoals). */
export function hasRecentGoal(game, aheadS, slackS = 5) {
  const now = clockElapsed(game?.status?.clock, game?.gameType);
  if (now == null || !(aheadS > 0)) return false;
  return (game.scoring ?? game.goals ?? []).some((g) => { const e = goalElapsed(g, game.gameType); return e != null && e > now - aheadS - slackS; });
}

// ── Clock log: when each clock reading first arrived, for setting the delay from the video's clock ──
/** One entry per change of the feed's clock: [t, n, s, run, int]. */
export function logClock(log, clock, t, keepMs = 300_000) {
  if (!clock?.n || clock.s == null) return log;
  const e = [t, clock.n, clock.s, clock.run ? 1 : 0, clock.int ? 1 : 0];
  const last = log[log.length - 1];
  if (last && t < last[0]) return log;
  if (!last || last.slice(1).join() !== e.slice(1).join()) log.push(e);
  while (log.length > 1 && log[1][0] < t - keepMs) log.shift();
  return log;
}

/**
 * The delay (whole seconds) that lines the data up with a video showing period n at secs left, right now.
 * The log says when each clock reading reached us; with the clock running we know when it passed secs.
 * Returns { s } or { error: 'ahead' | 'old' | 'none' }:
 * ahead = the data hasn't reached that time yet (the video is ahead, so no delay is needed),
 * old = that time is older than the history this browser kept, none = no clock data for that period.
 */
export function delayFromClock(log, n, secs, now) {
  const rows = log.filter((e) => e[1] === n && !e[4]);
  if (!rows.length) return { error: log.some((e) => e[1] > n || (e[1] === n && e[4])) ? 'old' : log.length ? 'ahead' : 'none' };
  const found = (at) => (at > now ? { error: 'ahead' } : { s: Math.max(0, Math.round((now - at) / 1000)) });
  for (let i = 0; i < rows.length; i++) {
    const [t, , s, run] = rows[i];
    const next = rows[i + 1];
    const end = next ? next[0] : now;
    if (!run) {
      if (s === secs) return found(t); // the clock sat at that time (a whistle): when it first did
      if (next && s > secs && next[2] < secs) return found(next[0]); // jumped past it between readings
      continue;
    }
    if (s < secs) continue;
    const at = t + (s - secs) * 1000; // running from s at time t: passes secs this much later
    if (at <= end) return found(at);
    if (next && next[2] < secs) return found(next[0]); // the next reading is already past it
  }
  return rows[0][2] < secs ? { error: 'old' } : { error: 'ahead' };
}

/** How far along a game is, for spotting a refresh that went backwards (a stale cache): bigger = later. */
export function progress(game) {
  const st = game?.status?.state;
  if (st === 'final') return 1e9;
  if (st !== 'live') return 0;
  const e = clockElapsed(game.status.clock, game.gameType);
  const goals = (game.away?.score ?? 0) + (game.home?.score ?? 0);
  return e == null ? 1 : 10 + e * 100 + goals;
}

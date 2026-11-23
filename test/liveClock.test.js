import test from 'node:test';
import assert from 'node:assert/strict';
import { periodNumber, goalElapsed, clockElapsed, clockNow, clockLabel, maskRecentGoals, hasRecentGoal, logClock, delayFromClock, progress } from '../src/liveClock.js';
import { timeoutNow } from '../src/gameDetail.js';
import { gameStatus } from '../src/normalize.js';

test('period labels and game time', () => {
  assert.deepEqual(['1', '3', 'OT', '2OT', '1st OT', '3rd OT', 'SO'].map(periodNumber), [1, 3, 4, 5, 4, 6, null]);
  assert.equal(goalElapsed({ period: '2', time: '5:10' }, 2), 1200 + 310);
  assert.equal(clockElapsed({ n: 2, s: 600 }, 2), 1800);
  assert.equal(clockElapsed({ n: 2, s: 300, int: true }, 2), 2400); // the period is over
  assert.equal(clockElapsed({ n: 4, s: 100 }, 2), 3600 + 200); // 5:00 regular-season OT
});

test('the clock counts down while running, holds when stopped, and stops guessing without refreshes', () => {
  const c = { n: 2, p: '2nd', s: 754, run: true, int: false };
  assert.equal(clockNow(c, 0), 754);
  assert.equal(clockNow(c, 3200), 751);
  assert.equal(clockNow(c, 60_000), 734); // capped at 20 s of guessing
  assert.equal(clockNow({ ...c, run: false }, 9000), 754);
  assert.equal(clockNow({ ...c, s: 2 }, 9000), 0);
  assert.equal(clockLabel(c, 751), '2nd 12:31');
  assert.equal(clockLabel({ ...c, run: false, int: true }, 1080), '2nd Intermission 18:00');
  assert.equal(clockNow({ ...c, run: false, int: true, s: 1080 }, 45_000), 1035); // intermissions tick too
});

test('the feed clock rides along in a live status', () => {
  const st = gameStatus({ gameState: 'LIVE', periodDescriptor: { number: 2, periodType: 'REG' }, clock: { timeRemaining: '05:07', secondsRemaining: 307, running: false, inIntermission: true } });
  assert.equal(st.label, '2nd Intermission');
  assert.deepEqual(st.clock, { n: 2, p: '2nd', s: 307, run: false, int: true });
});

test('while a delay fills, goals the video may not have shown are hidden and the score winds back', () => {
  const game = {
    gameType: 2,
    away: { abbrev: 'BUF', score: 2 }, home: { abbrev: 'TBL', score: 1 },
    status: { state: 'live', clock: { n: 2, s: 600, run: true } }, // 30:00 played
    linescore: { periods: [{ label: '1', away: 1, home: 1 }, { label: '2', away: 1, home: 0 }, { label: '3', away: 0, home: 0 }], totals: { away: 2, home: 1 } },
    goals: [
      { period: '1', time: '4:00', team: 'BUF', score: { away: 1, home: 0 } },
      { period: '1', time: '15:00', team: 'TBL', score: { away: 1, home: 1 } },
      { period: '2', time: '9:40', team: 'BUF', score: { away: 2, home: 1 } }, // 20 s of game time ago
    ],
  };
  const m = maskRecentGoals(game, 30);
  assert.equal(m.goals.length, 2);
  assert.equal(m.away.score, 1);
  assert.deepEqual(m.linescore.totals, { away: 1, home: 1 });
  assert.equal(m.linescore.periods[1].away, 0);
  assert.equal(maskRecentGoals(game, 5, 0), game); // that goal is older than 5 s
  assert.equal(hasRecentGoal({ ...game, scoring: game.goals }, 30), true);
  assert.equal(hasRecentGoal({ ...game, scoring: game.goals }, 10, 0), false);
});

test('the delay comes from when the data clock passed the time on the video', () => {
  const t0 = 1_000_000;
  const log = [];
  // Clock running from 12:40 at t0, readings every 5 s, then a whistle at 12:20 for 30 s.
  for (let i = 0; i <= 4; i++) logClock(log, { n: 2, s: 760 - 5 * i, run: true }, t0 + 5000 * i);
  logClock(log, { n: 2, s: 740, run: false }, t0 + 20_000);
  logClock(log, { n: 2, s: 740, run: true }, t0 + 50_000);
  logClock(log, { n: 2, s: 735, run: true }, t0 + 55_000);
  assert.equal(log.length, 8);
  const now = t0 + 60_000;
  assert.deepEqual(delayFromClock(log, 2, 754, now), { s: 54 }); // 12:34 passed 6 s after t0
  assert.deepEqual(delayFromClock(log, 2, 740, now), { s: 40 }); // the whistle: when the clock first sat there
  assert.deepEqual(delayFromClock(log, 2, 700, now), { error: 'ahead' }); // data hasn't got there
  assert.deepEqual(delayFromClock(log, 2, 900, now), { error: 'old' });
  assert.deepEqual(delayFromClock(log, 1, 30, now), { error: 'old' });
  assert.deepEqual(delayFromClock(log, 3, 1100, now), { error: 'ahead' });
  assert.deepEqual(delayFromClock([], 2, 700, now), { error: 'none' });
});

test('progress spots a refresh that went backwards', () => {
  const g = (s, a = 0) => ({ gameType: 2, status: { state: 'live', clock: { n: 2, s, run: true } }, away: { score: a }, home: { score: 0 } });
  assert.ok(progress(g(600)) > progress(g(610)));
  assert.ok(progress(g(600, 1)) > progress(g(600)));
  assert.ok(progress({ status: { state: 'final' } }) > progress(g(0)));
});

test('a timeout shows until play restarts', () => {
  const box = { clock: { running: false }, awayTeam: { abbrev: 'BUF' }, homeTeam: { abbrev: 'TBL' } };
  const stop = (reason, secondaryReason) => ({ typeDescKey: 'stoppage', details: { reason, secondaryReason } });
  assert.deepEqual(timeoutNow(stop('visitor-timeout', 'visitor-timeout'), box), { team: 'BUF' });
  assert.deepEqual(timeoutNow(stop('icing', 'home-timeout'), box), { team: 'TBL' });
  assert.deepEqual(timeoutNow(stop('offside', 'tv-timeout'), box), { team: null, tv: true });
  assert.equal(timeoutNow(stop('icing'), box), null);
  assert.equal(timeoutNow(stop('visitor-timeout'), { ...box, clock: { running: true } }), null);
  assert.equal(timeoutNow({ typeDescKey: 'faceoff' }, box), null);
});

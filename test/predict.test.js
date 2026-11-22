import { test } from 'node:test';
import assert from 'node:assert/strict';
import { predictGame, probableStarter } from '../src/predict.js';

// Game rows in GAME_FIELDS order: n, away, home, ag, hg, am, hm, an, hn, as, hs, end, ags, hgs.
const row = (n, away, home, an, hn, ags = 1, hgs = 2) => [n, away, home, 0, 0, an, hn, an, hn, 0, 0, 'REG', ags, hgs];
const season = (rows, players = {}) => ({ g: rows, players });

test('the team with the bigger momentum share is favoured, and home ice counts a little', () => {
  const rows = [];
  for (let n = 1; n <= 10; n++) rows.push(row(n, 'AAA', 'BBB', 60, 40));
  const p = predictGame({ total: season(rows), away: 'AAA', home: 'BBB', n: 11 });
  assert.ok(p.away > 0.6 && Math.abs(p.away + p.home - 1) < 1e-9);
  const even = [];
  for (let n = 1; n <= 10; n++) even.push(row(n, 'AAA', 'BBB', 50, 50));
  assert.ok(predictGame({ total: season(even), away: 'AAA', home: 'BBB', n: 11 }).home > 0.5);
});

test('only games before this one count, and it waits for enough games', () => {
  const rows = [];
  for (let n = 1; n <= 10; n++) rows.push(row(n, 'AAA', 'BBB', 50, 50));
  assert.equal(predictGame({ total: season(rows), away: 'AAA', home: 'BBB', n: 4 }), null);
  const a = predictGame({ total: season(rows), away: 'AAA', home: 'BBB', n: 11 });
  const b = predictGame({ total: season([...rows, row(11, 'AAA', 'BBB', 90, 10)]), away: 'AAA', home: 'BBB', n: 11 });
  assert.equal(a.away, b.away);
});

test('a back-to-back and a weaker probable goalie lower a team\'s chances', () => {
  const rows = [];
  for (let n = 1; n <= 10; n++) rows.push(row(n, 'AAA', 'BBB', 50, 50, 1, 2));
  const players = { 1: { n: 'Hot', p: 'G', ga: 10, xga: 30 }, 2: { n: 'Cold', p: 'G', ga: 30, xga: 22 } };
  const base = predictGame({ total: season(rows), away: 'AAA', home: 'BBB', n: 11 });
  const goalies = predictGame({ total: season(rows, players), away: 'AAA', home: 'BBB', n: 11 });
  assert.ok(goalies.away > base.away);
  assert.equal(goalies.parts.goalie.away.name, 'Hot');
  assert.ok(predictGame({ total: season(rows), away: 'AAA', home: 'BBB', n: 11, b2b: { away: true } }).away < base.away);
});

test('probable starter is whoever started most of the last 5', () => {
  assert.equal(probableStarter([1, 1, 1, 2, 2, 1, 2]), 2); // last 5: 1,2,2,1,2
  assert.equal(probableStarter([3, 4]), 4);
  assert.equal(probableStarter([]), null);
});

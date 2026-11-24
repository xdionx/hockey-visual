import test from 'node:test';
import assert from 'node:assert/strict';
import { compareGoals, teamGoals, FRESH_MS } from '../public/goalSeen.js';

const goal = (team, period, time, id, extra = {}) => ({ team, period, time, scorer: { id }, ...extra });
const LAK1 = goal('LAK', '1', '14:43', 1);
const MTL1 = goal('MTL', '2', '7:28', 2);
const LAK2 = goal('LAK', '2', '9:59', 3);
const game = (goals) => ({ goals });

// Replays one team's polls the way checkGoals does and returns the honks per poll.
function run(abbrev, polls, t0 = 1_000_000) {
  let rec = null;
  return polls.map((goals, i) => {
    const r = compareGoals(rec, teamGoals(game(goals), abbrev), t0 + i * 2000);
    rec = r.record;
    return r.newCount;
  });
}

test('the first sight of a game is a baseline: no honk', () => {
  assert.deepEqual(run('MTL', [[LAK1, MTL1]]), [0]);
});

test('only the team that scored honks', () => {
  const polls = [[LAK1, MTL1], [LAK1, MTL1, LAK2]];
  assert.deepEqual(run('LAK', polls), [0, 1]);
  assert.deepEqual(run('MTL', polls), [0, 0]);
});

test('a stale response with fewer goals cannot make an old goal new again', () => {
  // LAK scores; a stale edge copy without the LAK goal arrives, then the fresh one: MTL must stay quiet.
  const polls = [[LAK1, MTL1], [LAK1, MTL1, LAK2], [LAK1], [LAK1, MTL1, LAK2]];
  assert.deepEqual(run('MTL', polls), [0, 0, 0, 0]);
  assert.deepEqual(run('LAK', polls), [0, 1, 0, 0]);
});

test('both teams scoring between polls honk once each', () => {
  const polls = [[], [LAK1, MTL1]];
  assert.deepEqual(run('LAK', polls), [0, 1]);
  assert.deepEqual(run('MTL', polls), [0, 1]);
});

test('a disallowed goal removed and then a real goal later still honks once', () => {
  const polls = [[LAK1], [LAK1, LAK2], [LAK1], [LAK1, goal('LAK', '3', '1:00', 9)]];
  assert.deepEqual(run('LAK', polls), [0, 1, 0, 1]);
});

test('shootout goals never count', () => {
  assert.deepEqual(teamGoals(game([goal('LAK', 'SO', '0:00', 5), LAK1]), 'LAK'), [LAK1]);
});

test('a record older than ten minutes is a new baseline', () => {
  const r1 = compareGoals(null, [LAK1], 0).record;
  assert.equal(compareGoals(r1, [LAK1, LAK2], FRESH_MS + 1).newCount, 0);
});

test('a record saved by the old count-only code still works', () => {
  assert.equal(compareGoals({ n: 1, t: 0 }, [LAK1, LAK2], 1000).newCount, 1);
});

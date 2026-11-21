import { test } from 'node:test';
import assert from 'node:assert/strict';
import { emptySeason } from '../src/seasonStats.js';
import { seasonModel, pearson } from '../src/momentumModel.js';

test('model checks from game rows', () => {
  const total = emptySeason(20252026);
  // n, away, home, ag, hg, am, hm, an, hn, as, hs, end
  total.g = [
    [1, 'A', 'B', 3, 1, 60, 40, 50, 40, 30, 35, 'REG'],
    [2, 'B', 'A', 2, 3, 50, 55, 45, 40, 40, 30, 'OT'],
    [3, 'A', 'B', 1, 4, 30, 70, 30, null, 25, 20, 'REG'],
  ];
  const m = seasonModel(total);
  assert.equal(m.games, 3);
  assert.equal(m.noGoalGames, 2);
  assert.deepEqual([m.wins.mom.won, m.wins.mom.n], [3, 3]);
  assert.deepEqual([m.wins.ng.won, m.wins.ng.n], [1, 2]);
  assert.deepEqual([m.wins.sat.won, m.wins.sat.n], [0, 3]);
  const a = m.teams.find((t) => t.abbrev === 'A');
  assert.deepEqual([a.w, a.l, a.otl, a.pts], [2, 1, 0, 4]);
  const b = m.teams.find((t) => t.abbrev === 'B');
  assert.deepEqual([b.w, b.l, b.otl, b.pts], [1, 1, 1, 3]);
  assert.equal(a.ngGp, 2);
  assert.equal(m.predictive, null);
});

test('pearson', () => {
  assert.equal(pearson([1, 2, 3], [2, 4, 6]).toFixed(3), '1.000');
  assert.equal(pearson([1, 2], [1, 2]), null);
});

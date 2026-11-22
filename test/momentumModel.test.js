import { test } from 'node:test';
import assert from 'node:assert/strict';
import { emptySeason, addGame } from '../src/seasonStats.js';
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

test('team finishing from game rows, with a player-row fallback for older rows', () => {
  const total = emptySeason(20262027);
  const line = (id, team, xg, xgg) => ({ id, name: `P${id}`, team, pos: 'C', sat: 3, sog: 2, xg, xgg, mom: 1, mp: 1, mn: 0 });
  const row = (n, ag, hg) => [n, 'AAA', 'BBB', ag, hg, 5, 4, 3, 2, 10, 8, 'REG', null, null];
  addGame(total, [line(1, 'AAA', 1.5, 2), line(2, 'AAA', 0.5, 1), line(3, 'BBB', 2, 1)], row(1, 3, 1));
  addGame(total, [line(1, 'AAA', 1, 0), line(3, 'BBB', 1, 2)], row(2, 0, 2));
  assert.deepEqual(total.g[0].slice(14), [2, 2, 3, 1]);
  const m = seasonModel(total);
  assert.equal(m.finSource, 'games');
  const a = m.teams.find((t) => t.abbrev === 'AAA');
  assert.equal(a.finGoals, 3);
  assert.equal(a.finXg, 3);
  assert.equal(a.finPct, 100);
  const b = m.teams.find((t) => t.abbrev === 'BBB');
  assert.equal(b.finPct, 100);
  assert.equal(b.finGax, 0);
  // A row saved without team xG: fall back to summing players by their team.
  total.g[1] = total.g[1].slice(0, 14);
  const old = seasonModel(total);
  assert.equal(old.finSource, 'players');
  assert.equal(old.teams.find((t) => t.abbrev === 'AAA').finPct, 100);
  // Rows already carrying finishing are left as they are.
  assert.equal(addGame(emptySeason(1), [line(1, 'AAA', 9, 9)], total.g[0]).g[0], total.g[0]);
});

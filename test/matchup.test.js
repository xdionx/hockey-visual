import { test } from 'node:test';
import assert from 'node:assert/strict';
import { teamTable, goalieLine, teamSkaters } from '../src/matchup.js';

// Rows follow GAME_FIELDS: n, away, home, ag, hg, am, hm, an, hn, as, hs, end, ags, hgs, axg, hxg, agg, hgg, asog, hsog
const total = {
  g: [
    [1, 'AAA', 'BBB', 3, 1, 30, 20, 28, 18, 60, 40, 'REG', 1, 2, 2, 1, 3, 1, 30, 20],
    [2, 'BBB', 'CCC', 2, 2, 25, 25, 25, 25, 50, 50, 'OT', 2, 3, 1.5, 1.5, 2, 1, 25, 25],
    [3, 'CCC', 'AAA', 0, 4, 10, 40, 10, 38, 30, 70, 'REG', 3, 1, 1, 3, 0, 4, 15, 35],
  ],
  players: {
    1: { n: 'A Goalie', t: 'AAA', p: 'G', gp: 2, gs: 2, ga: 1, xga: 2 },
    2: { n: 'B Goalie', t: 'BBB', p: 'G', gp: 2, gs: 2, ga: 5, xga: 3.5 },
    10: { n: 'Al Skater', t: 'AAA', p: 'C', gp: 2, sat: 10, sog: 6, mom: 20, xg: 1, xgg: 2, tg: 2, ab: 1, bl: 0 },
    11: { n: 'Bo Skater', t: 'AAA', p: 'D', gp: 2, sat: 6, sog: 3, mom: 8, xg: 0.5, xgg: 0, tg: 2, ab: 0, bl: 1 },
  },
};

test('teamTable ranks each team (1 = best, fewer is better for attempts allowed)', () => {
  const t = teamTable(total, 1);
  assert.equal(t.teams, 3);
  assert.equal(t.get('AAA').gp, 2);
  assert.equal(t.get('AAA').momShare.rank, 1);
  assert.equal(t.get('AAA').satAgPg.rank, 1); // allowed 70 in 2 games, fewest
  assert.ok(Math.abs(t.get('AAA').finish.v - ((3 + 4) - (2 + 3)) / 2) < 1e-9);
  // Only games before number n count.
  assert.equal(teamTable(total, 1, 2).get('AAA').gp, 1);
});

test('goalieLine and teamSkaters', () => {
  const g = goalieLine(total, 1, 1, 1);
  assert.deepEqual([g.gsax, g.rank, g.of], [1, 1, 2]);
  const sk = teamSkaters(total, 'AAA', 1, { minGp: 1 });
  assert.deepEqual(sk.map((p) => p.name), ['Al Skater', 'Bo Skater']);
  assert.equal(sk[0].momPg, 10);
});

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { deficiencies, skaterReasons, ord } from '../src/deficiencies.js';

// Two teams, four games: AAA out-shoots BBB but BBB's goalie stops everything.
const row = (n, away, home, ag, hg, an, hn, axg, hxg, agg, hgg) => [n, away, home, ag, hg, an + 5, hn + 5, an, hn, 50, 40, 'REG', 1, 2, axg, hxg, agg, hgg, 30, 25];
const total = {
  g: [row(1, 'AAA', 'BBB', 1, 3, 60, 40, 3, 2, 1, 3), row(2, 'BBB', 'AAA', 2, 1, 40, 60, 2, 3, 2, 1), row(3, 'AAA', 'BBB', 0, 2, 60, 40, 3, 2, 0, 2), row(4, 'BBB', 'AAA', 3, 2, 40, 60, 2, 3, 3, 2)],
  players: {
    1: { n: 'Goalie A', t: 'AAA', p: 'G', gp: 4, ga: 10, xga: 8, gs: 4 },
    2: { n: 'Goalie B', t: 'BBB', p: 'G', gp: 4, ga: 4, xga: 12, gs: 4 },
    10: { n: 'Skater A', t: 'AAA', p: 'C', gp: 4, mom: 20, mp: 24, mn: -4, sat: 20, sog: 12, xg: 12, xgg: 4 },
    11: { n: 'Skater B', t: 'BBB', p: 'C', gp: 4, mom: 4, mp: 8, mn: -4, sat: 10, sog: 10, xg: 8, xgg: 10 },
  },
};

test('splits each team into play, finishing and goaltending', () => {
  const r = deficiencies(total);
  const a = r.teams.find((t) => t.abbrev === 'AAA');
  const b = r.teams.find((t) => t.abbrev === 'BBB');
  assert.equal(r.n, 2);
  assert.ok(a.areas.play.value > 0 && b.areas.play.value < 0, 'AAA drives play');
  assert.equal(a.areas.play.share, 0.6);
  assert.ok(a.areas.finishing.value < 0 && b.areas.finishing.value > 0, 'BBB finishes better');
  assert.ok(a.areas.goaltending.value < 0, 'AAA goaltending below average');
  assert.equal(a.w, 0);
  assert.equal(b.ptsPct, 1);
  // Finishing for one team is goaltending against it from the other side.
  assert.ok(Math.abs(a.areas.finishing.value + b.areas.goaltending.value) < 1e-9);
});

test('no game rows means no report', () => {
  assert.equal(deficiencies({ players: {}, g: [] }), null);
});

test('skater reasons explain momentum and finishing in plain words', () => {
  const rs = skaterReasons({ pos: 'D', momPg: 1, posMom: 3.5, momPct: 0.03, mnPg: -0.5, mnPct: 0.5, mnMore: 0.5, momCost: -1.2, finCost: -2, goals: 0, avgGoals: 2.1, shPct: 0, xShPct: 0.06, belowPct: 0.1, posBelow: 0.18, toiRank: 2, toiPg: 1310 });
  assert.deepEqual(rs.map((r) => r.k), ['mom', 'fin', 'toi']);
  assert.match(rs[0].text, /bottom 3% of defensemen/);
  assert.match(rs[1].text, /0 goals on shots an average shooter would turn into 2\.1/);
  assert.match(rs[2].text, /21:50 a night, 2nd/);
});

test('ordinals', () => {
  assert.deepEqual([1, 2, 3, 4, 11, 12, 13, 21, 22, 32].map(ord), ['1st', '2nd', '3rd', '4th', '11th', '12th', '13th', '21st', '22nd', '32nd']);
});

test('on-ice list: flags a regular whose team shot share drops with him, not a normal-share player', async () => {
  const { onIceRows } = await import('../src/deficiencies.js');
  const mk = (id, cf, ca, extra = {}) => ({ id, name: `P${id}`, pos: 'D', gp: 15, toiPg: 18 * 60, cost: -2, oi: { sec: 200 * 60, cf, ca, gf: 5, ga: 5 }, ...extra });
  const rows = onIceRows([mk(1, 40, 60), mk(2, 55, 45), mk(3, 56, 44), mk(4, 54, 46)]);
  assert.equal(rows[0].id, 1);
  assert.ok(rows[0].gap < -0.1);
  assert.ok(rows.find((r) => r.id === 2).gap > -0.1);
  // Too few minutes: left out.
  assert.equal(onIceRows([mk(1, 40, 60, { oi: { sec: 60 * 60, cf: 40, ca: 60, gf: 1, ga: 2 } }), mk(2, 55, 45)]).find((r) => r.id === 1), undefined);
});

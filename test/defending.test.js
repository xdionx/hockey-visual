import test from 'node:test';
import assert from 'node:assert/strict';
import { splitDefense, blendDefending, pkVsTeammates, defFile, defendingValues } from '../src/defending.js';
import { stintData } from '../src/stints.js';
import { pkTotals } from '../src/rapm.js';
import { skaterCard } from '../src/skaterCard.js';

// 60 forwards: suppression partly follows offense (the puck-control effect) plus independent defending.
function fixture(seed = 3) {
  let s = seed;
  const rnd = () => { s = (s * 1664525 + 1013904223) % 4294967296; return s / 4294967296 - 0.5; };
  const players = {}, pos = {};
  for (let i = 1; i <= 60; i++) {
    const o = rnd() * 12, indep = rnd() * 6;
    players[i] = { d: -(0.5 * o + indep), o, h: 300 };
    pos[i] = 'F';
  }
  return { players, pos };
}

test('splitDefense removes offense from Defending and keeps the total', () => {
  const { players, pos } = fixture();
  const out = splitDefense(players, pos);
  const ids = Object.keys(out);
  const mean = (a) => a.reduce((x, y) => x + y, 0) / a.length;
  const corr = (a, b) => { const ma = mean(a), mb = mean(b); return a.reduce((t, x, i) => t + (x - ma) * (b[i] - mb), 0) / Math.sqrt(a.reduce((t, x) => t + (x - ma) ** 2, 0) * b.reduce((t, x) => t + (x - mb) ** 2, 0)); };
  assert.ok(Math.abs(corr(ids.map((i) => out[i].df), ids.map((i) => out[i].o))) < 0.02, 'Defending is uncorrelated with offense');
  assert.ok(corr(ids.map((i) => out[i].pc), ids.map((i) => out[i].o)) > 0.99, 'Puck control follows offense');
  const sup = ids.map((i) => -out[i].d), m = mean(sup);
  ids.forEach((i) => assert.ok(Math.abs(out[i].df + out[i].pc - (-out[i].d - m)) < 0.005, 'parts add up to the old number'));
});

test('blendDefending weights 50/30/20 and shrinks thin seasons', () => {
  const f = (df, h) => ({ v: 2, players: { 7: { df, pc: 0, h } } });
  const full = blendDefending([f(10, 20), f(0, 20), f(0, 20)], 7);
  assert.ok(Math.abs(full.df - 5 / 1.1) < 1e-9);
  const early = blendDefending([f(10, 1), f(2, 20), f(2, 20)], 7);
  assert.ok(early.df < 2.5 && early.df > 1.5, 'one thin season barely moves a veteran');
  assert.equal(blendDefending([null, { v: 1, players: {} }, null], 7), null);
});

test('pkVsTeammates compares with the team and needs 60 minutes', () => {
  const file = { pk: { 1: [4000, 100], 2: [4000, 150], 3: [4000, 150], 4: [100, 5] } };
  const t = { 1: 'A', 2: 'A', 3: 'A', 4: 'B' };
  const r = pkVsTeammates(file, 1, t);
  assert.ok(Math.abs(r.value - (150 / 4000 - 100 / 4000) * 3600) < 1e-9);
  assert.equal(pkVsTeammates(file, 4, t), null);
});

test('stintData finds 5v5 and 4v5 stretches, positions and blocks', () => {
  const ids = (a, n) => Array.from({ length: n }, (_, i) => a + i);
  const roster = [...ids(100, 6).map((id) => ({ playerId: id, teamId: 1, positionCode: id === 105 ? 'G' : 'C' })), ...ids(200, 6).map((id) => ({ playerId: id, teamId: 2, positionCode: id === 205 ? 'D' : 'L' }))];
  const sh = (id, team, a, b) => ({ playerId: id, teamId: team, period: 1, startTime: a, endTime: b, typeCode: 517 });
  const shifts = { data: [...ids(100, 5).map((id) => sh(id, 1, '00:00', '01:00')), ...ids(200, 5).map((id) => sh(id, 2, '00:00', '01:00')),
    ...ids(100, 4).map((id) => sh(id, 1, '01:00', '02:00')), ...ids(200, 5).map((id) => sh(id, 2, '01:00', '02:00'))] };
  const plays = [{ typeDescKey: 'shot-on-goal', periodDescriptor: { number: 1 }, timeInPeriod: '00:30', details: { xCoord: 10, eventOwnerTeamId: 1 } },
    { typeDescKey: 'missed-shot', periodDescriptor: { number: 1 }, timeInPeriod: '01:30', details: { xCoord: 10, eventOwnerTeamId: 2 } },
    { typeDescKey: 'blocked-shot', periodDescriptor: { number: 1 }, timeInPeriod: '01:40', details: { xCoord: 10, eventOwnerTeamId: 1, shootingPlayerId: 200, blockingPlayerId: 101 } }];
  const d = stintData({ homeTeam: { id: 1 }, awayTeam: { id: 2 }, rosterSpots: roster, plays }, shifts);
  assert.equal(d.rows.length, 1);
  assert.equal(d.rows[0][3], 1);
  assert.equal(d.pk.length, 1);
  assert.deepEqual(d.pk[0][1], ids(100, 4));
  assert.equal(d.pk[0][2], 2, 'attempts against the shorthanded team (a miss and a block)');
  assert.equal(d.pos[205], 'D');
  assert.equal(d.pos[100], 'F');
  assert.equal(d.blk[101], 1);
  assert.deepEqual(pkTotals(d.pk), {}, 'a minute of penalty kill is too little to keep');
});

test('skater card uses the blended Defending and Puck control', () => {
  const players = {}, dp = {};
  for (let i = 1; i <= 30; i++) {
    players[i] = { n: `P${i}`, t: i % 2 ? 'AAA' : 'BBB', p: i % 3 ? 'C' : 'D', gp: 20, sat: 40, sog: 20, xg: 2, xgg: 2, g: 1, a1: 1, a2: 0, mom: 0, mp: 0, mn: 0, tg: 20, ab: 5, bl: 5, ocf: 300, oca: 300, oto: 20000, pen: 1, pd: 1, pim: 2, gv: 10, tk: 5, fw: 100, fl: 100, toi: 20000, rt: 120, rn: 20 };
    dp[i] = { d: 0, o: 0, h: 5, p: i % 3 ? 'F' : 'D', df: (i - 15) / 10, pc: (15 - i) / 20, blk: i };
  }
  const total = { season: 20262027, gameType: 2, players, g: [], v: 9 };
  const file = { v: 2, gpa: 0.0627, players: dp, pk: {} };
  const old = { v: 2, gpa: 0.0627, players: Object.fromEntries(Object.entries(dp).map(([k, q]) => [k, { ...q, df: q.df * 2 }])) };
  const c = skaterCard(total, 29, { def: file, defPrev: [old, null] });
  assert.ok(c.split);
  assert.ok(c.m.def.value > 0 && c.m.puck.value < 0);
  assert.ok(c.defBars.some((b) => b.key === 'puck'));
  assert.equal(c.dseasons.length, 3);
  assert.ok(c.m.blk.value > 0);
  const vals = defendingValues([file, old, null], total);
  assert.ok(vals.get(29).def > vals.get(5).def);
  const f = defFile({ season: 20262027, games: 1, gpa: 0.0627, players: { 1: { d: 1, o: 1, h: 1 } }, pos: { 1: 'F' }, pk: {}, blk: { 1: 3 } });
  assert.equal(f.players[1].blk, 3);
});

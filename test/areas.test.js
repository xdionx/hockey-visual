import test from 'node:test';
import assert from 'node:assert/strict';
import { areaBase, skaterFlags, goalieFlags, goalieAreas } from '../src/areas.js';
import { compareRows, withPercentiles, COLS } from '../src/compare.js';

const sk = (id, p, o = {}) => ({ n: `P${id}`, t: 'AAA', p, gp: 20, sat: 100, sog: 50, pen: 4, pd: 4, pim: 8, gv: 10, tk: 10, fw: 0, fl: 0, mom: 10, xg: 3, xgg: 3, ...o });
const total = () => ({ games: 20, g: [], players: {
  1: sk(1, 'R'), 2: sk(2, 'R'), 3: sk(3, 'R'), 4: sk(4, 'R', { sog: 30 }), 5: sk(5, 'R', { pen: 15, pd: 2, pim: 30 }),
  6: sk(6, 'C', { fw: 100, fl: 100 }), 7: sk(7, 'C', { fw: 60, fl: 140 }),
  8: { n: 'G1', t: 'AAA', p: 'G', gp: 10, gs: 10, ga: 30, xga: 25, sa: 300, sg: 30, psa: 100, pga: 20, osa: 200, oga: 10, sf: 3 },
  9: { n: 'G2', t: 'AAA', p: 'G', gp: 10, gs: 10, ga: 44, xga: 25, sa: 300, sg: 44, psa: 100, pga: 20, osa: 200, oga: 24, sf: 9 },
} });

test('shot volume, penalties and faceoff flags are league-relative with sample minimums', () => {
  const t = total();
  const base = areaBase(t);
  assert.deepEqual(skaterFlags(t.players[1], base).map((f) => f.k), []);
  assert.ok(skaterFlags(t.players[4], base).some((f) => f.k === 'vol'));
  assert.ok(skaterFlags(t.players[5], base).some((f) => f.k === 'disc'));
  assert.ok(skaterFlags(t.players[7], base).some((f) => f.k === 'fo'));
  // Too few attempts: no flag.
  assert.equal(skaterFlags({ ...t.players[4], sat: 20, sog: 5 }, base).some((f) => f.k === 'vol'), false);
});

test('goalie outside-plate flag compares with the league rate on the same shots', () => {
  const t = total();
  const base = areaBase(t);
  const a = goalieAreas(t.players[9], base);
  assert.ok(a.out.vs < 0 && a.out.ok);
  assert.ok(goalieFlags(t.players[9], base).some((f) => f.k === 'out'));
  assert.equal(goalieFlags(t.players[8], base).some((f) => f.k === 'out'), false);
});

test('compare rows rank goalies and skaters within their own group', () => {
  const d = compareRows(total());
  withPercentiles(d.goalies, COLS.goalies);
  const [best, worst] = d.goalies.sort((a, b) => b.overall - a.overall);
  assert.equal(best.name, 'G1');
  assert.ok(worst.bad.includes('Outside plate'));
});

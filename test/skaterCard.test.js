import test from 'node:test';
import assert from 'node:assert/strict';
import { rankIn, ofN, skaterCard } from '../src/skaterCard.js';

test('rankIn marks ties and ranks best first', () => {
  assert.deepEqual(rankIn([1, 2, 3, 3], 3), { rank: 1, of: 4, tied: true });
  assert.deepEqual(rankIn([1, 2, 3], 1, false), { rank: 1, of: 3, tied: false });
  assert.equal(ofN({ rank: 15, of: 30, tied: false }), '15th NHL');
  assert.equal(ofN({ rank: 1, of: 30, tied: true }), 'T1st NHL');
});

const row = (i, over = {}) => ({ n: `P${i}`, t: i % 2 ? 'AAA' : 'BBB', p: 'C', gp: 20, sat: 40 + i, sog: 20 + i, xg: 2 + i / 10, xgg: 2, g: i % 5, a1: i % 4, a2: 0, mom: i - 10, mp: i, mn: 0, tg: 20, ab: 5, bl: 5,
  ocf: 300, oca: 300 - i * 5, oto: 20000, oga: 5, ogf: 5, pen: 2, pd: 3, pim: 4, gv: 10, tk: 5, fw: 100, fl: 100, toi: 20000, ...over });
test('skaterCard gives ranks, summary and defense vs teammates', () => {
  const players = {};
  for (let i = 1; i <= 24; i++) players[i] = row(i);
  const total = { season: 20262027, gameType: 2, players, g: [], v: 9 };
  const c = skaterCard(total, 24);
  assert.equal(c.m.play.rank.rank, 1);
  assert.ok(c.m.def.value > 0, 'fewer attempts against than teammates = goals prevented');
  assert.ok(c.summary.headline);
  assert.ok(c.spider.length >= 3);
  assert.equal(skaterCard(total, 999), null);
  assert.ok(skaterCard(total, 1).weak.some((x) => x.key === 'play'));
});

import { emptySeason, addGame, perGame } from '../src/seasonStats.js';
import { areaBase, skaterFlags } from '../src/areas.js';
import { compareRows } from '../src/compare.js';

test('game ratings add up per player and feed averages, flags and Compare', () => {
  const total = emptySeason(20262027);
  for (let g = 0; g < 10; g++) {
    const lines = [];
    for (let i = 1; i <= 16; i++) lines.push({ id: i, name: `P${i}`, team: i % 2 ? 'AAA' : 'BBB', pos: 'C', sat: 3, sog: 2, xg: 0.2, xgg: 0, g: 0, a1: 0, a2: 0, mom: 0, pen: 0, pd: 0, pim: 0, gv: 0, tk: 0, fw: 5, fl: 5, rating: i === 1 ? 3.5 : 6 + (i % 3) * 0.3 });
    addGame(total, lines);
  }
  const r = total.players['1'];
  assert.equal(r.rn, 10);
  assert.equal(r.rt, 35);
  assert.equal(perGame(r).ratingAvg, 3.5);
  const flags = skaterFlags(r, areaBase(total));
  assert.ok(flags.some((f) => f.k === 'rate' && f.soft), 'a far-below-average rating is flagged softly');
  const rows = compareRows(total);
  assert.equal(rows.skaters.find((x) => x.id === 1).v.rating, 3.5);
});

import { productionRanks } from '../src/skaterCard.js';
test('productionRanks ranks box-score numbers with team ranks', () => {
  const players = {
    1: { n: 'A', t: 'AAA', p: 'C', gp: 10, g: 5, a1: 2, a2: 1, pim: 4, toi: 12000 },
    2: { n: 'B', t: 'AAA', p: 'L', gp: 10, g: 5, a1: 0, a2: 0, pim: 8, toi: 10000 },
    3: { n: 'C', t: 'BBB', p: 'D', gp: 10, g: 1, a1: 5, a2: 0, pim: 0, toi: 9000 },
    4: { n: 'G', t: 'BBB', p: 'G', gp: 10 },
  };
  const r = productionRanks({ players }, 1);
  assert.equal(r.g.nhl.rank, 1); assert.equal(r.g.nhl.tied, true);
  assert.equal(r.p.nhl.rank, 1); assert.equal(r.p.team.rank, 1); assert.equal(r.p.team.team, 'AAA');
  assert.equal(r.pim.nhl.rank, 2);
  assert.equal(productionRanks({ players }, 4), null);
});

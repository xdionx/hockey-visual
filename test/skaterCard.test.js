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

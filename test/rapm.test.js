import test from 'node:test';
import assert from 'node:assert/strict';
import { fitDefense } from '../src/rapm.js';

// 20 skaters, ids 1..20; skater 1 (home) suppresses attempts, skater 2 gives up extra. Random lineups.
test('fitDefense finds a planted good defender and a planted bad one', () => {
  let seed = 7;
  const rnd = () => { seed = (seed * 1664525 + 1013904223) % 4294967296; return seed / 4294967296; };
  const pick = (lo) => { const s = new Set(); while (s.size < 5) s.add(lo + Math.floor(rnd() * 10)); return [...s].sort((a, b) => a - b); };
  const rows = [];
  for (let i = 0; i < 4000; i++) {
    const h = pick(1), a = pick(11), dur = 60;
    const base = 60; // attempts per 60
    let against = base; // home attempts = attempts the away skaters allow
    const pois = (m) => { let L = Math.exp(-m), k = 0, p = 1; do { k++; p *= rnd(); } while (p > L); return k - 1; };
    const homeAtt = pois(((base + (a.includes(11) ? -15 : 0) + (a.includes(12) ? 15 : 0)) * dur) / 3600);
    const awayAtt = pois(((against + (h.includes(1) ? -15 : 0) + (h.includes(2) ? 15 : 0)) * dur) / 3600);
    rows.push([dur, h, a, homeAtt, awayAtt]);
  }
  const { players } = fitDefense(rows, 0.0627, 50);
  // MIN_SECONDS filter: lineups put every skater on the ice for plenty of time here
  assert.ok(players[1].d < players[2].d, 'skater 1 allows fewer attempts than skater 2');
  assert.ok(players[11].d < players[12].d);
  assert.ok(players[1].d < 0 && players[2].d > 0);
});

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { computeMomentum } from '../src/momentum.js';
import { VERSIONS, scoreGame, pickAhead, summarize } from '../src/modelLab.js';
import { slim } from '../src/pbpSlim.js';

const pbp = JSON.parse(readFileSync(new URL('./fixtures/game-2026020312/pbp.json', import.meta.url)));
const v = (id) => VERSIONS.find((x) => x.id === id);

test('the live version reproduces computeMomentum team totals', () => {
  const m = computeMomentum(pbp, pbp.awayTeam.id);
  const r = scoreGame(pbp, v('v4'));
  assert.deepEqual([r.am, r.hm], [m.totals.away, m.totals.home]);
  assert.deepEqual([r.an, r.hn], [m.totalsNoGoals.away, m.totalsNoGoals.home]);
});

test('slim play-by-play scores the same as the raw one', () => {
  for (const ver of VERSIONS) assert.deepEqual(scoreGame(slim(pbp), ver), scoreGame(pbp, ver), ver.id);
});

test('goals count as shots adds one shot value per goal to "no goals"', () => {
  const a = scoreGame(pbp, v('v3'));
  const b = scoreGame(pbp, v('v3-gs'));
  // each goal adds its shot value (at least half a shot: goals from wide of the circles count 0.5x)
  assert.ok(b.an >= a.an + a.ag * 0.5 && b.hn >= a.hn + a.hg * 0.5);
  assert.equal(b.am, a.am);
});

test('pickAhead only uses games before the one it picks', () => {
  const rows = [];
  // A always out-shoots B and always wins, from game 21 on (after 10 games each).
  for (let n = 1; n <= 30; n++) rows.push({ n, date: `2025-10-${String(n).padStart(2, '0')}`, away: 'A', home: 'B', ag: n > 20 ? 3 : 1, hg: n > 20 ? 1 : 2, an: 30, hn: 20, as: 30, hs: 20 });
  assert.equal(pickAhead(rows, 'ng'), 0.5); // games 11-30: lost 10, won 10
  const s = summarize(rows);
  assert.equal(s.games, 30);
});

import test from 'node:test';
import assert from 'node:assert/strict';
import { teamTable } from '../src/momentumModel.js';

// Game row fields (see GAME_FIELDS): n, away, home, ag, hg, am, hm, an, hn, as, hs, end
const g = (n, away, home, ag, hg, end) => [n, away, home, ag, hg, 1, 1, 1, 1, 1, 1, end];
const rows = [g(1, 'AAA', 'BBB', 3, 2, 'OT'), g(2, 'AAA', 'BBB', 1, 4, 'REG'), g(3, 'BBB', 'AAA', 2, 1, 'OT')]
  .map((r) => Object.fromEntries(['n', 'away', 'home', 'ag', 'hg', 'am', 'hm', 'an', 'hn', 'as', 'hs', 'end'].map((k, i) => [k, r[i]])));

test('regular season: an overtime loss is its own column and earns a point', () => {
  const a = teamTable(rows).find((t) => t.abbrev === 'AAA');
  assert.deepEqual([a.w, a.l, a.otl], [1, 1, 1]);
  assert.equal(a.ptsPct, 3 / 6);
});

test('playoffs: no points, an overtime loss is a loss, the overtime record is kept, pts % is win %', () => {
  const a = teamTable(rows, { playoffs: true }).find((t) => t.abbrev === 'AAA');
  assert.deepEqual([a.w, a.l, a.otw, a.otl], [1, 2, 1, 1]);
  assert.equal(a.ptsPct, 1 / 3);
  assert.equal(a.w + a.l, a.gp);
});

import test from 'node:test';
import assert from 'node:assert/strict';
import { topPlayers, missingTop } from '../src/lineupAlert.js';

const total = { players: {
  1: { n: 'Connor McDavid', t: 'EDM', p: 'C', gp: 20, mom: 60 },
  2: { n: 'Leon Draisaitl', t: 'EDM', p: 'C', gp: 20, mom: 40 },
  3: { n: 'Evan Bouchard', t: 'EDM', p: 'D', gp: 20, mom: 30 },
  4: { n: 'Zach Hyman', t: 'EDM', p: 'L', gp: 20, mom: 10 },
  5: { n: 'Stuart Skinner', t: 'EDM', p: 'G', gp: 20, mom: 99 },
  6: { n: 'Hot Rookie', t: 'EDM', p: 'C', gp: 3, mom: 30 },
  7: { n: 'Jordan Kyrou', t: 'STL', p: 'R', gp: 20, mom: 90 },
} };

test('top players: own team skaters with enough games, best momentum per game first', () => {
  assert.deepEqual(topPlayers(total, null, 'EDM').map((p) => p.name), ['Connor McDavid', 'Leon Draisaitl', 'Evan Bouchard']);
});

test('last season counts, shrunk toward zero', () => {
  const prev = { players: { 4: { n: 'Zach Hyman', t: 'EDM', p: 'L', gp: 80, mom: 300 } } };
  assert.equal(topPlayers(total, prev, 'EDM')[0].name, 'Zach Hyman');
});

test('missing top players match scratches by name (accents and case ignored) or id', () => {
  const top = topPlayers(total, null, 'EDM');
  assert.deepEqual(missingTop(top, ['CONNOR MCDAVID', 'Someone Else']).map((p) => p.rank), [1]);
  assert.deepEqual(missingTop(top, ['Evan Bóuchard']).map((p) => p.rank), [3]);
  assert.deepEqual(missingTop(top, [], [2]).map((p) => p.rank), [2]);
  assert.deepEqual(missingTop(top, []), []);
});

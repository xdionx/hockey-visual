import test from 'node:test';
import assert from 'node:assert/strict';
import { topPlayers, missingTop, notablePlayers, notableRole } from '../src/lineupAlert.js';

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

test('notable players: top 3 forwards and top 2 defensemen, ranked within the position', () => {
  const t = { players: {
    ...total.players,
    8: { n: 'Darnell Nurse', t: 'EDM', p: 'D', gp: 20, mom: 20 },
    9: { n: 'Mattias Ekholm', t: 'EDM', p: 'D', gp: 20, mom: 5 },
    10: { n: 'Ryan Nugent-Hopkins', t: 'EDM', p: 'C', gp: 20, mom: 8 },
  } };
  const list = notablePlayers(t, null, 'EDM');
  assert.deepEqual(list.map((p) => [p.name, p.pos, p.rank]), [
    ['Connor McDavid', 'F', 1], ['Leon Draisaitl', 'F', 2], ['Zach Hyman', 'F', 3],
    ['Evan Bouchard', 'D', 1], ['Darnell Nurse', 'D', 2],
  ]);
  assert.equal(notableRole(list[4]), '#2 defenseman');
  assert.deepEqual(missingTop(list, ['Darnell Nurse']).map((p) => p.name), ['Darnell Nurse']);
});

test('missing players: ids win over names when the feed has them (two players can share a name)', () => {
  const top = [{ id: 1, name: 'Elias Pettersson', rank: 1 }, { id: 2, name: 'Elias Pettersson', rank: 2 }];
  assert.deepEqual(missingTop(top, ['Elias Pettersson'], [2]).map((p) => p.id), [2]);
  assert.deepEqual(missingTop(top, ['Elias Pettersson']).map((p) => p.id), [1, 2]);
});

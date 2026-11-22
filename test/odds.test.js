import { test } from 'node:test';
import assert from 'node:assert/strict';
import { impliedProb, noVigAway, parsePartner, mergeOdds, score, compare, edge, marketAway } from '../src/odds.js';

const partner = (name, a, h, start = '2026-11-22T17:30:00Z') => ({
  bettingPartner: { name },
  games: [{ gameId: 1, gameType: 2, startTimeUTC: start,
    awayTeam: { odds: [{ description: 'MONEY_LINE_3_WAY', value: 105 }, { description: 'MONEY_LINE_2_WAY', value: a }] },
    homeTeam: { odds: [{ description: 'MONEY_LINE_2_WAY', value: h }] } }],
});

test('American odds to win chances, with and without the margin', () => {
  assert.ok(Math.abs(impliedProb(-150) - 0.6) < 1e-9);
  assert.ok(Math.abs(impliedProb(150) - 0.4) < 1e-9);
  assert.ok(Math.abs(noVigAway(-162, 136) - 0.5934) < 1e-3); // 0.6183 and 0.4237 scaled to sum to 1
  assert.equal(noVigAway(0, 100), null);
});

test('the partner feed reads the two-way moneyline and ignores unknown books and non-regular-season games', () => {
  assert.deepEqual(parsePartner(partner('DraftKings', -162, 136)), [{ gameId: 1, start: '2026-11-22T17:30:00Z', book: 'dk', a: -162, h: 136 }]);
  assert.deepEqual(parsePartner(partner('SomeBook', -110, -110)), []);
  assert.deepEqual(parsePartner({ ...partner('FanDuel', -110, -110), games: [{ ...partner('FanDuel', -110, -110).games[0], gameType: 3 }] }), []);
});

test('lines and picks keep updating until puck drop, then freeze', () => {
  const start = Date.parse('2026-11-22T17:30:00Z');
  const snap = (book, a, h) => ({ gameId: 1, start: '2026-11-22T17:30:00Z', book, a, h });
  let o = mergeOdds(null, [snap('dk', -150, 130)], new Map([[1, 0.55]]), start - 3600e3);
  o = mergeOdds(o, [snap('dk', -160, 138), snap('fd', -155, 135)], new Map([[1, 0.57]]), start - 600e3);
  assert.deepEqual([o.games[1].books.dk.a, o.games[1].books.fd.a, o.games[1].pick.a], [-160, -155, 0.57]);
  const after = mergeOdds(o, [snap('dk', 200, -250)], new Map([[1, 0.2]]), start + 60e3);
  assert.deepEqual([after.games[1].books.dk.a, after.games[1].pick.a], [-160, 0.57]);
});

test('scoring and comparison use only finished games with a pick and a book', () => {
  const g = (id, result, us, dk, fd) => [id, { date: 'd', start: 's', result, pick: { a: us }, books: { ...(dk ? { dk: { a: dk[0], h: dk[1] } } : {}), ...(fd ? { fd: { a: fd[0], h: fd[1] } } : {}) } }];
  const odds = { games: Object.fromEntries([g(1, 'away', 0.6, [-150, 130], [-150, 130]), g(2, 'home', 0.4, [120, -140], [120, -140]), g(3, null, 0.5, [100, -120], null), g(4, 'away', 0.7, null, null)]) };
  const c = compare(odds);
  assert.equal(c.games, 2);
  assert.equal(c.same.us.accuracy, 1);
  assert.ok(c.same.us.logLoss > 0 && c.same.dk.n === 2);
  assert.equal(score([], () => 0.5), null);
  assert.equal(c.gaps.length, 2);
});

test('an edge needs a 7-point gap and names the side we like more', () => {
  const books = { dk: { a: -150, h: 130 }, fd: { a: -150, h: 130 } }; // market away ~.58
  assert.ok(Math.abs(marketAway(books) - 0.5798) < 1e-3);
  assert.equal(edge(0.62, books), null);
  const e = edge(0.7, books);
  assert.deepEqual([e.side, e.pts], ['away', 12]);
  const h = edge(0.4, books); // we think the away team is weaker: the edge is on the home side
  assert.deepEqual([h.side, h.pts], ['home', 18]);
  assert.equal(edge(0.7, {}), null);
});

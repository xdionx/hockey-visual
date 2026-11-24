import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parsePartner, mergeOdds } from '../src/odds.js';
import { winByAtLeast, gapOf, impliedGap, puckLine, lineView, spreadReport } from '../src/spread.js';

const feed = {
  bettingPartner: { name: 'DraftKings' },
  games: [{ gameId: 7, gameType: 2, startTimeUTC: '2026-11-24T00:00:00Z',
    homeTeam: { odds: [{ description: 'MONEY_LINE_2_WAY', value: -205 }, { description: 'PUCK_LINE', value: 124, qualifier: '-1.5' }, { description: 'OVER_UNDER', value: 114, qualifier: 'O6.5' }] },
    awayTeam: { odds: [{ description: 'MONEY_LINE_2_WAY', value: 170 }, { description: 'PUCK_LINE', value: -148, qualifier: '+1.5' }, { description: 'OVER_UNDER', value: -135, qualifier: 'U6.5' }] } }],
};

test('the feed gives the puck line and total, and old-style feeds still parse', () => {
  const [g] = parsePartner(feed);
  assert.deepEqual([g.pl, g.tl], [{ line: -1.5, a: -148, h: 124 }, { line: 6.5, o: 114, u: -135 }]);
  const bare = structuredClone(feed);
  bare.games[0].homeTeam.odds = bare.games[0].homeTeam.odds.filter((o) => o.description === 'MONEY_LINE_2_WAY');
  assert.equal(parsePartner(bare)[0].pl, undefined);
});

test('a saved pick keeps our expected gap', () => {
  const o = mergeOdds(null, parsePartner(feed), new Map([[7, { away: 0.4, gap: -0.456 }]]), Date.parse('2026-11-23T12:00:00Z'));
  assert.equal(o.games[7].pick.gap, -0.46);
  assert.equal(o.games[7].books.dk.pl.line, -1.5);
});

test('win-by-2 chances behave like hockey', () => {
  const even = winByAtLeast(0, 6.4);
  assert.ok(Math.abs(even * 2 - 0.586) < 0.01, `${even}`); // both sides together: games decided by 2+
  assert.ok(winByAtLeast(1, 6.4) > even && winByAtLeast(-1, 6.4) < even);
  assert.ok(winByAtLeast(1.5, 6.4) < 0.6);
});

test('the gap behind a pick round-trips through its win chance', () => {
  const p = 1 / (1 + Math.exp(-(-0.011 + 0.665 * 0.8)));
  assert.ok(Math.abs(gapOf({ a: p }) - 0.8) < 1e-9);
  assert.ok(Math.abs(impliedGap(p) - 0.8) < 1e-9);
});

test('puck line: favorite is the side laying 1.5, margin removed', () => {
  const pl = puckLine({ pl: { line: -1.5, a: -148, h: 124 } });
  assert.equal(pl.fav, 'home');
  assert.ok(Math.abs(pl.favCover - 0.4464 / (0.4464 + 0.5968)) < 2e-3);
  assert.equal(puckLine({}), null);
});

test('line view and report on a finished game', () => {
  const books = { dk: { a: 170, h: -205, pl: { line: -1.5, a: -148, h: 124 }, tl: { line: 6.5, o: 114, u: -135 } } };
  const pick = { a: 0.4, gap: -0.45 };
  const v = lineView(books, pick);
  assert.equal(v.fav, 'home');
  assert.equal(v.agree, true);
  assert.ok(v.ours.gapFav > 0 && v.market.gapFav > v.ours.gapFav);
  const r = spreadReport({ games: { 1: { result: 'home', margin: -3, pick, books }, 2: { result: 'away', margin: 1, pick, books } } });
  assert.deepEqual([r.games, r.cover.n, r.picked.n], [2, 2, 2]);
  assert.equal(r.cover.actual, 0.5);
  assert.equal(r.picked.covered, 1);
  assert.equal(r.margin.n, 2);
});

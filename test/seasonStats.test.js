import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { normalizeGameDetail } from '../src/gameDetail.js';
import { linesFromDetail, linesFromPbp, emptySeason, addGame, perGame, leaderboard, rankOf, seasonOf, seasonLabel } from '../src/seasonStats.js';
import { normalizePlayer } from '../src/player.js';

const dir = new URL('./fixtures/game-2026020312/', import.meta.url);
const raw = Object.fromEntries(['box', 'landing', 'rightRail', 'pbp'].map((k) => [k, JSON.parse(readFileSync(new URL(`${k}.json`, dir), 'utf8'))]));

test('play-by-play lines match the box score lines for SAT and momentum', () => {
  const fromDetail = new Map(linesFromDetail(normalizeGameDetail(raw)).filter((l) => l.pos !== 'G').map((l) => [l.id, l]));
  const fromPbp = linesFromPbp(raw.pbp).filter((l) => l.pos !== 'G');
  assert.ok(fromPbp.length >= 36);
  for (const l of fromPbp) {
    const d = fromDetail.get(l.id);
    assert.ok(d, `player ${l.id} in both`);
    assert.equal(l.sat, d.sat, `SAT for ${l.name}`);
    assert.equal(l.sog, d.sog, `SOG for ${l.name}`);
    assert.equal(l.mom, d.mom, `momentum for ${l.name}`);
  }
});

test('season totals add up and rank per game', () => {
  const total = emptySeason(20262027);
  addGame(total, [{ id: 1, name: 'A', team: 'X', pos: 'C', sat: 6, sog: 3, mom: 4, mp: 5, mn: -1, toi: 1200 }, { id: 2, name: 'B', team: 'Y', pos: 'D', sat: 2, sog: 1, mom: -1, mp: 1, mn: -2, toi: 1500 }, { id: 3, name: 'G', team: 'X', pos: 'G', toi: 3600 }]);
  addGame(total, [{ id: 1, name: 'A', team: 'X', pos: 'C', sat: 4, sog: 2, mom: 2, mp: 3, mn: -1, toi: 1200 }]);
  assert.equal(total.games, 2);
  assert.equal(total.players[1].gp, 2);
  assert.equal(total.players[1].sat, 10);
  assert.equal(total.players[3].sat, undefined);
  const avg = perGame(total.players[1]);
  assert.equal(avg.satPerGame, 5);
  assert.equal(avg.momPerGame, 3);
  assert.equal(avg.satPer60, 15);
  const board = leaderboard(total, 'momPerGame', { minGp: 1 });
  assert.deepEqual(board.map((r) => r.id), [1, 2]);
  assert.deepEqual(rankOf(total, 2, 'satPerGame', { minGp: 1 }), { rank: 2, of: 2 });
});

test('season helpers', () => {
  assert.equal(seasonOf('2026-11-20'), 20262027);
  assert.equal(seasonOf('2027-04-10'), 20262027);
  assert.equal(seasonLabel(20092010), '2009-10');
});

test('player profile from the landing feed', () => {
  const p = normalizePlayer({
    playerId: 9, isActive: true, firstName: { default: 'Test' }, lastName: { default: 'Player' }, position: 'C', currentTeamAbbrev: 'EDM',
    featuredStats: { season: 20262027 },
    seasonTotals: [
      { season: 20252026, gameTypeId: 2, leagueAbbrev: 'NHL', teamName: { default: 'A' }, gamesPlayed: 10, goals: 2, assists: 3, points: 5, avgToi: '20:00', shots: 20 },
      { season: 20252026, gameTypeId: 2, leagueAbbrev: 'NHL', teamName: { default: 'B' }, gamesPlayed: 30, goals: 8, assists: 7, points: 15, avgToi: '10:00', shots: 60 },
      { season: 20262027, gameTypeId: 2, leagueAbbrev: 'NHL', teamName: { default: 'B' }, gamesPlayed: 5, goals: 1, assists: 1, points: 2, pim: 4, avgToi: '15:30' },
    ],
  });
  assert.equal(p.fullName, 'Test Player');
  assert.equal(p.now.gp, 5);
  assert.equal(p.now.toiPerGame, 930);
  const traded = p.nhl.find((s) => s.season === 20252026);
  assert.equal(traded.gp, 40);
  assert.equal(traded.points, 20);
  assert.equal(traded.team, 'A / B');
  assert.equal(traded.toiPerGame, 750);
});

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
  // Goalies: only the ones who went in count as a game played, the same as the box score.
  const goalies = (lines) => lines.filter((l) => l.pos === 'G').map((l) => l.id).sort();
  assert.deepEqual(goalies(linesFromPbp(raw.pbp)), goalies(linesFromDetail(normalizeGameDetail(raw))));
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

test('game rows match from the box score and the play-by-play', async () => {
  const { gameFromDetail, fromPbp, gameObj } = await import('../src/seasonStats.js');
  const fromDetail = gameObj(gameFromDetail(normalizeGameDetail(raw)));
  const pbpGame = gameObj(fromPbp(raw.pbp).game);
  assert.deepEqual(fromDetail, pbpGame);
  assert.equal(pbpGame.end, 'SO');
  assert.equal(pbpGame.n, 312);
  assert.ok(pbpGame.an < pbpGame.am && pbpGame.hn < pbpGame.hm, 'goals left out');
  const total = addGame(emptySeason(20262027), fromPbp(raw.pbp).lines, fromPbp(raw.pbp).game);
  assert.equal(total.g.length, 1);
});

test('goalieLineOf: goals saved above expected against an average goalie', async () => {
  const { goalieLineOf, perGame } = await import('../src/seasonStats.js');
  const g = goalieLineOf({ gp: 10, ga: 30, xga: 25, gs: 9 }, 1.2);
  assert.equal(g.xgaAvg, 30);
  assert.equal(g.gsax, 0);
  assert.equal(g.starts, 9);
  const pg = perGame({ p: 'G', gp: 4, ga: 8, xga: 10, gs: 4 }, 1);
  assert.equal(pg.gsax, 2);
  assert.equal(pg.gsaxPerGame, 0.5);
  assert.equal(perGame({ p: 'C', gp: 1, sat: 2, sog: 1, mom: 0 }).gsax, undefined);
});

test('scoring vs avg: assists above the position average make up for cold finishing', async () => {
  const { perGame, scoringBase } = await import('../src/seasonStats.js');
  const mk = (p, gp, a1, a2, xg, xgg) => ({ n: 'x', t: 'AAA', p, gp, sat: 0, sog: 20, xg, xgg, g: xgg, a1, a2, mom: 0 });
  const total = { players: { 1: mk('R', 20, 8, 2, 5, 3), 2: mk('C', 20, 3, 1, 5, 5), 3: mk('L', 20, 3, 1, 5, 5), 4: mk('D', 20, 2, 2, 1, 1) } };
  const base = scoringBase(total);
  assert.ok(base.F > 0 && base.D > 0);
  const a = perGame(total.players[1], 1, base);
  assert.equal(a.assists, 10);
  assert.ok(a.gaa < 0 && a.playVsAvg > 0);
  assert.ok(Math.abs(a.scoringVsAvg - (a.gaa + a.playVsAvg)) < 1e-9);
  // Files without assists yet: no scoring number, finishing unchanged.
  const old = perGame({ n: 'x', t: 'AAA', p: 'R', gp: 20, sog: 20, xg: 5, xgg: 3, mom: 0 }, 1, null);
  assert.equal(old.scoringVsAvg, null);
  assert.ok(old.gaa < 0);
});

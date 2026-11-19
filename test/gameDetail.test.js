import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { normalizeGameDetail, skaterGameScore, rating } from '../src/gameDetail.js';

const load = (k) => JSON.parse(readFileSync(new URL(`./fixtures/game-2026020312/${k}.json`, import.meta.url)));
// WPG 5 @ CHI 4, decided in a shootout.
const game = normalizeGameDetail({ box: load('box'), landing: load('landing'), rightRail: load('rightRail'), pbp: load('pbp') });

test('header, linescore and shootout', () => {
  assert.equal(game.status.label, 'Final/SO');
  assert.equal(game.away.abbrev, 'WPG');
  assert.deepEqual(game.linescore.periods.map((p) => p.label), ['1', '2', '3', 'OT', 'SO']);
  assert.deepEqual(game.linescore.totals, { away: 5, home: 4 });
  assert.deepEqual(game.linescore.shootout, { away: '2/3', home: '1/3' });
  assert.equal(game.shootout.length, 6);
});

test('scoring, penalties and three stars', () => {
  assert.equal(game.scoring.length, 9);
  assert.equal(game.scoring.at(-1).period, 'SO');
  assert.ok(game.penalties.length > 0);
  assert.equal(game.threeStars[0].star, 1);
});

test('players carry play-by-play extras and a game score', () => {
  const all = [...game.players.away.forwards, ...game.players.away.defense];
  const scheifele = all.find((p) => p.lastName === 'Scheifele');
  assert.equal(scheifele.goals, 1);
  assert.equal(scheifele.a1 + scheifele.a2, scheifele.assists);
  assert.ok(scheifele.fow + scheifele.fol > 0);
  assert.equal(scheifele.rating, 10);
  const goalies = game.players.away.goalies;
  assert.equal(goalies.find((g) => g.decision === 'W').lastName, 'Daws');
});

test('shots exclude the shootout and face the right nets', () => {
  assert.ok(game.shots.length > 50);
  const goals = game.shots.filter((s) => s.kind === 'goal');
  assert.equal(goals.length, 8);
  for (const g of goals) assert.equal(g.team === 'away' ? g.x < 0 : g.x > 0, true);
});

test('game score math', () => {
  const gs = skaterGameScore({ goals: 1, a1: 1, a2: 0, sog: 4, blocks: 0, penaltiesDrawn: 0, penaltiesTaken: 1, fow: 0, fol: 0, plusMinus: 1 });
  assert.equal(gs.total, 0.75 + 0.7 + 0.3 - 0.15 + 0.15);
  assert.equal(rating(0), 6);
  assert.equal(rating(99), 10);
});

test('game story headline finds the comeback and the shootout winner', async () => {
  const { storyline } = await import('../public/game/d6-story.js');
  const s = storyline(game);
  assert.equal(s.headline, 'Jets storm back from 4 down to beat the Blackhawks in a shootout');
  assert.match(s.dek[0], /Kyle Connor scored the shootout winner/);
});

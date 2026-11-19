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
  assert.equal(gs.total, 0.75 + 0.7 + 0.3 - 0.25 + 0.15);
  assert.equal(rating(0), 6);
  assert.equal(rating(99), 10);
});

test('game story headline finds the comeback and the shootout winner', async () => {
  const { storyline } = await import('../public/game/d6-story.js');
  const s = storyline(game);
  assert.equal(s.headline, 'Jets storm back from 4 down to beat the Blackhawks in a shootout');
  assert.match(s.dek[0], /Kyle Connor scored the shootout winner/);
});

test('on-ice weighted shot attempts from shift charts', async () => {
  const { onIceAttempts, ON_ICE_WEIGHTS, inHomePlate, HOME_PLATE_BONUS } = await import('../src/momentum.js');
  const pbp = load('pbp');
  // One WPG skater on the ice for all of period 2.
  const shifts = { data: [{ playerId: 8476460, teamId: 52, period: 2, startTime: '00:00', endTime: '20:00', typeCode: 517 }] };
  const row = onIceAttempts(pbp, shifts).get(8476460);
  const kinds = { goal: 'goal', 'shot-on-goal': 'sog', 'missed-shot': 'miss', 'blocked-shot': 'block' };
  const team = new Map(pbp.rosterSpots.map((r) => [r.playerId, r.teamId]));
  let cf = 0; let ca = 0;
  for (const p of pbp.plays) {
    const k = kinds[p.typeDescKey];
    if (!k || p.periodDescriptor.number !== 2) continue;
    const id = p.details.shootingPlayerId ?? p.details.scoringPlayerId;
    const w = ON_ICE_WEIGHTS[k] * (k !== 'goal' && inHomePlate(p.details.xCoord, p.details.yCoord) ? HOME_PLATE_BONUS : 1);
    if (team.get(id) === 52) cf += w; else ca += w;
  }
  assert.ok(Math.abs(row.cf - cf) < 0.01 && Math.abs(row.ca - ca) < 0.01);
  assert.equal(row.gf, 2);
  // Without shifts the box score still builds and falls back to plus/minus.
  assert.equal(onIceAttempts(pbp, null), null);
  assert.equal(game.hasShifts, false);
});

test('momentum swings and player momentum', () => {
  assert.ok(game.momentum.series.length > 300);
  assert.ok(game.momentum.swings.length >= 3 && game.momentum.swings.length <= 10);
  const all = [...game.players.away.forwards, ...game.players.away.defense];
  assert.ok(all.find((p) => p.lastName === 'Scheifele').momentum > 5);
});

test('taking a penalty costs the offender the power play it gave up', async () => {
  const { pushes } = await import('../src/momentum.js');
  const pbp = JSON.parse(readFileSync(new URL('./fixtures/game-2026020312/pbp.json', import.meta.url)));
  const plays = [...pbp.plays].sort((a, b) => a.sortOrder - b.sortOrder);
  const roster = new Map(pbp.rosterSpots.map((r) => [r.playerId, r.teamId]));
  const yager = pbp.plays.find((p) => p.typeDescKey === 'penalty').details.committedByPlayerId;
  const cost = pushes(plays, 52, roster).filter((e) => e.debit === yager).reduce((n, e) => n + (e.debitW ?? e.w), 0);
  // 1.0 for the penalty, power play pressure, and 1.5 because the power play scored.
  assert.ok(cost > 2.5, `cost ${cost}`);
});

test('home plate area', async () => {
  const { inHomePlate } = await import('../src/momentum.js');
  assert.equal(inHomePlate(80, 0), true); // low slot
  assert.equal(inHomePlate(-60, 15), true); // between the dots, other end
  assert.equal(inHomePlate(85, 20), false); // below the dots, near the goal line
  assert.equal(inHomePlate(45, 0), false); // point
  assert.equal(inHomePlate(95, 0), false); // behind the net
  assert.ok(game.shots.some((s) => s.homePlate));
});

test('drawing a penalty earns the power play it created', async () => {
  const { pushes } = await import('../src/momentum.js');
  const pbp = load('pbp');
  const plays = [...pbp.plays].sort((a, b) => a.sortOrder - b.sortOrder);
  const roster = new Map(pbp.rosterSpots.map((r) => [r.playerId, r.teamId]));
  const pen = pbp.plays.find((p) => p.typeDescKey === 'penalty' && p.details.drawnByPlayerId);
  const drawer = pen.details.drawnByPlayerId;
  const earned = pushes(plays, 52, roster).filter((e) => e.credits.some((c) => c.id === drawer) && ['penalty', 'power-play', 'pp-goal-against'].includes(e.kind))
    .reduce((n, e) => n + (e.creditW ?? e.w) * e.credits.find((c) => c.id === drawer).share, 0);
  assert.ok(earned > 1.2, `earned ${earned}`);
});

test('shorthanded goals swing momentum 1.5x more than other goals', () => {
  const goal = (code, owner) => ({ typeDescKey: 'goal', situationCode: code, timeInPeriod: '05:00', periodDescriptor: { number: 1, periodType: 'REG' }, details: { eventOwnerTeamId: owner, scoringPlayerId: 1 } });
  const [sh] = pushes([goal('1451', 52)], 52, new Map());
  const [pp] = pushes([goal('1541', 52)], 52, new Map());
  const [ev] = pushes([goal('1551', 52)], 52, new Map());
  assert.equal(sh.w, 4.5);
  assert.equal(pp.w, 3);
  assert.equal(ev.w, 3);
});

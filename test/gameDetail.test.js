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
  assert.match(s.dek[0].text, /Kyle Connor scored the shootout winner/);
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

test('shorthanded goals swing momentum 1.5x more than other goals', async () => {
  const { pushes } = await import('../src/momentum.js');
  const goal = (code, owner) => ({ typeDescKey: 'goal', situationCode: code, timeInPeriod: '05:00', periodDescriptor: { number: 1, periodType: 'REG' }, details: { eventOwnerTeamId: owner, scoringPlayerId: 1 } });
  // The first goal, and goals that tie or take the lead, count more; so go two down first and score the 2-1 goal.
  const second = (code) => pushes([goal('1551', 99), goal('1551', 99), goal(code, 52)], 52, new Map()).find((x) => x.team === 'away');
  const sh = second('1451');
  const pp = second('1541');
  const ev = second('1551');
  assert.equal(sh.w, 4.5);
  assert.equal(pp.w, 3);
  assert.equal(ev.w, 3);
});

test('the first goal of the game counts 1.5x', async () => {
  const { pushes } = await import('../src/momentum.js');
  const goal = (owner) => ({ typeDescKey: 'goal', situationCode: '1551', timeInPeriod: '05:00', periodDescriptor: { number: 1, periodType: 'REG' }, details: { eventOwnerTeamId: owner, scoringPlayerId: 1 } });
  const [first, next] = pushes([goal(52), goal(99)], 52, new Map());
  assert.equal(first.w, 4.5);
  assert.equal(next.w, 3.75); // 1-1: it ties the game
});

test('goals that tie the game or take the lead count 1.25x in momentum, and the game winner is a game-score bonus only', async () => {
  const { pushes } = await import('../src/momentum.js');
  const { classifyGoals, skaterGameScore } = await import('../src/gameDetail.js');
  const goal = (owner, n) => ({ eventId: n, sortOrder: n, typeDescKey: 'goal', situationCode: '1551', timeInPeriod: '05:00', periodDescriptor: { number: 1, periodType: 'REG' }, details: { eventOwnerTeamId: owner, scoringPlayerId: n } });
  // home 1-0 (opener), away ties 1-1, away leads 2-1, home ties 2-2, away leads 3-2, away extends 4-2
  const plays = [goal(99, 1), goal(52, 2), goal(52, 3), goal(99, 4), goal(52, 5), goal(52, 6)];
  const w = pushes(plays, 52, new Map()).filter((x) => x.kind === 'goal').map((x) => x.w);
  assert.deepEqual(w, [4.5, 3.75, 3.75, 3.75, 3.75, 3]);
  const kinds = classifyGoals({ awayTeam: { id: 52 }, homeTeam: { id: 99 }, plays });
  // Away wins 4-2: its 3rd goal (the 3-2 go-ahead that was never given back) is the game winner.
  assert.deepEqual([...kinds.entries()], [[1, 'lead'], [2, 'tie'], [3, 'lead'], [4, 'tie'], [5, 'winner']]);
  const base = { goals: 1, a1: 0, a2: 0, sog: 0, blocks: 0, penaltiesDrawn: 0, penaltiesTaken: 0, fow: 0, fol: 0, plusMinus: 0 };
  assert.equal(skaterGameScore({ ...base, keyGoalBonus: 0.35 }).parts.scoring, 1.1);
});

test('expected goals: close shots are worth more than long ones, and goalies get GSAx', async () => {
  const { shotXg, goalieExpected } = await import('../src/xg.js');
  const close = shotXg({ x: 82, y: 3, shotType: 'wrist' });
  const far = shotXg({ x: 45, y: 10, shotType: 'wrist' });
  const sharp = shotXg({ x: 82, y: 30, shotType: 'wrist' });
  assert.ok(close > 0.15 && close < 0.4, `close ${close}`);
  assert.ok(far < 0.06, `far ${far}`);
  assert.ok(sharp < close);
  assert.ok(shotXg({ x: 85, y: 2, shotType: 'tip-in' }) > shotXg({ x: 85, y: 2, shotType: 'wrist' }));
  const exp = goalieExpected([
    { kind: 'sog', x: 80, y: 0, shotType: 'wrist', goalieId: 7 },
    { kind: 'goal', x: 60, y: 5, shotType: 'snap', goalieId: 7 },
    { kind: 'goal', x: 70, y: 0, goalieId: null }, // empty net: no goalie, not counted
    { kind: 'miss', x: 80, y: 0, goalieId: 7 },
  ]);
  assert.equal(exp.get(7).shots, 2);
  assert.equal(exp.get(7).goals, 1);
  assert.equal(exp.size, 1);
});

test('goalie scorecard data includes expected save percentage and GSAx', () => {
  const g = [...game.players.away.goalies, ...game.players.home.goalies].find((x) => x.shotsAgainst >= 20);
  assert.ok(g.xga > 0 && g.expectedSavePct > 0.8 && g.expectedSavePct < 1);
  assert.equal(g.gsax, Math.round((g.xga - g.goalsAgainst) * 100) / 100);
  assert.ok(Math.abs(g.savePctAboveExpected - (g.saves / g.shotsAgainst - g.expectedSavePct)) < 0.002);
});

test('the story narrative tells the arc, momentum control, the difference makers and special teams', async () => {
  const { storyBeats } = await import('../public/game/d6-narrative.js');
  const beats = storyBeats(game);
  const text = Object.fromEntries(beats.map((b) => [b.label, b.text]));
  assert.deepEqual(beats.map((b) => b.label), ['How it unfolded', 'Who controlled play', 'What decided it', 'Goaltending', 'Penalties', 'The difference', 'Special teams']);
  assert.match(text['How it unfolded'], /fought back from 4 down/);
  assert.ok(beats.every((b) => b.items.length >= 1), 'every beat has points');
  assert.match(text['Who controlled play'], /shot attempts/);
  assert.match(text['Who controlled play'], /momentum/);
  assert.match(text['The difference'], /Scheifele/);
});

test('team colors stay real brand colors: valid hex, no grey fallbacks for Utah or Colorado', async () => {
  const { teamColors } = await import('../public/game/core.js');
  const ab = ['ANA', 'CHI', 'COL', 'DET', 'MTL', 'NJD', 'OTT', 'TOR', 'UTA', 'VGK', 'WPG'];
  for (const t of ['UTA', 'COL']) {
    for (const o of ab.filter((x) => x !== t)) {
      for (const g of [{ away: { abbrev: t }, home: { abbrev: o } }, { away: { abbrev: o }, home: { abbrev: t } }]) {
        const c = teamColors(g, { dark: true });
        for (const v of [c.away, c.home]) assert.match(v, /^#[0-9a-fA-F]{6}$/);
        const mine = g.away.abbrev === t ? c.away : c.home;
        const [r, gg, b] = [1, 3, 5].map((i) => parseInt(mine.slice(i, i + 2), 16));
        assert.ok(Math.max(r, gg, b) - Math.min(r, gg, b) >= 40, `${t} vs ${o} looks grey: ${mine}`);
      }
    }
  }
});

test('a fight is not charged to the fighters and sparks the team that was behind', async () => {
  const { computeMomentum } = await import('../src/momentum.js');
  const play = (n, type, period, time, d) => ({ sortOrder: n, typeDescKey: type, periodDescriptor: { number: period, periodType: 'REG' }, timeInPeriod: time, details: d });
  const pbp = {
    rosterSpots: [{ playerId: 1, teamId: 52 }, { playerId: 2, teamId: 53 }, { playerId: 3, teamId: 52 }],
    plays: [
      // Team 53 (home) piles on shots, then two players fight.
      ...Array.from({ length: 6 }, (_, i) => play(i + 1, 'shot-on-goal', 1, `0${i}:30`, { eventOwnerTeamId: 53, shootingPlayerId: 2, xCoord: 60, yCoord: 0 })),
      play(20, 'penalty', 1, '08:00', { eventOwnerTeamId: 52, committedByPlayerId: 1, descKey: 'fighting', typeCode: 'MAJ', duration: 5 }),
      play(21, 'penalty', 1, '08:00', { eventOwnerTeamId: 53, committedByPlayerId: 2, descKey: 'fighting', typeCode: 'MAJ', duration: 5 }),
    ],
  };
  const m = computeMomentum(pbp, 52, 600);
  assert.ok(m.players[1].impact > 0, 'fighter is not charged');
  assert.equal(m.players[1].neg, 0);
  assert.ok((m.players[1].kinds.fight ?? 0) > 0);
  const before = m.series.find(([t]) => t >= 470)[1];
  const after = m.series.find(([t]) => t >= 490)[1];
  assert.ok(after < before, 'the trailing (away) team got the lift, pulling the line toward away');
});

test('penalty kinds: majors, game misconducts and misconducts are told apart from minors and fights', async () => {
  const { penaltyKind } = await import('../src/penalties.js');
  assert.equal(penaltyKind({ typeCode: 'MIN', descKey: 'tripping', duration: 2 }), 'minor');
  assert.equal(penaltyKind({ typeCode: 'MAJ', descKey: 'fighting', duration: 5 }), 'fight');
  assert.equal(penaltyKind({ typeCode: 'MAJ', descKey: 'boarding', duration: 5 }), 'major');
  assert.equal(penaltyKind({ typeCode: 'MIS', descKey: 'misconduct', duration: 10 }), 'misconduct');
  assert.equal(penaltyKind({ typeCode: 'GAM', descKey: 'game-misconduct', duration: 10 }), 'game-misconduct');
  assert.equal(penaltyKind({ typeCode: 'BEN', descKey: 'too-many-men-on-the-ice', duration: 2 }), 'bench');
});

test('a major costs far more than a minor, a game misconduct more again, and a misconduct scales with the player', async () => {
  const { computeMomentum } = await import('../src/momentum.js');
  const play = (n, type, period, time, d) => ({ sortOrder: n, typeDescKey: type, periodDescriptor: { number: period, periodType: 'REG' }, timeInPeriod: time, details: d });
  const roster = [{ playerId: 1, teamId: 52 }, { playerId: 2, teamId: 53 }];
  const run = (extra) => computeMomentum({ rosterSpots: roster, plays: [
    // Player 1 (away) piles up momentum first, so a misconduct costs more.
    ...Array.from({ length: 8 }, (_, i) => play(i + 1, 'shot-on-goal', 1, `0${i}:30`, { eventOwnerTeamId: 52, shootingPlayerId: 1, xCoord: 60, yCoord: 0 })),
    ...extra,
  ] }, 52, 900).players[1];
  const pen = (typeCode, descKey, duration) => [play(30, 'penalty', 1, '09:00', { eventOwnerTeamId: 52, committedByPlayerId: 1, drawnByPlayerId: 2, typeCode, descKey, duration })];
  const minor = run(pen('MIN', 'tripping', 2));
  const major = run(pen('MAJ', 'boarding', 5));
  const gm = run(pen('GAM', 'game-misconduct', 10));
  const mis = run(pen('MIS', 'misconduct', 10));
  assert.ok(major.neg < minor.neg, 'a major hurts more than a minor');
  assert.ok(gm.neg < 0, 'a game misconduct dings the player');
  assert.ok(mis.neg < 0 && mis.neg > major.neg, 'a misconduct dings the player, but far less than a major');
  const calm = computeMomentum({ rosterSpots: roster, plays: pen('MIS', 'misconduct', 10) }, 52, 900).players[1];
  assert.ok(mis.neg < calm.neg, 'costs more for a player who was driving the game');
});

test('decisive penalties: a power-play goal, a swing, or a goal right after expiry', async () => {
  const { decisivePenalties } = await import('../public/game/d6-penalties.js');
  const game = {
    away: { abbrev: 'AAA', commonName: 'Aa' }, home: { abbrev: 'BBB', commonName: 'Bb' },
    penalties: [
      { team: 'AAA', period: '1', time: '5:00', player: 'X', infraction: 'Tripping', minutes: 2, kind: 'minor' },
      { team: 'AAA', period: '1', time: '12:00', player: 'Y', infraction: 'Hooking', minutes: 2, kind: 'minor' },
      { team: 'BBB', period: '2', time: '1:00', player: 'Z', infraction: 'Slashing', minutes: 2, kind: 'minor' },
    ],
    scoring: [
      { team: 'BBB', period: '1', time: '6:10', scorer: { name: 'S' }, periodName: '1st period' },
      { team: 'AAA', period: '1', time: '14:05', scorer: { name: 'T' }, periodName: '1st period' },
    ],
    momentum: { powerPlays: [{ team: 'home', start: 300, end: 370, result: 'goal' }, { team: 'home', start: 720, end: 840, result: 'killed' }], swings: [], series: [], max: 1 },
  };
  const m = [...decisivePenalties(game)];
  assert.equal(m.length, 2);
  assert.equal(m[0][1][0].kind, 'pp-goal');
  assert.equal(m[1][0].player, 'Y');
  assert.equal(m[1][1][0].kind, 'expiry'); // 12:00 + 2:00 = 14:00; goal at 14:05
});

test('shot attempts count shots, misses and blocks per team', async () => {
  const { shotAttempts } = await import('../src/sat.js');
  const play = (type, owner, shooter) => ({ typeDescKey: type, periodDescriptor: { number: 1, periodType: 'REG' }, timeInPeriod: '01:00', details: { eventOwnerTeamId: owner, shootingPlayerId: shooter, xCoord: 60, yCoord: 5 } });
  const pbp = {
    awayTeam: { id: 1 },
    rosterSpots: [{ playerId: 10, teamId: 1, firstName: { default: 'A' }, lastName: { default: 'A' } }, { playerId: 20, teamId: 2, firstName: { default: 'B' }, lastName: { default: 'B' } }],
    plays: [play('shot-on-goal', 1, 10), play('missed-shot', 1, 10), play('blocked-shot', 1, 10), play('shot-on-goal', 2, 20)],
  };
  assert.deepEqual(shotAttempts(pbp), { away: 3, home: 1 });
});

test('How it unfolded lists goals period by period with the running score', async () => {
  const { storyBeats } = await import('../public/game/d6-narrative.js');
  const arc = storyBeats(game)[0];
  assert.ok(arc.periods.length >= 3);
  const goalRows = arc.periods.flatMap((p) => p.items.filter((e) => e.goal));
  assert.equal(goalRows.length, game.scoring.filter((g) => g.period !== 'SO').length);
  assert.match(goalRows[0].text, /opened the scoring/);
  assert.match(goalRows.at(-1).score, /\d – \d/);
});

test('team stats include momentum and time in control', () => {
  const m = game.teamStats.find((s) => s.key === 'momentum');
  const c = game.teamStats.find((s) => s.key === 'momentumControl');
  assert.ok(m && c);
  assert.equal(m.awayNum, game.momentum.totals.away);
  assert.match(c.away, /^\d+ min$/);
});

test('goaltending story: a starter replaced after a rough start, and a goalie with a quiet or fantastic night', async () => {
  const { goaltending } = await import('../public/game/d6-narrative.js');
  const goalie = (name, o) => ({ fullName: name, starter: false, played: true, toi: '20:00', toiSeconds: 1200, saves: 0, shotsAgainst: 0, goalsAgainst: 0, gsax: 0, ...o });
  const game = {
    status: { state: 'final', label: 'Final' },
    away: { abbrev: 'AAA', commonName: 'Aces' }, home: { abbrev: 'HHH', commonName: 'Hawks' },
    linescore: { totals: { away: 4, home: 3 }, periods: [] },
    players: {
      away: { goalies: [goalie('Pat Starter', { toiSeconds: 610, saves: 2, shotsAgainst: 5, goalsAgainst: 3, gsax: -2.5 }), goalie('Sam Backup', { toiSeconds: 3000, saves: 20, shotsAgainst: 28, goalsAgainst: 8, gsax: -1.4 })] },
      home: { goalies: [goalie('Chris Wall', { toiSeconds: 3600, saves: 30, shotsAgainst: 31, goalsAgainst: 1, gsax: 1.8 })] },
    },
    penalties: [], scoring: [], momentum: null, teamStats: [],
  };
  const text = goaltending(game, true).join(' ');
  assert.match(text, /Pat Starter was replaced by Sam Backup in the Aces' net at 10:10 of the 1st period, after allowing 3 goals on 5 shots/);
  assert.match(text, /The change did not help/);
  assert.match(text, /Chris Wall was outstanding in the Hawks' net/);
});

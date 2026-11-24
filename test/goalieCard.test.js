import test from 'node:test';
import assert from 'node:assert/strict';
import { radarPoints, leagueGoalies, rankAmong, teamGameIds, startFromGame, summarize, median } from '../src/goalieCard.js';

const g = (id, o = {}) => ({ n: `G${id}`, t: 'AAA', p: 'G', gp: 10, gs: 10, ga: 25, xga: 22, sa: 300, sg: 25, psa: 100, pga: 15, osa: 200, oga: 10, sf: 2, q: Array.from({ length: 10 }, (_, i) => (i < 5 ? [25, 1] : [25, 4])), ...o });
const total = { season: 20262027, gameType: 2, games: 2, g: [[1, 'AAA', 'BBB', 3, 2, 0, 0, 0, 0, 0, 0, 'REG', 11, 22], [2, 'CCC', 'AAA', 1, 2, 0, 0, 0, 0, 0, 0, 'REG', 33, 11]], players: { 11: g(11), 12: g(12, { ga: 40, sg: 40 }), 13: g(13, { gs: 2 }) } };

test('league table keeps goalies with enough starts and a league QS%', () => {
  const lg = leagueGoalies(total);
  assert.deepEqual(lg.rows.map((r) => r.id).sort(), [11, 12]);
  assert.ok(lg.lgQsPct > 0 && lg.lgQsPct < 1);
  assert.ok(lg.rows[0].softPer != null && lg.inRate > 0.1);
});

test('rankAmong ranks best first and skips nulls', () => {
  assert.deepEqual(rankAmong([1, 2, 3, null], 3), { rank: 1, of: 3, tied: false });
  assert.deepEqual(rankAmong([3, 3, 1], 3), { rank: 1, of: 3, tied: true });
  assert.deepEqual(rankAmong([1, 2, 3], 1, false), { rank: 1, of: 3, tied: false });
  assert.equal(rankAmong([1, 2], null), null);
  assert.equal(median([3, 1, 2]), 2);
});

test('team game ids come from the season rows, with the starter', () => {
  assert.deepEqual(teamGameIds(total, 'AAA'), [{ id: '2026020001', starter: 11 }, { id: '2026020002', starter: 11 }]);
  assert.deepEqual(teamGameIds({ ...total, gameType: 3 }, 'AAA'), []);
});

test('a start is built from the game file: clips matched by period and time, plate and soft flags', () => {
  const game = {
    id: 2026020001, gameDate: '2026-10-01', away: { abbrev: 'CHI' }, home: { abbrev: 'UTA' },
    scoring: [{ period: '2', time: '5:00', highlightId: '999', highlight: 'https://nhl.com/video/x', scorer: { fullName: 'A Shooter' } }],
    shots: [
      { team: 'away', kind: 'sog', x: 75, y: 2, goalieId: 11, shotType: 'wrist', period: '1', time: '1:00' },
      { team: 'away', kind: 'goal', x: 40, y: 30, goalieId: 11, shotType: 'wrist', period: '2', time: '5:00' },
      { team: 'away', kind: 'sog', x: 60, y: 0, goalieId: 99, shotType: 'wrist', period: '2', time: '6:00' },
      { team: 'away', kind: 'block', x: 60, y: 0, goalieId: 11, period: '2', time: '7:00' },
    ],
  };
  const s = startFromGame(game, 11, 1, 0.9);
  assert.equal(s.sa, 2);
  assert.equal(s.ga, 1);
  assert.equal(s.opp, 'CHI');
  assert.equal(s.home, true);
  assert.equal(s.goals[0].clipId, '999');
  assert.equal(s.goals[0].scorer, 'A Shooter');
  assert.equal(s.goals[0].inside, false);
  assert.equal(s.goals[0].soft, true); // wide, far shot: worth under 6%
  assert.equal(s.shots[0].inside, true);
  const sum = summarize([s]);
  assert.equal(sum.inSa, 1);
  assert.equal(sum.outGa, 1);
  assert.equal(sum.soft, 1);
  assert.equal(startFromGame(game, 5), null);
});

test('spider percentiles rank him among league goalies, soft goals flipped', async () => {
  const lg = { rows: [1, 2, 3, 4, 5].map((i) => ({ id: i, gsaxPerGame: i, sv: i / 10, qsPct: i / 10, inSv: i / 10, outSv: i / 10, softPer: 5 - i })) };
  const best = radarPoints(lg, 5);
  assert.equal(best.length, 6);
  assert.ok(best.every((p) => p.pct === 100));
  const worst = radarPoints(lg, 1);
  assert.ok(worst.every((p) => p.pct === 0));
  assert.deepEqual(radarPoints(lg, 99), []);
});

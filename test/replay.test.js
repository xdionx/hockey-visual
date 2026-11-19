import { test } from 'node:test';
import assert from 'node:assert/strict';
import { sliceRaw, replayDuration } from '../src/replay.js';
import { normalizeGameDetail } from '../src/gameDetail.js';

const per = (n) => ({ number: n, periodType: 'REG', maxRegulationPeriods: 3 });
const play = (eventId, n, time, typeDescKey, details) => ({ eventId, periodDescriptor: per(n), timeInPeriod: time, timeRemaining: '00:00', typeDescKey, situationCode: '1551', details });
const skater = (id) => ({ playerId: id, sweaterNumber: id, name: { default: `P${id}` }, position: 'C', goals: 0, assists: 0, points: 0, plusMinus: 0, pim: 0, hits: 0, powerPlayGoals: 0, sog: 0, toi: '20:00', blockedShots: 0, shifts: 20, giveaways: 0, takeaways: 0 });
const goalie = (id, toi) => ({ playerId: id, sweaterNumber: id, name: { default: `G${id}` }, position: 'G', starter: true, toi, shotsAgainst: 1, saves: 0, goalsAgainst: 1 });
const raw = {
  box: {
    id: 1, gameType: 2, gameDate: '2026-11-18', gameState: 'OFF', periodDescriptor: per(3), clock: { timeRemaining: '00:00', inIntermission: false },
    awayTeam: { id: 1, abbrev: 'AAA', score: 1, sog: 1, placeName: { default: 'A' }, commonName: { default: 'Aa' } },
    homeTeam: { id: 2, abbrev: 'BBB', score: 0, sog: 0, placeName: { default: 'B' }, commonName: { default: 'Bb' } },
    playerByGameStats: { awayTeam: { forwards: [skater(10)], defense: [], goalies: [goalie(11, '60:00')] }, homeTeam: { forwards: [skater(20)], defense: [], goalies: [goalie(21, '60:00')] } },
  },
  landing: { summary: { scoring: [{ periodDescriptor: per(2), goals: [{ eventId: 3, strength: 'ev', teamAbbrev: { default: 'AAA' }, timeInPeriod: '05:00', name: { default: 'P10' }, assists: [] }] }], penalties: [], threeStars: [{ star: 1, playerId: 10, name: { default: 'P10' } }] } },
  rightRail: {},
  pbp: {
    rosterSpots: [{ playerId: 10, firstName: { default: 'A' }, lastName: { default: 'One' }, teamId: 1 }, { playerId: 20, firstName: { default: 'B' }, lastName: { default: 'Two' }, teamId: 2 }],
    plays: [
      play(1, 1, '00:00', 'faceoff', { eventOwnerTeamId: 1, winningPlayerId: 10, losingPlayerId: 20 }),
      play(2, 1, '10:00', 'hit', { eventOwnerTeamId: 2, hittingPlayerId: 20 }),
      play(3, 2, '05:00', 'goal', { eventOwnerTeamId: 1, scoringPlayerId: 10, goalieInNetId: 21 }),
      play(4, 3, '20:00', 'period-end', {}),
    ],
  },
};

test('replay duration is the end of the last non-shootout period', () => {
  assert.equal(replayDuration(raw), 2 * 1200 + 1200);
});

test('before the goal: 0-0, live, no goals listed, no three stars', () => {
  const g = normalizeGameDetail(sliceRaw(raw, 1300));
  assert.equal(g.status.state, 'live');
  assert.equal(g.away.score, 0);
  assert.equal(g.scoring.length, 0);
  assert.equal(g.threeStars.length, 0);
  assert.equal(g.players.home.forwards[0].hits, 1);
});

test('after the goal: 1-0, scorer credited, goalie charged', () => {
  const g = normalizeGameDetail(sliceRaw(raw, 1200 + 400));
  assert.equal(g.away.score, 1);
  assert.equal(g.scoring.length, 1);
  assert.equal(g.players.away.forwards[0].goals, 1);
  assert.equal(g.players.home.goalies[0].goalsAgainst, 1);
});

test('at the end the finished game is returned untouched', () => {
  assert.equal(sliceRaw(raw, 99999), raw);
});

test('slicing never changes the raw data', () => {
  const before = JSON.stringify(raw);
  sliceRaw(raw, 1300);
  assert.equal(JSON.stringify(raw), before);
});

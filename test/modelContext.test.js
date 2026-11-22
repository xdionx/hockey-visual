import { test } from 'node:test';
import assert from 'node:assert/strict';
import { contextModel } from '../src/modelContext.js';

const game = (date, away, home, plays = []) => ({ gameDate: date, awayTeam: { id: away }, homeTeam: { id: home }, plays });
const shot = (team, goalie, shooter, goal = false) => ({ typeDescKey: goal ? 'goal' : 'shot-on-goal', periodDescriptor: { number: 1, periodType: 'REG' }, timeInPeriod: '01:00',
  details: { eventOwnerTeamId: team, goalieInNetId: goalie, shootingPlayerId: goal ? undefined : shooter, scoringPlayerId: goal ? shooter : undefined, xCoord: 80, yCoord: 0, shotType: 'wrist' } });

test('a team on the second night of a back-to-back is marked down before the game', () => {
  const m = contextModel();
  m.learn(game('2026-11-01', 1, 2));
  assert.ok(m.pregame(game('2026-11-02', 1, 3)) < 0); // away team 1 played yesterday
  assert.ok(m.pregame(game('2026-11-02', 3, 2)) > 0); // home team 2 played yesterday
  assert.equal(m.pregame(game('2026-11-04', 1, 2)), 0);
});

test('shots by a player who has finished above expected count more; unknown players count 1x', () => {
  const m = contextModel();
  m.learn(game('2026-11-01', 1, 2, Array.from({ length: 20 }, () => shot(1, 99, 7, true))));
  assert.ok(m.shotMult({ credits: [{ id: 7 }] }) > 1);
  assert.equal(m.shotMult({ credits: [{ id: 8 }] }), 1);
});

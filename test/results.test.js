import { test } from 'node:test';
import assert from 'node:assert/strict';
import { gameEnd, resultLabel, decisionLabel } from '../public/game/core.js';
import { streakLabel } from '../public/game/d6-pregame.js';

const game = (...labels) => ({ linescore: { periods: labels.map((label) => ({ label })) } });

test('gameEnd reads the line score', () => {
  assert.equal(gameEnd(game('1', '2', '3')), 'REG');
  assert.equal(gameEnd(game('1', '2', '3', 'OT')), 'OT');
  assert.equal(gameEnd(game('1', '2', '3', 'OT', '2OT')), 'OT');
  assert.equal(gameEnd(game('1', '2', '3', 'OT', 'SO')), 'SO');
});

test('results use W/L, OTW/OTL and SOW/SOL', () => {
  assert.equal(resultLabel('W', 'REG'), 'W');
  assert.equal(resultLabel('L', 'REG'), 'L');
  assert.equal(resultLabel('W', 'OT'), 'OTW');
  assert.equal(resultLabel('O', 'OT'), 'OTL');
  assert.equal(resultLabel('W', 'SO'), 'SOW');
  assert.equal(resultLabel('O', 'SO'), 'SOL');
  assert.equal(resultLabel(null, 'SO'), null);
  assert.equal(decisionLabel(game('1', '2', '3', 'OT', 'SO'), 'O'), 'SOL');
});

test('streak names overtime and shootout loss runs', () => {
  assert.equal(streakLabel({ streak: 'W3', results: ['W', 'OTW', 'SOW'] }), 'W3');
  assert.equal(streakLabel({ streak: 'O1', results: ['SOL', 'L'] }), 'SOL 1');
  assert.equal(streakLabel({ streak: 'O2', results: ['OTL', 'OTL', 'W'] }), 'OTL 2');
  assert.equal(streakLabel({ streak: 'O2', results: ['OTL', 'SOL', 'W'] }), 'OTL/SOL 2');
  assert.equal(streakLabel({ streak: null }), null);
});

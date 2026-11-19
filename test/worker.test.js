import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ttlFor, scoreboardTtl } from '../worker/index.js';

test('cache rules: live 5s, not started 60s, yesterday 1h, 2+ days old cached for good', () => {
  assert.equal(ttlFor('live', '2026-11-18', '2026-11-18'), 5);
  assert.equal(ttlFor('pre', '2026-11-18', '2026-11-18'), 60);
  assert.equal(ttlFor('final', '2026-11-18', '2026-11-18'), 3600);
  assert.equal(ttlFor('final', '2026-11-17', '2026-11-18'), 3600);
  assert.equal(ttlFor('final', '2026-11-16', '2026-11-18'), 30 * 86400);
});

test('a date with any live game refreshes every 5 seconds', () => {
  const board = (states) => ({ date: '2026-11-18', games: states.map((state) => ({ status: { state } })) });
  assert.equal(scoreboardTtl(board(['final', 'live', 'pre']), '2026-11-18'), 5);
  assert.equal(scoreboardTtl(board(['final', 'pre']), '2026-11-18'), 60);
  assert.equal(scoreboardTtl(board(['final']), '2026-11-17'), 3600);
});

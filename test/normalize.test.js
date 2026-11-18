import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { normalizeScoreboard, periodLabel } from '../src/normalize.js';

const raw = JSON.parse(readFileSync(new URL('./fixtures/score-sample.json', import.meta.url)));
const board = normalizeScoreboard(raw);
const byId = (id) => board.games.find((g) => g.id === id);

test('period labels', () => {
  assert.equal(periodLabel({ number: 2, periodType: 'REG', maxRegulationPeriods: 3 }), '2');
  assert.equal(periodLabel({ number: 4, periodType: 'OT', maxRegulationPeriods: 3 }), 'OT');
  assert.equal(periodLabel({ number: 6, periodType: 'OT', maxRegulationPeriods: 3 }), '3OT');
  assert.equal(periodLabel({ number: 5, periodType: 'SO', maxRegulationPeriods: 3 }), 'SO');
});

test('regulation final has 3 periods that sum to the score', () => {
  const g = byId(2026020321); // SEA 1 @ CAR 5
  assert.equal(g.status.label, 'Final');
  assert.deepEqual(g.linescore.periods.map((p) => p.label), ['1', '2', '3']);
  const sum = (side) => g.linescore.periods.reduce((n, p) => n + p[side], 0);
  assert.equal(sum('away'), g.linescore.totals.away);
  assert.equal(sum('home'), g.linescore.totals.home);
});

test('shootout final matches the official linescore (0-3, 2-1, 2-0, 0-0, SO 1-0)', () => {
  const g = byId(2026020312); // WPG 5 @ CHI 4
  assert.equal(g.status.label, 'Final/SO');
  assert.deepEqual(
    g.linescore.periods.map((p) => [p.label, p.away, p.home]),
    [['1', 0, 3], ['2', 2, 1], ['3', 2, 0], ['OT', 0, 0], ['SO', 1, 0]],
  );
  assert.deepEqual(g.linescore.totals, { away: 5, home: 4 });
});

test('overtime final shows an OT column', () => {
  const g = byId(2026020327); // FLA 1 @ DAL 2 OT
  assert.equal(g.status.label, 'Final/OT');
  assert.equal(g.linescore.periods.at(-1).label, 'OT');
  assert.equal(g.goals.at(-1).periodName, 'Overtime');
});

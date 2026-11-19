import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { normalizeGame, normalizeScoreboard, nhlVideoUrl, periodLabel, videoId } from '../src/normalize.js';

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

test('goal highlight and game video links point at nhl.com video pages', () => {
  const g = normalizeGame({
    id: 1, awayTeam: { abbrev: 'MTL', name: { default: 'Canadiens' } }, homeTeam: { abbrev: 'NYR', name: { default: 'Rangers' } },
    gameState: 'OFF', periodDescriptor: { number: 3, periodType: 'REG' },
    threeMinRecap: '/video/mtl-at-nyr-recap-6408478745112',
    condensedGame: '/video/mtl-at-nyr-condensed-game-6408479231112',
    goals: [
      { periodDescriptor: { number: 2, periodType: 'REG' }, timeInPeriod: '07:59', teamAbbrev: 'MTL', name: { default: 'P. Danault' },
        highlightClipSharingUrl: 'https://nhl.com/video/mtl-nyr-danault-scores-goal-against-joonas-korpisalo-6408476888112', highlightClip: 6408476888112 },
      { periodDescriptor: { number: 3, periodType: 'REG' }, timeInPeriod: '01:00', teamAbbrev: 'NYR', name: { default: 'A. Panarin' } },
    ],
  });
  assert.equal(g.goals[0].highlight, 'https://www.nhl.com/video/mtl-nyr-danault-scores-goal-against-joonas-korpisalo-6408476888112');
  assert.equal(g.goals[0].highlightId, '6408476888112');
  assert.equal(g.goals[1].highlight, null);
  assert.equal(g.goals[1].highlightId, null);
  assert.equal(g.video.recapId, '6408478745112');
  assert.equal(g.video.condensedId, '6408479231112');
  assert.equal(g.video.recap, 'https://www.nhl.com/video/mtl-at-nyr-recap-6408478745112');
  assert.equal(g.video.condensed, 'https://www.nhl.com/video/mtl-at-nyr-condensed-game-6408479231112');
});

test('video links outside nhl.com are dropped', () => {
  assert.equal(nhlVideoUrl('javascript:alert(1)'), null);
  assert.equal(nhlVideoUrl('https://evil.example/video/x'), null);
  assert.equal(nhlVideoUrl('http://nhl.com/video/x'), 'https://www.nhl.com/video/x');
  assert.equal(nhlVideoUrl(undefined), null);
});

test('video ids come from the id field or the URL tail, digits only', () => {
  assert.equal(videoId(6408476888112, null), '6408476888112');
  assert.equal(videoId(null, '/video/x-recap-6408478745112'), '6408478745112');
  assert.equal(videoId('6408"><script>', '/video/nope'), null);
});

test('strength of play', async () => {
  const { strengthOf } = await import('../src/strength.js');
  assert.equal(strengthOf({ period: '2' }).label, '5v5');
  assert.equal(strengthOf({ period: 'OT', gameType: 2 }).label, '3v3');
  const pp = strengthOf({ period: '1', situation: { situationCode: '1451', timeRemaining: '01:45' } });
  assert.deepEqual([pp.label, pp.kind, pp.pp, pp.remaining], ['4v5', 'pp', 'home', '1:45']);
  const en = strengthOf({ period: '3', code: '0651' });
  assert.deepEqual([en.label, en.kind, en.emptyNet], ['6v5', 'empty-net', 'away']);
  assert.equal(strengthOf({ period: '2', intermission: true }), null);
});

test('stamp-assets adds a version to local imports, scripts and stylesheets only', async () => {
  const { stampJs, stampHtml } = await import('../scripts/stamp-assets.js');
  assert.equal(stampJs("import { a } from './core.js';\nimport b from '../x/y.js';\nconst m = import('./lazy.js');", 'abc'),
    "import { a } from './core.js?v=abc';\nimport b from '../x/y.js?v=abc';\nconst m = import('./lazy.js?v=abc');");
  assert.equal(stampJs("import x from 'https://cdn.example/x.js';", 'abc'), "import x from 'https://cdn.example/x.js';");
  assert.equal(stampHtml('<link rel="stylesheet" href="game/game.css"><script type="module" src="game/game.js"></script><link href="https://fonts.googleapis.com/css2?family=X">', 'abc'),
    '<link rel="stylesheet" href="game/game.css?v=abc"><script type="module" src="game/game.js?v=abc"></script><link href="https://fonts.googleapis.com/css2?family=X">');
});

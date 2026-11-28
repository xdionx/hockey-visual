import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildStandings, playoffField, normalizeStandings } from '../src/standings.js';

const mk = (a, conf, div, pts, gp = 2, seq = 1) => ({
  teamAbbrev: { default: a }, teamName: { default: `${a} Team` }, teamCommonName: { default: a }, conferenceAbbrev: conf, divisionAbbrev: div, divisionName: div,
  gamesPlayed: gp, wins: pts / 2, losses: gp - pts / 2, otLosses: 0, points: pts, pointPctg: pts / (2 * gp), regulationPlusOtWins: pts / 2, regulationWins: pts / 2,
  goalFor: 5, goalAgainst: 5, goalDifferential: 0, homeWins: 0, homeLosses: 0, homeOtLosses: 0, roadWins: 0, roadLosses: 0, roadOtLosses: 0, l10Wins: 0, l10Losses: 0, l10OtLosses: 0,
  streakCode: 'W', streakCount: 1, divisionSequence: seq, conferenceSequence: seq, leagueSequence: seq, wildcardSequence: 0, teamLogo: '', teamLogoDark: '',
});

test('playoff field is the top 3 of each division plus two wild cards', () => {
  // East: two divisions of four teams, points descending within a division; 8 qualify.
  const teams = [];
  for (const [d, base] of [['A', 20], ['M', 10]]) for (let i = 0; i < 4; i++) teams.push({ a: `${d}${i}`, conf: 'E', div: d, pts: base - i });
  const f = playoffField(teams, (t) => t.pts);
  assert.equal(f.field.size, 6 + 2);
  assert.deepEqual(f.division.A.slice(0, 3), ['A0', 'A1', 'A2']);
  assert.deepEqual(f.wildcard.E.slice(0, 2), ['A3', 'M3']); // best of the rest: 17 (A3) then 7 (M3)
});

test('standings rows are normalised', () => {
  const [t] = normalizeStandings({ standings: [mk('AAA', 'E', 'A', 4)] });
  assert.equal(t.a, 'AAA'); assert.equal(t.pts, 4); assert.equal(t.strk, 'W1');
});

test('projection: odds are probabilities, finish shares add to 1, a runaway leader is a lock', () => {
  const east = [['AAA', 'A', 40], ['BBB', 'A', 30], ['CCC', 'A', 20], ['DDD', 'A', 10], ['EEE', 'M', 38], ['FFF', 'M', 28], ['GGG', 'M', 18], ['HHH', 'M', 8]];
  const standings = { standings: east.map(([a, d, p], i) => mk(a, 'E', d, p, 2, i + 1)) };
  const sched = {};
  const abbrs = east.map((e) => e[0]);
  let id = 1;
  for (const a of abbrs) sched[a] = [];
  for (let day = 0; day < 6; day++) {
    for (let i = 0; i < abbrs.length; i += 2) {
      const [h, aw] = day % 2 ? [abbrs[i], abbrs[i + 1]] : [abbrs[i + 1], abbrs[i]];
      const g = { id: id++, date: `2026-12-0${day + 1}`, home: h, away: aw };
      sched[h].push(g); sched[aw].push(g);
    }
  }
  // each team has 6 scheduled games; make the first 2 "played" by padding gp to 2 and trimming past games
  for (const a of abbrs) sched[a] = [{ id: -1, date: '2026-11-01', home: a, away: a }, { id: -2, date: '2026-11-02', home: a, away: a }, ...sched[a]];
  const out = buildStandings({ standings, sched, total: { season: 20262027, g: [], players: {} }, today: '2026-12-01', sims: 500, seed: 1 });
  assert.equal(out.teams.length, 8);
  assert.equal(out.games, 24);
  for (const t of out.teams) {
    assert.ok(t.po >= 0 && t.po <= 1);
    assert.ok(Math.abs(t.pos.reduce((n, x) => n + x, 0) - t.po) < 0.002, `${t.a} finish shares must equal playoff odds`);
    assert.equal(t.left, 6);
    assert.ok(t.p10 <= t.med && t.med <= t.p90);
  }
  const total = out.teams.reduce((n, t) => n + t.po, 0);
  assert.ok(Math.abs(total - 8) < 0.001); // 8 spots per conference... 3+3+2
  assert.ok(out.teams.find((t) => t.a === 'AAA').po > 0.99);
});

// Standings page data: the NHL's standings plus our projection for every team.
//
//   buildStandings({ standings, sched, total, prev, today, sims })
//
// Pure (no fetching). `standings` is api-web.nhle.com/v1/standings/now, `sched` is { TEAM: [{ id, date, home, away }] }
// (each team's regular-season schedule, in date order), `total`/`prev` are this and last season's totals
// (src/seasonStats.js). Every remaining game gets a win chance from the pre-game pick model (src/predict.js: v4 momentum
// share, probable goalie, back-to-back), then the rest of the season is played out `sims` times to get playoff odds,
// where each team finishes in its division, and the likely first-round opponents. Backtested over 2021-26: see
// docs or the thread notes (Brier .096 vs .109 for a points-percentage baseline).
import { predictGame } from './predict.js';

const HOME_ICE = 0.535; // fallback win chance for the home team before the model has enough games

/** One team per row, in the NHL's own order and with its own sequence numbers. */
export function normalizeStandings(json) {
  return (json?.standings ?? []).map((t) => ({
    a: t.teamAbbrev.default,
    name: t.teamName.default,
    common: t.teamCommonName?.default ?? t.teamName.default,
    conf: t.conferenceAbbrev,
    div: t.divisionAbbrev,
    divName: t.divisionName,
    gp: t.gamesPlayed, w: t.wins, l: t.losses, otl: t.otLosses, pts: t.points,
    pct: t.pointPctg, row: t.regulationPlusOtWins, rw: t.regulationWins,
    gf: t.goalFor, ga: t.goalAgainst, diff: t.goalDifferential,
    home: `${t.homeWins}-${t.homeLosses}-${t.homeOtLosses}`,
    road: `${t.roadWins}-${t.roadLosses}-${t.roadOtLosses}`,
    l10: `${t.l10Wins}-${t.l10Losses}-${t.l10OtLosses}`,
    strk: t.streakCode ? `${t.streakCode}${t.streakCount}` : '',
    divSeq: t.divisionSequence, confSeq: t.conferenceSequence, leagueSeq: t.leagueSequence, wcSeq: t.wildcardSequence,
    logo: t.teamLogo, darkLogo: t.teamLogoDark,
  }));
}

/** Playoff field: top 3 in each division, then the next 2 in the conference. `key(team)` orders teams (higher is better). */
export function playoffField(teams, key) {
  const out = { division: {}, wildcard: {}, field: new Set() };
  for (const c of [...new Set(teams.map((t) => t.conf))]) {
    const inConf = teams.filter((t) => t.conf === c);
    const divs = {};
    for (const t of inConf) (divs[t.div] ??= []).push(t);
    const top = new Set();
    for (const [d, ts] of Object.entries(divs)) {
      ts.sort((x, y) => key(y) - key(x));
      out.division[d] = ts.map((t) => t.a);
      ts.slice(0, 3).forEach((t) => top.add(t));
    }
    const wc = inConf.filter((t) => !top.has(t)).sort((x, y) => key(y) - key(x));
    out.wildcard[c] = wc.map((t) => t.a);
    for (const t of [...top, ...wc.slice(0, 2)]) out.field.add(t.a);
  }
  return out;
}

function rng(seed) { // mulberry32
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6D2B79F5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const dayBefore = (d) => new Date(Date.parse(`${d}T12:00:00Z`) - 864e5).toISOString().slice(0, 10);
const r4 = (x) => Math.round(x * 10000) / 10000;

export function buildStandings({ standings, sched, total, prev = null, today, sims = 10000, seed = 20262027 }) {
  const teams = normalizeStandings(standings);
  const by = Object.fromEntries(teams.map((t) => [t.a, t]));
  const rand = rng(seed);
  // League rates from the standings: share of losses that reach overtime, share of wins that are regulation or OT.
  const losses = teams.reduce((n, t) => n + t.l + t.otl, 0) || 1;
  const OTL = teams.reduce((n, t) => n + t.otl, 0) / losses;
  const wins = teams.reduce((n, t) => n + t.w, 0) || 1;
  const ROW = teams.reduce((n, t) => n + t.row, 0) / wins;

  // Games each team still has to play: its schedule minus the games it has played (standings GP).
  const remainingFor = {};
  const playedDays = {};
  for (const t of teams) {
    const gs = sched[t.a] ?? [];
    remainingFor[t.a] = new Map(gs.slice(t.gp).map((g) => [g.id, g]));
    playedDays[t.a] = new Set(gs.map((g) => g.date));
  }
  const games = [];
  const seen = new Set();
  for (const t of teams) {
    for (const g of remainingFor[t.a].values()) {
      if (seen.has(g.id)) continue;
      seen.add(g.id);
      if (!by[g.home] || !by[g.away] || !remainingFor[g.home].has(g.id) || !remainingFor[g.away].has(g.id)) continue;
      const b2b = { away: playedDays[g.away].has(dayBefore(g.date)), home: playedDays[g.home].has(dayBefore(g.date)) };
      const p = predictGame({ total, prev, away: g.away, home: g.home, b2b });
      games.push({ ...g, b2b, pHome: p ? p.home : HOME_ICE, modeled: Boolean(p) });
    }
  }

  // Model inputs worth showing: season momentum share and the probable goalie.
  const share = {};
  for (const r of total?.g ?? []) {
    for (const [t, f, a] of [[r[1], r[7], r[8]], [r[2], r[8], r[7]]]) {
      if (f == null || a == null) continue;
      const o = (share[t] ??= [0, 0]);
      o[0] += f; o[1] += a;
    }
  }
  const shareOf = (a) => (share[a] ? share[a][0] / (share[a][0] + share[a][1]) : 0.5);

  const info = {};
  for (const t of teams) info[t.a] = { rem: [], ptsExp: 0 };
  for (const g of games) {
    info[g.home].rem.push({ opp: g.away, home: true, b2b: g.b2b.home, p: g.pHome });
    info[g.away].rem.push({ opp: g.home, home: false, b2b: g.b2b.away, p: 1 - g.pHome });
  }

  // Play out the rest of the season.
  const cnt = {};
  for (const t of teams) cnt[t.a] = { po: 0, pos: [0, 0, 0, 0, 0], pts: [], opp: {} };
  const pair = (x, y) => { cnt[x].opp[y] = (cnt[x].opp[y] ?? 0) + 1; cnt[y].opp[x] = (cnt[y].opp[x] ?? 0) + 1; };
  const pts = {}; const row = {}; const jit = {};
  for (let i = 0; i < sims; i++) {
    for (const t of teams) { pts[t.a] = t.pts; row[t.a] = t.row; }
    for (const g of games) {
      const homeWins = rand() < g.pHome;
      const w = homeWins ? g.home : g.away;
      const l = homeWins ? g.away : g.home;
      pts[w] += 2;
      if (rand() < ROW) row[w]++;
      if (rand() < OTL) pts[l]++;
    }
    for (const t of teams) jit[t.a] = rand() / 1e6;
    const f = playoffField(teams, (t) => pts[t.a] + row[t.a] / 1000 + jit[t.a]);
    for (const [d, order] of Object.entries(f.division)) order.slice(0, 3).forEach((a, k) => cnt[a].pos[k]++);
    for (const order of Object.values(f.wildcard)) order.slice(0, 2).forEach((a, k) => cnt[a].pos[3 + k]++);
    for (const a of f.field) cnt[a].po++;
    for (const t of teams) cnt[t.a].pts.push(pts[t.a]);
    // Round 1: better division winner v 2nd wild card, other winner v 1st wild card, 2nd v 3rd in each division.
    for (const c of Object.keys(f.wildcard)) {
      const winners = Object.entries(f.division).filter(([d]) => by[f.division[d][0]].conf === c).map(([, o]) => o[0]).sort((x, y) => (pts[y] + row[y] / 1000 + jit[y]) - (pts[x] + row[x] / 1000 + jit[x]));
      const wc = f.wildcard[c];
      if (winners.length === 2 && wc.length >= 2) { pair(winners[0], wc[1]); pair(winners[1], wc[0]); }
      for (const [d, o] of Object.entries(f.division)) if (by[o[0]].conf === c && o.length >= 3) pair(o[1], o[2]);
    }
  }

  const rows = teams.map((t) => {
    const o = info[t.a]; const c = cnt[t.a];
    c.pts.sort((x, y) => x - y);
    const q = (p) => c.pts[Math.min(c.pts.length - 1, Math.floor(c.pts.length * p))];
    const left = o.rem.length;
    const expW = o.rem.reduce((n, g) => n + g.p, 0);
    return {
      ...t,
      share: r4(shareOf(t.a)),
      left, homeLeft: o.rem.filter((g) => g.home).length, roadLeft: o.rem.filter((g) => !g.home).length, b2bLeft: o.rem.filter((g) => g.b2b).length,
      sos: left ? r4(o.rem.reduce((n, g) => n + shareOf(g.opp), 0) / left) : null,
      expW: Math.round(expW * 10) / 10,
      pace: t.gp ? Math.round((t.pts / t.gp) * (t.gp + left)) : null,
      med: q(0.5), p10: q(0.1), p90: q(0.9),
      po: r4(c.po / sims),
      pos: c.pos.map((x) => r4(x / sims)),
      opp: Object.entries(c.opp).sort((x, y) => y[1] - x[1]).slice(0, 3).map(([a, n]) => [a, r4(n / sims)]),
    };
  });
  // Ranks (1 = highest share, 1 = hardest remaining schedule).
  const rank = (key, k) => [...rows].filter((r) => r[key] != null).sort((x, y) => y[key] - x[key]).forEach((r, i) => { r[k] = i + 1; });
  rank('share', 'shareRank'); rank('sos', 'sosRank');
  return {
    asOf: today, sims, season: total?.season ?? null,
    gamesPerTeam: rows.length ? Math.max(...rows.map((r) => r.gp + r.left)) : 0,
    modeled: games.filter((g) => g.modeled).length, games: games.length,
    teams: rows,
  };
}

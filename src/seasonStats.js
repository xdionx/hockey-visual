// Season rollups of the per-game numbers we compute ourselves (SAT and momentum).
// Pure functions, no fetching, safe in the browser (the player pages and a future
// stats page import this file) and in Node (the data scripts).
//
// One season file holds a running total per player, so a new game is just added in:
//
//   { season: 20262027, gameType: 2, v: SEASON_VERSION, games: 312, updated: "...",
//     players: { "8478402": { n: "Connor McDavid", t: "EDM", p: "C", gp: 24, sat: 98, sog: 66,
//                             mom: 41.3, mp: 55.0, mn: -13.7, toi: 33840 } } }
//
// n name, t team (latest), p position, gp games played, sat own shot attempts (on goal, missed
// or blocked), sog shots on goal, mom momentum impact (mp the positive part, mn the negative
// part), toi seconds on ice (only when the game had a box score; older seasons are built from
// play-by-play alone and leave it out).
//
// `g` keeps one short row per game (see GAME_FIELDS) so the momentum stats page can test the model
// against results: who won, team momentum with and without goals, team shot attempts.
import { computeMomentum } from './momentum.js';
import { shotXg, finishingPct } from './xg.js';
import { tierOf } from './impact.js';

// Bump when how a game line is computed changes (momentum weights, what counts as an attempt):
// the backfill then rebuilds the saved seasons instead of mixing old and new numbers.
// 2: backup goalies who never went in no longer count as a game played. 3: game rows (`g`).
// 4: momentum model v4 (shots and penalties only, home plate 3x, goals count as shots in "no goals").
// 5: finishing (xg = expected goals from the player's shots on a goalie, xgg = goals on a goalie), goalie
//    goals against vs expected (ga, xga, gs = games started), and each game's starting goalies (ags, hgs).
// 6: scoring (g = all goals, a1 primary assists, a2 secondary assists; shootouts left out) for Scoring vs avg.
// 7: home plate narrowed to 19 ft, inner 2x / outer 3.5x, wide shots 0.5x (momentum and on-ice weights).
// 8: goalie shots against (sa) and goals on them (sg), plus one [shots, goals] entry per start (q), for quality starts.
export const SEASON_VERSION = 8;

/** First season we keep on-ice shot attempts for (shift charts; the Team deficiencies tab starts here too). */
export const FIRST_SHIFT_SEASON = 20202021;

/** First season the NHL play-by-play has every event with rink coordinates (needed for momentum). */
export const FIRST_FULL_SEASON = 20092010;

const t = (v) => (v && typeof v === 'object' ? v.default : v) ?? '';
const round1 = (n) => Math.round(n * 10) / 10;
const ATTEMPTS = new Set(['goal', 'shot-on-goal', 'missed-shot', 'blocked-shot']);

/**
 * Order of the values in a game row (total.g): game number, away and home team, goals, team momentum
 * (every push), team momentum without goals, team shot attempts, how it ended ('REG' | 'OT' | 'SO'), and
 * each team's starting goalie id (null when unknown), then team finishing: expected goals from shots on a
 * goalie (axg, hxg) and goals scored on a goalie (agg, hgg). addGame fills the last four from the player
 * lines, so rows saved before they existed simply leave them out.
 */
export const GAME_FIELDS = ['n', 'away', 'home', 'ag', 'hg', 'am', 'hm', 'an', 'hn', 'as', 'hs', 'end', 'ags', 'hgs', 'axg', 'hxg', 'agg', 'hgg', 'asog', 'hsog'];
const FIN_AT = GAME_FIELDS.indexOf('axg');
export const gameObj = (row) => Object.fromEntries(GAME_FIELDS.map((k, i) => [k, row[i]]));

const teamSat = (lines, team) => lines.reduce((n, l) => n + (l.team === team && l.pos !== 'G' ? l.sat ?? 0 : 0), 0);
const teamSum = (lines, team, k) => lines.reduce((n, l) => n + (l.team === team && l.pos !== 'G' ? l[k] ?? 0 : 0), 0);

/** A game row with team finishing appended (from the skaters' xg/xgg), when the lines carry it. */
export function withFinishing(game, lines) {
  if (!game || game.length >= GAME_FIELDS.length || !lines.some((l) => l.pos !== 'G' && l.xg != null)) return game;
  const [a, h] = [game[1], game[2]];
  const r2 = (n) => Math.round(n * 100) / 100;
  return [...game.slice(0, FIN_AT), ...Array(Math.max(0, FIN_AT - game.length)).fill(null), r2(teamSum(lines, a, 'xg')), r2(teamSum(lines, h, 'xg')),
    teamSum(lines, a, 'xgg'), teamSum(lines, h, 'xgg'), teamSum(lines, a, 'sog'), teamSum(lines, h, 'sog')];
}
const gameNo = (id) => Number(String(id).slice(-4));

/** A game row from a box score we built, or null when it has no momentum. */
export function gameFromDetail(detail, lines = linesFromDetail(detail)) {
  const m = detail?.momentum;
  if (!m?.totals) return null;
  const a = detail.away?.abbrev;
  const h = detail.home?.abbrev;
  const labels = (detail.linescore?.periods ?? []).map((p) => p.label);
  const end = detail.outcome ?? (labels.includes('SO') ? 'SO' : labels.some((l) => /OT/.test(l)) ? 'OT' : 'REG');
  return [gameNo(detail.id), a, h, detail.away?.score ?? 0, detail.home?.score ?? 0, m.totals.away, m.totals.home,
    m.totalsNoGoals?.away ?? null, m.totalsNoGoals?.home ?? null, teamSat(lines, a), teamSat(lines, h), end,
    starterOf(detail.players?.away?.goalies), starterOf(detail.players?.home?.goalies)];
}
const starterOf = (goalies) => (goalies ?? []).find((g) => g.starter)?.id ?? (goalies ?? []).find((g) => g.played)?.id ?? null;

/** NHL game types we keep totals for (preseason, 1, never counts). */
export const REGULAR = 2;
export const PLAYOFFS = 3;

/** A season file's name: regular season "<season>.json", playoffs "<season>-p.json". */
export function seasonFile(season, gameType = REGULAR) {
  return `${season}${gameType === PLAYOFFS ? '-p' : ''}.json`;
}

/** "20262027" -> "2026-27" */
export function seasonLabel(season) {
  const s = String(season);
  return `${s.slice(0, 4)}-${s.slice(6, 8)}`;
}

/** The season a date (YYYY-MM-DD) falls in: from September on it's the new season. */
export function seasonOf(date) {
  const [y, m] = String(date).split('-').map(Number);
  const start = m >= 9 ? y : y - 1;
  return Number(`${start}${start + 1}`);
}

/**
 * One line per player who dressed, from a box score we built (src/gameDetail.js).
 * Goalies come back with gp only: SAT and momentum are skater numbers.
 */
export function linesFromDetail(detail) {
  const out = [];
  for (const side of ['away', 'home']) {
    const team = detail?.[side]?.abbrev ?? '';
    const p = detail?.players?.[side] ?? {};
    for (const s of [...(p.forwards ?? []), ...(p.defense ?? [])]) {
      out.push({
        id: s.id, name: s.fullName ?? s.name, team, pos: s.position,
        sat: s.attempts ?? 0, sog: s.sog ?? 0, ...(s.xg != null ? { xg: s.xg, xgg: s.xgGoals ?? 0 } : {}),
        ...(s.a1 != null ? { g: s.goals ?? 0, a1: s.a1, a2: s.a2 ?? 0 } : {}),
        mom: s.momentum ?? 0, mp: s.momentumParts?.pos ?? Math.max(0, s.momentum ?? 0), mn: s.momentumParts?.neg ?? Math.min(0, s.momentum ?? 0),
        toi: s.toiSeconds ?? null,
      });
    }
    for (const g of p.goalies ?? []) {
      if (!g.played) continue;
      out.push({ id: g.id, name: g.fullName ?? g.name, team, pos: 'G', toi: g.toiSeconds ?? null,
        ...(g.xga != null ? { ga: g.goalsAgainst ?? 0, xga: g.xga } : {}), st: g.starter ? 1 : 0 });
    }
  }
  return out;
}

/**
 * The same lines from the raw NHL play-by-play alone (used for past seasons, one request a game).
 * Every dressed player counts as a game played, like the NHL's own GP. No time on ice.
 */
export function linesFromPbp(pbp) {
  return fromPbp(pbp).lines;
}

/** Player lines and the game row from one raw play-by-play (momentum computed once). */
export function fromPbp(pbp) {
  if (!pbp?.plays?.length) return { lines: [], game: null };
  const awayId = pbp.awayTeam?.id;
  const abbrev = { [pbp.awayTeam?.id]: pbp.awayTeam?.abbrev, [pbp.homeTeam?.id]: pbp.homeTeam?.abbrev };
  const mom = computeMomentum(pbp, awayId);
  const momentum = mom.players;
  const att = new Map();
  for (const e of pbp.plays) {
    if (!ATTEMPTS.has(e.typeDescKey) || e.periodDescriptor?.periodType === 'SO') continue;
    const id = e.details?.shootingPlayerId ?? e.details?.scoringPlayerId;
    if (!id) continue;
    const a = att.get(id) ?? { sat: 0, sog: 0, xg: 0, xgg: 0 };
    a.sat++;
    if (e.typeDescKey === 'goal' || e.typeDescKey === 'shot-on-goal') {
      a.sog++;
      // Finishing only counts shots with a goalie in net (an empty-net goal says nothing about finishing).
      const p = e.details?.goalieInNetId ? shotXg({ x: e.details.xCoord, y: e.details.yCoord, shotType: e.details.shotType }) : null;
      if (p != null) { a.xg += p; if (e.typeDescKey === 'goal') a.xgg++; }
    }
    att.set(id, a);
  }
  // Goals and primary / secondary assists (all strengths, empty net included, like the NHL's own points).
  const pts = new Map();
  const bump = (id, k) => { if (!id) return; const p = pts.get(id) ?? { g: 0, a1: 0, a2: 0 }; p[k]++; pts.set(id, p); };
  for (const e of pbp.plays) {
    if (e.typeDescKey !== 'goal' || e.periodDescriptor?.periodType === 'SO') continue;
    bump(e.details?.scoringPlayerId, 'g'); bump(e.details?.assist1PlayerId, 'a1'); bump(e.details?.assist2PlayerId, 'a2');
  }
  // A dressed backup goalie who never went in didn't play (the NHL doesn't count that as a game).
  const inNet = new Set(pbp.plays.map((e) => e.details?.goalieInNetId).filter(Boolean));
  // Goals against and expected goals against per goalie, and who started for each team.
  const gk = new Map();
  const faced = new Map();
  const starters = {};
  const teamOf = new Map((pbp.rosterSpots ?? []).map((r) => [r.playerId, r.teamId]));
  for (const e of [...pbp.plays].sort((x, y) => (x.sortOrder ?? 0) - (y.sortOrder ?? 0))) {
    if ((e.typeDescKey !== 'goal' && e.typeDescKey !== 'shot-on-goal') || e.periodDescriptor?.periodType === 'SO') continue;
    const d = e.details ?? {};
    if (!d.goalieInNetId) continue;
    const team = teamOf.get(d.goalieInNetId);
    if (team != null && starters[team] == null) starters[team] = d.goalieInNetId;
    // Shots against and goals on them (every shot with a goalie in net, shootouts left out) for quality starts.
    const f = faced.get(d.goalieInNetId) ?? { sa: 0, sg: 0 };
    f.sa++;
    if (e.typeDescKey === 'goal') f.sg++;
    faced.set(d.goalieInNetId, f);
    const p = shotXg({ x: d.xCoord, y: d.yCoord, shotType: d.shotType });
    if (p == null) continue;
    const g = gk.get(d.goalieInNetId) ?? { ga: 0, xga: 0 };
    g.xga += p;
    if (e.typeDescKey === 'goal') g.ga++;
    gk.set(d.goalieInNetId, g);
  }
  const lines = (pbp.rosterSpots ?? []).filter((r) => r.positionCode !== 'G' || inNet.has(r.playerId)).map((r) => {
    const base = { id: r.playerId, name: `${t(r.firstName)} ${t(r.lastName)}`.trim(), team: abbrev[r.teamId] ?? '', pos: r.positionCode };
    if (r.positionCode === 'G') {
      const g = gk.get(r.playerId) ?? { ga: 0, xga: 0 };
      const f = faced.get(r.playerId) ?? { sa: 0, sg: 0 };
      return { ...base, toi: null, ga: g.ga, xga: Math.round(g.xga * 100) / 100, sa: f.sa, sg: f.sg, st: starters[r.teamId] === r.playerId ? 1 : 0 };
    }
    const m = momentum[r.playerId];
    const a = att.get(r.playerId) ?? { sat: 0, sog: 0, xg: 0, xgg: 0 };
    const pt = pts.get(r.playerId) ?? { g: 0, a1: 0, a2: 0 };
    return { ...base, sat: a.sat, sog: a.sog, xg: Math.round(a.xg * 100) / 100, xgg: a.xgg, g: pt.g, a1: pt.a1, a2: pt.a2, mom: m?.impact ?? 0, mp: m?.pos ?? 0, mn: m?.neg ?? 0, toi: null };
  });
  const a = pbp.awayTeam?.abbrev;
  const h = pbp.homeTeam?.abbrev;
  const game = [gameNo(pbp.id), a, h, pbp.awayTeam?.score ?? 0, pbp.homeTeam?.score ?? 0, mom.totals.away, mom.totals.home,
    mom.totalsNoGoals.away, mom.totalsNoGoals.home, teamSat(lines, a), teamSat(lines, h),
    pbp.gameOutcome?.lastPeriodType ?? pbp.plays.at(-1)?.periodDescriptor?.periodType ?? 'REG',
    starters[pbp.awayTeam?.id] ?? null, starters[pbp.homeTeam?.id] ?? null];
  return { lines, game };
}

export function emptySeason(season, gameType = 2) {
  return { season: Number(season), gameType, v: SEASON_VERSION, games: 0, updated: null, players: {}, g: [] };
}

/** Adds one game's lines (and its game row, when given) into a season total (in place) and returns it. */
export function addGame(total, lines, game = null) {
  total.games++;
  if (game) (total.g ??= []).push(withFinishing(game, lines));
  for (const l of lines) {
    const key = String(l.id);
    const p = total.players[key] ?? (total.players[key] = { n: l.name, t: l.team, p: l.pos, gp: 0 });
    p.n = l.name || p.n;
    p.t = l.team || p.t;
    p.p = l.pos || p.p;
    p.gp++;
    if (l.pos !== 'G') {
      p.sat = (p.sat ?? 0) + (l.sat ?? 0);
      p.sog = (p.sog ?? 0) + (l.sog ?? 0);
      if (l.xg != null) {
        p.xg = Math.round(((p.xg ?? 0) + l.xg) * 100) / 100;
        p.xgg = (p.xgg ?? 0) + (l.xgg ?? 0);
        // Game tiers (src/impact.js): tg games rated, ab above average, bl below average.
        const tier = tierOf(l, l.pos);
        p.tg = (p.tg ?? 0) + 1;
        if (tier === 1) p.ab = (p.ab ?? 0) + 1;
        if (tier === -1) p.bl = (p.bl ?? 0) + 1;
      }
      // On-ice shot attempts and goals (weighted attempts, from the shift charts): ocf/oca for and against, ogf/oga goals,
      // oto seconds on ice in the games that had shift data. Only games with shifts count, so this stays aligned.
      if (l.oi && (l.oi.sec ?? l.toi)) {
        p.ocf = Math.round(((p.ocf ?? 0) + l.oi.cf) * 100) / 100;
        p.oca = Math.round(((p.oca ?? 0) + l.oi.ca) * 100) / 100;
        p.ogf = (p.ogf ?? 0) + l.oi.gf;
        p.oga = (p.oga ?? 0) + l.oi.ga;
        p.oto = (p.oto ?? 0) + (l.oi.sec ?? l.toi);
      }
      if (l.a1 != null) {
        p.g = (p.g ?? 0) + (l.g ?? 0);
        p.a1 = (p.a1 ?? 0) + l.a1;
        p.a2 = (p.a2 ?? 0) + (l.a2 ?? 0);
      }
      p.mom = round1((p.mom ?? 0) + (l.mom ?? 0));
      p.mp = round1((p.mp ?? 0) + (l.mp ?? 0));
      p.mn = round1((p.mn ?? 0) + (l.mn ?? 0));
    } else if (l.xga != null) {
      p.ga = (p.ga ?? 0) + (l.ga ?? 0);
      p.xga = Math.round(((p.xga ?? 0) + l.xga) * 100) / 100;
      p.gs = (p.gs ?? 0) + (l.st ?? 0);
      if (l.sa != null) {
        p.sa = (p.sa ?? 0) + l.sa;
        p.sg = (p.sg ?? 0) + (l.sg ?? 0);
        if (l.st) (p.q ??= []).push([l.sa, l.sg ?? 0]); // one [shots against, goals against] per start
      }
    }
    if (l.toi != null) p.toi = (p.toi ?? 0) + l.toi;
  }
  return total;
}

/**
 * League-wide goals on a goalie per expected goal that season (from every skater row). Our xG only sees
 * distance, angle and shot type, so it runs low (the league scores 11-24% more than it expects); multiplying
 * xG by this rate gives "what an average NHL shooter would score from the same shots". 1 when unknown.
 */
export function leagueRate(total) {
  let xg = 0;
  let goals = 0;
  for (const p of Object.values(total?.players ?? {})) {
    if (p.p === 'G' || p.xg == null) continue;
    xg += p.xg;
    goals += p.xgg ?? 0;
  }
  return xg > 0 ? goals / xg : 1;
}

/**
 * Scoring in plain numbers. Goals vs avg only credits finishing, so a player who sets up plays looks cold.
 * Playmaking is the assists above what an average forward (or defenseman) gets in the same games, each worth
 * ASSIST_WEIGHT of a goal (fit on 6 seasons, scripts/scoring-lab: a primary assist ~0.75, a secondary ~0.79).
 * Scoring vs avg = Goals vs avg + playmaking.
 */
export const ASSIST_WEIGHT = 0.75;

/** Average assists per game for forwards and defensemen this season (null when the file has no assists yet). */
export function scoringBase(total, minGp = 5) {
  const acc = { F: { a: 0, gp: 0 }, D: { a: 0, gp: 0 } };
  for (const p of Object.values(total?.players ?? {})) {
    if (p.p === 'G' || p.a1 == null || p.gp < minGp) continue;
    const k = acc[p.p === 'D' ? 'D' : 'F'];
    k.a += p.a1 + (p.a2 ?? 0);
    k.gp += p.gp;
  }
  return acc.F.gp && acc.D.gp ? { F: acc.F.a / acc.F.gp, D: acc.D.a / acc.D.gp } : null;
}

/** Goals, assists, playmaking and scoring vs average for one season row; nulls when the row has no assists or no base. */
export function scoringLine(row, finGaa, base) {
  if (row.p === 'G' || row.a1 == null) return { goals: null, assists: null, playVsAvg: null, scoringVsAvg: null };
  const assists = row.a1 + (row.a2 ?? 0);
  const playVsAvg = base ? ASSIST_WEIGHT * (assists - base[row.p === 'D' ? 'D' : 'F'] * row.gp) : null;
  return { goals: row.g ?? 0, assists, playVsAvg, scoringVsAvg: playVsAvg != null && finGaa != null ? finGaa + playVsAvg : null };
}

/** Finishing in plain numbers: shooting %, an average shooter's shooting % on the same shots, goals above average. */
export function finishingLine(goals, xg, sog, rate = 1) {
  if (xg == null) return { shPct: null, xShPct: null, gaa: null };
  const avg = xg * rate;
  return { shPct: sog ? goals / sog : null, xShPct: sog ? avg / sog : null, gaa: goals - avg, avgGoals: avg };
}

/**
 * Quality starts (Rob Vollman's definition). A start is a quality start when the goalie's save % is at or above the
 * league average that season, or, on a quiet night (under 20 shots), when he allows 2 goals or fewer and still saves
 * at least .885. The league average is computed from the season file, never hardcoded.
 * A pulled starter is judged on the shots he faced; relief appearances are never starts.
 */
export const QS_LOW_SHOTS = 20;
export const QS_MAX_GA = 2;
export const QS_MIN_SV = 0.885;

/** League-wide save % of every goalie that season (shootouts and empty nets left out), or null before the totals carry shots. */
export function leagueSavePct(total) {
  let sa = 0;
  let sg = 0;
  for (const p of Object.values(total?.players ?? {})) {
    if (p.p !== 'G' || p.sa == null) continue;
    sa += p.sa;
    sg += p.sg ?? 0;
  }
  return sa > 0 ? 1 - sg / sa : null;
}

/** Is one start ([shots against, goals against]) a quality start, given the league save %? */
export function isQualityStart([sa, ga], lgSv) {
  const sv = sa ? 1 - ga / sa : 1;
  return sv >= lgSv || (sa < QS_LOW_SHOTS && ga <= QS_MAX_GA && sv >= QS_MIN_SV);
}

/** { qs, starts, qsPct } for a goalie row, or null when the row has no per-start data (seasons built before v8). */
export function qualityStarts(row, lgSv) {
  if (!row?.q || lgSv == null) return null;
  const qs = row.q.filter((s) => isQualityStart(s, lgSv)).length;
  return { qs, starts: row.q.length, qsPct: row.q.length ? qs / row.q.length : null };
}

/** Quality starts per team (by each goalie's latest team): { TOR: { qs, starts, qsPct } }. */
export function teamQualityStarts(total) {
  const lgSv = leagueSavePct(total);
  const out = {};
  for (const r of Object.values(total?.players ?? {})) {
    const q = r.p === 'G' ? qualityStarts(r, lgSv) : null;
    if (!q) continue;
    const t = (out[r.t] ??= { qs: 0, starts: 0 });
    t.qs += q.qs;
    t.starts += q.starts;
  }
  for (const t of Object.values(out)) t.qsPct = t.starts ? t.qs / t.starts : null;
  return out;
}

/** A goalie's season in plain numbers: expected goals against (scaled to the league), goals saved above expected, quality starts. */
export function goalieLineOf(row, rate = 1, lgSv = null) {
  const xga = row.xga * rate;
  const gsax = xga - (row.ga ?? 0);
  const q = qualityStarts(row, lgSv);
  return { ga: row.ga ?? 0, xgaAvg: xga, gsax, gsaxPerGame: row.gp ? gsax / row.gp : null, starts: row.gs ?? 0, qs: q?.qs ?? null, qsStarts: q?.starts ?? null, qsPct: q?.qsPct ?? null, lgSv };
}

/** Goalies ranked by quality start % (QS as the tie-break), best first. minStarts defaults to a quarter of the most starts. */
export function qsBoard(total, { minStarts = null } = {}) {
  const lgSv = leagueSavePct(total);
  const rows = Object.entries(total?.players ?? {}).filter(([, r]) => r.p === 'G' && r.q?.length).map(([id, r]) => ({ id: Number(id), ...r, ...qualityStarts(r, lgSv), lgSv }));
  const most = Math.max(0, ...rows.map((r) => r.starts));
  const min = minStarts ?? Math.max(1, Math.ceil(most / 4));
  const board = rows.filter((r) => r.starts >= min).sort((a, b) => b.qsPct - a.qsPct || b.qs - a.qs || b.starts - a.starts);
  board.forEach((r, i) => { r.rank = i && board[i - 1].qsPct === r.qsPct && board[i - 1].qs === r.qs ? board[i - 1].rank : i + 1; });
  return { board, lgSv, minStarts: min };
}

/** Per-game averages for one player's season row (null when the player has no games). rate: leagueRate(total). */
export function perGame(row, rate = 1, base = null, lgSv = null) {
  if (!row?.gp) return null;
  const skater = row.p !== 'G';
  return {
    gp: row.gp,
    satPerGame: skater ? (row.sat ?? 0) / row.gp : null,
    sogPerGame: skater ? (row.sog ?? 0) / row.gp : null,
    momPerGame: skater ? (row.mom ?? 0) / row.gp : null,
    momPosPerGame: skater ? (row.mp ?? 0) / row.gp : null,
    momNegPerGame: skater ? (row.mn ?? 0) / row.gp : null,
    // Only where every game had time on ice (the current season); per 60 minutes.
    satPer60: skater && row.toi ? ((row.sat ?? 0) * 3600) / row.toi : null,
    momPer60: skater && row.toi ? ((row.mom ?? 0) * 3600) / row.toi : null,
    toiPerGame: row.toi ? row.toi / row.gp : null,
    // Finishing: goals on a goalie per expected goal x 100 (100 = average), and goals above expected.
    xg: skater && row.xg != null ? row.xg : null,
    finPct: skater && row.xg != null ? finishingPct(row.xgg ?? 0, row.xg) : null,
    gax: skater && row.xg != null ? (row.xgg ?? 0) - row.xg : null,
    // Share of rated games above / below average for the position (src/impact.js).
    abovePct: skater && row.tg ? (row.ab ?? 0) / row.tg : null,
    belowPct: skater && row.tg ? (row.bl ?? 0) / row.tg : null,
    // The same against an average NHL shooter that season (what the pages show).
    ...(skater ? finishingLine(row.xgg ?? 0, row.xg, row.sog ?? 0, rate) : { shPct: null, xShPct: null, gaa: null }),
    ...scoringLine(row, skater && row.xg != null ? (row.xgg ?? 0) - row.xg * rate : null, base),
    // Goalies: goals saved above what an average NHL goalie would allow on the same shots (xGA x league rate).
    ...(!skater && row.xga != null ? goalieLineOf(row, rate, lgSv) : {}),
  };
}

/** Fewest games to make a leaderboard: a quarter of the most anyone has played, at least 1. */
export function minGames(total) {
  const most = Math.max(0, ...Object.values(total?.players ?? {}).map((p) => p.gp));
  return Math.max(1, Math.ceil(most / 4));
}

/**
 * Skaters ranked by a per-game number ('satPerGame', 'momPerGame', ...), best first.
 * Options: pos 'F' | 'D' | null, minGp (defaults to minGames), minXg (fewest expected goals, for finishing ranks).
 */
export function leaderboard(total, key, { pos = null, minGp = minGames(total), minXg = 0 } = {}) {
  const rows = [];
  const rate = leagueRate(total);
  const base = scoringBase(total);
  for (const [id, row] of Object.entries(total?.players ?? {})) {
    if (row.p === 'G' || row.gp < minGp || (minXg && (row.xg ?? 0) < minXg)) continue;
    if (pos === 'D' && row.p !== 'D') continue;
    if (pos === 'F' && row.p === 'D') continue;
    const avg = perGame(row, rate, base);
    if (avg[key] == null) continue;
    rows.push({ id: Number(id), ...row, ...avg, value: avg[key] });
  }
  rows.sort((a, b) => b.value - a.value);
  rows.forEach((r, i) => { r.rank = i && rows[i - 1].value === r.value ? rows[i - 1].rank : i + 1; });
  return rows;
}

/** { rank, of } for one player on a leaderboard, or null when they don't qualify. */
export function rankOf(total, id, key, opts) {
  const board = leaderboard(total, key, opts);
  const hit = board.find((r) => r.id === Number(id));
  return hit ? { rank: hit.rank, of: board.length } : null;
}

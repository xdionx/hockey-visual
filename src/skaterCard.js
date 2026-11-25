// Skater card v2: pure helpers (no DOM). Every number the card ranks, with NHL ranks ("15th NHL", "T1st NHL"), team ranks,
// league-average values, offense / defense summary, strengths and weak spots. Built from a season file.
import { leagueRate, minGames, perGame, scoringBase } from './seasonStats.js';
import { areaBase, skaterAreas } from './areas.js';

const isD = (p) => p === 'D';
export const MIN_DEF_TOI = 6000; // seconds of ice time before the defense number is shown
const GOALS_PER_ATTEMPT = 0.065 * 0.64; // all-strength attempt -> goal value, shrunk to what carries into the next season

// key, label, group (off / def / disc / fo), higher is better, kind of number, context (not a strength or weak spot), definition
export const METRICS = [
  ['scoring', 'Scoring vs avg', 'off', true, 'signed', false, 'Goals plus 3/4 of assists, above an average player at the position, per game.'],
  ['fin', 'Finishing', 'off', true, 'signed', false, 'Goals scored minus what an average NHL shooter would score from the same shots, per game.'],
  ['play', 'Driving play', 'off', true, 'signed', false, 'Momentum per game: our play-by-play model of the shifts in pressure the player creates or gives up.'],
  ['sat', 'Shot attempts', 'off', true, 'dec', false, 'Own shot attempts (SAT) per game: shots, misses and blocks.'],
  ['xg', 'Chances (xG)', 'off', true, 'dec2', false, 'Expected goals from the player\'s own shots per game, using shot location and type.'],
  ['vol', 'Shot volume', 'off', true, 'pct', false, 'Share of the player\'s attempts that reach the net (not blocked or missed).'],
  ['pen', 'Penalties', 'disc', true, 'signed2', false, 'Penalties drawn minus penalties taken per game.'],
  ['def', 'Defense', 'def', true, 'signed', false, 'Goals prevented at 5v5: shot attempts the other team takes while he is on the ice, adjusted for who he plays with and against, turned into goals. Overlaps with puck possession; season-long even in the last 10 view.'],
  ['fo', 'Faceoffs', 'fo', true, 'pct', false, 'Faceoff win % (centers only).'],
  ['rating', 'Avg rating', 'rate', true, 'dec1', false, 'Average game rating from our scorecards: 6.0 is an average night, 9+ is a huge game. It blends scoring, shots, defense, discipline, faceoffs, on-ice results and momentum.'],
  ['give', 'Giveaways', 'ctx', false, 'dec1', true, 'Giveaways per game. Context only: puck carriers give it away more because they have it more.'],
];
export const METRIC = Object.fromEntries(METRICS.map((m) => [m[0], { key: m[0], label: m[1], group: m[2], hi: m[3], kind: m[4], ctx: m[5], tip: m[6] }]));

const r3 = (v) => Math.round(v * 1000) / 1000;

/** Rank of v within values (1 = best); tied when another value is equal at 3 decimals. */
export function rankIn(values, v, hi = true) {
  const x = r3(v);
  const vals = values.map(r3);
  return { rank: 1 + vals.filter((y) => (hi ? y > x : y < x)).length, of: vals.length, tied: vals.filter((y) => y === x).length > 1 };
}
const pctOf = (rk) => (rk.of > 1 ? (rk.of - rk.rank) / (rk.of - 1) : 0.5);
export const ofN = (r) => (r ? `${r.tied ? 'T' : ''}${ord(r.rank)} NHL` : '');
export const ord = (n) => { const s = ['th', 'st', 'nd', 'rd']; const v = n % 100; return `${n}${s[(v - 20) % 10] || s[v] || s[0]}`; };
export const teamOrd = (t, r) => (r ? `${t} ${r.tied ? 'T' : ''}${ord(r.rank)}` : '');

/** Every qualifying skater's numbers: Map id -> { row, team, group, v: { key: value|null } }. */
export function skaterTable(total, { win = false, def: defFile = null } = {}) {
  if (!total?.players) return null;
  const rate = leagueRate(total);
  const sbase = scoringBase(total);
  const base = areaBase(total, { win });
  const minGp = Math.max(5, minGames(total));
  const minToi = win ? 1500 : MIN_DEF_TOI;
  // Team / position-group on-ice totals for "against teammates".
  const grp = new Map();
  for (const row of Object.values(total.players)) {
    if (row.p === 'G' || !row.t || row.oto == null) continue;
    const k = `${row.t}|${isD(row.p) ? 'D' : 'F'}`;
    const g = grp.get(k) ?? { oca: 0, oto: 0 };
    g.oca += row.oca ?? 0; g.oto += row.oto ?? 0;
    grp.set(k, g);
  }
  const out = new Map();
  for (const [id, row] of Object.entries(total.players)) {
    if (row.p === 'G' || !row.t || row.gp < minGp) continue;
    const pg = perGame(row, rate, sbase);
    const a = skaterAreas(row, base);
    const gp = row.gp;
    let def = null;
    const adj = defFile?.players?.[id] ?? null;
    if (defFile) {
      if (adj) def = -adj.d * adj.h * (defFile.gpa ?? 0.0627); // goals prevented: attempts against /60 below average x 5v5 hours x goals per attempt
    } else if (row.oto >= minToi) {
      const g = grp.get(`${row.t}|${isD(row.p) ? 'D' : 'F'}`);
      const restToi = g.oto - row.oto;
      if (restToi >= minToi) {
        const rel = ((row.oca ?? 0) / row.oto - (g.oca - (row.oca ?? 0)) / restToi) * 3600; // attempts against per 60, vs teammates
        def = -rel * (row.oto / 3600) * GOALS_PER_ATTEMPT;
      }
    }
    out.set(Number(id), { id: Number(id), name: row.n, row, adj, team: row.t, pos: row.p, group: isD(row.p) ? 'D' : 'F', gp, pg, areas: a, v: {
      scoring: pg.scoringVsAvg != null ? pg.scoringVsAvg / gp : null,
      fin: pg.gaa != null ? pg.gaa / gp : null,
      play: pg.momPerGame,
      sat: pg.satPerGame,
      xg: row.xg != null ? row.xg / gp : null,
      vol: a.vol?.share ?? null,
      pen: a.pen?.perGame ?? null,
      def,
      fo: a.fo?.pct ?? null,
      give: a.give?.perGame ?? null,
      rating: (row.rn ?? 0) >= (win ? 3 : 5) ? row.rt / row.rn : null,
    } });
  }
  return { rows: out, rate, sbase, adjusted: !!defFile };
}

const TIERS = [[0.9, 'elite'], [0.7, 'strong'], [0.4, 'average'], [0.2, 'below average'], [0, 'poor']];
export const tierName = (p) => TIERS.find(([t]) => p >= t)[1];

/**
 * Everything the card shows for one skater: per metric value, NHL rank, percentile, NHL average, team rank;
 * the spider points, the summary and strengths / weak spots. null when the skater doesn't qualify.
 */
export function skaterCard(total, id, opts = {}) {
  const tbl = skaterTable(total, opts);
  const me = tbl?.rows.get(Number(id));
  if (!me) return null;
  const all = [...tbl.rows.values()];
  const m = {};
  for (const [key, , , hi] of METRICS) {
    const mine = me.v[key];
    if (mine == null) continue;
    const pool = all.filter((r) => r.v[key] != null && (key !== 'fo' || r.pos === 'C') && (key !== 'def' || r.group === me.group));
    if (pool.length < 5) continue;
    const vals = pool.map((r) => r.v[key]);
    const rank = rankIn(vals, mine, hi);
    const mates = pool.filter((r) => r.team === me.team && r.group === me.group);
    const teamRank = mates.length > 1 ? rankIn(mates.map((r) => r.v[key]), mine, hi) : null;
    const sorted = [...vals].sort((a, b) => a - b);
    m[key] = { ...METRIC[key], value: mine, vals, rank, pct: pctOf(rank), of: pool.length, avg: sorted[Math.floor(sorted.length / 2)], mean: vals.reduce((a, b) => a + b, 0) / vals.length,
      teamRank, teamOf: mates.length, team: me.team, best: mates.length > 1 ? mates.reduce((a, b) => ((hi ? b.v[key] > a.v[key] : b.v[key] < a.v[key]) ? b : a)) : null,
      worst: mates.length > 1 ? mates.reduce((a, b) => ((hi ? b.v[key] < a.v[key] : b.v[key] > a.v[key]) ? b : a)) : null };
  }
  const SPIDER = ['scoring', 'fin', 'play', 'sat', 'xg', 'pen'];
  const spider = SPIDER.filter((k) => m[k]).map((k) => ({ key: k, label: m[k].label, pct: Math.round(m[k].pct * 100), value: m[k].value, rank: m[k].rank, tip: m[k].tip }));
  const defBars = ['def', 'pen'].filter((k) => m[k]).map((k) => ({ key: k, label: k === 'def' ? 'Goals prevented' : 'Penalties not taken', pct: Math.round(m[k].pct * 100), value: m[k].value, rank: m[k].rank }));
  const ranked = Object.values(m).filter((x) => !x.ctx);
  const strengths = [...ranked].sort((a, b) => b.pct - a.pct).filter((x) => x.pct >= 0.7).slice(0, 4);
  const weak = [...ranked].sort((a, b) => a.pct - b.pct).filter((x) => x.pct <= 0.3).slice(0, 4).map((x) => ({ ...x, ugly: x.pct <= 0.1 }));
  const mean = (ks) => { const v = ks.filter((k) => m[k]).map((k) => m[k].pct); return v.length ? v.reduce((a, b) => a + b, 0) / v.length : null; };
  const off = mean(['scoring', 'play', 'xg', 'fin']);
  const def = m.def ? m.def.pct : null;
  let headline;
  if (off == null) headline = 'Not enough games yet';
  else if (def == null) headline = off >= 0.7 ? 'Offensive driver' : off < 0.2 ? 'Struggling offensively' : 'Depth skater';
  else if (off >= 0.7 && def >= 0.7) headline = 'Two-way player';
  else if (off >= 0.7 && def < 0.4) headline = 'Offense-first';
  else if (def >= 0.7 && off < 0.4) headline = 'Defense-first';
  else if (off >= 0.9) headline = 'Offensive driver';
  else if (def >= 0.9) headline = 'Defensive anchor';
  else if (off < 0.2 && def < 0.2) headline = 'Struggling at both ends';
  else headline = 'Balanced / depth';
  return { id: me.id, name: me.name, team: me.team, pos: me.pos, group: me.group, gp: me.gp, row: me.row, pg: me.pg, areas: me.areas, m, spider, defBars, strengths, weak,
    isWin: !!opts.win, adjusted: tbl.adjusted, adj: me.adj, summary: { headline, off, def, offTier: off == null ? null : tierName(off), defTier: def == null ? null : tierName(def) }, rate: tbl.rate, sbase: tbl.sbase,
    pool: all.filter((r) => r.group === me.group && r.v.def != null).map((r) => ({ id: r.id, name: r.name, x: ((r.row.g ?? 0) + (r.row.a1 ?? 0) + (r.row.a2 ?? 0)) / r.gp, y: r.v.def })) };
}

/** Hover text for one ranked stat: definition, value, NHL rank vs NHL AVG, and where he sits on his team. */
export function hoverText(x, fmtV) {
  if (!x) return '';
  const parts = [x.tip, `${x.label}: ${fmtV(x.value)}, ${ofN(x.rank)} of ${x.of} (NHL AVG ${fmtV(x.mean)}).`];
  if (x.teamRank) parts.push(`${teamOrd(x.team, x.teamRank)} of ${x.teamOf} teammates at his position group; best ${x.best.name} ${fmtV(x.best.v[x.key])}, lowest ${x.worst.name} ${fmtV(x.worst.v[x.key])}.`);
  return parts.join(' ');
}

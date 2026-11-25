// Defending vs puck control. The adjusted 5v5 model (rapm.js) gives each skater attempts against per 60 (d, lower is better) and
// attempts for per 60 (o). Today's "Defense" leaned on players who simply control the puck, so it is split in two within the
// position group (defensemen and forwards separately): Puck control = the part his own offense explains, Defending = the rest.
// Pure.
export const BASE_WEIGHTS = [0.5, 0.3, 0.2]; // this season, last season, the one before (tested on 2017-18 to 2025-26)
export const FULL_SECONDS = 40000; // 5v5 seconds in a season for it to count at full weight
export const PRIOR = 0.1; // keeps a player with little data near average
export const MIN_PK_SECONDS = 3600; // 60 penalty-kill minutes before the bar shows
const FIT_SECONDS = 12000;
const r3 = (v) => Math.round(v * 1000) / 1000;

/** Adds p (D / F), df (Defending, attempts per 60 prevented vs position peers) and pc (Puck control, same unit) to each fitted skater. pos: { id: 'D' | 'F' }. */
export function splitDefense(players, pos) {
  const out = {};
  for (const g of ['D', 'F']) {
    const ids = Object.keys(players).filter((id) => pos[id] === g);
    const fit = ids.filter((id) => players[id].h * 3600 >= FIT_SECONDS);
    const use = fit.length >= 30 ? fit : ids;
    if (use.length < 10) { for (const id of ids) out[id] = { ...players[id], p: g }; continue; }
    const n = use.length;
    const ox = use.reduce((s, id) => s + players[id].o, 0) / n, sy = use.reduce((s, id) => s - players[id].d, 0) / n;
    let sxy = 0, sxx = 0;
    for (const id of use) { sxy += (players[id].o - ox) * (-players[id].d - sy); sxx += (players[id].o - ox) ** 2; }
    const b = sxx > 0 ? sxy / sxx : 0;
    for (const id of ids) {
      const q = players[id];
      const pc = b * (q.o - ox);
      out[id] = { ...q, p: g, df: r3(-q.d - sy - pc), pc: r3(pc) };
    }
  }
  for (const id of Object.keys(players)) if (!out[id]) out[id] = { ...players[id] }; // position unknown (older saved stints): model numbers only
  return out;
}

/** The def file for a season: the model fit, the Defending / Puck control split and penalty-kill totals. */
export function defFile({ season, games, gpa, players, pos, pk, blk = {} }) {
  const split = splitDefense(players, pos);
  for (const id of Object.keys(split)) if (blk[id]) split[id].blk = blk[id]; // regulation shot blocks, all strengths
  return { season, v: 2, games, gpa, players: split, pk: pk ?? {} };
}

/**
 * Blends this season with the two before it. files = [this, last, before] (def files or null).
 * Returns { df, pc, w, seasons: [{ df, pc, h } | null x3] } in attempts per 60 prevented, or null when none has the split.
 */
export function blendDefending(files, id) {
  let df = 0, pc = 0, w = 0, any = false;
  const seasons = BASE_WEIGHTS.map((base, i) => {
    const q = files[i]?.v >= 2 ? files[i].players?.[id] : null;
    if (!q || q.df == null) return null;
    const wi = base * Math.min(1, (q.h * 3600) / FULL_SECONDS);
    df += wi * q.df; pc += wi * q.pc; w += wi; any = true;
    return { df: q.df, pc: q.pc, h: q.h };
  });
  if (!any) return null;
  return { df: df / (w + PRIOR), pc: pc / (w + PRIOR), w, seasons };
}

/** Penalty kill, attempts against per 60 vs teammates (positive = fewer than his teammates allow), from a def file's pk totals; null under 60 minutes. teamOf: id -> team. */
export function pkVsTeammates(file, id, teamOf) {
  const mine = file?.pk?.[id];
  if (!mine || mine[0] < MIN_PK_SECONDS) return null;
  let sec = 0, ca = 0;
  for (const [k, t] of Object.entries(file.pk)) if (k !== String(id) && teamOf[k] && teamOf[k] === teamOf[id]) { sec += t[0]; ca += t[1]; }
  if (sec < 1800) return null;
  return { value: (ca / sec - mine[1] / mine[0]) * 3600, sec: mine[0] };
}

const GAMES = 82;
/**
 * Blended Defending and Puck control for every skater, in goals per 82 games at a typical amount of 5v5 ice time for his position
 * (so ranks compare skill, not minutes). files = [this season, last, the one before]; total = the season file (positions, games).
 * Returns Map id -> { def, puck, group, seasons: [{ def, puck, h } | null x3] } or null when there is no split yet.
 */
export function defendingValues(files, total) {
  const cur = files.find((f) => f?.v >= 2 && f.players);
  if (!cur) return null;
  const gpa = cur.gpa ?? 0.0627;
  const grp = (id) => { const p = total?.players?.[id]?.p; return p ? (p === 'D' ? 'D' : 'F') : (files.map((f) => f?.players?.[id]?.p).find(Boolean) ?? null); };
  // Typical 5v5 hours per game, by position group, from this season's file.
  const hrs = { D: [], F: [] };
  for (const [id, q] of Object.entries(cur.players)) {
    const gp = total?.players?.[id]?.gp;
    if (gp >= 5 && q.p) hrs[q.p].push(q.h / gp);
  }
  const expo = Object.fromEntries(Object.entries(hrs).map(([g, v]) => [g, (v.length ? v.reduce((a, b) => a + b, 0) / v.length : g === 'D' ? 0.2 : 0.17) * GAMES]));
  const out = new Map();
  const ids = new Set(files.flatMap((f) => (f?.v >= 2 ? Object.keys(f.players ?? {}) : [])));
  for (const id of ids) {
    const g = grp(id);
    const b = g && blendDefending(files, id);
    if (!b) continue;
    const k = expo[g] * gpa;
    out.set(Number(id), { def: b.df * k, puck: b.pc * k, group: g, seasons: b.seasons.map((s) => s && { def: s.df * k, puck: s.pc * k, h: s.h }) });
  }
  return out;
}

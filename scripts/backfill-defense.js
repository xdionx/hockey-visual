// Builds past seasons' adjusted defense files (seasons/<season>-def.json: Defending / Puck control split, penalty kill totals).
//
//   node scripts/backfill-defense.js <outDir> [--minutes 40] [--newest 20252026] [--oldest 20172018] [--cache <dir>]
//
// Each regular-season game's shift chart and play-by-play become 5v5 and 4v5 stints (src/stints.js); a whole season's stints
// feed one ridge fit (src/rapm.js). A season is ~2,600 requests, so a run works for at most --minutes and parks the stints it has
// in <outDir>/stints/<season>.json.gz; the next run carries on. Once a season is fit, its stints are dropped and the def file
// is marked complete, and it is skipped from then on. --cache reads <dir>/d<season>/<gameId>.json ({ pbp, shifts }) instead of the API.
import { mkdir, readFile, writeFile, readdir, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { gzipSync, gunzipSync } from 'node:zlib';
import { stintData } from '../src/stints.js';
import { fitDefense, pkTotals } from '../src/rapm.js';
import { defFile } from '../src/defending.js';
import { seasonOf } from '../src/seasonStats.js';

const args = process.argv.slice(2);
const outDir = args.find((a, i) => !a.startsWith('--') && !args[i - 1]?.startsWith('--')) ?? 'seasons-data';
const opt = (name, fallback) => { const i = args.indexOf(`--${name}`); return i >= 0 ? args[i + 1] : fallback; };
const prevSeason = (s) => Number(`${Math.floor(s / 10000) - 1}${Math.floor(s / 10000)}`);
const newest = Number(opt('newest', prevSeason(seasonOf(new Date().toISOString().slice(0, 10)))));
const oldest = Number(opt('oldest', 20172018));
const cache = opt('cache', null);
const deadline = Date.now() + Number(opt('minutes', 40)) * 60_000;
const PAUSE_MS = 250;
const GIVE_UP_AFTER = 10;

async function get(url) {
  for (let attempt = 0; attempt < 5; attempt++) {
    try {
      const res = await fetch(url, { headers: { accept: 'application/json', 'user-agent': 'hockey-visual-backfill/1.0' } });
      if (res.status === 404) return null;
      if (res.status === 429 || res.status >= 500) { await new Promise((r) => setTimeout(r, 2000 * 2 ** attempt)); continue; }
      return res.ok ? await res.json() : null;
    } catch { await new Promise((r) => setTimeout(r, 2000 * 2 ** attempt)); }
  }
  return null;
}
async function game(season, n) {
  const id = `${String(season).slice(0, 4)}02${String(n).padStart(4, '0')}`;
  if (cache) { // cached games keep shifts as [player, team, period, start, end, length] rows
    const c = JSON.parse(await readFile(join(cache, `d${String(season).slice(2, 4)}${String(season).slice(6, 8)}`, `${id}.json`), 'utf8').catch(() => 'null'));
    return c && { pbp: c.pbp, shifts: { data: (c.shifts ?? []).map((a) => ({ playerId: a[0], teamId: a[1], period: a[2], startTime: a[3], endTime: a[4], typeCode: 517 })) } };
  }
  await new Promise((r) => setTimeout(r, PAUSE_MS));
  const pbp = await get(`https://api-web.nhle.com/v1/gamecenter/${id}/play-by-play`);
  if (!pbp?.plays?.length) return null;
  if (!['OFF', 'FINAL'].includes(pbp.gameState)) return { pbp, shifts: null };
  await new Promise((r) => setTimeout(r, PAUSE_MS));
  return { pbp, shifts: await get(`https://api.nhle.com/stats/rest/en/shiftcharts?cayenneExp=gameId=${id}`) };
}

await mkdir(join(outDir, 'seasons'), { recursive: true });
await mkdir(join(outDir, 'stints'), { recursive: true });
let out = false, added = 0;
for (let season = newest; season >= oldest && !out; season = prevSeason(season)) {
  const defPath = join(outDir, 'seasons', `${season}-def.json`);
  const done = JSON.parse(await readFile(defPath, 'utf8').catch(() => 'null'));
  if (done?.v >= 2 && done.complete) continue;
  const sp = join(outDir, 'stints', `${season}.json.gz`);
  const st = await readFile(sp).then((b) => JSON.parse(gunzipSync(b))).catch(() => null) ?? { next: 1, games: 0, rows: [], pk: [], pos: {}, blk: {} };
  let misses = 0, finished = false;
  const save = async () => writeFile(sp, gzipSync(JSON.stringify(st)));
  while (!finished) {
    if (Date.now() > deadline) { await save(); out = true; break; }
    const g = await game(season, st.next);
    if (!g?.pbp?.plays?.length || !['OFF', 'FINAL'].includes(g.pbp.gameState)) {
      if (++misses >= GIVE_UP_AFTER) finished = true; else st.next++;
      continue;
    }
    misses = 0;
    const d = stintData(g.pbp, g.shifts);
    if (d.rows.length) {
      for (const r of d.rows) st.rows.push(r);
      for (const r of d.pk) st.pk.push(r);
      Object.assign(st.pos, d.pos);
      for (const [k, n] of Object.entries(d.blk)) st.blk[k] = (st.blk[k] ?? 0) + n;
      st.games++;
    }
    st.next++; added++;
    if (added % 100 === 0) await save();
  }
  if (!finished) continue;
  const fit = fitDefense(st.rows);
  await writeFile(defPath, `${JSON.stringify({ ...defFile({ season, games: st.games, gpa: fit.gpa, players: fit.players, pos: st.pos, pk: pkTotals(st.pk), blk: st.blk }), complete: true })}\n`);
  await rm(sp, { force: true });
  console.log(`${season}: ${st.games} games, ${Object.keys(fit.players).length} skaters`);
}
console.log(`Defense backfill: ${added} games read`);

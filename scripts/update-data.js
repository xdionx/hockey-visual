// Saves NHL scores as static JSON files for the GitHub Pages site.
//
//   node scripts/update-data.js <outDir> [--from YYYY-MM-DD] [--ahead N]
//
// Writes <outDir>/scores/<date>.json for every date from --from through N days
// after the NHL's current date, plus <outDir>/latest.json ({ date }) so the page
// knows what "today" is. Dates already saved are skipped unless they are recent
// (the last 2 days or later), so a scheduled run only re-fetches what can change.
//
// Also writes <outDir>/games/<gameId>.json (the box score) for every game that has
// started. Finished games already saved are skipped.
//
// Then rolls the current season's finished regular-season games up into
// <outDir>/seasons/<season>.json (SAT and momentum per player, see src/seasonStats.js).
// Past seasons come from scripts/backfill-seasons.js instead.
import { mkdir, readFile, writeFile, access, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { getScoreboard, getGameDetailRaw } from '../src/nhlApi.js';
import { normalizeGameDetail } from '../src/gameDetail.js';
import { normalizeScoreboard } from '../src/normalize.js';
import { shotAttempts } from '../src/sat.js';
import { emptySeason, addGame, linesFromDetail, seasonOf } from '../src/seasonStats.js';

const args = process.argv.slice(2);
const outDir = args.find((a) => !a.startsWith('--')) ?? 'data';
const opt = (name, fallback) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : fallback;
};
// Default backfill: start of the 2026-27 preseason.
const from = opt('from', '2026-09-20');
const ahead = Number(opt('ahead', 14));

const shift = (iso, days) => {
  const d = new Date(`${iso}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
};
const exists = (p) => access(p).then(() => true, () => false);

async function writeIfChanged(path, data) {
  const text = `${JSON.stringify(data)}\n`;
  const old = await readFile(path, 'utf8').catch(() => null);
  if (old === text) return false;
  await writeFile(path, text);
  return true;
}

const now = await getScoreboard();
const today = now.currentDate;
const refreshFrom = shift(today, -2);
const until = shift(today, ahead);
await mkdir(join(outDir, 'scores'), { recursive: true });

let fetched = 0;
let changed = 0;
for (let date = from; date <= until; date = shift(date, 1)) {
  const file = join(outDir, 'scores', `${date}.json`);
  if (date < refreshFrom && (await exists(file))) continue;
  if (fetched) await new Promise((r) => setTimeout(r, 300)); // be gentle with the API
  const raw = date === today ? now : await getScoreboard(date);
  fetched++;
  if (await writeIfChanged(file, normalizeScoreboard(raw))) changed++;
}
if (await writeIfChanged(join(outDir, 'latest.json'), { date: today })) changed++;

// Box scores for every game that has started, up to today.
await mkdir(join(outDir, 'games'), { recursive: true });
await mkdir(join(outDir, 'sat'), { recursive: true });
let boxFetched = 0;
let boxFailed = 0;
for (let date = from; date <= today; date = shift(date, 1)) {
  const day = JSON.parse(await readFile(join(outDir, 'scores', `${date}.json`), 'utf8').catch(() => 'null'));
  for (const game of day?.games ?? []) {
    if (game.status.state === 'pre' || game.status.state === 'postponed') continue;
    const file = join(outDir, 'games', `${game.id}.json`);
    const saved = JSON.parse(await readFile(file, 'utf8').catch(() => 'null'));
    const satFile = join(outDir, 'sat', `${game.id}.json`);
    if (saved?.status?.state === 'final' && date < refreshFrom && (await exists(satFile))) continue;
    await new Promise((r) => setTimeout(r, 300));
    try {
      const raw = await getGameDetailRaw(game.id);
      const detail = normalizeGameDetail(raw);
      boxFetched++;
      if (raw.pbp) await writeIfChanged(satFile, shotAttempts(raw.pbp));
      if (await writeIfChanged(file, detail)) changed++;
    } catch (err) {
      boxFailed++;
      console.warn(`Box score ${game.id} failed: ${err.message}`);
    }
  }
}

// Current season totals, rebuilt from the saved box scores (cheap: no API calls).
const season = seasonOf(today);
const total = emptySeason(season);
const gameFiles = (await readdir(join(outDir, 'games'))).filter((f) => f.endsWith('.json')).sort();
for (const f of gameFiles) {
  const g = JSON.parse(await readFile(join(outDir, 'games', f), 'utf8').catch(() => 'null'));
  if (!g || g.season !== season || g.gameType !== 2 || g.status?.state !== 'final') continue;
  addGame(total, linesFromDetail(g));
}
await mkdir(join(outDir, 'seasons'), { recursive: true });
const seasonFile = join(outDir, 'seasons', `${season}.json`);
const before = JSON.parse(await readFile(seasonFile, 'utf8').catch(() => 'null'));
if (before?.games !== total.games || JSON.stringify(before?.players) !== JSON.stringify(total.players)) {
  total.updated = new Date().toISOString();
  total.complete = false;
  await writeFile(seasonFile, `${JSON.stringify(total)}\n`);
  changed++;
}

console.log(`NHL date ${today}: fetched ${fetched} days and ${boxFetched} box scores (${boxFailed} failed), ${changed} files changed`);

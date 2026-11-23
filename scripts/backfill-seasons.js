// Builds past seasons' SAT and momentum totals per player from the NHL play-by-play.
//
//   node scripts/backfill-seasons.js <outDir> [--minutes 40] [--newest 20252026] [--oldest 20092010]
//
// Writes <outDir>/seasons/<season>.json (see src/seasonStats.js), newest season first, and each
// season's playoffs to <outDir>/seasons/<season>-p.json. A full
// season is about 1,300 play-by-play requests, so each run works for at most --minutes and saves
// where it stopped (`next`, the next game number); the next run carries on from there. Finished
// seasons never change, so a season marked complete is skipped unless SEASON_VERSION changed.
// Regular season game ids are <season start>02NNNN, numbered from 1. Playoff game ids (03RRSG: round,
// series, game) aren't numbered straight through and 2019-20 added a qualifying round, so the playoffs
// take their game list from the NHL schedule instead (about 15 weekly requests a season). Preseason
// games never count.
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { emptySeason, addGame, fromPbp, seasonOf, seasonFile, SEASON_VERSION, FIRST_FULL_SEASON, REGULAR, PLAYOFFS } from '../src/seasonStats.js';

const args = process.argv.slice(2);
const outDir = args.find((a) => !a.startsWith('--')) ?? 'seasons-data';
const opt = (name, fallback) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : fallback;
};
const prevSeason = (s) => Number(`${Math.floor(s / 10000) - 1}${Math.floor(s / 10000)}`);
const newest = Number(opt('newest', prevSeason(seasonOf(new Date().toISOString().slice(0, 10)))));
const oldest = Number(opt('oldest', FIRST_FULL_SEASON));
const deadline = Date.now() + Number(opt('minutes', 40)) * 60_000;
const PAUSE_MS = 250; // be gentle with the API
const GIVE_UP_AFTER = 10; // missing game numbers in a row = the season is over

async function api(path) {
  for (let attempt = 0; ; attempt++) {
    const res = await fetch(`https://api-web.nhle.com/v1/${path}`, { headers: { accept: 'application/json', 'user-agent': 'hockey-visual-backfill/1.0' } });
    if (res.status === 404) return null;
    if ((res.status === 429 || res.status >= 500) && attempt < 4) {
      await new Promise((r) => setTimeout(r, 2000 * 2 ** attempt));
      continue;
    }
    if (!res.ok) throw new Error(`NHL API ${res.status} for ${path}`);
    return res.json();
  }
}
const pbp = (gameId) => api(`gamecenter/${gameId}/play-by-play`);

/**
 * Every playoff game id of a season, in order, from the weekly schedule. Starts April 1 of the season's
 * second year and stops two empty weeks after the last playoff game (the 2020 bubble ran into September).
 */
async function playoffIds(season) {
  const ids = new Set();
  let empty = 0;
  for (let d = new Date(`${String(season).slice(4)}-04-01T12:00:00Z`); d.getUTCMonth() < 10 && !(ids.size && empty >= 2); d.setUTCDate(d.getUTCDate() + 7)) {
    await new Promise((r) => setTimeout(r, PAUSE_MS));
    const week = await api(`schedule/${d.toISOString().slice(0, 10)}`);
    const found = (week?.gameWeek ?? []).flatMap((day) => day.games ?? []).filter((g) => g.gameType === PLAYOFFS);
    found.forEach((g) => ids.add(g.id));
    empty = found.length ? 0 : empty + 1;
  }
  return [...ids].sort((a, b) => a - b);
}

await mkdir(join(outDir, 'seasons'), { recursive: true });
let done = 0;
let outOfTime = false;

/** Builds (or carries on with) one season file; false when time ran out. */
async function build(season, gameType) {
  const file = join(outDir, 'seasons', seasonFile(season, gameType));
  let total = JSON.parse(await readFile(file, 'utf8').catch(() => 'null'));
  if (total?.v !== SEASON_VERSION) total = { ...emptySeason(season, gameType), next: gameType === REGULAR ? 1 : 0, complete: false };
  if (total.complete) return true;
  const save = async () => {
    total.updated = new Date().toISOString();
    await writeFile(file, `${JSON.stringify(total)}\n`);
  };
  // Regular season: the next game number. Playoffs: the position in the season's playoff game list.
  const ids = gameType === PLAYOFFS ? await playoffIds(season) : null;
  let misses = 0;
  const startYear = String(season).slice(0, 4);
  while (!total.complete) {
    if (Date.now() > deadline) { await save(); return false; }
    if (ids && total.next >= ids.length) { total.complete = true; break; }
    const id = ids ? ids[total.next] : `${startYear}02${String(total.next).padStart(4, '0')}`;
    await new Promise((r) => setTimeout(r, PAUSE_MS));
    const data = await pbp(id);
    if (!data?.plays?.length || !['OFF', 'FINAL'].includes(data.gameState)) {
      if (ids) { total.next++; continue; } // a listed playoff game without a usable play-by-play: skip it
      if (++misses >= GIVE_UP_AFTER) {
        total.next -= misses - 1; // point back at the first missing number
        total.complete = true;
      } else total.next++;
      continue;
    }
    misses = 0;
    const { lines, game } = fromPbp(data);
    addGame(total, lines, game);
    total.next++;
    done++;
    if (done % 50 === 0) await save();
  }
  await save();
  console.log(`${season}${gameType === PLAYOFFS ? ' playoffs' : ''}: ${total.games} games${total.complete ? ' (complete)' : ''}`);
  return true;
}

for (let season = newest; season >= oldest && !outOfTime; season = prevSeason(season)) {
  outOfTime = !(await build(season, REGULAR)) || !(await build(season, PLAYOFFS));
}
console.log(`Backfill: added ${done} games`);

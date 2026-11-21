// Builds past seasons' SAT and momentum totals per player from the NHL play-by-play.
//
//   node scripts/backfill-seasons.js <outDir> [--minutes 40] [--newest 20252026] [--oldest 20092010]
//
// Writes <outDir>/seasons/<season>.json (see src/seasonStats.js), newest season first. A full
// season is about 1,300 play-by-play requests, so each run works for at most --minutes and saves
// where it stopped (`next`, the next game number); the next run carries on from there. Finished
// seasons never change, so a season marked complete is skipped unless SEASON_VERSION changed.
// Regular season only (game ids <season start>02NNNN, numbered from 1).
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { emptySeason, addGame, linesFromPbp, seasonOf, SEASON_VERSION, FIRST_FULL_SEASON } from '../src/seasonStats.js';

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

async function pbp(gameId) {
  for (let attempt = 0; ; attempt++) {
    const res = await fetch(`https://api-web.nhle.com/v1/gamecenter/${gameId}/play-by-play`, { headers: { accept: 'application/json', 'user-agent': 'hockey-visual-backfill/1.0' } });
    if (res.status === 404) return null;
    if ((res.status === 429 || res.status >= 500) && attempt < 4) {
      await new Promise((r) => setTimeout(r, 2000 * 2 ** attempt));
      continue;
    }
    if (!res.ok) throw new Error(`NHL API ${res.status} for ${gameId}`);
    return res.json();
  }
}

await mkdir(join(outDir, 'seasons'), { recursive: true });
let done = 0;
outer: for (let season = newest; season >= oldest; season = prevSeason(season)) {
  const file = join(outDir, 'seasons', `${season}.json`);
  let total = JSON.parse(await readFile(file, 'utf8').catch(() => 'null'));
  if (total?.v !== SEASON_VERSION) total = { ...emptySeason(season), next: 1, complete: false };
  if (total.complete) continue;
  const save = async () => {
    total.updated = new Date().toISOString();
    await writeFile(file, `${JSON.stringify(total)}\n`);
  };
  let misses = 0;
  const startYear = String(season).slice(0, 4);
  while (!total.complete) {
    if (Date.now() > deadline) { await save(); break outer; }
    const id = `${startYear}02${String(total.next).padStart(4, '0')}`;
    await new Promise((r) => setTimeout(r, PAUSE_MS));
    const data = await pbp(id);
    if (!data?.plays?.length || !['OFF', 'FINAL'].includes(data.gameState)) {
      if (++misses >= GIVE_UP_AFTER) {
        total.next -= misses - 1; // point back at the first missing number
        total.complete = true;
      } else total.next++;
      continue;
    }
    misses = 0;
    addGame(total, linesFromPbp(data));
    total.next++;
    done++;
    if (done % 50 === 0) await save();
  }
  await save();
  console.log(`${season}: ${total.games} games${total.complete ? ' (complete)' : ''}`);
}
console.log(`Backfill: added ${done} games`);

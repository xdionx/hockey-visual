// Saves NHL scores as static JSON files for the GitHub Pages site.
//
//   node scripts/update-data.js <outDir> [--from YYYY-MM-DD] [--ahead N] [--seasons <dir of past season files>]
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
// <outDir>/seasons/<season>.json (playoff games into <season>-p.json) (SAT and momentum per player, see src/seasonStats.js). Each game's
// player lines are computed from its play-by-play with today's model and kept in
// <outDir>/lines/<gameId>.json, tagged with SEASON_VERSION: when the model changes, every game is
// recomputed, so a season never mixes old and new momentum weights.
// Past seasons come from scripts/backfill-seasons.js instead.
import { mkdir, readFile, writeFile, access, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { getScoreboard, getGameDetailRaw } from '../src/nhlApi.js';
import { normalizeGameDetail } from '../src/gameDetail.js';
import { normalizeScoreboard } from '../src/normalize.js';
import { shotAttempts } from '../src/sat.js';
import { stintRows } from '../src/stints.js';
import { fitDefense } from '../src/rapm.js';
import { getShifts } from '../src/nhlApi.js';
import { emptyRecent, addRecent, recentFile, emptySeason, addGame, fromPbp, linesFromDetail, seasonOf, seasonFile, SEASON_VERSION } from '../src/seasonStats.js';
import { getPlayByPlay } from '../src/nhlApi.js';
import { parsePartner, mergeOdds } from '../src/odds.js';
import { predictGame } from '../src/predict.js';

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

/** Saves one finished game's player lines (SAT, momentum) for the season totals. */
async function writeLines(gameId, pbp) {
  await mkdir(join(outDir, 'lines'), { recursive: true });
  const { lines, game } = fromPbp(pbp);
  const out = { v: SEASON_VERSION, gameId, lines, game };
  await writeIfChanged(join(outDir, 'lines', `${gameId}.json`), out);
  return out;
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
      if (raw.pbp && detail.status.state === 'final' && !detail.status.settling && (detail.gameType === 2 || detail.gameType === 3)) await writeLines(game.id, raw.pbp);
      if (await writeIfChanged(file, detail)) changed++;
    } catch (err) {
      boxFailed++;
      console.warn(`Box score ${game.id} failed: ${err.message}`);
    }
  }
}

// Current season totals from every finished regular-season game's player lines, and the playoffs
// in their own file (<season>-p.json). Preseason games never count.
const season = seasonOf(today);
const totals = { 2: emptySeason(season, 2), 3: emptySeason(season, 3) };
const recent = emptyRecent(season);
let linesFetched = 0;
let stintsFetched = 0;
const STINTS_PER_RUN = 120; // new games per run; the rest catch up on the next runs
const stintAll = [];
let stintGames = 0;
for (const f of (await readdir(join(outDir, 'games'))).filter((x) => x.endsWith('.json')).sort()) {
  const g = JSON.parse(await readFile(join(outDir, 'games', f), 'utf8').catch(() => 'null'));
  const total = totals[g?.gameType];
  if (!g || !total || g.season !== season || g.status?.state !== 'final' || g.status.settling) continue; // settling: wait for the official FINAL stats
  let saved = JSON.parse(await readFile(join(outDir, 'lines', `${g.id}.json`), 'utf8').catch(() => 'null'));
  if (saved?.v !== SEASON_VERSION) {
    await new Promise((r) => setTimeout(r, 300));
    try {
      saved = await writeLines(g.id, await getPlayByPlay(g.id));
      linesFetched++;
    } catch (err) {
      console.warn(`Player lines ${g.id} failed: ${err.message}`);
      continue;
    }
  }
  // 5v5 stints for the adjusted defense model (regular season only), saved once per finished game.
  if (g.gameType === 2 && g.hasShifts) {
    let st = JSON.parse(await readFile(join(outDir, 'stints', `${g.id}.json`), 'utf8').catch(() => 'null'));
    if (!st && stintsFetched < STINTS_PER_RUN) {
      stintsFetched++;
      await new Promise((r) => setTimeout(r, 300));
      try {
        st = { v: 1, rows: stintRows(await getPlayByPlay(g.id), await getShifts(g.id)) };
        await mkdir(join(outDir, 'stints'), { recursive: true });
        await writeFile(join(outDir, 'stints', `${g.id}.json`), JSON.stringify(st));
      } catch (err) {
        console.warn(`Stints ${g.id} failed: ${err.message}`);
      }
    }
    if (st?.rows?.length) { for (const r of st.rows) stintAll.push(r); stintGames++; }
  }
  // Time on ice comes from the box score (the play-by-play doesn't carry it).
  const toi = new Map(linesFromDetail(g).map((l) => [l.id, l.toi]));
  // On-ice shot attempts and goals per skater come from the box score's shift charts (when the game had them).
  const oi = new Map(g.hasShifts ? ['away', 'home'].flatMap((side) => [...(g.players?.[side]?.forwards ?? []), ...(g.players?.[side]?.defense ?? [])]).filter((s) => s.onIce).map((s) => [s.id, s.onIce]) : []);
  const merged = saved.lines.map((l) => ({ ...l, toi: toi.get(l.id) ?? null, oi: oi.get(l.id) }));
  addGame(total, merged, saved.game ?? null);
  if (g.gameType === 2) addRecent(recent, merged, Number(String(g.id).slice(-4)));
}
await mkdir(join(outDir, 'seasons'), { recursive: true });
for (const total of Object.values(totals)) {
  if (total.gameType === 3 && !total.games) continue; // no playoff games yet this season
  const file = join(outDir, 'seasons', seasonFile(season, total.gameType));
  const before = JSON.parse(await readFile(file, 'utf8').catch(() => 'null'));
  if (before?.games !== total.games || JSON.stringify(before?.players) !== JSON.stringify(total.players) || JSON.stringify(before?.g) !== JSON.stringify(total.g)) {
    total.updated = new Date().toISOString();
    total.complete = false;
    await writeFile(file, `${JSON.stringify(total)}\n`);
    changed++;
  }
}
// Adjusted 5v5 defense for the whole season so far (ridge regression over every saved stint).
if (stintAll.length) {
  const fit = fitDefense(stintAll);
  const df = join(outDir, 'seasons', `${season}-def.json`);
  const body = `${JSON.stringify({ season, v: 1, games: stintGames, gpa: fit.gpa, players: fit.players })}\n`;
  const prev = await readFile(df, 'utf8').catch(() => null);
  if (!prev || JSON.parse(prev).games !== stintGames) {
    await writeFile(df, body);
    changed++;
  }
}
// Each team's last 10 games of player lines, for the Team deficiencies "Last 10 games" view.
if (totals[2].games) {
  const rf = join(outDir, 'seasons', recentFile(season));
  const body = `${JSON.stringify(recent)}\n`;
  if ((await readFile(rf, 'utf8').catch(() => null)) !== body) {
    await writeFile(rf, body);
    changed++;
  }
}
const total = totals[2];

// Sportsbook lines (DraftKings US, FanDuel Canada) and our pre-game pick, kept for the "us vs the market" card.
// Lines and picks keep updating until puck drop, then freeze as the closing line. Results are filled in once final.
try {
  const prev = JSON.parse(await readFile(join(opt('seasons', 'seasons/seasons'), `${season - 10001}.json`), 'utf8').catch(() => 'null'));
  const snaps = [];
  for (const c of ['US', 'CA']) {
    const res = await fetch(`https://api-web.nhle.com/v1/partner-game/${c}/now`, { headers: { accept: 'application/json' } }).catch(() => null);
    if (res?.ok) snaps.push(...parsePartner(await res.json()));
    await new Promise((r) => setTimeout(r, 300));
  }
  const oddsFile = join(outDir, 'odds.json');
  const saved = JSON.parse(await readFile(oddsFile, 'utf8').catch(() => 'null'));
  const nowMs = Date.now();
  const board = JSON.parse(await readFile(join(outDir, 'scores', `${today}.json`), 'utf8').catch(() => 'null'));
  const yest = JSON.parse(await readFile(join(outDir, 'scores', `${shift(today, -1)}.json`), 'utf8').catch(() => 'null'));
  const played = new Set((yest?.games ?? []).filter((g) => g.status.state !== 'postponed').flatMap((g) => [g.away.abbrev, g.home.abbrev]));
  const picks = new Map();
  const dateOf = {};
  for (const g of board?.games ?? []) {
    dateOf[g.id] = g.gameDate;
    if (g.gameType !== 2 || Date.parse(g.startTimeUTC) <= nowMs) continue;
    const p = predictGame({ total, prev, away: g.away.abbrev, home: g.home.abbrev, n: Number(String(g.id).slice(-4)), b2b: { away: played.has(g.away.abbrev), home: played.has(g.home.abbrev) } });
    if (p) picks.set(g.id, p);
  }
  const before = JSON.stringify({ ...saved, updated: 0 }); // mergeOdds edits the saved game objects in place, so compare with a copy
  const odds = mergeOdds(saved, snaps, picks, nowMs, dateOf);
  // Results for saved games that have finished (scores files are refreshed for the last two days).
  const finals = new Map();
  for (const g of Object.values(odds.games).filter((x) => !x.result && x.date <= today)) {
    if (!finals.has(g.date)) finals.set(g.date, JSON.parse(await readFile(join(outDir, 'scores', `${g.date}.json`), 'utf8').catch(() => 'null')));
  }
  for (const [id, g] of Object.entries(odds.games)) {
    if (g.result && g.margin != null) continue;
    if (!finals.has(g.date)) finals.set(g.date, JSON.parse(await readFile(join(outDir, 'scores', `${g.date}.json`), 'utf8').catch(() => 'null')));
    const f = finals.get(g.date)?.games?.find((x) => String(x.id) === id);
    if (f?.status.state === 'final') {
      const { away, home } = f.linescore.totals; // the shootout goal counts, so a shootout game is a one-goal margin
      g.result = away > home ? 'away' : 'home';
      g.margin = away - home;
      g.goals = away + home;
    }
  }
  const same = saved && JSON.stringify({ ...odds, updated: 0 }) === before;
  if (!same) { await writeFile(oddsFile, `${JSON.stringify(odds)}\n`); changed++; }
} catch (err) {
  console.warn(`Odds step failed: ${err.message}`);
}

console.log(`NHL date ${today}: fetched ${fetched} days, ${boxFetched} box scores (${boxFailed} failed) and ${linesFetched} player-line games, ${changed} files changed`);

// Saves a slim copy of every regular-season play-by-play, for testing momentum model versions offline.
//
//   node scripts/cache-pbp.js <outDir> --seasons 20212022,20222023 [--concurrency 4]
//
// Writes <outDir>/<season>.ndjson.gz: one game per line, with only the fields src/momentum.js and
// src/seasonStats.js read (about a tenth of the raw size). Resumes: games already saved are skipped.
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { gzipSync, gunzipSync } from 'node:zlib';
import { slim } from '../src/pbpSlim.js';

const args = process.argv.slice(2);
const outDir = args.find((a) => !a.startsWith('--')) ?? 'pbp-cache';
const opt = (name, fallback) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : fallback;
};
const seasons = String(opt('seasons', '')).split(',').filter(Boolean).map(Number);
const concurrency = Number(opt('concurrency', 4));

async function get(gameId) {
  for (let attempt = 0; ; attempt++) {
    try {
      const res = await fetch(`https://api-web.nhle.com/v1/gamecenter/${gameId}/play-by-play`, { headers: { accept: 'application/json', 'user-agent': 'hockey-visual-cache/1.0' } });
      if (res.status === 404) return null;
      if ((res.status === 429 || res.status >= 500) && attempt < 6) { await new Promise((r) => setTimeout(r, 2000 * 2 ** attempt)); continue; }
      if (!res.ok) throw new Error(`NHL API ${res.status} for ${gameId}`);
      return await res.json();
    } catch (e) {
      if (attempt >= 6) throw e;
      await new Promise((r) => setTimeout(r, 2000 * 2 ** attempt));
    }
  }
}

await mkdir(outDir, { recursive: true });
for (const season of seasons) {
  const file = join(outDir, `${season}.ndjson.gz`);
  const have = new Map();
  try {
    for (const line of gunzipSync(await readFile(file)).toString().split('\n').filter(Boolean)) { const g = JSON.parse(line); have.set(g.id, line); }
  } catch {}
  const year = String(season).slice(0, 4);
  // A season has at most 1,312 regular-season games (32 teams x 82 / 2); older ones 1,230 or fewer.
  const ids = Array.from({ length: 1312 }, (_, i) => Number(`${year}02${String(i + 1).padStart(4, '0')}`)).filter((id) => !have.has(id));
  let next = 0;
  let added = 0;
  const save = async () => writeFile(file, gzipSync([...have.entries()].sort((a, b) => a[0] - b[0]).map(([, l]) => l).join('\n') + '\n'));
  await Promise.all(Array.from({ length: concurrency }, async () => {
    while (next < ids.length) {
      const id = ids[next++];
      await new Promise((r) => setTimeout(r, 120));
      const raw = await get(id);
      if (!raw?.plays?.length || !['OFF', 'FINAL'].includes(raw.gameState)) continue;
      have.set(id, JSON.stringify(slim(raw)));
      if (++added % 200 === 0) { await save(); console.log(`${season}: ${have.size} games`); }
    }
  }));
  await save();
  console.log(`${season}: done, ${have.size} games`);
}

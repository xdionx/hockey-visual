// Tests momentum model versions against past seasons, offline.
//
//   node scripts/model-lab.js <pbpCacheDir> [--out public/data/model-lab.json] [--only v3,v4]
//
// Reads the slim play-by-play saved by scripts/cache-pbp.js, scores every game with each model
// version in VERSIONS, and writes one summary per version per season (see src/modelLab.js for the checks).
import { readFile, readdir, writeFile, mkdir } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { gunzipSync } from 'node:zlib';
import { VERSIONS, scoreGame, summarize, predictionPairs, pooledPrediction } from '../src/modelLab.js';

const args = process.argv.slice(2);
const dir = args.find((a) => !a.startsWith('--')) ?? 'pbp-cache';
const opt = (name, fallback) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : fallback;
};
const out = opt('out', null);
const only = opt('only', null)?.split(',');
const versions = VERSIONS.filter((v) => !only || only.includes(v.id));

const files = (await readdir(dir)).filter((f) => f.endsWith('.ndjson.gz')).sort();
const pairs = Object.fromEntries(versions.map((v) => [v.id, { half: [], ahead: [] }]));
const result = { updated: new Date().toISOString(), versions: versions.map(({ id, name, note, live }) => ({ id, name, note, live: !!live })), seasons: {} };
for (const f of files) {
  const season = Number(f.slice(0, 8));
  const games = gunzipSync(await readFile(join(dir, f))).toString().split('\n').filter(Boolean).map((l) => JSON.parse(l));
  const rows = Object.fromEntries(versions.map((v) => [v.id, []]));
  for (const g of games) for (const v of versions) { const r = scoreGame(g, v); if (r) rows[v.id].push(r); }
  result.seasons[season] = Object.fromEntries(versions.map((v) => [v.id, summarize(rows[v.id])]));
  for (const v of versions) {
    const p = predictionPairs(rows[v.id]);
    pairs[v.id].half.push(...p.half);
    pairs[v.id].ahead.push(...p.ahead);
  }
  console.error(`${season}: ${games.length} games`);
}
result.pooled = Object.fromEntries(versions.map((v) => {
  const p = pool(Object.values(result.seasons).map((s) => s[v.id]));
  // Prediction correlations over every season's pairs at once (a bigger, steadier test than an average of seasons).
  return [v.id, { ...p, checks: { ...p.checks, ...pooledPrediction(pairs[v.id]) } }];
}));

/** Average of each check over the seasons. */
function pool(list) {
  const keys = new Set(list.flatMap((s) => Object.keys(s.checks)));
  const checks = {};
  for (const k of keys) {
    const vals = list.map((s) => s.checks[k]).filter((v) => v != null);
    checks[k] = vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : null;
  }
  return { seasons: list.length, games: list.reduce((a, s) => a + s.games, 0), checks };
}

const table = [['version', ...Object.keys(result.pooled[versions[0].id].checks)]];
for (const v of versions) table.push([v.id, ...Object.values(result.pooled[v.id].checks).map((x) => (x == null ? '-' : x.toFixed(3)))]);
const w = table[0].map((_, i) => Math.max(...table.map((r) => String(r[i]).length)));
console.log(table.map((r) => r.map((c, i) => String(c).padEnd(w[i])).join('  ')).join('\n'));
if (out) { await mkdir(dirname(out), { recursive: true }); await writeFile(out, `${JSON.stringify(result)}\n`); }

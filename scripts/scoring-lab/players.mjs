// One row per skater per game from the slim pbp cache (scripts/cache-pbp.js): the site's own momentum and
// finishing numbers (fromPbp) plus goals and primary / secondary assists (shootouts left out).
//
//   node scripts/scoring-lab/players.mjs <cache> players.csv
import { readFile, readdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { gunzipSync } from 'node:zlib';
const { fromPbp } = await import(new URL('../../src/seasonStats.js', import.meta.url).href);
const dir = process.argv[2], out = process.argv[3];
const rows = ['season,game,team,home,gf,ga,won,pid,pos,mom,sog,xg,xgg,g,a1,a2,pg,pa1,pa2'];
for (const f of (await readdir(dir)).filter((f) => f.endsWith('.ndjson.gz')).sort()) {
  const season = Number(f.slice(0, 8));
  let n = 0;
  for (const line of gunzipSync(await readFile(join(dir, f))).toString().split('\n').filter(Boolean)) {
    const pbp = JSON.parse(line);
    const { lines, game } = fromPbp(pbp);
    if (!game) continue;
    n++;
    const pts = new Map();
    const bump = (id, k) => { if (!id) return; const p = pts.get(id) ?? { g: 0, a1: 0, a2: 0, pg: 0, pa1: 0, pa2: 0 }; p[k]++; pts.set(id, p); };
    for (const e of pbp.plays) {
      if (e.typeDescKey !== 'goal' || e.periodDescriptor?.periodType === 'SO') continue;
      const d = e.details ?? {};
      // Power-play goals tracked too (situationCode: away goalie, away skaters, home skaters, home goalie).
      const s = String(e.situationCode ?? '');
      const ownerHome = d.eventOwnerTeamId === pbp.homeTeam?.id;
      const pp = s.length === 4 && (ownerHome ? Number(s[2]) > Number(s[1]) : Number(s[1]) > Number(s[2]));
      bump(d.scoringPlayerId, 'g'); bump(d.assist1PlayerId, 'a1'); bump(d.assist2PlayerId, 'a2');
      if (pp) { bump(d.scoringPlayerId, 'pg'); bump(d.assist1PlayerId, 'pa1'); bump(d.assist2PlayerId, 'pa2'); }
    }
    const [, a, h, ag, hg] = game;
    for (const l of lines) {
      if (l.pos === 'G') continue;
      const home = l.team === h ? 1 : 0;
      const gf = home ? hg : ag, gaa = home ? ag : hg;
      const p = pts.get(l.id) ?? { g: 0, a1: 0, a2: 0, pg: 0, pa1: 0, pa2: 0 };
      rows.push([season, pbp.id, l.team, home, gf, gaa, gf > gaa ? 1 : 0, l.id, l.pos, l.mom ?? 0, l.sog ?? 0, l.xg ?? 0, l.xgg ?? 0,
        p.g, p.a1, p.a2, p.pg, p.pa1, p.pa2].join(','));
    }
  }
  console.error(season, n);
}
await writeFile(out, rows.join('\n') + '\n');

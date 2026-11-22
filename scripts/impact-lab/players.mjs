// One row per player per game from the slim pbp cache, using the site's own fromPbp (v4 momentum, our xG).
import { readFile, readdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { gunzipSync } from 'node:zlib';
const { fromPbp } = await import(new URL('../../src/seasonStats.js', import.meta.url).href);
const dir = process.argv[2], out = process.argv[3];
const rows = ['season,game,date,team,opp,home,gf,ga,won,end,pid,pos,mom,mp,mn,sat,sog,xg,xgg,gag,xga,st,tn,on'];
for (const f of (await readdir(dir)).filter((f) => f.endsWith('.ndjson.gz')).sort()) {
  const season = Number(f.slice(0, 8));
  let n = 0;
  for (const line of gunzipSync(await readFile(join(dir, f))).toString().split('\n').filter(Boolean)) {
    const g = JSON.parse(line);
    const { lines, game } = fromPbp(g);
    if (!game) continue;
    n++;
    const [, a, h, ag, hg, , , an, hn, , , end] = game;
    for (const l of lines) {
      const home = l.team === h ? 1 : 0;
      const gf = home ? hg : ag, gaa = home ? ag : hg;
      rows.push([season, g.id, g.gameDate, l.team, home ? a : h, home, gf, gaa, gf > gaa ? 1 : 0, end, l.id, l.pos,
        l.mom ?? '', l.mp ?? '', l.mn ?? '', l.sat ?? '', l.sog ?? '', l.xg ?? '', l.xgg ?? '', l.ga ?? '', l.xga ?? '', l.st ?? '', home ? hn : an, home ? an : hn].join(','));
    }
  }
  console.error(season, n);
}
await writeFile(out, rows.join('\n'));

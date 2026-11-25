// Flattens the slim play-by-play cache into one CSV row per shot a goalie faced (shots on goal and goals,
// shootouts and empty nets left out), with strength, rebound gap, shot type, plate area and our current xG.
//   node scripts/goalie-score-lab/flatten.mjs <pbpCacheDir> <out.csv>
import { readFile, readdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { gunzipSync } from 'node:zlib';
const R = new URL('../../src/', import.meta.url).href;
const { shotXg } = await import(R + 'xg.js');
const { plateArea, elapsedOf } = await import(R + 'momentum.js');
const dir = process.argv[2];
const out = ['season,game,date,goalie,gname,gteam,home,per,t,sh,dk,strength,ptype,area,x,y,gap,gapAny,n10,xg,goal,own'];
const ATT = new Set(['shot-on-goal', 'goal', 'missed-shot', 'blocked-shot']);
for (const f of (await readdir(dir)).filter((f) => f.endsWith('.ndjson.gz')).sort()) {
  const season = Number(f.slice(0, 8));
  for (const line of gunzipSync(await readFile(join(dir, f))).toString().split('\n').filter(Boolean)) {
    const g = JSON.parse(line);
    if (!g.plays?.length) continue;
    const A = g.awayTeam.id;
    const team = new Map(g.rosterSpots.map((r) => [r.playerId, r.teamId]));
    const name = new Map(g.rosterSpots.map((r) => [r.playerId, `${r.firstName?.default ?? ''} ${r.lastName?.default ?? ''}`.trim()]));
    const plays = [...g.plays].sort((a, b) => a.sortOrder - b.sortOrder);
    const last = { 0: [], 1: [] }; // attempt times per attacking side this period
    let lastSog = { per: null, t: null, side: null };
    for (const p of plays) {
      const type = p.typeDescKey;
      if (p.periodDescriptor?.periodType === 'SO') continue;
      if (!ATT.has(type)) continue;
      const d = p.details ?? {};
      const t = elapsedOf(p);
      const per = p.periodDescriptor.number;
      let side = d.eventOwnerTeamId == null ? null : d.eventOwnerTeamId === A ? 0 : 1; // shooting side
      if (type === 'blocked-shot') { const st = team.get(d.shootingPlayerId); side = st != null ? (st === A ? 0 : 1) : side == null ? null : 1 - side; } // shooter's side (owner is the blocking team)
      if (side == null) continue;
      const key = per;
      if (type === 'shot-on-goal' || type === 'goal') {
        if (d.goalieInNetId && d.xCoord != null) {
          const arr = last[side].filter((e) => e.per === per);
          const prevAny = arr.length ? t - arr.at(-1).t : null;
          const prevSog = [...arr].reverse().find((e) => e.sog);
          const gap = prevSog ? t - prevSog.t : null;
          const n10 = arr.filter((e) => t - e.t <= 10).length;
          const sit = String(p.situationCode ?? '');
          const as = Number(sit[1]), hs = Number(sit[2]);
          const sh = side === 0 ? as : hs, dk = side === 0 ? hs : as;
          const strength = !sit || sit.length < 4 ? '' : sh > dk ? 'PP' : sh < dk ? 'SH' : 'EV';
          const gteam = team.get(d.goalieInNetId);
          const xg = shotXg({ x: d.xCoord, y: d.yCoord, shotType: d.shotType });
          out.push([season, g.id, g.gameDate, d.goalieInNetId, JSON.stringify(name.get(d.goalieInNetId) ?? ''), gteam, gteam === A ? 0 : 1, per, t, sh, dk, strength, d.shotType ?? '', plateArea(d.xCoord, d.yCoord), d.xCoord, d.yCoord, gap ?? '', prevAny ?? '', n10, xg.toFixed(4), type === 'goal' ? 1 : 0, ''].join(','));
        }
      }
      last[side].push({ per, t, sog: type === 'shot-on-goal' || type === 'goal' });
    }
  }
  console.error(season);
}
await writeFile(process.argv[3], out.join('\n'));

// Flattens slim pbp into per-game shot/goalie event lists for goalie analysis.
import { readFile, readdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { gunzipSync } from 'node:zlib';
const R = new URL("../../src/", import.meta.url).href;
const { shotXg } = await import(R + 'xg.js');
const { inHomePlate, elapsedOf } = await import(R + 'momentum.js');
const { scoreGame, VERSIONS } = await import(R + 'modelLab.js');
const v4 = VERSIONS.find((v) => v.id === 'v4');
const dir = process.argv[2], out = process.argv[3];
const all = [];
for (const f of (await readdir(dir)).filter((f) => f.endsWith('.ndjson.gz')).sort()) {
  const season = Number(f.slice(0, 8));
  for (const line of gunzipSync(await readFile(join(dir, f))).toString().split('\n').filter(Boolean)) {
    const g = JSON.parse(line);
    if (!g.plays?.length) continue;
    const A = g.awayTeam.id;
    const team = new Map(g.rosterSpots.map((r) => [r.playerId, r.teamId]));
    const goalies = new Set(g.rosterSpots.filter((r) => r.positionCode === 'G').map((r) => r.playerId));
    const plays = [...g.plays].sort((a, b) => a.sortOrder - b.sortOrder);
    const ev = [];
    for (const p of plays) {
      if (p.periodDescriptor?.periodType === 'SO') continue;
      const d = p.details ?? {};
      const k = { 'shot-on-goal': 's', goal: 'g', 'missed-shot': 'm', 'blocked-shot': 'b', penalty: 'p', 'period-end': 'e', faceoff: 'f' }[p.typeDescKey];
      if (!k) continue;
      const t = elapsedOf(p);
      let side;
      if (k === 'b') { const st = team.get(d.shootingPlayerId); side = st != null ? (st === A ? 0 : 1) : d.eventOwnerTeamId != null ? (d.eventOwnerTeamId === A ? 1 : 0) : null; }
      else side = d.eventOwnerTeamId == null ? null : d.eventOwnerTeamId === A ? 0 : 1; // 0 away,1 home
      const e = { k, t, s: side, sit: p.situationCode, per: p.periodDescriptor.number };
      if (k === 's' || k === 'g' || k === 'm') {
        e.x = d.xCoord; e.y = d.yCoord; e.hp = inHomePlate(d.xCoord, d.yCoord) ? 1 : 0;
        e.xg = shotXg({ x: d.xCoord, y: d.yCoord, shotType: d.shotType });
        e.gid = d.goalieInNetId ?? null; e.st = d.shotType;
      }
      ev.push(e);
    }
    const r = scoreGame(g, v4);
    all.push({ id: g.id, season, date: g.gameDate, a: g.awayTeam.abbrev, h: g.homeTeam.abbrev, ag: g.awayTeam.score, hg: g.homeTeam.score,
      end: g.gameOutcome?.lastPeriodType, an: r.an, hn: r.hn, as: r.as, hs: r.hs, goalies: [...goalies], ev });
  }
  console.error(season, all.length);
}
await writeFile(out, JSON.stringify(all));

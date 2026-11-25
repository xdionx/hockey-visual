// 5v5 stints for the defense model: every stretch of a game where the same five skaters per side are on the ice,
// with the shot attempts each side took in it. Pure; takes the play-by-play and the stats API's shift chart.
const sec = (s) => { const [m, x] = String(s).split(':'); return Number(m) * 60 + Number(x); };
const ATTEMPT = new Set(['shot-on-goal', 'missed-shot', 'blocked-shot', 'goal']);

/** [[seconds, [home ids], [away ids], home attempts, away attempts], ...] for regulation 5v5 skater stretches; [] without shifts. */
export function stintRows(pbp, shiftsRaw) { return stintData(pbp, shiftsRaw).rows; }

/**
 * { rows, pk, pos, blk }: rows as stintRows; pk = [[seconds, [the 4 shorthanded skaters], attempts against them by the 5-skater side], ...]
 * for regulation 4v5 stretches (penalty kill).
 */
export function stintData(pbp, shiftsRaw) {
  const shifts = (shiftsRaw?.data ?? []).filter((s) => (s.typeCode == null || s.typeCode === 517) && !s.eventDescription && s.startTime && s.endTime);
  if (!pbp || !shifts.length) return { rows: [], pk: [], pos: {}, blk: {} };
  const home = pbp.homeTeam?.id, away = pbp.awayTeam?.id;
  const pos = new Map((pbp.rosterSpots ?? []).map((r) => [r.playerId, [r.positionCode, r.teamId]]));
  const out = [], pk = [];
  for (const per of [1, 2, 3]) {
    const sh = shifts.filter((s) => s.period === per && pos.has(s.playerId) && pos.get(s.playerId)[0] !== 'G').map((s) => [s.playerId, s.teamId, sec(s.startTime), sec(s.endTime)]).filter((s) => s[3] > s[2]);
    if (!sh.length) continue;
    const bp = [...new Set(sh.flatMap((s) => [s[2], s[3]]))].sort((a, b) => a - b);
    const ev = [];
    for (const pl of pbp.plays ?? []) {
      if (pl.periodDescriptor?.number !== per || !ATTEMPT.has(pl.typeDescKey) || pl.details?.xCoord == null) continue;
      const d = pl.details;
      const tm = pl.typeDescKey === 'blocked-shot' ? pos.get(d.shootingPlayerId)?.[1] : d.eventOwnerTeamId;
      if (tm !== home && tm !== away) continue;
      ev.push([sec(pl.timeInPeriod), tm === home]);
    }
    ev.sort((a, b) => a[0] - b[0]);
    for (let k = 0; k + 1 < bp.length; k++) {
      const a = bp[k], b = bp[k + 1];
      const on = sh.filter((s) => s[2] <= a && s[3] >= b);
      const hs = on.filter((s) => s[1] === home).map((s) => s[0]).sort((x, y) => x - y);
      const as = on.filter((s) => s[1] === away).map((s) => s[0]).sort((x, y) => x - y);
      const four = hs.length === 4 && as.length === 5 ? 'h' : hs.length === 5 && as.length === 4 ? 'a' : null;
      if (!(hs.length === 5 && as.length === 5) && !four) continue;
      let ha = 0, aa = 0;
      for (const [t, isHome] of ev) if (t >= a && t < b) (isHome ? ha++ : aa++);
      if (four) pk.push([b - a, four === 'h' ? hs : as, four === 'h' ? aa : ha]);
      else out.push([b - a, hs, as, ha, aa]);
    }
  }
  const posOf = {};
  for (const r of pbp.rosterSpots ?? []) if (r.positionCode && r.positionCode !== 'G') posOf[r.playerId] = r.positionCode === 'D' ? 'D' : 'F';
  const blk = {};
  for (const pl of pbp.plays ?? []) if (pl.typeDescKey === 'blocked-shot' && pl.periodDescriptor?.number <= 3 && pl.details?.blockingPlayerId) blk[pl.details.blockingPlayerId] = (blk[pl.details.blockingPlayerId] ?? 0) + 1;
  return { rows: out, pk, pos: posOf, blk };
}

// A slim copy of an NHL play-by-play: only the fields src/momentum.js, src/seasonStats.js and
// src/modelLab.js read (about a tenth of the raw size). Used by scripts/cache-pbp.js.
const DETAIL_KEYS = ['eventOwnerTeamId', 'xCoord', 'yCoord', 'zoneCode', 'shotType', 'scoringPlayerId', 'assist1PlayerId', 'assist2PlayerId',
  'shootingPlayerId', 'blockingPlayerId', 'winningPlayerId', 'losingPlayerId', 'playerId', 'hittingPlayerId', 'committedByPlayerId',
  'drawnByPlayerId', 'descKey', 'typeCode', 'type', 'duration', 'goalieInNetId', 'reason'];
const T = (v) => (v && typeof v === 'object' ? { default: v.default } : v);

export function slim(raw) {
  return {
    id: raw.id, gameState: raw.gameState, gameDate: raw.gameDate,
    awayTeam: { id: raw.awayTeam?.id, abbrev: raw.awayTeam?.abbrev, score: raw.awayTeam?.score },
    homeTeam: { id: raw.homeTeam?.id, abbrev: raw.homeTeam?.abbrev, score: raw.homeTeam?.score },
    gameOutcome: raw.gameOutcome,
    rosterSpots: (raw.rosterSpots ?? []).map((r) => ({ playerId: r.playerId, teamId: r.teamId, positionCode: r.positionCode, firstName: T(r.firstName), lastName: T(r.lastName) })),
    plays: (raw.plays ?? []).map((p) => {
      const d = {};
      for (const k of DETAIL_KEYS) if (p.details?.[k] != null) d[k] = p.details[k];
      return { periodDescriptor: { number: p.periodDescriptor?.number, periodType: p.periodDescriptor?.periodType }, timeInPeriod: p.timeInPeriod,
        situationCode: p.situationCode, homeTeamDefendingSide: p.homeTeamDefendingSide, typeDescKey: p.typeDescKey, sortOrder: p.sortOrder, details: d };
    }),
  };
}

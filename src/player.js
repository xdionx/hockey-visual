// A player's profile, season-by-season and recent games, from the NHL API's player landing
// (api-web.nhle.com/v1/player/<id>/landing). Pure, no fetching.
const t = (v) => (v && typeof v === 'object' ? v.default : v) ?? '';
const toSeconds = (mmss) => {
  if (!mmss) return null;
  const [m, s] = String(mmss).split(':').map(Number);
  return (m || 0) * 60 + (s || 0);
};

function seasonRow(s, goalie) {
  const base = {
    season: s.season,
    gameType: s.gameTypeId,
    league: s.leagueAbbrev,
    team: t(s.teamName),
    gp: s.gamesPlayed ?? 0,
  };
  if (goalie) {
    return {
      ...base,
      wins: s.wins ?? 0, losses: s.losses ?? 0, otLosses: s.otLosses ?? 0, shutouts: s.shutouts ?? 0,
      gaa: s.goalsAgainstAvg ?? null, savePct: s.savePctg ?? null, goalsAgainst: s.goalsAgainst ?? null, shotsAgainst: s.shotsAgainst ?? null,
      toiPerGame: s.gamesPlayed && toSeconds(s.timeOnIce) ? toSeconds(s.timeOnIce) / s.gamesPlayed : null,
    };
  }
  return {
    ...base,
    goals: s.goals ?? 0, assists: s.assists ?? 0, points: s.points ?? 0, plusMinus: s.plusMinus ?? 0, pim: s.pim ?? 0,
    shots: s.shots ?? 0, ppg: s.powerPlayGoals ?? 0, ppp: s.powerPlayPoints ?? 0, shg: s.shorthandedGoals ?? 0, gwg: s.gameWinningGoals ?? 0,
    shootingPct: s.shootingPctg ?? null, foPct: s.faceoffWinningPctg ?? null,
    toiPerGame: toSeconds(s.avgToi),
  };
}

/** Everything the quick view and the full player card need. */
export function normalizePlayer(raw) {
  const goalie = raw.position === 'G';
  const seasons = (raw.seasonTotals ?? []).map((s) => seasonRow(s, goalie));
  const current = raw.featuredStats?.season ?? null;
  const regular = seasons.filter((s) => s.league === 'NHL' && s.gameType === 2);
  const draft = raw.draftDetails;
  return {
    id: raw.playerId,
    active: !!raw.isActive,
    firstName: t(raw.firstName),
    lastName: t(raw.lastName),
    fullName: `${t(raw.firstName)} ${t(raw.lastName)}`.trim(),
    number: raw.sweaterNumber ?? null,
    position: raw.position,
    goalie,
    team: raw.currentTeamAbbrev ?? null,
    teamName: t(raw.fullTeamName) || null,
    teamLogo: raw.teamLogo ?? null,
    headshot: raw.headshot ?? null,
    hero: raw.heroImage ?? null,
    birthDate: raw.birthDate ?? null,
    birthPlace: [t(raw.birthCity), t(raw.birthStateProvince), raw.birthCountry].filter(Boolean).join(', ') || null,
    height: raw.heightInInches ?? null,
    weight: raw.weightInPounds ?? null,
    shoots: raw.shootsCatches ?? null,
    draft: draft ? { year: draft.year, team: draft.teamAbbrev, round: draft.round, pick: draft.pickInRound, overall: draft.overallPick } : null,
    currentSeason: current,
    // This season's regular season line, or null when the player hasn't played in it.
    now: regular.find((s) => s.season === current && s.team) ? mergeSeason(regular.filter((s) => s.season === current), goalie) : null,
    // NHL regular seasons, one row per season (a traded player's teams are combined, with each team kept).
    nhl: groupSeasons(regular, goalie),
    playoffs: groupSeasons(seasons.filter((s) => s.league === 'NHL' && s.gameType === 3), goalie),
    other: seasons.filter((s) => s.league !== 'NHL'),
    career: raw.careerTotals?.regularSeason ? seasonRow({ ...raw.careerTotals.regularSeason, leagueAbbrev: 'NHL', gameTypeId: 2 }, goalie) : null,
    last5: (raw.last5Games ?? []).map((g) => ({
      gameId: g.gameId, date: g.gameDate, opponent: g.opponentAbbrev, home: g.homeRoadFlag === 'H', team: g.teamAbbrev,
      ...(goalie
        ? { decision: g.decision ?? null, shotsAgainst: g.shotsAgainst ?? null, goalsAgainst: g.goalsAgainst ?? null, savePct: g.savePctg ?? null }
        : { goals: g.goals ?? 0, assists: g.assists ?? 0, points: g.points ?? 0, plusMinus: g.plusMinus ?? 0, pim: g.pim ?? 0, shots: g.shots ?? 0 }),
      toi: g.toi ?? null,
    })),
  };
}

const SUM_SKATER = ['gp', 'goals', 'assists', 'points', 'plusMinus', 'pim', 'shots', 'ppg', 'ppp', 'shg', 'gwg'];
const SUM_GOALIE = ['gp', 'wins', 'losses', 'otLosses', 'shutouts', 'goalsAgainst', 'shotsAgainst'];

/** One season from its per-team rows. */
function mergeSeason(rows, goalie) {
  if (rows.length === 1) return { ...rows[0], teams: [rows[0].team] };
  const out = { season: rows[0].season, gameType: rows[0].gameType, league: rows[0].league, team: rows.map((r) => r.team).join(' / '), teams: rows.map((r) => r.team) };
  for (const k of goalie ? SUM_GOALIE : SUM_SKATER) out[k] = rows.reduce((a, r) => a + (r[k] ?? 0), 0);
  const weighted = (k) => {
    const w = rows.filter((r) => r[k] != null);
    const gp = w.reduce((a, r) => a + r.gp, 0);
    return gp ? w.reduce((a, r) => a + r[k] * r.gp, 0) / gp : null;
  };
  out.toiPerGame = weighted('toiPerGame');
  if (goalie) {
    out.savePct = out.shotsAgainst ? (out.shotsAgainst - out.goalsAgainst) / out.shotsAgainst : weighted('savePct');
    out.gaa = weighted('gaa');
  } else {
    out.shootingPct = out.shots ? out.goals / out.shots : null;
    out.foPct = weighted('foPct');
  }
  return out;
}

/** Several seasons added up into one line (e.g. career playoffs), or null when there are none. */
export function combineSeasons(rows, goalie) {
  return rows.length ? mergeSeason(rows, goalie) : null;
}

function groupSeasons(rows, goalie) {
  const by = new Map();
  for (const r of rows) by.set(r.season, [...(by.get(r.season) ?? []), r]);
  return [...by.values()].map((list) => mergeSeason(list, goalie)).sort((a, b) => b.season - a.season);
}

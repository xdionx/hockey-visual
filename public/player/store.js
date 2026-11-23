// Loads player profiles (live data Worker) and season totals (static files the GitHub Action saves),
// with small in-memory caches so opening the same card twice is instant.
import { getData, getStatic } from '../data.js';
import { perGame, scoringBase, rankOf, seasonOf, seasonFile, minGames, leagueRate, REGULAR, PLAYOFFS } from '../src/seasonStats.js';
import { goalieLine } from '../src/matchup.js';

const players = new Map();
const FIN_MIN_XG = 3;
const seasons = new Map();

export function loadPlayer(id) {
  if (!players.has(id)) players.set(id, getData(`players/${id}.json`).catch(() => null));
  return players.get(id);
}

/** A season's totals file (regular season or playoffs), or null when it hasn't been built yet. */
export function loadSeason(season, gameType = REGULAR) {
  const name = seasonFile(season, gameType);
  if (!seasons.has(name)) seasons.set(name, getStatic(`seasons/${name}`).catch(() => null));
  return seasons.get(name);
}

/**
 * Regular season or playoffs, for the toggles on the player cards and the stats page. Every page starts
 * on the regular season (or ?type=playoffs); the choice is shared on the page, so a quick view opened
 * from the playoff stats opens on the playoffs too, and links to the full card carry it along.
 */
export const GAME_TYPES = { regular: REGULAR, playoffs: PLAYOFFS };
let statsType = new URLSearchParams(globalThis.location?.search ?? '').get('type') === 'playoffs' ? 'playoffs' : 'regular';
export const getStatsType = () => statsType;
export function setStatsType(type) { statsType = type === 'playoffs' ? 'playoffs' : 'regular'; }
export const typeQuery = (type = statsType) => (type === 'playoffs' ? '&type=playoffs' : '');
/** The Regular season / Playoffs switch (buttons carry data-stats-type). */
export function typeToggle(type, cls = '') {
  const b = (k, label) => `<button type="button" data-stats-type="${k}" aria-pressed="${k === type}">${label}</button>`;
  return `<div class="pc-type ${cls}" role="group" aria-label="Regular season or playoffs">${b('regular', 'Regular season')}${b('playoffs', 'Playoffs')}</div>`;
}

function goalieRank(total, id) {
  const g = goalieLine(total, id, leagueRate(total));
  return g?.rank ? { rank: g.rank, of: g.of } : null;
}

export const currentSeason = () => seasonOf(new Date(Date.now() - 10 * 3600_000).toISOString().slice(0, 10));

/** Our numbers for one player in one season file: per-game averages plus league ranks. */
export function ourStats(total, id) {
  const row = total?.players?.[String(id)];
  if (!row) return null;
  const avg = perGame(row, leagueRate(total), scoringBase(total));
  const opts = { minGp: minGames(total) };
  return {
    row,
    ...avg,
    satRank: row.p === 'G' ? null : rankOf(total, id, 'satPerGame', opts),
    momRank: row.p === 'G' ? null : rankOf(total, id, 'momPerGame', opts),
    // Finishing is noisy on few chances: rank only among skaters with a few expected goals.
    finRank: row.p === 'G' || avg?.gaa == null || (row.xg ?? 0) < FIN_MIN_XG ? null : rankOf(total, id, 'gaa', { ...opts, minXg: FIN_MIN_XG }),
    // Goalies: goals saved above expected, ranked among goalies with 5+ starts (as on the Pregame view).
    scoreRank: row.p === 'G' || avg?.scoringVsAvg == null || (row.xg ?? 0) < FIN_MIN_XG ? null : rankOf(total, id, 'scoringVsAvg', { ...opts, minXg: FIN_MIN_XG }),
    gsaxRank: row.p === 'G' && avg?.gsax != null ? goalieRank(total, id) : null,
    minGp: opts.minGp,
    games: total.games,
    complete: !!total.complete,
  };
}

// Formatting shared by the quick view and the full card.
export const fmt = {
  toi: (sec) => (sec == null ? '-' : `${Math.floor(sec / 60)}:${String(Math.round(sec % 60)).padStart(2, '0')}`),
  dec: (n, d = 1) => (n == null || Number.isNaN(n) ? '-' : n.toFixed(d)),
  signed: (n, d = 1) => {
    if (n == null || Number.isNaN(n)) return '-';
    const r = Number(n.toFixed(d)); // no sign on a value that rounds to zero ("−0.0")
    return `${r > 0 ? '+' : r < 0 ? '−' : ''}${Math.abs(n).toFixed(d)}`;
  },
  pct: (n, d = 1) => (n == null ? '-' : `${(n * 100).toFixed(d)}%`),
  sv: (n) => (n == null ? '-' : n.toFixed(3).replace(/^0/, '')),
  ord: (n) => {
    const s = ['th', 'st', 'nd', 'rd'];
    const v = n % 100;
    return `${n}${s[(v - 20) % 10] || s[v] || s[0]}`;
  },
  fin: (n) => (n == null ? '-' : `${n}%`),
  season: (s) => `${String(s).slice(0, 4)}-${String(s).slice(6, 8)}`,
  height: (inches) => (inches ? `${Math.floor(inches / 12)}'${inches % 12}"` : null),
  age: (birth) => {
    if (!birth) return null;
    const b = new Date(`${birth}T12:00:00Z`);
    const now = new Date();
    let a = now.getUTCFullYear() - b.getUTCFullYear();
    if (now.getUTCMonth() < b.getUTCMonth() || (now.getUTCMonth() === b.getUTCMonth() && now.getUTCDate() < b.getUTCDate())) a--;
    return a;
  },
};

const POS = { C: 'Center', L: 'Left wing', R: 'Right wing', D: 'Defense', G: 'Goalie' };
export const positionName = (p) => POS[p] ?? p ?? '';

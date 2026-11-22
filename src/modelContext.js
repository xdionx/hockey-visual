// v5 candidate: v4 plus what's known before puck drop (scripts/goalie-lab/ found these on 2021-24):
//  - shooter finishing: each shot counts more for a player who beats xG over his career so far (about a
//    third of a hot or cold finishing year carries over, so it is shrunk hard toward average);
//  - starting goalie: his goals saved above expected so far, per expected goal;
//  - back-to-back: a team playing the second night in a row is about 0.3-0.5 goals worse.
// The goalie and back-to-back pieces only apply to the next-game prediction (as `pre`, in share units).
// Stateful: games must be scored in date order, and learn() runs after each game.
import { shotXg } from './xg.js';
import { elapsedOf } from './momentum.js';

const FIN_SHRINK = 15; // expected goals of average shooting added to every player's record
const FIN_WEIGHT = 2; // a 1.10x finisher's shots count 1.20x
const GOALIE_SHRINK = 40;
// Next-game goal-gap fit on 2021-24 (v4 share gap 17.9 goals per unit, goalie 1.38, back-to-back -0.48).
const GOALIE_COEF = 1.38 / 17.9;
const B2B_COEF = -0.48 / 17.9;

export function contextModel() {
  const shooters = new Map(); // id -> [goals, xG]
  const goalies = new Map(); // id -> [goals against, xG against]
  const lastDate = new Map(); // team id -> 'YYYY-MM-DD'
  const league = [0, 0]; // running goals and xG, to keep our xG scaled to real goal totals
  const scale = () => (league[1] > 500 ? league[0] / league[1] : 1.1);
  const talent = (id) => {
    const s = shooters.get(id);
    return s ? (s[0] + FIN_SHRINK) / (s[1] * scale() + FIN_SHRINK) : 1;
  };
  const gsax = (id) => {
    const g = goalies.get(id);
    return g ? (g[1] * scale() - g[0]) / (g[1] * scale() + GOALIE_SHRINK) : 0;
  };
  const shotsOf = (pbp) => pbp.plays.filter((p) => (p.typeDescKey === 'shot-on-goal' || p.typeDescKey === 'goal') && p.periodDescriptor?.periodType !== 'SO' && p.details?.goalieInNetId);
  const days = (a, b) => Math.round((Date.parse(a) - Date.parse(b)) / 86400000);
  return {
    /** Multiplier for a shot push (sog, miss, block-attempt, goal as a shot) by its shooter's record. */
    shotMult(e) {
      const id = e.credits?.[0]?.id;
      return id ? Math.min(1.6, Math.max(0.6, 1 + FIN_WEIGHT * (talent(id) - 1))) : 1;
    },
    /** Away-minus-home adjustment to the season-to-date share gap, from facts known before the game. */
    pregame(pbp) {
      const awayId = pbp.awayTeam.id;
      const starter = {};
      for (const p of [...shotsOf(pbp)].sort((a, b) => elapsedOf(a) - elapsedOf(b))) {
        const side = p.details.eventOwnerTeamId === awayId ? 'home' : 'away';
        starter[side] ??= p.details.goalieInNetId;
      }
      const b2b = (id) => (lastDate.has(id) && days(pbp.gameDate, lastDate.get(id)) === 1 ? 1 : 0);
      return GOALIE_COEF * (gsax(starter.away) - gsax(starter.home)) + B2B_COEF * (b2b(awayId) - b2b(pbp.homeTeam.id));
    },
    learn(pbp) {
      for (const p of shotsOf(pbp)) {
        const d = p.details;
        const x = shotXg({ x: d.xCoord, y: d.yCoord, shotType: d.shotType });
        if (x == null) continue;
        const goal = p.typeDescKey === 'goal' ? 1 : 0;
        const id = d.shootingPlayerId ?? d.scoringPlayerId;
        if (id) { const s = shooters.get(id) ?? [0, 0]; s[0] += goal; s[1] += x; shooters.set(id, s); }
        const g = goalies.get(d.goalieInNetId) ?? [0, 0]; g[0] += goal; g[1] += x; goalies.set(d.goalieInNetId, g);
        league[0] += goal; league[1] += x;
      }
      lastDate.set(pbp.awayTeam.id, pbp.gameDate);
      lastDate.set(pbp.homeTeam.id, pbp.gameDate);
    },
  };
}

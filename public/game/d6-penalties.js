// Penalties that decided something: a power-play goal, a big momentum swing, or a goal
// within seconds of the penalty running out. Shared by the story text and the penalty table.
import { elapsed, penKind } from './core.js';

const EXPIRY_WINDOW = 10; // seconds after the penalty ends
const SWING_LEAD = 10;    // a swing that starts this long before the penalty still counts
const SWING_WINDOW = 90;  // ... or this long after it

const clock = (t) => { const n = Math.floor(t / 1200) + 1; return { period: n, time: `${Math.floor((t % 1200) / 60)}:${String(Math.floor(t % 60)).padStart(2, '0')}` }; };

/** Penalty -> list of { kind, text, goal? } reasons it mattered. Only penalties with at least one reason are returned. */
export function decisivePenalties(game) {
  const out = new Map();
  const abbr = { away: game.away.abbrev, home: game.home.abbrev };
  const sideOf = (x) => (x.team === abbr.away ? 'away' : 'home');
  const pps = game.momentum?.powerPlays ?? [];
  const swings = game.momentum?.swings ?? [];
  const series = game.momentum?.series ?? [];
  const biggest = game.momentum?.max ?? 1;
  const goals = (game.scoring ?? []).filter((g) => g.period !== 'SO').map((g) => ({ ...g, t: elapsed(g.period, g.time) }));
  const nameOf = (s) => game[s].commonName ?? abbr[s];

  for (const x of game.penalties ?? []) {
    const kind = x.kind ?? penKind(x);
    if (['fight', 'misconduct', 'game-misconduct', 'penalty-shot'].includes(kind)) continue;
    const t0 = elapsed(x.period, x.time);
    const side = sideOf(x);
    const opp = side === 'away' ? 'home' : 'away';
    const why = [];
    const pp = pps.find((q) => q.team === opp && Math.abs(q.start - t0) <= 4);

    // 1. It led directly to a power-play goal.
    if (pp?.result === 'goal') {
      const g = goals.find((q) => q.team === abbr[opp] && q.t >= pp.start && q.t <= (pp.end ?? pp.start + 300));
      if (g) why.push({ kind: 'pp-goal', goal: g, text: `Led to a power-play goal by ${g.scorer.name} at ${g.time} of the ${String(g.periodName ?? g.period).toLowerCase().replace(' period', '')}` });
    }

    // 2. It started a large momentum swing for the other side: held a while and reached half of the game's biggest push.
    const sw = swings.find((q) => q.team === opp && q.t >= t0 - SWING_LEAD && q.t <= t0 + SWING_WINDOW);
    if (sw) {
      const peak = Math.max(0, ...series.filter(([t]) => t >= sw.t && t <= sw.until).map(([, v]) => Math.abs(v)));
      if (peak >= 0.5 * biggest) why.push({ kind: 'swing', text: `Started a big momentum swing for the ${nameOf(opp)}` });
    }

    // 3. A goal within seconds of the penalty running out (a minor ended early by a power-play goal never expires).
    const minutes = x.minutes ?? (kind === 'major' || kind === 'match' ? 5 : 2);
    const endedEarly = pp?.result === 'goal' && minutes <= 2;
    if (!endedEarly) {
      const end = t0 + minutes * 60;
      const g = goals.find((q) => q.t >= end && q.t <= end + EXPIRY_WINDOW);
      if (g) {
        const secs = g.t - end;
        why.push({ kind: 'expiry', goal: g, text: `${g.scorer.name} (${g.team}) scored ${secs ? `${secs} second${secs === 1 ? '' : 's'} after` : 'the moment'} it expired` });
      }
    }
    if (why.length) out.set(x, why);
  }
  return out;
}

/** One sentence for the story's penalties paragraph. */
export function decisiveStory(game, final) {
  const found = decisivePenalties(game);
  if (!found.size) return '';
  const bits = [...found].slice(0, 3).map(([x, why]) => {
    const parts = why.map((w) => {
      if (w.kind === 'pp-goal') return 'led directly to a power-play goal';
      if (w.kind === 'swing') return 'started a big momentum swing';
      const secs = w.goal.t - (elapsed(x.period, x.time) + (x.minutes ?? 2) * 60);
      return `was followed by a goal ${secs ? `${secs} second${secs === 1 ? '' : 's'}` : 'the moment'} after it ran out`;
    });
    const when = `${x.time} of the ${String(x.periodName ?? x.period).toLowerCase().replace(' period', '')}`;
    return `${x.player} (${x.team})'s ${String(x.infraction).toLowerCase()} at ${when} ${parts.join(' and ')}`;
  });
  const lead = found.size === 1 ? (final ? 'One penalty mattered:' : 'One penalty has mattered:') : (final ? 'The penalties that mattered:' : 'The penalties that have mattered:');
  return `${lead} ${bits.join('; ')}.`;
}

/** The same findings as separate short points, one per penalty. */
export function decisiveItems(game, final) {
  const found = decisivePenalties(game);
  const out = [];
  for (const [x, why] of [...found].slice(0, 4)) {
    const parts = why.map((w) => {
      if (w.kind === 'pp-goal') return `led directly to ${w.goal.scorer.name}'s power-play goal`;
      if (w.kind === 'swing') return 'started a big momentum swing';
      const secs = w.goal.t - (elapsed(x.period, x.time) + (x.minutes ?? 2) * 60);
      const gap = secs ? `${secs} second${secs === 1 ? '' : 's'}` : 'the moment';
      if (w.goal.team === x.team) {
        return w.goal.scorer.fullName === x.player
          ? `was killed off, and ${x.player} scored ${gap} after stepping out of the box, catching the power play off guard`
          : `was killed off, and ${w.goal.scorer.name} scored ${gap} after it ended, catching the power play off guard`;
      }
      return `ran out ${gap} before ${w.goal.scorer.name} (${w.goal.team}) scored`;
    });
    const at = `${x.time} of the ${String(x.periodName ?? x.period).toLowerCase().replace(' period', '')}`;
    out.push(`${x.player} (${x.team})'s ${String(x.infraction).toLowerCase()} at ${at} ${parts.join(' and ')}.`);
  }
  return out.map((t, i) => (i === 0 ? `${final ? 'A penalty that mattered' : 'A penalty that has mattered'}: ${t}` : `Another: ${t}`));
}

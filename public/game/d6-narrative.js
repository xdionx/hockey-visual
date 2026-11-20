// The written story of a game: how it unfolded, who controlled play over longer stretches (not just
// shot attempts), who made the difference (goalies included) and what special teams did.
import { allSkaters, allGoalies, elapsed, penKind } from './core.js';
import { decisiveItems, decisivePenalties } from './d6-penalties.js';
import { shotSummary } from './d4-analytics.js';

const other = (s) => (s === 'away' ? 'home' : 'away');
const mins = (s) => { const m = Math.max(1, Math.round(s / 60)); return `${m} minute${m === 1 ? '' : 's'}`; };
const clockOf = (t) => {
  const n = Math.floor(t / 1200);
  const s = t - n * 1200;
  return `${n >= 3 ? 'OT' : `P${n + 1}`} ${Math.floor(s / 60)}:${String(Math.round(s % 60)).padStart(2, '0')}`;
};
const ord = (n) => ['1st', '2nd', '3rd'][n] ?? 'OT';
const lastName = (n) => String(n ?? '').replace(/^.*\s/, '');
const when = (g) => `${g.time} of the ${String(g.periodName ?? '').toLowerCase()}`;

/** Goals with the running score and who led. */
function goalFlow(game) {
  let a = 0; let h = 0;
  return game.scoring.filter((g) => g.period !== 'SO').map((g) => {
    const side = g.team === game.away.abbrev ? 'away' : 'home';
    if (side === 'away') a++; else h++;
    return { ...g, side, after: { away: a, home: h }, lead: a === h ? null : a > h ? 'away' : 'home', margin: Math.abs(a - h) };
  });
}

const nth = (n) => ({ 1: '1st', 2: '2nd', 3: '3rd' })[n] ?? `${n}th`;
const periodTitle = (label, gameType) => {
  if (label === 'OT') return gameType === 3 ? '1st overtime' : 'Overtime';
  if (/OT$/.test(label)) return `${nth(Number(label.slice(0, -2)))} overtime`;
  return `${nth(Number(label))} period`;
};
const sameGoal = (a, b) => a.team === b.team && a.period === b.period && a.time === b.time;
const pen = (x) => `${x.player} (${x.team}) ${String(x.infraction ?? 'penalty').toLowerCase()}`;
const shortWhen = (x) => `${x.time} of the ${String(x.periodName ?? x.period).toLowerCase().replace(' period', '')}`;

/**
 * How the game unfolded: key points first (who scored first, how the lead moved, how it ended), then a
 * period-by-period list of every goal with the running score. Penalties that led to goals are folded into
 * the goal they produced and also listed on their own.
 */
function unfolded(game, final) {
  const goals = goalFlow(game);
  const t = game.linescore.totals;
  const nick = (s) => game[s].commonName;
  const ab = (s) => game[s].abbrev;
  const label = final ? 'was' : 'is';
  const so = final && /\/SO$/.test(game.status.label);
  const winner = final && t.away !== t.home ? (t.away > t.home ? 'away' : 'home') : null;
  const decisive = decisivePenalties(game);
  const links = (g) => {
    for (const [x, why] of decisive) for (const w of why) if (w.goal && sameGoal(w.goal, g)) return { x, w };
    return null;
  };

  let gwg = null;
  if (winner && !so) { let n = 0; const need = t[other(winner)] + 1; gwg = goals.find((g) => g.side === winner && ++n === need) ?? null; }

  // One entry per goal.
  const goalEvents = goals.map((g, i) => {
    const before = goals[i - 1]?.lead ?? null;
    const who = lastName(g.scorer.fullName);
    let did;
    if (i === 0) did = 'opened the scoring';
    else if (g.lead === null) did = 'tied it';
    else if (before === null) did = goals.slice(0, i).some((x) => x.lead === g.side) ? `retook the lead for the ${nick(g.side)}` : `put the ${nick(g.side)} ahead`;
    else if (g.side === g.lead) did = `extended the ${nick(g.side)} lead`;
    else did = 'cut the deficit';
    let how = '';
    const link = links(g);
    if (link?.w.kind === 'pp-goal') how = ` on the power play, after ${pen(link.x)} at ${link.x.period === g.period ? link.x.time : shortWhen(link.x)}`;
    else if (link?.w.kind === 'expiry') {
      const secs = link.w.goal.t - (elapsed(link.x.period, link.x.time) + (link.x.minutes ?? 2) * 60);
      const gap = secs ? `${secs} second${secs === 1 ? '' : 's'} after` : 'the moment';
      const same = link.x.team === g.team;
      const own = same && link.x.player === g.scorer.fullName;
      if (own) how = `, ${gap} stepping out of the penalty box (${String(link.x.infraction).toLowerCase()}), catching the ${nick(other(g.side))} off guard`;
      else if (same) how = `, ${gap} the ${nick(g.side)} killed off ${pen(link.x)}, catching the ${nick(other(g.side))} off guard`;
      else how = `, ${gap} ${pen(link.x)} ran out`;
    }
    else if (g.tags?.includes('PPG')) how = ' on the power play';
    else if (g.tags?.includes('SHG')) how = ' shorthanded';
    if (g.tags?.includes('EN')) how += ' into an empty net';
    const flag = g === gwg ? 'win' : g.lead === null && i ? 'tie' : g.lead && before !== g.lead && before === null ? 'lead' : '';
    return {
      at: elapsed(g.period, g.time), time: g.time, period: g.period, side: g.side, flag, goal: true,
      text: `${who} (${g.team}) ${did}${how}${g === gwg ? ', the game-winner' : ''}`,
      score: `${ab('away')} ${g.after.away} – ${g.after.home} ${ab('home')}`,
    };
  });
  // Penalties that started a big swing but did not themselves produce a goal.
  const penEvents = [];
  for (const [x, why] of decisive) {
    if (why.some((w) => w.goal)) continue;
    const opp = x.team === ab('away') ? 'home' : 'away';
    penEvents.push({ at: elapsed(x.period, x.time), time: x.time, period: x.period, side: opp, flag: 'pen', text: `${pen(x)} started a big momentum swing for the ${nick(opp)}`, score: '' });
  }

  // Period blocks.
  let ra = 0; let rh = 0;
  const periods = game.linescore.periods.filter((p) => p.label !== 'SO' && (final || p.away != null)).map((p) => {
    ra += p.away ?? 0; rh += p.home ?? 0;
    const items = [...goalEvents, ...penEvents].filter((e) => e.period === p.label).sort((x, y) => x.at - y.at);
    return {
      title: periodTitle(p.label, game.gameType),
      score: `${ab('away')} ${ra} – ${rh} ${ab('home')}`,
      note: p.shotsAway != null ? `Shots ${p.shotsAway}–${p.shotsHome}` : '',
      items,
      quiet: !items.some((e) => e.goal) ? 'No goals.' : '',
    };
  });

  // Key points.
  const points = [];
  if (!goals.length) {
    points.push(final ? 'Neither team found the net in regulation.' : 'Still scoreless. Nobody has put one past the goalie yet.');
    return { points, penalty: [], periods };
  }
  const first = goals[0];
  points.push(`The ${nick(first.side)} scored first: ${lastName(first.scorer.fullName)} at ${when(first)}.`);
  let flips = 0; let prev = null;
  for (const g of goals) { if (g.lead && prev && g.lead !== prev) flips++; if (g.lead) prev = g.lead; }
  const ties = goals.filter((g, i) => g.lead === null && i).length;
  const peak = goals.reduce((p, g) => (g.margin > p.margin ? g : p), { margin: 0 });
  if (ties + flips >= 2) points.push(`Back and forth: the game ${label} tied ${ties} time${ties === 1 ? '' : 's'}${flips ? ` and the lead changed hands ${flips} time${flips === 1 ? '' : 's'}` : ''}.`);
  else if (goals.every((g) => g.lead === goals[0].side) && goals.length > 1) points.push(`The ${nick(first.side)} ${final ? 'led from the first goal to the last' : 'have led the whole way'}.`);
  if (peak.margin >= 2) points.push(`Biggest lead: the ${nick(peak.lead)} went up ${peak.after[peak.lead]}-${peak.after[other(peak.lead)]} by ${when(peak)}.`);
  if (winner) {
    const behind = Math.max(0, ...goals.map((g) => (g.lead === other(winner) ? g.margin : 0)));
    if (behind >= 1) {
      const tie = goals.filter((g) => g.lead === null && g.side === winner).at(-1);
      points.push(`The ${nick(winner)} fought back from ${behind} down${tie ? `, tying it ${tie.after.away}-${tie.after.home} on ${lastName(tie.scorer.fullName)}'s goal at ${when(tie)}` : ''}.`);
    }
    if (so) {
      const d = game.scoring.find((g) => g.period === 'SO');
      points.push(`Settled in a shootout${d ? `: ${d.scorer.fullName} scored the shootout winner` : ''}.`);
    } else {
      // The goal that put the winner ahead for good, and whether they held on.
      const idx = goals.reduce((k, g, i) => (g.lead === winner && (goals[i - 1]?.lead ?? null) !== winner ? i : k), -1);
      const decider = goals[idx];
      if (decider && idx <= 0 && behind === 0) {
        if (gwg) points.push(`${lastName(gwg.scorer.fullName)} scored the game-winner at ${when(gwg)}.`);
      } else if (decider) {
        const after = goals.slice(idx + 1);
        const oppAfter = after.filter((g) => g.side === other(winner)).length;
        const inOT = /OT$/.test(decider.period);
        const tail = inOT ? '' : oppAfter
          ? ` The ${nick(other(winner))} answered ${oppAfter === 1 ? 'once' : `${oppAfter} times`}, but it was not enough.`
          : ` The ${nick(other(winner))} never got the equalizer; the ${nick(winner)} held on.`;
        points.push(`${lastName(decider.scorer.fullName)} put the ${nick(winner)} ahead for good at ${when(decider)}${decider === gwg ? ', the game-winner' : ''}.${tail}`);
      }
    }
  } else {
    const lead = t.away === t.home ? null : t.away > t.home ? 'away' : 'home';
    const score = `${Math.max(t.away, t.home)}-${Math.min(t.away, t.home)}`;
    points.push(lead ? `The ${nick(lead)} lead ${score}.` : `It's tied ${score}.`);
  }
  // Penalties that led to goals.
  const penalty = [];
  for (const [x, why] of decisive) {
    for (const w of why) {
      if (!w.goal) continue;
      const g = goals.find((q) => sameGoal(w.goal, q));
      if (!g) continue;
      penalty.push(`${pen(x)} at ${shortWhen(x)} ${w.kind === 'pp-goal' ? `led to ${lastName(g.scorer.fullName)}'s power-play goal for the ${nick(g.side)}` : x.team === g.team ? `was killed off and ${lastName(g.scorer.fullName)} scored for the ${nick(g.side)} right out of the box` : `ran out and ${lastName(g.scorer.fullName)} scored for the ${nick(g.side)} moments later`} (${g.after.away}-${g.after.home}).`);
    }
  }
  return { points, penalty, periods };
}

/** Who owned play over time. Shot attempts are only part of it: momentum also counts faceoffs, takeaways, power plays and more. */
function control(game, final) {
  const m = game.momentum;
  const shots = shotSummary(game);
  const att = shots.away.attempts + shots.home.attempts;
  const name = (s) => `the ${game[s].commonName}`;
  const cap = (t) => t.charAt(0).toUpperCase() + t.slice(1);
  const out = [];
  const shotLead = shots.away.attempts === shots.home.attempts ? null : shots.away.attempts > shots.home.attempts ? 'away' : 'home';
  if (att && shotLead) out.push(`${cap(name(shotLead))} ${final ? 'had' : 'have had'} ${Math.round((100 * shots[shotLead].attempts) / att)}% of the shot attempts${final ? '' : ' so far'} (${shots[shotLead].attempts}-${shots[other(shotLead)].attempts} SAT).`);
  if (!m?.periods?.length) return out;
  const ctl = m.periods.reduce((a, p) => ({ away: a.away + (p.control?.away ?? 0), home: a.home + (p.control?.home ?? 0), even: a.even + (p.control?.even ?? 0) }), { away: 0, home: 0, even: 0 });
  const tot = ctl.away + ctl.home + ctl.even;
  const ctlLead = Math.abs(ctl.away - ctl.home) < tot * 0.06 ? null : ctl.away > ctl.home ? 'away' : 'home';
  if (ctlLead) {
    const o = other(ctlLead);
    out.push(`${shotLead && shotLead !== ctlLead ? `But ${name(ctlLead)} ${final ? 'controlled' : 'have controlled'} the momentum longer` : `${cap(name(ctlLead))} ${shotLead ? 'also ' : ''}${final ? 'controlled' : 'have controlled'} the momentum`}: ${mins(ctl[ctlLead])} versus ${mins(ctl[o])}${ctl.even > tot * 0.25 ? `, with the rest even` : ''}.`);
  } else {
    out.push(`Momentum ${final ? 'was' : 'has been'} shared: ${name('away')} ${final ? 'controlled' : 'have had'} ${mins(ctl.away)}, ${name('home')} ${mins(ctl.home)}.`.replace(/^/, ''));
  }
  // Which team owned each period, grouped ("CHI owned the 1st, WPG the 2nd and 3rd").
  const owners = m.periods.map((p, i) => {
    const c = p.control ?? {};
    const d = (c.away ?? 0) - (c.home ?? 0);
    const span = (c.away ?? 0) + (c.home ?? 0) + (c.even ?? 0);
    return { i, side: Math.abs(d) < span * 0.1 ? null : d > 0 ? 'away' : 'home' };
  });
  const groups = [];
  for (const o of owners) {
    const g = groups.at(-1);
    if (g && g.side === o.side) g.ps.push(o.i); else groups.push({ side: o.side, ps: [o.i] });
  }
  if (groups.length > 1 && groups.some((g) => g.side)) {
    const phrase = groups.map((g, k) => {
      const label = g.ps.length === 1 ? ord(g.ps[0]) : g.ps.length === 2 ? `${ord(g.ps[0])} and ${ord(g.ps[1])}` : `${ord(g.ps[0])} through ${ord(g.ps.at(-1))}`;
      const lines = game.linescore.periods;
      const mine = g.ps.reduce((n, i) => n + (lines[i]?.[g.side] ?? 0), 0);
      const theirs = g.side ? g.ps.reduce((n, i) => n + (lines[i]?.[other(g.side)] ?? 0), 0) : 0;
      const verb = k && groups[k - 1].side && groups[k - 1].side !== g.side ? 'took' : 'owned';
      return g.side ? `${name(g.side)} ${verb} the ${label}${mine < theirs ? ` despite being outscored ${theirs}-${mine}` : ''}` : `the ${label} ${g.ps.length > 1 ? 'were' : 'was'} even`;
    });
    out.push(`${cap(phrase.join(', then '))}.`);
  }
  // The longest single stretch.
  const run = (m.swings ?? []).reduce((best, s) => ((s.until - s.t) > (best ? best.until - best.t : 0) ? s : best), null);
  if (run && run.until - run.t >= 180) {
    out.push(`The longest stretch${final ? '' : ' so far'}: the ${game[run.team].commonName} ${final ? 'held' : 'held'} the momentum for ${mins(run.until - run.t)} from ${clockOf(run.t)}.`);
  }
  return out;
}

/** The people who made the difference, goalies included. */
function difference(game, final) {
  const skaters = allSkaters(game).filter((p) => p.rating != null);
  const best = skaters.sort((x, y) => y.rating - x.rating || y.gameScore - x.gameScore)[0];
  const out = [];
  if (best) {
    const line = [best.goals && `${best.goals} G`, best.assists && `${best.assists} A`, `${best.sog} SOG`].filter(Boolean).join(', ');
    out.push(`${best.fullName} (${best.team}) ${final ? 'set' : 'is setting'} the pace: ${line}${best.momentum != null ? `, +${Math.max(0, best.momentum).toFixed(1)} momentum` : ''}.`);
  }
  return out;
}

/** Seconds into the game as "10:11 of the 1st period". */
function gameClock(sec) {
  const n = Math.floor(sec / 1200);
  const into = sec - n * 1200;
  const per = ['1st period', '2nd period', '3rd period'][n] ?? 'overtime';
  return `${Math.floor(into / 60)}:${String(Math.floor(into % 60)).padStart(2, '0')} of the ${per}`;
}

/** How one goalie did, in a phrase. gsax is goals saved above what an average goalie would have saved. `where` is e.g. "in the Sabres' net". */
function goalieGrade(g, where = '') {
  const sv = `${g.saves} of ${g.shotsAgainst}`;
  const x = g.gsax ?? 0;
  const worse = `${Math.abs(x).toFixed(1)} goals worse than expected`;
  const w = where ? ` ${where}` : '';
  const shots = `${g.shotsAgainst} shot${g.shotsAgainst === 1 ? '' : 's'}`;
  if (g.shotsAgainst < 8 && x > -1) return { tier: 'quiet', text: `has had a quiet night${w}, facing ${shots}`, past: `had a quiet night${w}, facing ${shots}` };
  if (x >= 1.5) return { tier: 'great', text: `has been outstanding${w}, stopping ${sv}, ${x.toFixed(1)} goals better than expected`, past: `was outstanding${w}, stopping ${sv}, ${x.toFixed(1)} goals better than expected` };
  if (x >= 0.5) return { tier: 'good', text: `has been solid${w}, stopping ${sv}`, past: `was solid${w}, stopping ${sv}` };
  if (x > -0.5) return { tier: 'even', text: `has been steady${w}, stopping ${sv}`, past: `was steady${w}, stopping ${sv}` };
  if (x > -1.2) return { tier: 'soft', text: `has given up a little more than expected${w}, stopping ${sv}, but nothing disastrous`, past: `gave up a little more than expected${w}, stopping ${sv}, but nothing disastrous` };
  if (x > -2) return { tier: 'bad', text: `has struggled${w}, stopping ${sv}, ${worse}`, past: `struggled${w}, stopping ${sv}, ${worse}` };
  return { tier: 'awful', text: `is having a terrible night${w}, stopping ${sv}, ${worse}`, past: `had a terrible night${w}, stopping ${sv}, ${worse}` };
}

/** Goaltending for each team: how the goalie did and, when there was a change, who came in and how it went. */
export function goaltending(game, final) {
  const out = [];
  const last = (g) => g.fullName.split(' ').slice(-1)[0];
  for (const s of ['away', 'home']) {
    const team = game[s];
    // Box score order is the order they came in; a starter flag, when the NHL sets one, wins.
    const gl = [...game.players[s].goalies].filter((g) => g.played).sort((a, b) => b.starter - a.starter);
    if (!gl.length) continue;
    const where = `in the ${team.commonName}${/s$/.test(team.commonName) ? "'" : "'s"} net`;
    if (gl.length === 1) {
      const g = gl[0];
      const gr = goalieGrade(g, where);
      out.push(`${g.fullName} ${final ? gr.past : gr.text}.`);
      continue;
    }
    const [first, ...rest] = gl;
    const next = rest[0];
    const at = gameClock(first.toiSeconds);
    const fg = goalieGrade(first);
    const rough = fg.tier === 'bad' || fg.tier === 'awful' || first.goalsAgainst >= 3;
    const why = rough ? `after allowing ${first.goalsAgainst} goal${first.goalsAgainst === 1 ? '' : 's'} on ${first.shotsAgainst} shots` : `with ${first.goalsAgainst} goal${first.goalsAgainst === 1 ? '' : 's'} allowed on ${first.shotsAgainst} shots, so it looks like a precaution or an injury rather than a pull`;
    out.push(`${first.fullName} ${final ? 'was' : 'has been'} replaced by ${next.fullName} ${where} at ${at}, ${why}.`);
    const ng = goalieGrade(next);
    const helped = ['great', 'good', 'quiet', 'even'].includes(ng.tier);
    const prefix = rough ? (helped ? 'The change settled things down. ' : `The change ${final ? 'did not help' : 'has not helped'}. `) : '';
    out.push(`${prefix}${last(next)} ${final ? ng.past : ng.text}.`);
  }
  return out;
}

/** What actually decided it: shot quality, goaltending and defense, which momentum alone can miss. */
function decided(game, final) {
  const gl = allGoalies(game).filter((g) => g.played && g.xga != null);
  const fo = game.teamStats?.find((x) => x.key === 'faceoffWinningPctg');
  let faceoff = '';
  if (fo && fo.awayNum != null && fo.homeNum != null && Math.abs(fo.awayNum - fo.homeNum) >= 10) {
    const w = fo.awayNum > fo.homeNum ? 'away' : 'home';
    faceoff = `The ${game[w].commonName} ${final ? 'dominated' : 'are dominating'} the faceoff circle, winning ${Math.round(fo[`${w}Num`])}% of the draws, which ${final ? 'meant' : 'means'} more time with the puck.`;
  }
  if (!gl.length) return faceoff ? [faceoff] : [];
  const side = (g) => (g.team === game.away.abbrev ? 'away' : 'home');
  const name = (s) => `the ${game[s].commonName}`;
  const cap = (t) => t.charAt(0).toUpperCase() + t.slice(1);
  // A goalie's xga is the chances the OTHER team created.
  const xg = { away: 0, home: 0 };
  for (const g of gl) xg[other(side(g))] += g.xga;
  const t = game.linescore.totals;
  const gsax = { away: 0, home: 0 };
  for (const g of gl) gsax[side(g)] += g.gsax ?? 0;
  const out = [];
  const r = (n) => n.toFixed(1);
  const tense = (a, b) => (final ? a : b);
  // Chance quality: who created the better looks.
  const diff = xg.away - xg.home;
  if (Math.abs(diff) >= 0.6) {
    const q = diff > 0 ? 'away' : 'home';
    const bad = t[q] <= t[other(q)];
    out.push(`${cap(name(q))} ${tense('created', 'have created')} the better chances (${r(xg[q])} expected goals versus ${r(xg[other(q)])})${bad ? `, but ${tense('trailed', 'trail')} on the scoreboard` : ''}.`);
  } else out.push(`The chances ${tense('were', 'have been')} close to even (${r(xg.away)} expected goals for ${game.away.abbrev}, ${r(xg.home)} for ${game.home.abbrev}).`);
  // Goaltending.
  const hot = gl.filter((g) => g.gsax >= 1 && g.shotsAgainst >= 8).sort((a, b) => b.gsax - a.gsax)[0];
  const cold = gl.filter((g) => g.gsax <= -1 && g.shotsAgainst >= 8).sort((a, b) => a.gsax - b.gsax)[0];
  // Defense: a team that gave up very little quality.
  for (const s of ['away', 'home']) {
    const against = xg[other(s)];
    if (against <= 1.2 && game.linescore.totals.away + game.linescore.totals.home >= 0 && gl.length) {
      out.push(`${cap(name(s))} ${tense('held', 'have held')} ${name(other(s))} to just ${r(against)} expected goals, a tight defensive effort.`);
    } else if (against >= 3.5) {
      out.push(`${cap(name(s))} ${tense('gave up', 'have given up')} ${r(against)} expected goals, ${tense('a leaky night', 'a lot of quality chances')} defensively.`);
    }
  }
  if (faceoff) out.push(faceoff);
  // Tie it to the result.
  const lead = t.away === t.home ? null : t.away > t.home ? 'away' : 'home';
  const ctl = (game.momentum?.periods ?? []).reduce((a, p) => ({ away: a.away + (p.control?.away ?? 0), home: a.home + (p.control?.home ?? 0) }), { away: 0, home: 0 });
  const mLead = Math.abs(ctl.away - ctl.home) < 120 ? null : ctl.away > ctl.home ? 'away' : 'home';
  if (lead && mLead && lead !== mLead && (hot || cold)) out.push(`So ${tense('the momentum did not decide this one', 'momentum is not the whole story here')}: goaltending ${tense('did', 'is doing')} a lot of the work.`);
  return out;
}

/** The story of the penalties: who took them, what the other side did with them, and the severe ones. */
function penaltyStory(game, final) {
  const pens = (game.penalties ?? []).map((x) => ({ ...x, kind: penKind(x) })).filter((x) => !['bench', 'penalty-shot'].includes(x.kind));
  const real = pens.filter((x) => x.kind !== 'fight');
  const fights = pens.filter((x) => x.kind === 'fight');
  const tense = (a, b) => (final ? a : b);
  if (!real.length && !fights.length) return [final ? 'A clean game: not a single penalty was called.' : 'No penalties yet.'];
  const name = (s) => `the ${game[s].commonName}`;
  const cap = (t) => t.charAt(0).toUpperCase() + t.slice(1);
  const abbr = { away: game.away.abbrev, home: game.home.abbrev };
  const count = { away: 0, home: 0 };
  const mins = { away: 0, home: 0 };
  for (const x of [...real, ...fights]) {
    const side = x.team === abbr.away ? 'away' : 'home';
    if (x.kind === 'misconduct' || x.kind === 'game-misconduct') continue; // no skater lost: not part of the count
    count[side]++; mins[side] += x.minutes ?? 2;
  }
  const out = [];
  if (count.away + count.home) {
    if (count.away === count.home) out.push(`Both teams ${tense('took', 'have taken')} ${count.away} ${count.away === 1 ? 'penalty' : 'penalties'}.`);
    else {
      const more = count.away > count.home ? 'away' : 'home';
      out.push(`${cap(name(more))} ${tense('took', 'have taken')} ${count[more]} ${count[more] === 1 ? 'penalty' : 'penalties'} (${mins[more]} minutes) versus ${count[other(more)]} for ${name(other(more))}.`);
    }
  }
  // What the other side did with them.
  const pps = game.momentum?.powerPlays ?? [];
  const ppLine = [];
  for (const side of ['away', 'home']) {
    const mine = pps.filter((x) => x.team === side);
    if (!mine.length) continue;
    ppLine.push(`${abbr[side]} ${mine.filter((x) => x.result === 'goal').length} for ${mine.length}`);
  }
  if (ppLine.length) out.push(`Power plays ${tense('went', 'are')} ${ppLine.join(', ')}.`);
  // Penalty trouble: the momentum it handed over.
  const handed = { away: 0, home: 0 };
  for (const p of allSkaters(game)) {
    const k = p.momentumParts?.kinds ?? {};
    handed[p.side] += Math.abs(Math.min(0, k['penalty-taken'] ?? 0)) + Math.abs(Math.min(0, k.misconduct ?? 0)) + Math.abs(Math.min(0, k['game-misconduct'] ?? 0));
  }
  for (const side of ['away', 'home']) {
    const other_ = other(side);
    const oppGoals = pps.filter((x) => x.team === other_ && x.result === 'goal').length;
    if (count[side] >= count[other_] + 2 && count[side] >= 4) {
      out.push(`${cap(name(side))} ${tense('had', 'are having')} a discipline problem: it ${tense('handed', 'has handed')} ${name(other_)} ${handed[side].toFixed(1)} momentum${oppGoals ? ` and ${oppGoals} power-play goal${oppGoals === 1 ? '' : 's'}` : ''}.`);
    }
  }
  // The severe ones.
  const sev = real.filter((x) => ['major', 'match', 'game-misconduct', 'misconduct'].includes(x.kind));
  for (const x of sev) {
    const what = { major: `a ${String(x.infraction).toLowerCase()} major`, match: 'a match penalty', 'game-misconduct': 'a game misconduct', misconduct: 'a misconduct' }[x.kind];
    out.push(`${x.player} (${x.team}) ${tense('took', 'has taken')} ${what}${x.kind === 'major' || x.kind === 'match' ? ' and the team played short for the full 5 minutes' : x.kind === 'game-misconduct' ? ' and was ejected' : ''}.`);
  }
  for (const [i, x] of fights.entries()) {
    if (i % 2) continue;
    const y = fights[i + 1];
    out.push(`${x.player} (${x.team})${y ? ` and ${y.player} (${y.team})` : ''} ${tense('fought', 'have fought')} at ${x.time} of the ${String(x.periodName ?? '').toLowerCase().replace(' period', '')}.`);
  }
  out.push(...decisiveItems(game, final));
  return out;
}

/** Power plays and the penalty that cost the most momentum. */
function specialTeams(game, final = true) {
  const pp = game.teamStats?.find((s) => s.key === 'powerPlay');
  const out = [];
  if (pp) {
    const a = `${game.away.abbrev} ${pp.away}`;
    const h = `${game.home.abbrev} ${pp.home}`;
    const total = (pp.awayNum ?? 0) + (pp.homeNum ?? 0);
    out.push(total ? `Power plays: ${a}, ${h}.` : `No power play goals (${a}, ${h}).`);
  }
  const worst = allSkaters(game).filter((p) => (p.momentumParts?.kinds?.['penalty-taken'] ?? 0) <= -2)
    .sort((x, y) => (x.momentumParts.kinds['penalty-taken']) - (y.momentumParts.kinds['penalty-taken']))[0];
  if (worst) out.push(`${worst.fullName} (${worst.team}) ${final ? 'took' : 'has taken'} the penalty that ${final ? 'cost' : 'has cost'} the most: ${Math.abs(worst.momentumParts.kinds['penalty-taken']).toFixed(1)} momentum handed to the other side.`);
  return out;
}

/**
 * The Story section as labeled beats. Each has `items` (short points, shown as a list) and the same
 * words joined as `text`. "How it unfolded" also carries `penalty` (penalties that led to goals) and
 * `periods` (the period-by-period goal list).
 */
export function storyBeats(game) {
  const final = game.status.state === 'final';
  const un = unfolded(game, final);
  const beats = [
    { label: final ? 'How it unfolded' : 'How it stands', items: un.points, penalty: un.penalty, periods: un.periods },
    { label: final ? 'Who controlled play' : 'Who has the play', items: control(game, final) },
    { label: final ? 'What decided it' : 'Chances so far', items: decided(game, final) },
    { label: 'Goaltending', items: goaltending(game, final) },
    { label: final ? 'Penalties' : 'Penalties so far', items: penaltyStory(game, final) },
    { label: final ? 'The difference' : 'Standing out so far', items: difference(game, final) },
    { label: final ? 'Special teams' : 'Special teams so far', items: specialTeams(game, final) },
  ];
  return beats.filter((b) => b.items.length).map((b) => ({ ...b, text: b.items.join(' ') }));
}

export { elapsed };

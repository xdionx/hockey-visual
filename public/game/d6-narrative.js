// The written story of a game: how it unfolded, who controlled play over longer stretches (not just
// shot attempts), who made the difference (goalies included) and what special teams did.
import { allSkaters, allGoalies, elapsed } from './core.js';
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

/** Present-tense account of a game still being played. */
function liveArc(game, goals) {
  const name = (s) => game[s].commonName;
  const t = game.linescore.totals;
  const last = goals.at(-1);
  const lead = t.away === t.home ? null : t.away > t.home ? 'away' : 'home';
  const score = lead ? `${t[lead]}-${t[other(lead)]}` : `${t.away}-${t.home}`;
  const first = goals[0];
  const parts = [`The ${name(first.side)} struck first, ${lastName(first.scorer.fullName)} at ${when(first)}.`];
  const behind = lead ? Math.max(0, ...goals.map((g) => (g.lead === other(lead) ? g.margin : 0))) : 0;
  const peakTrail = Math.max(0, ...goals.map((g) => g.margin));
  if (lead && behind >= 1) parts.push(`The ${name(lead)} have come back from ${behind} down and now lead ${score}.`);
  else if (lead) parts.push(`The ${name(lead)} lead ${score}${last.side === lead && goals.length > 1 ? `, extending it on ${lastName(last.scorer.fullName)}'s goal at ${when(last)}` : ''}.`);
  else parts.push(`It's tied ${score}${last.side && goals.length > 1 ? `, ${lastName(last.scorer.fullName)} evening it at ${when(last)}` : ''}${peakTrail >= 2 ? ' after a big swing' : ''}.`);
  return parts.join(' ');
}

/** How the game unfolded: who struck first, the biggest lead, the comeback, the finish. */
function arc(game, final) {
  const goals = goalFlow(game);
  const name = (s) => game[s].commonName;
  if (!goals.length) return final ? 'Neither team found the net in regulation.' : 'Still scoreless.';
  const first = goals[0];
  const parts = [];
  if (!final) return liveArc(game, goals);
  // The biggest lead either team had.
  const peak = goals.reduce((p, g) => (g.margin > p.margin ? g : p), { margin: 0 });
  const t = game.linescore.totals;
  const winner = final && t.away !== t.home ? (t.away > t.home ? 'away' : 'home') : null;
  if (peak.margin >= 2) parts.push(`The ${name(peak.lead)} jumped to a ${peak.after[peak.lead]}-${peak.after[other(peak.lead)]} lead by ${when(peak)}.`);
  else parts.push(`The ${name(first.side)} opened the scoring, ${lastName(first.scorer.fullName)} at ${when(first)}.`);
  if (winner) {
    const behind = Math.max(0, ...goals.map((g) => (g.lead === other(winner) ? g.margin : 0)));
    const last = game.status.label.split('/')[1];
    if (behind >= 1) {
      const ties = goals.filter((g) => g.lead === null && g.side === winner);
      const tie = ties.at(-1);
      parts.push(`The ${name(winner)} fought back from ${behind} down${tie ? `, tying it ${tie.after.away}-${tie.after.home} on ${lastName(tie.scorer.fullName)}'s goal at ${when(tie)}` : ''}${last === 'SO' ? ', then won it in a shootout' : last ? ', then won it in overtime' : ''}.`);
    } else if (last === 'SO') {
      parts.push(`It went to a shootout and the ${name(winner)} came out on top.`);
    } else if (last) {
      parts.push(`The ${name(winner)} won it in overtime.`);
    }
    if (last === 'SO') {
      const d = game.scoring.find((g) => g.period === 'SO');
      if (d) parts.push(`${d.scorer.fullName} scored the shootout winner.`);
    } else {
      let n = 0; const need = t[other(winner)] + 1;
      const gwg = goals.find((g) => g.side === winner && ++n === need);
      if (gwg) parts.push(`${gwg.scorer.fullName} scored the game-winner at ${when(gwg)}.`);
    }
  }
  return parts.join(' ');
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
  if (att && shotLead) out.push(`${cap(name(shotLead))} ${final ? 'had' : 'have had'} ${Math.round((100 * shots[shotLead].attempts) / att)}% of the shot attempts${final ? '' : ' so far'} (${shots[shotLead].attempts}-${shots[other(shotLead)].attempts}).`);
  if (!m?.periods?.length) return out.join(' ');
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
      return g.side ? `${name(g.side)} ${verb} the ${label}${mine < theirs ? ` despite being outscored ${theirs}-${mine}` : ''}` : `the ${label} was even`;
    });
    out.push(`${cap(phrase.join(', then '))}.`);
  }
  // The longest single stretch.
  const run = (m.swings ?? []).reduce((best, s) => ((s.until - s.t) > (best ? best.until - best.t : 0) ? s : best), null);
  if (run && run.until - run.t >= 180) {
    out.push(`The longest stretch${final ? '' : ' so far'}: the ${game[run.team].commonName} ${final ? 'held' : 'held'} the momentum for ${mins(run.until - run.t)} from ${clockOf(run.t)}.`);
  }
  return out.join(' ');
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
  const gl = allGoalies(game).filter((g) => g.played && g.gsax != null && g.shotsAgainst >= 8);
  const stand = gl.sort((x, y) => y.gsax - x.gsax)[0];
  const weak = gl.sort((x, y) => x.gsax - y.gsax)[0];
  if (stand && stand.gsax >= 0.7) out.push(`In net, ${stand.fullName} (${stand.team}) ${final ? 'stopped' : 'has stopped'} ${stand.saves} of ${stand.shotsAgainst}, ${stand.gsax.toFixed(1)} goals better than expected.`);
  if (weak && weak !== stand && weak.gsax <= -0.9) out.push(`${weak.fullName} (${weak.team}) ${final ? 'allowed' : 'has allowed'} ${Math.abs(weak.gsax).toFixed(1)} more goals than expected on ${weak.shotsAgainst} shots.`);
  else if (stand && weak === stand && stand.gsax <= -0.9) out.push(`${stand.fullName} (${stand.team}) ${final ? 'allowed' : 'has allowed'} ${Math.abs(stand.gsax).toFixed(1)} more goals than expected.`);
  return out.join(' ');
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
  if (!gl.length) return faceoff;
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
  if (hot) out.push(`${hot.fullName} (${hot.team}) ${tense('stood tall', 'is standing tall')}, saving ${r(hot.gsax)} goals more than expected.`);
  if (cold) out.push(`${cold.fullName} (${cold.team}) ${tense('struggled', 'is struggling')}: ${r(Math.abs(cold.gsax))} more goals allowed than expected.`);
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
  return out.join(' ');
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
  return out.join(' ');
}

/** Labeled paragraphs for the Story section. */
export function storyBeats(game) {
  const final = game.status.state === 'final';
  const beats = [
    [final ? 'How it unfolded' : 'How it stands', arc(game, final)],
    [final ? 'Who controlled play' : 'Who has the play', control(game, final)],
    [final ? 'What decided it' : 'Chances and goaltending', decided(game, final)],
    [final ? 'The difference' : 'Standing out so far', difference(game, final)],
    [final ? 'Special teams' : 'Special teams so far', specialTeams(game, final)],
  ];
  return beats.filter(([, text]) => text).map(([label, text]) => ({ label, text }));
}

export { elapsed };

// "How it was won": the result split into momentum, chances, finishing and goaltending, plus which
// skaters had an above or below average game for their position (p.tier, set in game.js from src/impact.js).
//
// Goals scored on a goalie = expected goals (what average shooters score from those shots) + how much
// the shooters beat that. One team's shooters beating average is the same goals as the other goalie
// falling short, so each team gets its own shooters (goals vs avg) and its own goalie (goals saved vs
// avg = the other team's shooters turned around).
import { esc } from './core.js';

const skatersOf = (game, side) => [...(game.players?.[side]?.forwards ?? []), ...(game.players?.[side]?.defense ?? [])];
const sum = (list, k) => list.reduce((s, p) => s + (p[k] ?? 0), 0);
const sgn = (n, d = 1) => `${n > 0.05 ? '+' : n < -0.05 ? '−' : ''}${Math.abs(n).toFixed(d)}`;

/** Numbers for both teams, or null when the box score has no expected goals. */
export function wonNumbers(game) {
  const sides = {};
  for (const side of ['away', 'home']) {
    const sk = skatersOf(game, side);
    if (!sk.some((p) => p.xg != null)) return null;
    sides[side] = {
      abbrev: game[side]?.abbrev ?? side,
      score: game[side]?.score ?? 0,
      chances: sum(sk, 'avgGoals'),
      onGoalie: sum(sk, 'xgGoals'),
      shooters: sum(sk, 'gaa'),
      players: sk.map((p) => ({ p, tier: p.tier ?? null })),
    };
  }
  // Goals by strength (from the scoring summary) and power plays (from team stats, "1/4").
  const pp = (game.teamStats ?? []).find((r) => r.key === 'powerPlay');
  for (const side of ['away', 'home']) {
    const goals = (game.scoring ?? []).filter((g) => g.period !== 'SO' && g.team === sides[side].abbrev);
    const has = (g, t) => (g.tags ?? []).includes(t);
    sides[side].evGoals = goals.filter((g) => !has(g, 'PPG') && !has(g, 'SHG') && !has(g, 'EN')).length;
    sides[side].ppGoals = goals.filter((g) => has(g, 'PPG')).length;
    sides[side].shGoals = goals.filter((g) => has(g, 'SHG')).length;
    const opps = String(pp?.[side] ?? '').split('/')[1];
    sides[side].ppOpps = opps == null || opps === '' ? null : Number(opps);
  }
  const m = game.momentum?.totalsNoGoals;
  const tot = m ? (m.away ?? 0) + (m.home ?? 0) : 0;
  for (const [side, other] of [['away', 'home'], ['home', 'away']]) {
    sides[side].goalie = -sides[other].shooters;
    sides[side].momShare = tot > 0 ? m[side] / tot : null;
  }
  return sides;
}

function sentence(game, s) {
  const { away: a, home: h } = s;
  if (a.score === h.score) return '';
  const [w, l] = a.score > h.score ? [a, h] : [h, a];
  const verb = game.status?.state === 'final' ? 'won' : 'leads';
  const pieces = [
    [w.chances - l.chances, `the better chances (${w.chances.toFixed(1)} expected goals to ${l.chances.toFixed(1)})`],
    [w.shooters, `its shooters, who scored ${w.shooters.toFixed(1)} more goals than average shooters would have on those shots`],
    [w.goalie, `its goalie, who saved ${w.goalie.toFixed(1)} more goals than an average goalie would have`],
  ].sort((x, y) => y[0] - x[0]);
  let txt = pieces[0][0] > 0.05 ? `${esc(w.abbrev)} ${verb} mainly on ${pieces[0][1]}.` : `${esc(w.abbrev)} ${verb} on goals into an empty net.`;
  const lost = [];
  if (w.momShare != null && w.momShare < 0.5) lost.push(`more of the play (${Math.round((1 - w.momShare) * 100)}% of momentum)`);
  if (l.chances > w.chances + 0.2) lost.push(`the better chances (${l.chances.toFixed(1)} expected goals to ${w.chances.toFixed(1)})`);
  // Even strength (5v5, 4v4, 3v3) decides most games; say so when special teams made the difference.
  const stNet = (t, o) => t.ppGoals + t.shGoals - o.ppGoals - o.shGoals;
  if (w.evGoals <= l.evGoals && stNet(w, l) > 0) {
    txt += ` Special teams made the difference: ${w.evGoals === l.evGoals ? `even strength finished ${w.evGoals}-${l.evGoals}` : `${esc(l.abbrev)} won even strength ${l.evGoals}-${w.evGoals}`}, but ${esc(w.abbrev)} scored ${w.ppGoals} on the power play${w.shGoals ? ` and ${w.shGoals} shorthanded` : ''}${l.ppGoals + l.shGoals ? ` to ${esc(l.abbrev)}'s ${l.ppGoals + l.shGoals}` : ''}.`;
  }
  if (lost.length) txt += ` ${esc(l.abbrev)} had ${lost.join(' and ')} but couldn't turn it into goals.`;
  else if (w.momShare != null) txt += ` ${esc(w.abbrev)} also had more of the play (${Math.round(w.momShare * 100)}% of momentum).`;
  return txt;
}

function row(label, tip, a0, h0, fmt, better = 'high', num = (v) => v) {
  const [a, h] = [num(a0), num(h0)];
  const cls = (x, y) => (Math.abs(x - y) < 0.05 ? '' : (better === 'high' ? x > y : x < y) ? ' hw-win' : '');
  return `<tr title="${esc(tip)}"><td class="hw-a${cls(a, h)}">${fmt(a0)}</td><th>${label}</th><td class="hw-h${cls(h, a)}">${fmt(h0)}</td></tr>`;
}

function tierList(t, c) {
  const name = (x) => `<span class="hw-n">${esc(x.p.name ?? x.p.fullName ?? '')}</span>`;
  const up = t.players.filter((x) => x.tier === 1).map(name);
  const dn = t.players.filter((x) => x.tier === -1).map(name);
  return `<div class="hw-tier" style="--team:${c}">
    <b>${esc(t.abbrev)}</b>
    <p><span class="hw-up">Above their season average</span>${up.join(', ') || '-'}</p>
    <p><span class="hw-dn">Below their season average</span>${dn.join(', ') || '-'}</p>
  </div>`;
}

export function howWon(game, c) {
  const s = wonNumbers(game);
  if (!s) return '';
  const { away: a, home: h } = s;
  const final = game.status?.state === 'final';
  const pctf = (v) => (v == null ? '-' : `${Math.round(v * 100)}%`);
  const en = (t) => t.score - t.onGoalie;
  return `<section class="b-card hw-card">
    <h2>${final ? 'How it was won' : 'How it’s going'}</h2>
    <p class="hw-lede">${sentence(game, s)}</p>
    <table class="hw-table">
      <thead><tr><th class="hw-a" style="--team:${c.away}">${esc(a.abbrev)}</th><th></th><th class="hw-h" style="--team:${c.home}">${esc(h.abbrev)}</th></tr></thead>
      <tbody>
        ${row('Goals', 'Final score', a.score, h.score, (v) => v)}
        ${row('Even-strength goals', '5 on 5, 4 on 4 and 3 on 3, with both goalies in: where about 70% of NHL goals come from', a.evGoals, h.evGoals, (v) => v)}
        ${a.ppOpps != null && h.ppOpps != null ? row('Power play', 'Power-play goals out of power-play chances', [a.ppGoals, a.ppOpps], [h.ppGoals, h.ppOpps], ([g, n]) => `${g} of ${n}`, 'high', ([g]) => g) : ''}
        ${a.shGoals || h.shGoals ? row('Shorthanded goals', 'Goals scored while killing a penalty', a.shGoals, h.shGoals, (v) => v) : ''}
        ${a.momShare != null ? row('Momentum', 'Share of the momentum both teams built, goals left out', a.momShare, h.momShare, pctf) : ''}
        ${row('Chances', 'Expected goals: what average NHL shooters would score from these shots on goal', a.chances, h.chances, (v) => v.toFixed(1))}
        ${row('Shooters vs avg', 'Goals scored on the goalie minus expected goals', a.shooters, h.shooters, (v) => sgn(v))}
        ${row('Goalie vs avg', 'Goals saved compared with an average goalie facing the same shots', a.goalie, h.goalie, (v) => sgn(v))}
        ${en(a) || en(h) ? row('Empty net and other', 'Goals not scored on a goalie (empty net), plus any shootout winner', en(a), en(h), (v) => v) : ''}
      </tbody>
    </table>
    <h3 class="hw-sub">Compared with their season <small>Skaters who played well above or below their own average game this season, by momentum and finishing. Goals and assists aren't counted, so a player can have points and still be below their average.</small></h3>
    <div class="hw-tiers">${tierList(a, c.away)}${tierList(h, c.home)}</div>
  </section>`;
}

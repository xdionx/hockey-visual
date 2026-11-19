// Design 5 "Scorecards": one card per player with a game rating and what drove it.
// A modern take on HockeyStats-style player game cards; the start of the per-player scorecard.
import { esc, logo, teamColors, statusText, prettyDate, allSkaters, allGoalies, pct, signed, rinkMarkup, shotMark, headshot, ratingColor, GS_PARTS, on, morphInner, goalieXg } from './core.js';

export const PART_COLORS = { scoring: '#6366f1', momentum: '#22c55e', shooting: '#0ea5e9', onIce: '#14b8a6', defense: '#a3a3a3', discipline: '#f59e0b', faceoffs: '#ec4899' };

function header(game, c) {
  const ls = game.linescore;
  return `<section class="s-head">
    <div class="s-t" style="--team:${c.away}">${logo(game.away, 's-logo')}<div><b>${esc(game.away.commonName)}</b><span>${esc(game.away.abbrev)}</span></div><em>${ls.totals.away}</em></div>
    <div class="s-mid"><span class="s-st ${game.status.state}">${esc(statusText(game))}</span><span>${esc(prettyDate(game.gameDate))}</span></div>
    <div class="s-t r" style="--team:${c.home}"><em>${ls.totals.home}</em><div><b>${esc(game.home.commonName)}</b><span>${esc(game.home.abbrev)}</span></div>${logo(game.home, 's-logo')}</div>
  </section>`;
}

/** Diverging bar: negative parts grow left of the zero line, positive parts right. */
export function breakdownBar(p, scale) {
  const pos = GS_PARTS.filter(([k]) => p.gameScoreParts[k] > 0);
  const neg = GS_PARTS.filter(([k]) => p.gameScoreParts[k] < 0);
  const seg = ([k, label]) => {
    const v = p.gameScoreParts[k];
    return `<i style="width:${((100 * Math.abs(v)) / scale).toFixed(1)}%;background:${PART_COLORS[k]}" title="${esc(`${label}: ${v > 0 ? '+' : ''}${v.toFixed(2)}`)}"></i>`;
  };
  return `<div class="s-div"><div class="s-neg">${neg.map(seg).join('')}</div><div class="s-zero"></div><div class="s-pos">${pos.map(seg).join('')}</div></div>`;
}

export function miniRink(game, p, c) {
  const shots = game.shots.filter((s) => s.shooterId === p.id);
  const vb = p.side === 'away' ? '-101 -43.5 102 87' : '-1 -43.5 102 87';
  return `<svg class="s-rink" viewBox="${vb}" role="img" aria-label="${esc(`${p.fullName} shot locations`)}">${rinkMarkup()}${shots.map((s) => shotMark(s, c[p.side], 3.2)).join('')}</svg>`;
}

export function ratingBadge(r, big = false) {
  return `<span class="s-rate ${big ? 'big' : ''}" style="--r:${ratingColor(r)}">${r.toFixed(1)}</span>`;
}

const MOM_KIND = {
  goal: 'Goals', sog: 'Shots', miss: 'Missed shots', 'block-attempt': 'Blocked attempts', block: 'Blocks', faceoff: 'Faceoff wins',
  'faceoff-loss': 'Faceoff losses', takeaway: 'Takeaways', giveaway: 'Giveaways', hit: 'Hits', 'penalty-drawn': 'Penalties drawn',
  'penalty-taken': 'Penalties taken', 'penalty-kill': 'Penalty kill',
};

/** Momentum the player created (green, right) and gave away (red, left), with the biggest reasons. */
export function momentumBar(p, scale = 15) {
  const m = p.momentumParts;
  if (!m || (!m.pos && !m.neg)) return '';
  const w = (v) => Math.min(100, (100 * Math.abs(v)) / scale);
  const kinds = Object.entries(m.kinds ?? {});
  const top = (sign) => kinds.filter(([, v]) => Math.sign(v) === sign).sort((a, b) => Math.abs(b[1]) - Math.abs(a[1])).slice(0, 2)
    .map(([k]) => esc(MOM_KIND[k] ?? k)).join(', ');
  const title = kinds.sort((a, b) => b[1] - a[1]).map(([k, v]) => `${MOM_KIND[k] ?? k}: ${v > 0 ? '+' : ''}${v.toFixed(1)}`).join('\n');
  return `<div class="s-mom" title="${esc(`Momentum created and given away\n${title}`)}">
    <div class="s-bd-h"><span>Momentum</span><b>${p.momentum > 0 ? '+' : ''}${(p.momentum ?? 0).toFixed(1)}</b></div>
    <div class="s-mom-bar"><div class="l"><i style="width:${w(m.neg)}%"></i></div><div class="r"><i style="width:${w(m.pos)}%"></i></div></div>
    <div class="s-mom-why"><span class="neg"><b>${m.neg.toFixed(1)}</b> lost${top(-1) ? `<small>${top(-1)}</small>` : ''}</span><span class="pos"><b>+${m.pos.toFixed(1)}</b> gained${top(1) ? `<small>${top(1)}</small>` : ''}</span></div>
  </div>`;
}

export function skaterCard(game, p, c, scale) {
  return `<article class="s-card" style="--team:${c[p.side]}">
    <div class="s-top">${headshot(p, 's-mug')}
      <div class="s-who"><strong>${esc(p.fullName)}</strong><span>#${p.number ?? ''} · ${esc(p.position)} · ${esc(p.team)}</span></div>
      ${ratingBadge(p.rating)}
    </div>
    <div class="s-line"><span><b>${p.goals}</b>G</span><span><b>${p.assists}</b>A</span><span><b>${p.sog}</b>SOG</span><span><b>${signed(p.plusMinus)}</b>+/-</span><span title="Momentum impact: weighted plays that pushed momentum toward the player's team (swing plays count 1.5x)"><b>${p.momentum != null ? (p.momentum > 0 ? '+' : '') + p.momentum.toFixed(1) : '-'}</b>MOM</span><span><b>${esc(p.toi)}</b>TOI</span></div>
    ${p.onIce ? `<div class="s-onice" title="Shot attempts while on the ice, weighted: on goal 1, missed 0.5, blocked 0.35"><span>On-ice shots</span><b>${p.onIce.cf.toFixed(1)}</b><div class="s-oi-bar"><i style="width:${p.onIce.pct ?? 50}%"></i></div><b>${p.onIce.ca.toFixed(1)}</b><em>${p.onIce.pct != null ? `${Math.round(p.onIce.pct)}%` : ''}</em></div>` : ''}
    ${p.swingPlays ? `<div class="s-swing">&#8635; ${p.swingPlays} swing play${p.swingPlays > 1 ? 's' : ''}</div>` : ''}
    <div class="s-body">
      <div class="s-bd"><div class="s-bd-h"><span>Game score</span><b>${p.gameScore > 0 ? '+' : ''}${p.gameScore.toFixed(2)}</b></div>${breakdownBar(p, scale)}${momentumBar(p)}</div>
      ${miniRink(game, p, c)}
    </div>
  </article>`;
}

export function goalieCard(g, c) {
  const sv = g.shotsAgainst ? g.saves / g.shotsAgainst : 0;
  return `<article class="s-card goalie" style="--team:${c[g.side]}">
    <div class="s-top">${headshot(g, 's-mug')}
      <div class="s-who"><strong>${esc(g.fullName)}</strong><span>#${g.number ?? ''} · G · ${esc(g.team)}${g.decision ? ` · ${esc(g.decision)}` : ''}</span></div>
      ${ratingBadge(g.rating)}
    </div>
    <div class="s-line"><span><b>${g.saves}</b>SV</span><span><b>${g.goalsAgainst}</b>GA</span><span><b>${pct(g.savePct)}</b>SV%</span><span><b>${esc(g.toi)}</b>TOI</span></div>
    ${goalieXg(g)}
    <div class="s-gbody">
      <svg viewBox="0 0 36 36" class="s-ring"><circle cx="18" cy="18" r="15.9" class="bgc"/><circle cx="18" cy="18" r="15.9" class="fg" stroke-dasharray="${(sv * 100).toFixed(1)} 100"/><text x="18" y="21" text-anchor="middle">${Math.round(sv * 100)}%</text></svg>
      <dl><dt>Even strength</dt><dd>${esc(g.evenStrength)}</dd><dt>Power play</dt><dd>${esc(g.powerPlay)}</dd><dt>Shorthanded</dt><dd>${esc(g.shorthanded)}</dd><dt>Game score</dt><dd>${g.gameScore > 0 ? '+' : ''}${g.gameScore.toFixed(2)}</dd></dl>
    </div>
  </article>`;
}

export function spotlight(game, c, players, scale) {
  const best = players[0];
  if (!best) return '';
  const parts = GS_PARTS.map(([k, label]) => {
    const v = best.gameScoreParts?.[k];
    if (v == null) return '';
    return `<div class="s-part"><span><i style="background:${PART_COLORS[k]}"></i>${esc(label)}</span><b>${v > 0 ? '+' : ''}${v.toFixed(2)}</b></div>`;
  }).join('');
  return `<section class="s-spot" style="--team:${c[best.side]}">
    <div class="s-spot-l">${headshot(best, 's-spot-mug')}<div><span class="s-kicker">Player of the game</span><h2>${esc(best.fullName)}</h2><span class="s-muted">#${best.number ?? ''} · ${esc(best.position)} · ${esc(game[best.side].name)}</span></div></div>
    <div class="s-spot-r">${ratingBadge(best.rating, true)}
      ${best.position === 'G' ? `<div class="s-parts"><div class="s-part"><span>Saves</span><b>${best.saves}/${best.shotsAgainst}</b></div><div class="s-part"><span>SV%</span><b>${pct(best.savePct)}</b></div></div>` : `<div class="s-parts">${parts}</div>`}
    </div>
    ${best.position === 'G' ? '' : `<div class="s-spot-bar">${breakdownBar(best, scale)}</div>`}
  </section>`;
}

export function grid(game, c, state) {
  const sk = allSkaters(game);
  const gs = allGoalies(game);
  let list = [...sk, ...gs];
  if (state.team !== 'all') list = list.filter((p) => p.side === state.team);
  if (state.pos === 'F') list = list.filter((p) => ['C', 'L', 'R'].includes(p.position));
  if (state.pos === 'D') list = list.filter((p) => p.position === 'D');
  if (state.pos === 'G') list = list.filter((p) => p.position === 'G');
  const key = { rating: (p) => p.rating, points: (p) => (p.points ?? -1) * 100 + p.rating, toi: (p) => p.toiSeconds }[state.sort];
  list.sort((a, b) => key(b) - key(a));
  const scale = Math.max(1.5, ...sk.map((p) => Object.values(p.gameScoreParts).reduce((a, v) => a + Math.max(0, v), 0)), ...sk.map((p) => -Object.values(p.gameScoreParts).reduce((a, v) => a + Math.min(0, v), 0))) * 1.05;
  return list.map((p) => (p.position === 'G' ? goalieCard(p, c) : skaterCard(game, p, c, scale))).join('') || '<p class="s-muted">No players match.</p>';
}

export function scorecardControls(game) {
  return `<section class="s-controls" id="s-controls">
        <div class="s-seg" data-k="team"><button data-v="all" aria-pressed="true">Both teams</button><button data-v="away" aria-pressed="false">${esc(game.away.abbrev)}</button><button data-v="home" aria-pressed="false">${esc(game.home.abbrev)}</button></div>
        <div class="s-seg" data-k="pos"><button data-v="all" aria-pressed="true">All</button><button data-v="F" aria-pressed="false">Forwards</button><button data-v="D" aria-pressed="false">Defense</button><button data-v="G" aria-pressed="false">Goalies</button></div>
        <div class="s-seg" data-k="sort"><button data-v="rating" aria-pressed="true">By rating</button><button data-v="points" aria-pressed="false">By points</button><button data-v="toi" aria-pressed="false">By ice time</button></div>
      </section>`;
}

export function scorecardKey() {
  return `<section class="s-key">
        <div><b>Rating</b> runs from 3.0 to 10.0. A quiet game is about 6.0; ${['#dc2626', '#ea580c', '#ca8a04', '#65a30d', '#16a34a', '#2563eb'].map((x) => `<i style="background:${x}"></i>`).join('')}</div>
        <div><b>Game score</b> adds up what a player did: ${GS_PARTS.map(([k, l]) => `<span><i style="background:${PART_COLORS[k]}"></i>${esc(l)}</span>`).join('')}. Goalies: +0.1 per save, -0.75 per goal against.</div>
        <div><b>Momentum (MOM)</b> credits each player for the plays that pushed momentum their team's way: shots on goal, goals and assists, faceoff wins, takeaways, hits, blocks and drawn penalties, minus giveaways and penalties taken. A penalty taken costs the player the momentum the other team gained from it, including the whole power play and 1.5 more if it scored. A penalty drawn earns the player that momentum: 1.0, the power play pressure, and 0.75 more if it scored. Penalties also move game score: +0.25 drawn, -0.25 taken. A <b>swing play</b> came while the team was behind on momentum and counts 1.5x. <b>Goalies</b> get expected save % (xSV%) from where, and how, each shot came: close, central and tipped shots are likelier goals. <b>GSAx</b> is goals saved above expected (positive means the goalie stopped more than an average goalie would have) and feeds the goalie's game score. These expected-goals numbers are our own estimate from shot distance, angle and type, not an official NHL stat. The <b>momentum bar</b> under game score splits MOM into what the player gained (green) and lost (red), with the biggest reasons for each.</div>
        <div class="s-muted">Weights follow the public Game Score model. <b>On-ice</b> uses shot attempts for and against while the player was on the ice (on goal 1, missed 0.5, blocked 0.35, and 1.5x from the home plate area in front of the net) plus goals for and against; <b>Shooting</b> adds a bonus for every attempt from home plate; if the NHL's shift data isn't available yet, it falls back to plus/minus.</div>
      </section>`;
}

/** Fills #s-grid with player cards and wires the team/position/sort controls. */
// Kept outside the render so live refreshes don't reset the filters.
const cardFilter = { team: 'all', pos: 'all', sort: 'rating' };

export function mountScorecards(root, game, c) {
  const state = cardFilter;
  root.querySelectorAll('#s-controls [data-k]').forEach((seg) => {
    seg.querySelectorAll('button').forEach((x) => x.setAttribute('aria-pressed', String(x.dataset.v === state[seg.dataset.k])));
  });
  const el = root.querySelector('#s-grid');
  const draw = () => morphInner(el, grid(game, c, state));
  on(root.querySelector('#s-controls'), 'click', (e) => {
    const b = e.target.closest('button[data-v]');
    if (!b) return;
    const seg = b.closest('[data-k]');
    seg.querySelectorAll('button').forEach((x) => x.setAttribute('aria-pressed', String(x === b)));
    state[seg.dataset.k] = b.dataset.v;
    draw();
  });
  draw();
}

export default {
  id: 'scorecards',
  name: 'Scorecards',
  inspiration: 'Per-player game cards with a rating and what drove it: a modern take on HockeyStats player cards',
  render(game) {
    const c = teamColors(game);
    const sk = allSkaters(game);
    const all = [...sk, ...allGoalies(game)].sort((a, b) => b.rating - a.rating || b.gameScore - a.gameScore);
    const scale = Math.max(1.5, ...sk.map((p) => Object.values(p.gameScoreParts).reduce((a, v) => a + Math.max(0, v), 0))) * 1.05;
    return `<div class="s-wrap">
      ${header(game, c)}
      ${spotlight(game, c, all, scale)}
      ${scorecardControls(game)}
      <section class="s-grid" id="s-grid" data-js></section>
      ${scorecardKey()}
    </div>`;
  },
  mount(root, game) {
    mountScorecards(root, game, teamColors(game));
  },
};

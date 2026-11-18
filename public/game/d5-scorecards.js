// Design 5 "Scorecards": one card per player with a game rating and what drove it.
// A modern take on HockeyStats-style player game cards; the start of the per-player scorecard.
import { esc, logo, teamColors, statusText, prettyDate, allSkaters, allGoalies, pct, signed, rinkMarkup, shotMark, headshot, ratingColor, GS_PARTS } from './core.js';

const PART_COLORS = { scoring: '#6366f1', shooting: '#0ea5e9', onIce: '#14b8a6', defense: '#a3a3a3', discipline: '#f59e0b', faceoffs: '#ec4899' };

function header(game, c) {
  const ls = game.linescore;
  return `<section class="s-head">
    <div class="s-t" style="--team:${c.away}">${logo(game.away, 's-logo')}<div><b>${esc(game.away.commonName)}</b><span>${esc(game.away.abbrev)}</span></div><em>${ls.totals.away}</em></div>
    <div class="s-mid"><span class="s-st ${game.status.state}">${esc(statusText(game))}</span><span>${esc(prettyDate(game.gameDate))}</span></div>
    <div class="s-t r" style="--team:${c.home}"><em>${ls.totals.home}</em><div><b>${esc(game.home.commonName)}</b><span>${esc(game.home.abbrev)}</span></div>${logo(game.home, 's-logo')}</div>
  </section>`;
}

/** Diverging bar: negative parts grow left of the zero line, positive parts right. */
function breakdownBar(p, scale) {
  const pos = GS_PARTS.filter(([k]) => p.gameScoreParts[k] > 0);
  const neg = GS_PARTS.filter(([k]) => p.gameScoreParts[k] < 0);
  const seg = ([k, label]) => {
    const v = p.gameScoreParts[k];
    return `<i style="width:${((100 * Math.abs(v)) / scale).toFixed(1)}%;background:${PART_COLORS[k]}" title="${esc(`${label}: ${v > 0 ? '+' : ''}${v.toFixed(2)}`)}"></i>`;
  };
  return `<div class="s-div"><div class="s-neg">${neg.map(seg).join('')}</div><div class="s-zero"></div><div class="s-pos">${pos.map(seg).join('')}</div></div>`;
}

function miniRink(game, p, c) {
  const shots = game.shots.filter((s) => s.shooterId === p.id);
  const vb = p.side === 'away' ? '-101 -43.5 102 87' : '-1 -43.5 102 87';
  return `<svg class="s-rink" viewBox="${vb}" role="img" aria-label="${esc(`${p.fullName} shot locations`)}">${rinkMarkup()}${shots.map((s) => shotMark(s, c[p.side], 3.2)).join('')}</svg>`;
}

function ratingBadge(r, big = false) {
  return `<span class="s-rate ${big ? 'big' : ''}" style="--r:${ratingColor(r)}">${r.toFixed(1)}</span>`;
}

function skaterCard(game, p, c, scale) {
  return `<article class="s-card" style="--team:${c[p.side]}">
    <div class="s-top">${headshot(p, 's-mug')}
      <div class="s-who"><strong>${esc(p.fullName)}</strong><span>#${p.number ?? ''} · ${esc(p.position)} · ${esc(p.team)}</span></div>
      ${ratingBadge(p.rating)}
    </div>
    <div class="s-line"><span><b>${p.goals}</b>G</span><span><b>${p.assists}</b>A</span><span><b>${p.sog}</b>SOG</span><span><b>${signed(p.plusMinus)}</b>+/-</span><span><b>${esc(p.toi)}</b>TOI</span></div>
    <div class="s-body">
      <div class="s-bd"><div class="s-bd-h"><span>Game score</span><b>${p.gameScore > 0 ? '+' : ''}${p.gameScore.toFixed(2)}</b></div>${breakdownBar(p, scale)}</div>
      ${miniRink(game, p, c)}
    </div>
  </article>`;
}

function goalieCard(g, c) {
  const sv = g.shotsAgainst ? g.saves / g.shotsAgainst : 0;
  return `<article class="s-card goalie" style="--team:${c[g.side]}">
    <div class="s-top">${headshot(g, 's-mug')}
      <div class="s-who"><strong>${esc(g.fullName)}</strong><span>#${g.number ?? ''} · G · ${esc(g.team)}${g.decision ? ` · ${esc(g.decision)}` : ''}</span></div>
      ${ratingBadge(g.rating)}
    </div>
    <div class="s-line"><span><b>${g.saves}</b>SV</span><span><b>${g.goalsAgainst}</b>GA</span><span><b>${pct(g.savePct)}</b>SV%</span><span><b>${esc(g.toi)}</b>TOI</span></div>
    <div class="s-gbody">
      <svg viewBox="0 0 36 36" class="s-ring"><circle cx="18" cy="18" r="15.9" class="bgc"/><circle cx="18" cy="18" r="15.9" class="fg" stroke-dasharray="${(sv * 100).toFixed(1)} 100"/><text x="18" y="21" text-anchor="middle">${Math.round(sv * 100)}%</text></svg>
      <dl><dt>Even strength</dt><dd>${esc(g.evenStrength)}</dd><dt>Power play</dt><dd>${esc(g.powerPlay)}</dd><dt>Shorthanded</dt><dd>${esc(g.shorthanded)}</dd><dt>Game score</dt><dd>${g.gameScore > 0 ? '+' : ''}${g.gameScore.toFixed(2)}</dd></dl>
    </div>
  </article>`;
}

function spotlight(game, c, players, scale) {
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

function grid(game, c, state) {
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
      <section class="s-controls" id="s-controls">
        <div class="s-seg" data-k="team"><button data-v="all" aria-pressed="true">Both teams</button><button data-v="away" aria-pressed="false">${esc(game.away.abbrev)}</button><button data-v="home" aria-pressed="false">${esc(game.home.abbrev)}</button></div>
        <div class="s-seg" data-k="pos"><button data-v="all" aria-pressed="true">All</button><button data-v="F" aria-pressed="false">Forwards</button><button data-v="D" aria-pressed="false">Defense</button><button data-v="G" aria-pressed="false">Goalies</button></div>
        <div class="s-seg" data-k="sort"><button data-v="rating" aria-pressed="true">By rating</button><button data-v="points" aria-pressed="false">By points</button><button data-v="toi" aria-pressed="false">By ice time</button></div>
      </section>
      <section class="s-grid" id="s-grid"></section>
      <section class="s-key">
        <div><b>Rating</b> runs from 3.0 to 10.0. A quiet game is about 6.0; ${['#dc2626', '#ea580c', '#ca8a04', '#65a30d', '#16a34a', '#2563eb'].map((x) => `<i style="background:${x}"></i>`).join('')}</div>
        <div><b>Game score</b> adds up what a player did: ${GS_PARTS.map(([k, l]) => `<span><i style="background:${PART_COLORS[k]}"></i>${esc(l)}</span>`).join('')}. Goalies: +0.1 per save, -0.75 per goal against.</div>
        <div class="s-muted">Weights follow the public Game Score model. On-ice shot attempts aren't in the NHL feed we use yet, so on-ice impact uses plus/minus for now.</div>
      </section>
    </div>`;
  },
  mount(root, game) {
    const c = teamColors(game);
    const state = { team: 'all', pos: 'all', sort: 'rating' };
    const el = root.querySelector('#s-grid');
    const draw = () => { el.innerHTML = grid(game, c, state); };
    root.querySelector('#s-controls').addEventListener('click', (e) => {
      const b = e.target.closest('button[data-v]');
      if (!b) return;
      const seg = b.closest('[data-k]');
      seg.querySelectorAll('button').forEach((x) => x.setAttribute('aria-pressed', String(x === b)));
      state[seg.dataset.k] = b.dataset.v;
      draw();
    });
    draw();
  },
};

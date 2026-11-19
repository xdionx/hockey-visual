// Design 2 "Broadcast": a dark, bold, on-air graphics look.
// Inspired by TSN and NHL broadcast score bugs: team-color panels, condensed type, big numbers.
import { esc, logo, teamColors, statusText, prettyDate, skaters, goaliesOf, pct, signed, videoButton, visualizerButton, elapsed, headshot, strengthBadge } from './core.js';

export function hero(game, c) {
  const ls = game.linescore;
  const panel = (s) => `<div class="b-panel ${s}" style="--team:${s === 'away' ? c.panelAway : c.panelHome}">
    ${logo(game[s], 'b-logo', true)}
    <div class="b-name"><span>${esc(game[s].placeName)}</span><strong>${esc(game[s].commonName)}</strong></div>
    <div class="b-score">${game.status.state === 'pre' ? '–' : ls.totals[s]}</div>
  </div>`;
  return `<section class="b-hero">
    ${panel('away')}
    <div class="b-mid"><span class="b-state ${game.status.state}">${esc(statusText(game))}</span>${strengthBadge(game, c)}<span class="b-date">${esc(prettyDate(game.gameDate))}</span><span class="b-venue">${esc(game.venue)}</span></div>
    ${panel('home')}
  </section>
  <div class="b-strip">${ls.periods.map((p) => `<div class="b-per"><span>${esc(p.label)}</span><b>${p.away ?? '-'}</b><b>${p.home ?? '-'}</b></div>`).join('')}
    <div class="b-per tot"><span>SOG</span><b>${ls.shots.away ?? '-'}</b><b>${ls.shots.home ?? '-'}</b></div>
  </div>`;
}

/** Game flow: goals placed on a horizontal 60+ minute track. */
export function flow(game, c) {
  const reg = game.linescore.periods.filter((p) => p.label !== 'SO');
  const length = reg.length > 3 ? 3 * 1200 + (reg.length - 3) * 300 : 3600; // regular-season OT is 5 minutes
  const pos = (g) => {
    const e = elapsed(g.period, g.time);
    return Math.min(100, (100 * (e > 3600 ? 3600 + (e - 3600) * (300 / 1200) : e)) / length);
  };
  const goals = game.scoring.filter((g) => g.period !== 'SO');
  const ticks = [0, 1, 2, 3].map((i) => `<span class="b-tick" style="left:${(100 * i * 1200) / length}%"></span>`).join('');
  return `<section class="b-card"><h2>Game flow</h2>
    <div class="b-flow">
      <div class="b-track"></div>${ticks}
      ${(() => {
        // Stack labels that would overlap: each side keeps the right edge of its labels per row.
        const rows = { away: [], home: [] };
        return goals.map((g) => {
          const s = g.team === game.away.abbrev ? 'away' : 'home';
          const x = pos(g);
          let row = rows[s].findIndex((end) => x - end > 9);
          if (row < 0) row = rows[s].length;
          rows[s][row] = x;
          return `<div class="b-goal ${s}" style="left:${x}%;--team:${c[s]};--row:${row}" title="${esc(`${g.team} ${g.scorer.name} ${g.period === 'OT' ? 'OT' : `P${g.period}`} ${g.time}`)}"><span>${esc(g.scorer.name.replace(/^.*?\.\s*/, ''))}</span></div>`;
        }).join('');
      })()}
      <div class="b-flow-lbl"><span>1st</span><span>2nd</span><span>3rd</span>${reg.length > 3 ? '<span>OT</span>' : ''}</div>
    </div>
  </section>`;
}

export function scoringCards(game, c) {
  if (!game.scoring.length) return '';
  return `<section class="b-card"><h2>Scoring plays</h2><div class="b-goals">
    ${game.scoring.map((g) => {
      const s = g.team === game.away.abbrev ? 'away' : 'home';
      return `<article class="b-gc" style="--team:${c[s]}">
        ${headshot(g.scorer, 'b-mug')}
        <div class="b-gc-body">
          <div class="b-gc-top"><span class="b-tm">${esc(g.team)}</span><span>${g.period === 'SO' ? 'Shootout' : `${esc(g.period === 'OT' ? 'OT' : `P${g.period}`)} · ${esc(g.time)}`}</span>${g.tags.map((t) => `<span class="b-tag">${esc(t)}</span>`).join('')}</div>
          <strong>${esc(g.scorer.fullName)}${g.scorer.goalsToDate != null ? ` <small>(${g.scorer.goalsToDate})</small>` : ''}</strong>
          <div class="b-ast">${g.period === 'SO' ? 'Deciding goal' : g.assists.length ? g.assists.map((a) => esc(a.name)).join(', ') : 'Unassisted'}</div>
        </div>
        <div class="b-gc-score">${g.score.away}<i>-</i>${g.score.home}</div>
        <div class="b-gc-acts">${visualizerButton(g.visualizer, `${g.team} · ${g.scorer.name} · Goal visualizer`, '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="2" y="5" width="20" height="14" rx="5" fill="none" stroke="currentColor" stroke-width="2"/><circle cx="9" cy="12" r="2" fill="currentColor"/><path d="M11 12h6" stroke="currentColor" stroke-width="2" stroke-dasharray="2 2"/></svg>', 'b-viz')}
        ${videoButton(g.highlightId, `${g.team} · ${g.scorer.name}`, '<span>&#9654;</span>', 'b-play', g.highlight)}</div>
      </article>`;
    }).join('')}
  </div></section>`;
}

export function stars(game) {
  if (!game.threeStars.length) return '';
  const order = [2, 1, 3].map((n) => game.threeStars.find((s) => s.star === n)).filter(Boolean);
  return `<section class="b-card"><h2>Three stars</h2><div class="b-stars">
    ${order.map((s) => `<div class="b-star s${s.star}">${headshot(s, 'b-star-mug')}<span class="b-star-n">${'★'.repeat(s.star === 1 ? 3 : s.star === 2 ? 2 : 1)}</span><strong>${esc(s.name)}</strong><span>${esc(s.team)} · ${esc(s.line)}</span><div class="b-plinth">${s.star}</div></div>`).join('')}
  </div></section>`;
}

export function statBars(game, c) {
  if (!game.teamStats.length) return '';
  return `<section class="b-card"><h2>Team stats</h2>
    <div class="b-legend"><span style="--team:${c.away}">${esc(game.away.abbrev)}</span><span style="--team:${c.home}">${esc(game.home.abbrev)}</span></div>
    ${game.teamStats.map((s) => {
      const sum = s.awayNum + s.homeNum || 1;
      const a = (100 * s.awayNum) / sum;
      return `<div class="b-stat"><div class="b-stat-row"><b>${esc(s.away)}</b><span>${esc(s.label)}</span><b>${esc(s.home)}</b></div>
        <div class="b-bar"><i style="width:${a}%;background:${c.away}"></i><i style="width:${100 - a}%;background:${c.home}"></i></div></div>`;
    }).join('')}
  </section>`;
}

export function roster(game, side, c) {
  const list = skaters(game, side);
  const g = goaliesOf(game, side).filter((x) => x.played);
  return `<div data-panel-group="b-team" data-panel="${side}" ${side === 'home' ? 'hidden' : ''} style="--team:${c[side]}">
    <div class="b-scroll"><table class="b-table sortable">
      <thead><tr><th class="l" data-sort>Skater</th><th data-sort>Pos</th><th data-sort>G</th><th data-sort>A</th><th data-sort>P</th><th data-sort>+/-</th><th data-sort>SOG</th><th data-sort>HIT</th><th data-sort>BLK</th><th data-sort>PIM</th><th data-sort>TOI</th></tr></thead>
      <tbody>${list.map((p) => `<tr class="${p.points ? 'hot' : ''}"><td class="l" data-v="${esc(p.lastName)}"><span class="b-num">${p.number ?? ''}</span>${esc(p.fullName)}</td><td>${esc(p.position)}</td><td>${p.goals}</td><td>${p.assists}</td><td class="b">${p.points}</td><td data-v="${p.plusMinus}">${signed(p.plusMinus)}</td><td>${p.sog}</td><td>${p.hits}</td><td>${p.blocks}</td><td>${p.pim}</td><td data-v="${p.toiSeconds}">${esc(p.toi)}</td></tr>`).join('')}</tbody>
    </table></div>
    <div class="b-scroll"><table class="b-table">
      <thead><tr><th class="l">Goalie</th><th>Dec</th><th>SA</th><th>SV</th><th>GA</th><th>SV%</th><th>TOI</th></tr></thead>
      <tbody>${g.map((x) => `<tr><td class="l"><span class="b-num">${x.number ?? ''}</span>${esc(x.fullName)}</td><td>${esc(x.decision ?? '')}</td><td>${x.shotsAgainst}</td><td>${x.saves}</td><td>${x.goalsAgainst}</td><td class="b">${pct(x.savePct)}</td><td>${esc(x.toi)}</td></tr>`).join('')}</tbody>
    </table></div>
  </div>`;
}

export default {
  id: 'broadcast',
  name: 'Broadcast',
  inspiration: 'Dark on-air graphics with team-color panels, inspired by TSN and NHL broadcasts',
  render(game) {
    const c = teamColors(game, { dark: true });
    // Hero panels keep the true team colors; markers and bars use the lifted ones.
    c.panelAway = c.awayBase;
    c.panelHome = c.homeBase;
    return `<div class="b-wrap">
      ${hero(game, c)}
      <div class="b-cols">
        <div>${flow(game, c)}${scoringCards(game, c)}</div>
        <div>${stars(game)}${statBars(game, c)}</div>
      </div>
      <section class="b-card" data-tab-scope><div class="b-tabs" data-tabs="b-team" role="tablist">
        <button type="button" data-tab="away" aria-selected="true" style="--team:${c.away}">${esc(game.away.name)}</button>
        <button type="button" data-tab="home" aria-selected="false" style="--team:${c.home}">${esc(game.home.name)}</button>
      </div>
      ${roster(game, 'away', c)}${roster(game, 'home', c)}</section>
      <p class="b-vids">${videoButton(game.video.recapId, `${game.away.abbrev} @ ${game.home.abbrev} · Recap`, '&#9654; Recap', 'b-btn')}${videoButton(game.video.condensedId, `${game.away.abbrev} @ ${game.home.abbrev} · Condensed game`, '&#9654; Condensed game', 'b-btn')}</p>
    </div>`;
  },
};

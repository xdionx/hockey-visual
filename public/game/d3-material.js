// Design 3 "Cards": soft, rounded, tabbed cards.
// Inspired by Google's sports results cards: a summary first, details one tap away.
import { esc, logo, teamColors, statusText, prettyDate, skaters, goaliesOf, pct, signed, videoButton, timeline, headshot } from './core.js';

function hero(game, c) {
  const ls = game.linescore;
  const final = game.status.state === 'final';
  const team = (s) => {
    const lost = final && ls.totals[s] < ls.totals[s === 'away' ? 'home' : 'away'];
    const t = `<div class="m-team ${lost ? 'lost' : ''}">${logo(game[s], 'm-logo')}<span>${esc(game[s].commonName)}</span></div>`;
    const sc = `<div class="m-score ${lost ? 'lost' : ''}">${game.status.state === 'pre' ? '' : ls.totals[s]}</div>`;
    return s === 'away' ? t + sc : sc + t;
  };
  return `<section class="m-card m-hero">
    <div class="m-meta">${esc(prettyDate(game.gameDate, { weekday: 'short', month: 'short', day: 'numeric' }))} · ${esc(game.venue)}</div>
    <div class="m-match">${team('away')}<div class="m-status ${game.status.state}">${esc(statusText(game))}</div>${team('home')}</div>
    <table class="m-ls"><thead><tr><th></th>${ls.periods.map((p) => `<th>${esc(p.label)}</th>`).join('')}<th>T</th></tr></thead>
      <tbody>${['away', 'home'].map((s) => `<tr><td><span class="m-dot" style="background:${c[s]}"></span>${esc(game[s].abbrev)}</td>${ls.periods.map((p) => `<td>${p[s] ?? '-'}</td>`).join('')}<td class="b">${ls.totals[s]}</td></tr>`).join('')}</tbody>
    </table>
  </section>`;
}

function summary(game, c) {
  const items = timeline(game);
  let last = null;
  const rows = items.map((it) => {
    const s = it.team === game.away.abbrev ? 'away' : 'home';
    const head = it.period !== last ? `<li class="m-period">${esc(it.periodName)}</li>` : '';
    last = it.period;
    if (it.kind === 'goal') {
      return `${head}<li class="m-ev goal ${s}" style="--team:${c[s]}">
        ${headshot(it.scorer, 'm-mug')}
        <div class="m-ev-body"><strong>${esc(it.scorer.fullName)}</strong>${it.scorer.goalsToDate != null ? ` <span class="m-muted">(${it.scorer.goalsToDate})</span>` : ''}${it.tags.map((t) => ` <span class="m-chip">${esc(t)}</span>`).join('')}
          <div class="m-muted">${it.period === 'SO' ? 'Deciding shootout goal' : it.assists.length ? `Assists: ${it.assists.map((a) => esc(a.name)).join(', ')}` : 'Unassisted'}</div></div>
        <div class="m-ev-side"><span class="m-sc">${it.score.away} - ${it.score.home}</span><span class="m-muted">${it.period === 'SO' ? '' : esc(it.time)}</span></div>
        ${videoButton(it.highlightId, `${it.team} · ${it.scorer.name}`, '&#9654;', 'm-play', it.highlight)}
      </li>`;
    }
    return `${head}<li class="m-ev pen ${s}" style="--team:${c[s]}">
      <span class="m-icon">&#9646;</span>
      <div class="m-ev-body">${esc(it.player)} <span class="m-muted">· ${esc(it.team)}</span><div class="m-muted">${esc(it.infraction)}, ${it.minutes ?? ''} min</div></div>
      <div class="m-ev-side"><span class="m-muted">${esc(it.time)}</span></div><span></span>
    </li>`;
  }).join('');
  const stars = game.threeStars.length ? `<section class="m-card"><h2>Three stars</h2><div class="m-stars">${game.threeStars.map((s) => `<div class="m-starchip">${headshot(s, 'm-mug')}<div><strong>${'★'.repeat(4 - s.star)} ${esc(s.name)}</strong><div class="m-muted">${esc(s.team)} · ${esc(s.line)}</div></div></div>`).join('')}</div></section>` : '';
  const vids = [videoButton(game.video.recapId, `${game.away.abbrev} @ ${game.home.abbrev} · Recap`, '&#9654;&nbsp; Recap', 'm-pill'), videoButton(game.video.condensedId, `${game.away.abbrev} @ ${game.home.abbrev} · Condensed game`, '&#9654;&nbsp; Condensed game', 'm-pill')].join('');
  return `<div data-panel-group="m-tab" data-panel="summary">
    ${vids ? `<div class="m-vids">${vids}</div>` : ''}
    ${stars}
    <section class="m-card"><h2>Timeline</h2>${rows ? `<ul class="m-timeline">${rows}</ul>` : '<p class="m-muted">No goals or penalties yet.</p>'}</section>
    <section class="m-card m-info"><h2>Game info</h2>
      <dl>
        <dt>Venue</dt><dd>${esc(game.venue)}${game.venueLocation ? `, ${esc(game.venueLocation)}` : ''}</dd>
        ${game.broadcasts.length ? `<dt>TV</dt><dd>${game.broadcasts.map(esc).join(', ')}</dd>` : ''}
        ${game.officials.referees.length ? `<dt>Referees</dt><dd>${game.officials.referees.map(esc).join(', ')}</dd><dt>Linesmen</dt><dd>${game.officials.linesmen.map(esc).join(', ')}</dd>` : ''}
        ${game.seasonSeries ? `<dt>Season series</dt><dd>${esc(game.away.abbrev)} ${game.seasonSeries.away} - ${game.seasonSeries.home} ${esc(game.home.abbrev)}</dd>` : ''}
      </dl>
    </section>
  </div>`;
}

function players(game, c) {
  const panel = (s) => {
    const list = skaters(game, s);
    const g = goaliesOf(game, s).filter((x) => x.played);
    return `<div data-panel-group="m-team" data-panel="${s}" ${s === 'home' ? 'hidden' : ''}>
      <div class="m-scroll"><table class="m-table sortable">
        <thead><tr><th class="l" data-sort>Player</th><th data-sort>G</th><th data-sort>A</th><th data-sort>P</th><th data-sort>+/-</th><th data-sort>S</th><th data-sort>H</th><th data-sort>BLK</th><th data-sort>TOI</th></tr></thead>
        <tbody>${list.map((p) => `<tr><td class="l" data-v="${esc(p.lastName)}"><div class="m-pl">${headshot(p, 'm-mug sm')}<div><span>${esc(p.fullName)}</span><small>#${p.number ?? ''} · ${esc(p.position)}</small></div></div></td><td>${p.goals}</td><td>${p.assists}</td><td class="b">${p.points}</td><td data-v="${p.plusMinus}">${signed(p.plusMinus)}</td><td>${p.sog}</td><td>${p.hits}</td><td>${p.blocks}</td><td data-v="${p.toiSeconds}">${esc(p.toi)}</td></tr>`).join('')}</tbody>
      </table></div>
      <h3>Goalies</h3>
      <div class="m-scroll"><table class="m-table">
        <thead><tr><th class="l">Player</th><th>SA</th><th>SV</th><th>GA</th><th>SV%</th><th>TOI</th></tr></thead>
        <tbody>${g.map((x) => `<tr><td class="l"><div class="m-pl">${headshot(x, 'm-mug sm')}<div><span>${esc(x.fullName)} ${x.decision ? `<span class="m-chip">${esc(x.decision)}</span>` : ''}</span><small>#${x.number ?? ''}</small></div></div></td><td>${x.shotsAgainst}</td><td>${x.saves}</td><td>${x.goalsAgainst}</td><td class="b">${pct(x.savePct)}</td><td>${esc(x.toi)}</td></tr>`).join('')}</tbody>
      </table></div>
    </div>`;
  };
  return `<div data-panel-group="m-tab" data-panel="players" hidden><section class="m-card" data-tab-scope>
    <div class="m-seg" data-tabs="m-team">${['away', 'home'].map((s, i) => `<button type="button" data-tab="${s}" aria-selected="${i === 0}">${logo(game[s], 'm-seg-logo')}${esc(game[s].commonName)}</button>`).join('')}</div>
    ${panel('away')}${panel('home')}
  </section></div>`;
}

function stats(game, c) {
  const rows = game.teamStats.map((s) => {
    const max = Math.max(s.awayNum, s.homeNum) || 1;
    return `<div class="m-stat"><div class="m-stat-lbl">${esc(s.label)}</div>
      <div class="m-stat-row">
        <span class="m-v ${s.awayNum >= s.homeNum ? 'lead' : ''}">${esc(s.away)}</span>
        <div class="m-bars"><div class="m-bar l"><i style="width:${(100 * s.awayNum) / max}%;background:${c.away}"></i></div><div class="m-bar r"><i style="width:${(100 * s.homeNum) / max}%;background:${c.home}"></i></div></div>
        <span class="m-v ${s.homeNum >= s.awayNum ? 'lead' : ''}">${esc(s.home)}</span>
      </div></div>`;
  }).join('');
  const shots = game.linescore.periods.filter((p) => p.label !== 'SO');
  return `<div data-panel-group="m-tab" data-panel="stats" hidden>
    <section class="m-card"><div class="m-stat-head">${logo(game.away, 'm-seg-logo')}<h2>Team stats</h2>${logo(game.home, 'm-seg-logo')}</div>${rows || '<p class="m-muted">No stats yet.</p>'}</section>
    <section class="m-card"><h2>Shots by period</h2><div class="m-shots">${shots.map((p) => {
      const max = Math.max(...shots.map((x) => Math.max(x.shotsAway ?? 0, x.shotsHome ?? 0)), 1);
      return `<div class="m-sp"><div class="m-sp-bars"><i style="height:${(100 * (p.shotsAway ?? 0)) / max}%;background:${c.away}"><b>${p.shotsAway ?? ''}</b></i><i style="height:${(100 * (p.shotsHome ?? 0)) / max}%;background:${c.home}"><b>${p.shotsHome ?? ''}</b></i></div><span>${esc(p.label)}</span></div>`;
    }).join('')}</div></section>
  </div>`;
}

export default {
  id: 'cards',
  name: 'Cards',
  inspiration: 'Rounded tabbed cards with a summary first, inspired by Google sports results',
  render(game) {
    const c = teamColors(game);
    return `<div class="m-wrap" data-tab-scope>
      ${hero(game, c)}
      <div class="m-tabs" data-tabs="m-tab" role="tablist">
        <button type="button" data-tab="summary" aria-selected="true">Summary</button>
        <button type="button" data-tab="players" aria-selected="false">Players</button>
        <button type="button" data-tab="stats" aria-selected="false">Stats</button>
      </div>
      ${summary(game, c)}${players(game, c)}${stats(game, c)}
    </div>`;
  },
};

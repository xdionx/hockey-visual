// Design 1 "Classic": a dense, newspaper-style box score.
// Inspired by the ESPN and CBS Sports box scores: everything on one scrolling page, sortable tables.
import { esc, logo, teamColors, statusText, prettyDate, skaters, goaliesOf, pct, signed, videoButton } from './core.js';

function header(game, c) {
  const ls = game.linescore;
  const final = game.status.state === 'final';
  const side = (s) => {
    const team = game[s];
    const lost = final && ls.totals[s] < ls.totals[s === 'away' ? 'home' : 'away'];
    return `<div class="c-team ${s} ${lost ? 'lost' : ''}" style="--team:${c[s]}">
      ${logo(team, 'c-logo')}
      <div class="c-tname"><span class="place">${esc(team.placeName)}</span><strong>${esc(team.commonName)}</strong></div>
      <div class="c-score">${game.status.state === 'pre' ? '' : ls.totals[s]}</div>
    </div>`;
  };
  return `<section class="c-head">
    ${side('away')}
    <div class="c-status"><strong class="${game.status.state}">${esc(statusText(game))}</strong><span>${esc(prettyDate(game.gameDate))}</span></div>
    ${side('home')}
  </section>`;
}

function linescore(game) {
  const ls = game.linescore;
  const cols = ls.periods.map((p) => `<th>${esc(p.label)}</th>`).join('');
  const row = (s, key) => ls.periods.map((p) => `<td>${p[key === 'g' ? s : `shots${s[0].toUpperCase()}${s.slice(1)}`] ?? '-'}</td>`).join('');
  return `<div class="c-grid2">
    <table class="c-table c-ls"><caption>Scoring</caption>
      <thead><tr><th></th>${cols}<th>T</th></tr></thead>
      <tbody>
        <tr><td class="l">${esc(game.away.abbrev)}</td>${row('away', 'g')}<td class="b">${ls.totals.away}</td></tr>
        <tr><td class="l">${esc(game.home.abbrev)}</td>${row('home', 'g')}<td class="b">${ls.totals.home}</td></tr>
      </tbody>
    </table>
    <table class="c-table c-ls"><caption>Shots on goal</caption>
      <thead><tr><th></th>${ls.periods.filter((p) => p.label !== 'SO').map((p) => `<th>${esc(p.label)}</th>`).join('')}<th>T</th></tr></thead>
      <tbody>
        ${['away', 'home'].map((s) => `<tr><td class="l">${esc(game[s].abbrev)}</td>${ls.periods.filter((p) => p.label !== 'SO').map((p) => `<td>${p[s === 'away' ? 'shotsAway' : 'shotsHome'] ?? '-'}</td>`).join('')}<td class="b">${ls.shots[s] ?? '-'}</td></tr>`).join('')}
      </tbody>
    </table>
  </div>`;
}

function scoringSummary(game) {
  if (!game.scoring.length) return '';
  let last = null;
  const rows = game.scoring.map((g) => {
    const head = g.period !== last ? `<tr class="c-sub"><td colspan="5">${esc(g.periodName)}</td></tr>` : '';
    last = g.period;
    const assists = g.period === 'SO' ? '' : g.assists.length ? g.assists.map((a) => `${esc(a.name)} (${a.assistsToDate ?? ''})`).join(', ') : 'Unassisted';
    return `${head}<tr>
      <td class="t">${g.period === 'SO' ? '' : esc(g.time)}</td>
      <td class="tm">${esc(g.team)}</td>
      <td class="l"><strong>${esc(g.scorer.name)}</strong>${g.scorer.goalsToDate != null ? ` (${g.scorer.goalsToDate})` : ''} ${g.tags.map((t) => `<span class="c-tag">${esc(t)}</span>`).join('')}<div class="sub">${assists}</div></td>
      <td class="t">${g.score.away}-${g.score.home}</td>
      <td>${videoButton(g.highlightId, `${g.team} · ${g.scorer.name}`, '&#9654;', 'c-play', g.highlight)}</td>
    </tr>`;
  }).join('');
  return `<section class="c-sec"><h2>Scoring summary</h2><table class="c-table c-sum"><tbody>${rows}</tbody></table></section>`;
}

function penaltySummary(game) {
  if (!game.penalties.length) return '';
  let last = null;
  const rows = game.penalties.map((p) => {
    const head = p.period !== last ? `<tr class="c-sub"><td colspan="4">${esc(p.periodName)}</td></tr>` : '';
    last = p.period;
    return `${head}<tr><td class="t">${esc(p.time)}</td><td class="tm">${esc(p.team)}</td><td class="l">${esc(p.player)}: ${esc(p.infraction)}</td><td class="t">${p.minutes ?? ''} min</td></tr>`;
  }).join('');
  return `<section class="c-sec"><h2>Penalties</h2><table class="c-table c-sum"><tbody>${rows}</tbody></table></section>`;
}

function teamStats(game) {
  if (!game.teamStats.length) return '';
  return `<section class="c-sec"><h2>Team stats</h2><table class="c-table c-ts">
    <thead><tr><th class="l">${esc(game.away.abbrev)}</th><th></th><th class="r">${esc(game.home.abbrev)}</th></tr></thead>
    <tbody>${game.teamStats.map((s) => `<tr><td class="l ${s.awayNum > s.homeNum ? 'b' : ''}">${esc(s.away)}</td><td class="lbl">${esc(s.label)}</td><td class="r ${s.homeNum > s.awayNum ? 'b' : ''}">${esc(s.home)}</td></tr>`).join('')}</tbody>
  </table></section>`;
}

function skaterTable(list, title) {
  if (!list.length) return '';
  const sum = (k) => list.reduce((a, p) => a + p[k], 0);
  const fow = sum('fow');
  const fot = fow + sum('fol');
  return `<div class="c-scroll"><table class="c-table c-players sortable">
    <thead><tr><th class="l" data-sort>${esc(title)}</th><th data-sort>G</th><th data-sort>A</th><th data-sort>PTS</th><th data-sort>+/-</th><th data-sort>SOG</th><th data-sort>HIT</th><th data-sort>BLK</th><th data-sort>PIM</th><th data-sort>FO%</th><th data-sort>SHF</th><th data-sort>TOI</th></tr></thead>
    <tbody>${list.map((p) => `<tr>
      <td class="l" data-v="${esc(p.lastName)}"><span class="num">${p.number ?? ''}</span> ${esc(p.name)} <span class="pos">${esc(p.position)}</span></td>
      <td>${p.goals}</td><td>${p.assists}</td><td class="b">${p.points}</td><td data-v="${p.plusMinus}">${signed(p.plusMinus)}</td><td>${p.sog}</td><td>${p.hits}</td><td>${p.blocks}</td><td>${p.pim}</td>
      <td data-v="${p.foPct ?? -1}">${p.foPct == null ? '-' : p.foPct.toFixed(1)}</td><td>${p.shifts}</td><td data-v="${p.toiSeconds}">${esc(p.toi)}</td>
    </tr>`).join('')}</tbody>
    <tfoot><tr><td class="l">Totals</td><td>${sum('goals')}</td><td>${sum('assists')}</td><td>${sum('points')}</td><td></td><td>${sum('sog')}</td><td>${sum('hits')}</td><td>${sum('blocks')}</td><td>${sum('pim')}</td><td>${fot ? ((100 * fow) / fot).toFixed(1) : '-'}</td><td></td><td></td></tr></tfoot>
  </table></div>`;
}

function goalieTable(list) {
  if (!list.length) return '';
  return `<div class="c-scroll"><table class="c-table c-players">
    <thead><tr><th class="l">Goalies</th><th>SA</th><th>GA</th><th>SV</th><th>SV%</th><th>EV</th><th>PP</th><th>SH</th><th>TOI</th></tr></thead>
    <tbody>${list.map((g) => `<tr>
      <td class="l"><span class="num">${g.number ?? ''}</span> ${esc(g.name)} ${g.decision ? `<span class="c-dec">(${esc(g.decision)})</span>` : ''}</td>
      <td>${g.shotsAgainst}</td><td>${g.goalsAgainst}</td><td>${g.saves}</td><td class="b">${g.played ? pct(g.savePct) : '-'}</td>
      <td>${esc(g.evenStrength ?? '')}</td><td>${esc(g.powerPlay ?? '')}</td><td>${esc(g.shorthanded ?? '')}</td><td>${esc(g.toi)}</td>
    </tr>`).join('')}</tbody>
  </table></div>`;
}

function teamBox(game, side, color) {
  const team = game[side];
  const p = game.players[side];
  return `<section class="c-sec c-teambox" style="--team:${color}">
    <h2>${logo(team, 'c-mini')} ${esc(team.name)}</h2>
    ${skaterTable(p.forwards, 'Forwards')}
    ${skaterTable(p.defense, 'Defense')}
    ${goalieTable(goaliesOf(game, side))}
    ${team.scratches.length ? `<p class="c-note"><strong>Scratches:</strong> ${team.scratches.map(esc).join(', ')}</p>` : ''}
    ${team.coach ? `<p class="c-note"><strong>Head coach:</strong> ${esc(team.coach)}</p>` : ''}
  </section>`;
}

function gameInfo(game) {
  const stars = game.threeStars.length ? `<p><strong>Three stars:</strong> ${game.threeStars.map((s) => `${s.star}. ${esc(s.name)} (${esc(s.team)}) ${esc(s.line)}`).join(' · ')}</p>` : '';
  return `<section class="c-sec c-info"><h2>Game information</h2>
    ${stars}
    <p><strong>Venue:</strong> ${esc(game.venue)}${game.venueLocation ? `, ${esc(game.venueLocation)}` : ''}</p>
    ${game.officials.referees.length ? `<p><strong>Referees:</strong> ${game.officials.referees.map(esc).join(', ')} · <strong>Linesmen:</strong> ${game.officials.linesmen.map(esc).join(', ')}</p>` : ''}
    ${game.broadcasts.length ? `<p><strong>TV:</strong> ${game.broadcasts.map(esc).join(', ')}</p>` : ''}
    ${game.seasonSeries ? `<p><strong>Season series:</strong> ${esc(game.away.abbrev)} ${game.seasonSeries.away}, ${esc(game.home.abbrev)} ${game.seasonSeries.home}</p>` : ''}
    <p class="c-vids">${videoButton(game.video.recapId, `${game.away.abbrev} @ ${game.home.abbrev} · Recap`, 'Watch recap', 'c-btn')} ${videoButton(game.video.condensedId, `${game.away.abbrev} @ ${game.home.abbrev} · Condensed game`, 'Condensed game', 'c-btn')}</p>
  </section>`;
}

export default {
  id: 'classic',
  name: 'Classic',
  inspiration: 'Dense one-page box score, inspired by ESPN and CBS Sports',
  render(game) {
    const c = teamColors(game);
    return `<div class="c-wrap">
      ${header(game, c)}
      <section class="c-sec">${linescore(game)}</section>
      <div class="c-cols">
        <div>${scoringSummary(game)}${penaltySummary(game)}</div>
        <div>${teamStats(game)}${gameInfo(game)}</div>
      </div>
      ${teamBox(game, 'away', c.away)}
      ${teamBox(game, 'home', c.home)}
      <p class="c-note">Click a column heading to sort.</p>
    </div>`;
  },
};

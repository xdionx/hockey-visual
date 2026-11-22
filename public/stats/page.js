// Momentum stats: how the momentum model does, season by season. stats.html?season=<20252026>
//
// Everything comes from the season files (data/seasons/<season>.json, see src/seasonStats.js):
// per-player totals for the leaderboard and one row per game for the model checks.
import { loadSeason, currentSeason, fmt } from '../player/store.js';
import { installPlayerLinks, playerLink } from '../player/link.js';
import { esc, makeSortable, teamColor } from '../game/core.js';
import { leaderboard, minGames, FIRST_FULL_SEASON } from '../src/seasonStats.js';
import { seasonModel } from '../src/momentumModel.js';
import { compare, BOOK_NAMES, EDGE_MIN } from '../src/odds.js';
import { getStatic } from '../data.js';

installPlayerLinks();
const main = document.querySelector('#stats');
const params = new URLSearchParams(location.search);

const C = { ng: '#0b9bd9', sat: '#d97706', mom: '#8b5cf6' };
const NAMES = { ng: 'Momentum, goals left out', mom: 'Momentum, all pushes', sat: 'Shot attempts (SAT)', home: 'Home team' };

const prev = (s) => Number(`${Math.floor(s / 10000) - 1}${Math.floor(s / 10000)}`);
const allSeasons = () => {
  const out = [];
  for (let s = currentSeason(); s >= FIRST_FULL_SEASON; s = prev(s)) out.push(s);
  return out;
};
const pct = (v, d = 1) => (v == null ? '-' : `${(v * 100).toFixed(d)}%`);
const r2 = (v) => (v == null ? '-' : v.toFixed(2));

// Team filter shared by the Players and Finishing tables. Ranks stay league ranks, so a filtered
// table shows where each player sits in the whole NHL.
const teamsOf = (total) => [...new Set(Object.values(total?.players ?? {}).filter((r) => r.p !== 'G' && r.t).map((r) => r.t))].sort();
function filterBar(total, attr, pos, team) {
  const btns = [[null, 'All skaters'], ['F', 'Forwards'], ['D', 'Defense']].map(([p, l]) => `<button type="button" data-${attr}pos="${p ?? ''}" aria-pressed="${p === pos}">${l}</button>`).join('');
  const opts = teamsOf(total).map((t) => `<option value="${esc(t)}"${t === team ? ' selected' : ''}>${esc(t)}</option>`).join('');
  return `<div class="ms-filters"><div class="ms-toggle" role="group" aria-label="Position">${btns}</div>
    <label class="ms-select${team ? ' ms-on' : ''}"${team ? ` style="--team:${teamColor(team)}"` : ''}><span>Team</span><select data-${attr}team aria-label="Team"><option value="">All teams</option>${opts}</select></label></div>`;
}
const byTeam = (board, team) => (team ? board.filter((r) => r.t === team) : board);

function card(title, sub, html, cls = '') {
  return `<section class="pc-card ${cls}"><h2>${title}${sub ? ` <small>${sub}</small>` : ''}</h2>${html}</section>`;
}

/** 'complete' | 'current' | 'partial' | 'missing' */
function stateOf(season, total) {
  if (!total) return 'missing';
  if (season === currentSeason()) return 'current';
  return total.complete ? 'complete' : 'partial';
}

function chips(list, selected) {
  return `<nav class="ms-seasons" aria-label="Season">${list.map(({ season, state }) => {
    const label = fmt.season(season);
    if (state === 'missing') return `<span class="ms-chip ms-off" title="${label} is still being built from the NHL play-by-play">${label}</span>`;
    const tip = state === 'partial' ? ' title="Still being built: numbers so far"' : state === 'current' ? ' title="Season in progress"' : '';
    return `<a class="ms-chip ${state === 'partial' ? 'ms-part' : ''}" href="?season=${season}"${season === selected ? ' aria-current="true"' : ''}${tip}>${label}${state === 'partial' ? '<i>*</i>' : ''}</a>`;
  }).join('')}</nav>`;
}

function winTile(key, w, hl = false) {
  const v = w?.pct;
  const width = v == null ? 0 : Math.max(0, Math.min(100, v * 100));
  return `<div class="ms-win${hl ? ' ms-hl' : ''}" style="--c:${C[key] ?? '#64748b'}">
    <span class="ms-win-k">${NAMES[key]}</span>
    <span class="ms-win-v">${pct(v)}</span>
    <span class="ms-meter" role="img" aria-label="${pct(v)} of games won"><b style="width:${width}%"></b><i style="left:50%"></i></span>
    <span class="ms-win-s">${w?.n ? `${w.won} of ${w.n} games` : 'no games yet'}</span>
  </div>`;
}

function modelCard(m, season, state) {
  if (!m.games) {
    return card('Does momentum win games?', '', '<p class="pq-note">This season file was saved before game-by-game rows were added. It fills in on the next data refresh.</p>');
  }
  const missingNg = m.games - m.noGoalGames;
  const pred = m.predictive;
  const corr = (label, v, sub) => `<div class="pq-t pq-ours"><span class="pq-v">${r2(v)}</span><span class="pq-k">${label}</span><span class="pq-s">${sub}</span></div>`;
  return card('Does momentum win games?', `${m.games} games${state === 'partial' ? ' so far' : ''}`, `
    <p class="ms-lede">How often the team that won each battle won the game. The fair test is <b>momentum with goals left out</b>: goals are part of the full momentum number, so that one partly counts the result itself. Shot attempts (SAT, the stat analysts call Corsi) are the yardstick to beat, and the home team is the floor.</p>
    <div class="ms-wins">${winTile('ng', m.wins.ng, true)}${winTile('sat', m.wins.sat)}${winTile('mom', m.wins.mom)}${winTile('home', m.wins.home)}</div>
    <p class="pq-note">Expect the per-game numbers without goals to sit near 50%: a team that falls behind pushes harder for the rest of the game (analysts call it score effects), so it often wins the shot and momentum battle while losing the game. The standings and prediction checks below look past that.</p>
    ${missingNg ? `<p class="pq-note">${missingNg} games saved before "goals left out" existed are skipped in that number until they are refreshed.</p>` : ''}
    <h3 class="pc-sub">Does it explain the standings? <small>correlation (r) between a team's share and its points %, 1 = perfect</small></h3>
    <div class="pq-grid pc-grid ms-corr">
      ${corr('Momentum, no goals', m.fit.ng, 'share of team momentum')}
      ${corr('SAT', m.fit.sat, 'share of shot attempts')}
      ${corr('Momentum, all', m.fit.mom, 'includes goals')}
      ${pred ? `${corr('Predicts: MOM', pred.ng, '1st half share → 2nd half pts %')}${corr('Predicts: SAT', pred.sat, '1st half share → 2nd half pts %')}${corr('Predicts: goals', pred.gf, '1st half GF% → 2nd half pts %')}` : ''}
    </div>
    <p class="pq-note">${pred ? 'The "Predicts" numbers split the season in half: a stat that measures real skill should still line up with results in games it hasn\'t seen. Goals for % is the luck-heavy comparison.' : 'The first-half/second-half prediction test appears once every team has played 20 games.'}</p>`);
}

/** Grouped bars: win % by share of the game, momentum (no goals) beside SAT. */
function binsChart(bins) {
  const W = 620;
  const H = 220;
  const pad = { l: 40, r: 10, t: 14, b: 40 };
  const iw = W - pad.l - pad.r;
  const ih = H - pad.t - pad.b;
  const gw = iw / bins.length;
  const bw = Math.min(30, (gw - 16) / 2);
  const y = (v) => pad.t + ih - v * ih;
  const grid = [0, 0.25, 0.5, 0.75, 1].map((v) => `<line class="ms-grid${v === 0.5 ? ' ms-half' : ''}" x1="${pad.l}" x2="${W - pad.r}" y1="${y(v)}" y2="${y(v)}"/><text class="ms-ax" x="${pad.l - 6}" y="${y(v) + 3}" text-anchor="end">${v * 100}%</text>`).join('');
  const bars = bins.map((b, i) => {
    const cx = pad.l + gw * i + gw / 2;
    const label = b.lo === 0 ? `under ${b.hi}%` : b.hi === 100 ? `${b.lo}%+` : `${b.lo}-${b.hi}%`;
    const bar = (k, x) => {
      const v = b[k].pct;
      if (v == null) return '';
      const h = Math.max(2, v * ih);
      return `<g class="ms-hit"><rect x="${x - 4}" y="${pad.t}" width="${bw + 8}" height="${ih}" fill="transparent"/><path d="M${x},${pad.t + ih} v${-(h - 4)} q0,-4 4,-4 h${bw - 8} q4,0 4,4 v${h - 4} z" fill="${C[k]}"/><title>${NAMES[k]}, ${label} of the game: won ${pct(v)} (${b[k].won} of ${b[k].n})</title></g>`;
    };
    return `${bar('ng', cx - bw - 1)}${bar('sat', cx + 1)}<text class="ms-ax" x="${cx}" y="${H - pad.b + 16}" text-anchor="middle">${label}</text>`;
  }).join('');
  return `<div class="ms-legend"><span style="--c:${C.ng}">Momentum, goals left out</span><span style="--c:${C.sat}">Shot attempts</span></div>
    <div class="ms-scroll"><svg class="ms-chart" viewBox="0 0 ${W} ${H}" style="max-width:${W}px" role="img" aria-label="Win percentage by share of the game">${grid}${bars}
    <text class="ms-ax" x="${pad.l + iw / 2}" y="${H - 4}" text-anchor="middle">Team's share of the game</text></svg></div>`;
}

function binsTable(bins) {
  const label = (b) => (b.lo === 0 ? `under ${b.hi}%` : b.hi === 100 ? `${b.lo}%+` : `${b.lo}-${b.hi}%`);
  return `<details class="ms-fold"><summary>Show as a table</summary><div class="pc-scroll"><table class="pc-table"><thead><tr><th class="l">Share of the game</th><th>Momentum win %</th><th>Games</th><th>SAT win %</th><th>Games</th></tr></thead><tbody>
    ${bins.map((b) => `<tr><td class="l">${label(b)}</td><td>${pct(b.ng.pct)}</td><td>${b.ng.n}</td><td>${pct(b.sat.pct)}</td><td>${b.sat.n}</td></tr>`).join('')}</tbody></table></div></details>`;
}

/** Scatter: each team's share (x) against its points % (y). */
function scatter(teams, key) {
  const pts = teams.filter((t) => t[key] != null && t.ptsPct != null);
  if (pts.length < 3) return '<p class="pq-note">Not enough games yet.</p>';
  const W = 560;
  const H = 320;
  const pad = { l: 44, r: 14, t: 12, b: 38 };
  const xs = pts.map((t) => t[key]);
  const ys = pts.map((t) => t.ptsPct);
  const span = (vals, min) => {
    const lo = Math.min(...vals);
    const hi = Math.max(...vals);
    const m = Math.max(min, (hi - lo) * 0.08);
    return [lo - m, hi + m];
  };
  const [x0, x1] = span(xs, 0.01);
  const [y0, y1] = span(ys, 0.02);
  const X = (v) => pad.l + ((v - x0) / (x1 - x0)) * (W - pad.l - pad.r);
  const Y = (v) => pad.t + (1 - (v - y0) / (y1 - y0)) * (H - pad.t - pad.b);
  // Least-squares line
  const n = pts.length;
  const mx = xs.reduce((a, b) => a + b, 0) / n;
  const my = ys.reduce((a, b) => a + b, 0) / n;
  const slope = xs.reduce((a, x, i) => a + (x - mx) * (ys[i] - my), 0) / (xs.reduce((a, x) => a + (x - mx) ** 2, 0) || 1);
  const fy = (x) => my + slope * (x - mx);
  const ticks = (a, b, step) => {
    const out = [];
    for (let v = Math.ceil(a / step) * step; v <= b; v += step) out.push(Math.round(v * 1000) / 1000);
    return out;
  };
  const xt = ticks(x0, x1, x1 - x0 > 0.12 ? 0.04 : 0.02).map((v) => `<line class="ms-grid" x1="${X(v)}" x2="${X(v)}" y1="${pad.t}" y2="${H - pad.b}"/><text class="ms-ax" x="${X(v)}" y="${H - pad.b + 14}" text-anchor="middle">${(v * 100).toFixed(0)}%</text>`).join('');
  const yt = ticks(y0, y1, 0.1).map((v) => `<line class="ms-grid" x1="${pad.l}" x2="${W - pad.r}" y1="${Y(v)}" y2="${Y(v)}"/><text class="ms-ax" x="${pad.l - 6}" y="${Y(v) + 3}" text-anchor="end">${(v * 100).toFixed(0)}%</text>`).join('');
  const color = key === 'satShare' ? C.sat : key === 'momShare' ? C.mom : C.ng;
  const dots = pts.map((t) => `<g class="ms-hit"><circle cx="${X(t[key])}" cy="${Y(t.ptsPct)}" r="12" fill="transparent"/><circle cx="${X(t[key])}" cy="${Y(t.ptsPct)}" r="5" fill="${color}" stroke="#111827" stroke-width="2"/>
    <text class="ms-dot" x="${X(t[key]) + 8}" y="${Y(t.ptsPct) + 3}">${esc(t.abbrev)}</text><title>${esc(t.abbrev)}: ${pct(t[key])} share, ${pct(t.ptsPct)} of points (${t.w}-${t.l}-${t.otl})</title></g>`).join('');
  const xLabel = key === 'satShare' ? 'Share of shot attempts' : key === 'momShare' ? 'Share of momentum (all pushes)' : 'Share of momentum (goals left out)';
  return `<div class="ms-scroll"><svg class="ms-chart" viewBox="0 0 ${W} ${H}" style="max-width:${W}px" role="img" aria-label="${xLabel} against points percentage">${xt}${yt}
    <line class="ms-fit" x1="${X(x0)}" y1="${Y(fy(x0))}" x2="${X(x1)}" y2="${Y(fy(x1))}"/>${dots}
    <text class="ms-ax" x="${pad.l + (W - pad.l - pad.r) / 2}" y="${H - 4}" text-anchor="middle">${xLabel}</text>
    <text class="ms-ax" transform="translate(11 ${pad.t + (H - pad.t - pad.b) / 2}) rotate(-90)" text-anchor="middle">Points %</text></svg></div>`;
}

function teamsCard(m) {
  if (!m.teams.length) return '';
  const rows = m.teams.slice().sort((a, b) => b.ptsPct - a.ptsPct).map((t) => `<tr style="--team:${teamColor(t.abbrev)}">
    <td class="l ms-team">${esc(t.abbrev)}</td><td>${t.gp}</td><td class="l">${t.w}-${t.l}-${t.otl}</td>
    <td data-v="${t.ptsPct}"><b>${pct(t.ptsPct)}</b></td><td data-v="${t.gdPerGame}">${fmt.signed(t.gdPerGame, 2)}</td>
    <td class="pc-o" data-v="${t.ngShare ?? ''}">${pct(t.ngShare)}</td><td class="pc-o" data-v="${t.momShare}">${pct(t.momShare)}</td>
    <td data-v="${t.satShare}">${pct(t.satShare)}</td><td data-v="${t.momPerGame}" class="pc-o ${t.momPerGame >= 0 ? 'up' : 'down'}">${fmt.signed(t.momPerGame, 1)}</td>
    <td class="${t.gaa > 0 ? 'up' : t.gaa < 0 ? 'down' : ''}" data-v="${t.gaa ?? ''}">${fmt.signed(t.gaa, 1)}</td></tr>`).join('');
  return card('Teams', 'momentum share against the standings', `
    <div class="ms-toggle" role="group" aria-label="Chart">
      <button type="button" data-x="ngShare" aria-pressed="true">Momentum, no goals <small>r ${r2(m.fit.ng)}</small></button>
      <button type="button" data-x="satShare" aria-pressed="false">SAT <small>r ${r2(m.fit.sat)}</small></button>
      <button type="button" data-x="momShare" aria-pressed="false">Momentum, all <small>r ${r2(m.fit.mom)}</small></button>
    </div>
    <div class="ms-scatter">${scatter(m.teams, 'ngShare')}</div>
    <p class="pq-note">Each dot is a team. The closer the dots hug the line, the better that number explains who is winning.</p>
    <div class="pc-scroll"><table class="pc-table sortable"><thead><tr><th class="l" data-sort>Team</th><th data-sort>GP</th><th class="l">W-L-OTL</th><th data-sort data-dir="desc">Pts %</th><th data-sort title="Goal differential per game">GD/GP</th>
      <th class="pc-o" data-sort title="Share of the momentum both teams built, goals left out">MOM% no goals</th><th class="pc-o" data-sort title="Share of all momentum, goals included">MOM%</th><th data-sort title="Share of shot attempts (Corsi for %)">SAT%</th><th class="pc-o" data-sort title="Momentum built minus momentum given up, per game">MOM +/− /GP</th><th data-sort title="Finishing: goals scored minus what average NHL shooters would score from the same shots. Not part of momentum.">Goals vs avg</th></tr></thead>
      <tbody>${rows}</tbody></table></div>`, 'ms-teams');
}

const PLAYER_COLS = [
  ['momPerGame', 'MOM/GP', 'Momentum impact per game'],
  ['momPosPerGame', 'MOM+/GP', 'Momentum created per game'],
  ['momNegPerGame', 'MOM−/GP', 'Momentum given up per game (penalties, giveaways, lost draws)'],
  ['satPerGame', 'SAT/GP', 'Own shot attempts per game'],
  ['sogPerGame', 'SOG/GP', 'Shots on goal per game'],
  ['momPer60', 'MOM/60', 'Momentum per 60 minutes on ice (seasons with time on ice only)'],
  ['satPer60', 'SAT/60', 'Shot attempts per 60 minutes on ice'],
];

function playersCard(total, pos, showAll, team) {
  const minGp = minGames(total);
  const league = leaderboard(total, 'momPerGame', { pos, minGp });
  const board = byTeam(league, team);
  const has60 = board.some((r) => r.momPer60 != null);
  const tiers = board.some((r) => r.abovePct != null);
  const cols = PLAYER_COLS.filter(([k]) => has60 || !k.endsWith('60'));
  const shown = showAll ? board : board.slice(0, 50);
  const val = (r, k) => {
    const v = r[k];
    if (v == null) return '<td class="pc-na">-</td>';
    const signed = k.startsWith('mom');
    const cls = k === 'momPerGame' ? ` pc-o ${v >= 0 ? 'up' : 'down'}` : signed ? ' pc-o' : '';
    return `<td class="${cls.trim()}" data-v="${v}">${signed ? fmt.signed(v, 2) : fmt.dec(v, 2)}</td>`;
  };
  const rows = shown.map((r) => `<tr><td data-v="${r.rank}">${r.rank}</td><td class="l">${playerLink(r.id, r.n)}</td><td class="l">${esc(r.t)}</td><td class="l">${esc(r.p)}</td><td>${r.gp}</td>${cols.map(([k]) => val(r, k)).join('')}<td data-v="${r.mom}">${fmt.signed(r.mom, 1)}</td>${tiers ? `<td class="pc-o up" data-v="${r.abovePct ?? ''}">${pct(r.abovePct, 0)}</td><td class="pc-o down" data-v="${r.belowPct ?? ''}">${pct(r.belowPct, 0)}</td>` : ''}</tr>`).join('');
  return card('Players', `${team ? `${board.length} ${esc(team)} of ${league.length}` : board.length} skaters with ${minGp}+ games`, `
    ${filterBar(total, '', pos, team)}
    <div class="pc-scroll"><table class="pc-table sortable ms-players"><thead><tr><th data-sort>#</th><th class="l" data-sort>Player</th><th class="l" data-sort>Team</th><th class="l">Pos</th><th data-sort>GP</th>
      ${cols.map(([k, l, tip], i) => `<th class="${k.startsWith('mom') ? 'pc-o' : ''}" data-sort${i === 0 ? ' data-dir="desc"' : ''} title="${tip}">${l}</th>`).join('')}<th data-sort title="Season total">MOM</th>${tiers ? '<th class="pc-o" data-sort title="Share of games well above average for the position (momentum plus finishing)">Above avg</th><th class="pc-o" data-sort title="Share of games well below average for the position">Below avg</th>' : ''}</tr></thead>
      <tbody>${rows}</tbody></table></div>
    ${board.length > shown.length ? `<button type="button" class="ms-more" data-more>Show all ${board.length}</button>` : ''}
    ${board.length ? '' : '<p class="pq-note">No skaters on this team have played enough games yet.</p>'}
    <p class="pq-note">Click a name for the player card.${team ? ' # is the rank across the whole league.' : ''} Minimum games is a quarter of the most games anyone has played this season.${tiers ? ' Above avg / Below avg: how often a player\'s game (momentum plus finishing) was well above or below a typical game at that position; most games land in between.' : ''}${has60 ? '' : ' Per-60 numbers need time on ice, which seasons rebuilt from the play-by-play don\'t have.'}</p>`, 'ms-players-card');
}

// Finishing: goals scored against what an average NHL shooter would score from the same shots (our xG,
// scaled to the league's real scoring that season). Its own stat, not part of momentum.
const FIN_MIN_XG = 3;
const NO_FIN = '<p class="pq-note">No finishing numbers in this season file yet. They fill in on the next data refresh.</p>';

function gaaCell(v, d = 1, strong = false) {
  const txt = fmt.signed(v, d);
  return `<td class="pc-o ${v > 0 ? 'up' : v < 0 ? 'down' : ''}" data-v="${v ?? ''}">${strong ? `<b>${txt}</b>` : txt}</td>`;
}

function finPlayers(total, pos, showAll, team) {
  const minGp = minGames(total);
  const league = leaderboard(total, 'gaa', { pos, minGp, minXg: FIN_MIN_XG });
  if (!league.length) return NO_FIN;
  const board = byTeam(league, team);
  const shown = showAll ? board : board.slice(0, 50);
  const rows = shown.map((r) => `<tr><td data-v="${r.rank}">${r.rank}</td><td class="l">${playerLink(r.id, r.n)}</td><td class="l">${esc(r.t)}</td><td class="l">${esc(r.p)}</td><td>${r.gp}</td>
    <td>${r.sog}</td><td data-v="${r.xgg ?? 0}">${r.xgg ?? 0}</td><td data-v="${r.shPct ?? ''}">${pct(r.shPct)}</td><td data-v="${r.xShPct ?? ''}">${pct(r.xShPct)}</td>${gaaCell(r.gaa, 1, true)}</tr>`).join('');
  return `${filterBar(total, 'fin', pos, team)}
    <div class="pc-scroll"><table class="pc-table sortable ms-players"><thead><tr><th data-sort>#</th><th class="l" data-sort>Player</th><th class="l" data-sort>Team</th><th class="l">Pos</th><th data-sort>GP</th>
      <th data-sort title="Shots on goal">Shots</th><th data-sort title="Goals scored with a goalie in net (empty-net goals left out)">Goals</th><th data-sort title="Share of shots on goal that went in">Shooting %</th><th data-sort title="What an average NHL shooter would shoot from the same shots (same distance, angle and shot type) this season">Avg shooter %</th><th class="pc-o" data-sort data-dir="desc" title="Goals scored minus what an average NHL shooter would score from the same shots">Goals vs avg</th></tr></thead>
      <tbody>${rows}</tbody></table></div>
    ${board.length > shown.length ? `<button type="button" class="ms-more" data-finmore>Show all ${board.length}</button>` : ''}
    <p class="pq-note">${team ? `${board.length} ${esc(team)} of ${league.length}` : board.length} skaters with ${minGp}+ games and enough good chances to judge (about 3 goals' worth).${team ? ' # is the rank across the whole league.' : ''}</p>`;
}

function finTeams(m) {
  const teams = m.teams.filter((t) => t.gaa != null).sort((a, b) => b.gaa - a.gaa);
  if (!teams.length) return NO_FIN;
  const rows = teams.map((t) => `<tr style="--team:${teamColor(t.abbrev)}"><td class="l ms-team">${esc(t.abbrev)}</td><td>${t.gp}</td><td data-v="${t.ptsPct}">${pct(t.ptsPct)}</td>
    <td>${t.finSog}</td><td>${t.finGoals}</td><td data-v="${t.shPct ?? ''}">${pct(t.shPct)}</td><td data-v="${t.xShPct ?? ''}">${pct(t.xShPct)}</td>${gaaCell(t.gaa, 1, true)}${gaaCell(t.gaaPerGame, 2)}</tr>`).join('');
  return `<div class="pc-scroll"><table class="pc-table sortable"><thead><tr><th class="l" data-sort>Team</th><th data-sort>GP</th><th data-sort>Pts %</th>
      <th data-sort title="Shots on goal with a goalie in net">Shots</th><th data-sort title="Goals scored with a goalie in net (empty-net goals and shootouts left out)">Goals</th><th data-sort title="Share of shots on goal that went in">Shooting %</th><th data-sort title="What average NHL shooters would shoot from the same shots this season">Avg shooter %</th><th class="pc-o" data-sort data-dir="desc" title="Goals scored minus what average NHL shooters would score from the same shots">Goals vs avg</th><th class="pc-o" data-sort title="Goals vs average, per game">Per game</th></tr></thead>
      <tbody>${rows}</tbody></table></div>
    <p class="pq-note">Goals vs average per game against points %: r ${r2(m.fit.fin)}.${m.finSource === 'players' ? ' This season was saved before game rows carried team shots, so team totals add up every skater\'s season under the player\'s latest team (a traded player counts fully for the new team).' : ''}</p>`;
}

function finishingCard(total, m, view, pos, showAll, team) {
  const tabs = [['players', 'Players'], ['teams', 'Teams']].map(([k, l]) => `<button type="button" data-fin="${k}" aria-pressed="${k === view}">${l}</button>`).join('');
  return card('Finishing', 'who buries their chances', `
    <p class="ms-lede">Some shots are far easier to score on than others: a tip at the side of the net goes in much more often than a slap shot from the point. <b>Avg shooter %</b> is how often an average NHL shooter scores from the same shots (same spots, same kinds of shot) this season. <b>Shooting %</b> is how often this shooter actually scored. <b>Goals vs avg</b> turns the gap into goals: +8 means 8 more goals than an average shooter would have scored. It's its own stat and isn't part of momentum.</p>
    <div class="ms-toggle" role="group" aria-label="Finishing view">${tabs}</div>
    ${view === 'teams' ? finTeams(m) : finPlayers(total, pos, showAll, team)}
    <p class="pq-note">Shot quality is our own estimate from shot location and type, scaled so the league as a whole comes out exactly average each season. Finishing is a real skill but a streaky one: about a third of a hot or cold year carries into the next.</p>`, 'ms-fin-card');
}

/** League view across every season we have: win % per season (line chart) plus a table. */
function trendsCard(list) {
  const have = list.filter((s) => s.model?.games).reverse(); // oldest first
  if (!have.length) return '';
  const W = Math.max(640, have.length * 52 + 60);
  const H = 220;
  const pad = { l: 40, r: 16, t: 14, b: 30 };
  const vals = have.flatMap((s) => [s.model.wins.ng.pct, s.model.wins.sat.pct, s.model.wins.mom.pct]).filter((v) => v != null);
  const lo = Math.min(0.5, ...vals) - 0.02;
  const hi = Math.max(...vals, 0.6) + 0.02;
  const step = have.length > 1 ? (W - pad.l - pad.r) / (have.length - 1) : 0;
  const X = (i) => pad.l + (have.length > 1 ? i * step : (W - pad.l - pad.r) / 2);
  const Y = (v) => pad.t + (1 - (v - lo) / (hi - lo)) * (H - pad.t - pad.b);
  const grid = [];
  for (let v = Math.ceil(lo * 20) / 20; v <= hi; v += 0.05) grid.push(`<line class="ms-grid${Math.abs(v - 0.5) < 0.001 ? ' ms-half' : ''}" x1="${pad.l}" x2="${W - pad.r}" y1="${Y(v)}" y2="${Y(v)}"/><text class="ms-ax" x="${pad.l - 6}" y="${Y(v) + 3}" text-anchor="end">${Math.round(v * 100)}%</text>`);
  const line = (k) => {
    const p = have.map((s, i) => [X(i), s.model.wins[k].pct]).filter(([, v]) => v != null);
    if (!p.length) return '';
    return `<polyline fill="none" stroke="${C[k]}" stroke-width="2" stroke-linejoin="round" points="${p.map(([x, v]) => `${x},${Y(v)}`).join(' ')}"/>
      ${have.map((s, i) => (s.model.wins[k].pct == null ? '' : `<g class="ms-hit"><circle cx="${X(i)}" cy="${Y(s.model.wins[k].pct)}" r="10" fill="transparent"/><circle cx="${X(i)}" cy="${Y(s.model.wins[k].pct)}" r="4" fill="${C[k]}" stroke="#111827" stroke-width="2"/><title>${fmt.season(s.season)}, ${NAMES[k]}: ${pct(s.model.wins[k].pct)}${s.state === 'partial' || s.state === 'current' ? ' (so far)' : ''}</title></g>`)).join('')}`;
  };
  const xl = have.map((s, i) => `<text class="ms-ax" x="${X(i)}" y="${H - pad.b + 16}" text-anchor="middle">${String(s.season).slice(2, 4)}-${String(s.season).slice(6, 8)}${s.state === 'partial' ? '*' : ''}</text>`).join('');
  const rows = list.filter((s) => s.model?.games).map((s) => `<tr><td class="l"><a href="?season=${s.season}">${fmt.season(s.season)}</a>${s.state === 'partial' ? ' *' : s.state === 'current' ? ' <small>now</small>' : ''}</td><td>${s.model.games}</td>
    <td class="pc-o">${pct(s.model.wins.ng.pct)}</td><td>${pct(s.model.wins.sat.pct)}</td><td>${pct(s.model.wins.mom.pct)}</td><td>${pct(s.model.wins.home.pct)}</td>
    <td class="pc-o">${r2(s.model.fit.ng)}</td><td>${r2(s.model.fit.sat)}</td><td class="pc-o">${r2(s.model.predictive?.ng)}</td><td>${r2(s.model.predictive?.sat)}</td>
    <td>${fmt.dec(s.model.league.momPerTeamGame, 1)}</td><td>${fmt.dec(s.model.league.satPerTeamGame, 1)}</td></tr>`).join('');
  const missing = list.filter((s) => s.state === 'missing').length;
  return card('Season by season', 'how the model holds up across the league', `
    <div class="ms-legend"><span style="--c:${C.ng}">Momentum, goals left out</span><span style="--c:${C.sat}">Shot attempts</span><span style="--c:${C.mom}">Momentum, all</span></div>
    <div class="ms-scroll"><svg class="ms-chart" viewBox="0 0 ${W} ${H}" style="max-width:${W}px" role="img" aria-label="Win percentage of the team that won each battle, by season">${grid.join('')}${line('sat')}${line('mom')}${line('ng')}${xl}</svg></div>
    <p class="pq-note">Win % of the team that won each battle.${missing ? ` ${missing} older season${missing === 1 ? ' is' : 's are'} still being built from the NHL play-by-play and will appear on their own.` : ''}${list.some((s) => s.state === 'partial') ? ' * = still being built, numbers so far.' : ''}</p>
    <div class="pc-scroll"><table class="pc-table"><thead><tr><th class="l">Season</th><th>Games</th><th class="pc-o" title="Momentum winner, goals left out">MOM win %</th><th title="SAT winner">SAT win %</th><th title="Momentum winner, goals included">MOM (all) win %</th><th>Home win %</th>
      <th class="pc-o" title="Team momentum share (no goals) vs points %">MOM r</th><th title="Team SAT share vs points %">SAT r</th><th class="pc-o" title="First-half momentum share vs second-half points %">MOM predicts</th><th title="First-half SAT share vs second-half points %">SAT predicts</th><th title="Momentum per team per game">MOM/team GP</th><th title="Shot attempts per team per game">SAT/team GP</th></tr></thead>
      <tbody>${rows}</tbody></table></div>`);
}

// Our pre-game pick against DraftKings and FanDuel (data/odds.json, saved by the data script before each puck drop).
function marketCard(odds) {
  const c = odds ? compare(odds) : null;
  if (!c?.games) {
    return card('Us vs the market', 'DraftKings and FanDuel', '<p class="pq-note">We started saving sportsbook lines and our own pre-game pick for every regular-season game on Nov 22, 2026. Results show up here as games finish; the comparison means little before a few hundred games.</p>');
  }
  const f = (v, d = 3) => (v == null ? '-' : v.toFixed(d));
  const row = (label, sc, cls = '') => `<tr class="${cls}"><td class="l">${label}</td><td>${sc?.n ?? '-'}</td><td>${sc ? `${(sc.accuracy * 100).toFixed(1)}%` : '-'}</td><td>${f(sc?.brier)}</td><td>${f(sc?.logLoss)}</td></tr>`;
  const tbl = (rows) => `<div class="pc-scroll"><table class="pc-table"><thead><tr><th class="l">Source</th><th>Games</th><th title="How often the favorite won">Right</th><th title="Brier score: lower is better">Brier</th><th title="Log loss: lower is better">Log loss</th></tr></thead><tbody>${rows}</tbody></table></div>`;
  const base = c.same ?? { us: c.us, dk: c.dk, fd: c.fd };
  const gaps = c.gaps.map((g) => {
    const us = Math.round(g.s.us * 100);
    const mk = Math.round(g.s.market * 100);
    const won = g.result === 'away' ? 'away won' : 'home won';
    return `<tr><td class="l">${esc(g.date)} · game ${esc(g.id.slice(-4))}</td><td>${us}%</td><td>${mk}%</td><td>${won}</td></tr>`;
  }).join('');
  return card('Us vs the market', `${c.games} finished games`, `
    <p class="ms-lede">Each game's lines are saved shortly before puck drop, next to our own pick, and judged once it's over. Sportsbook prices include the book's margin, so it is removed first. Lower Brier and log loss mean better-calibrated win chances.</p>
    ${tbl(`${row('Our pick', base.us, 'ml-live')}${row(BOOK_NAMES.dk, base.dk)}${row(BOOK_NAMES.fd, base.fd)}${base.market ? row('Both books averaged', base.market) : ''}`)}
    <p class="pq-note">${c.same ? `Scored on the ${c.both} games every source covers, so the rows compare directly.` : 'Each source is scored on every game it has.'} Hockey is close to a coin flip: markets are usually right about 58-60% of the time, so a gap of a point or two needs hundreds of games to mean anything.</p>
    ${c.flagged.n ? `<p class="pq-note"><b>Flagged games</b> (we and the books differ by ${Math.round(EDGE_MIN * 100)}+ points): the side we liked more won <b>${c.flagged.ours}</b> of ${c.flagged.n}, the side the market liked more won <b>${c.flagged.market}</b>.${c.flagged.n < 100 ? ' Too few games so far to say who is right.' : ''}</p>` : ''}
    ${gaps ? `<details class="ms-fold"><summary>Biggest disagreements</summary><div class="pc-scroll"><table class="pc-table"><thead><tr><th class="l">Game</th><th>Our away %</th><th>Market away %</th><th>Result</th></tr></thead><tbody>${gaps}</tbody></table></div></details>` : ''}`);
}

// Model versions side by side (public/model-lab.json, written by scripts/model-lab.js over past seasons).
const LAB_CHECKS = [
  ['pickNg', 'pickSat', 'Same game', 'Team with more momentum (goals left out) won the game', pct],
  ['fitNg', 'fitSat', 'Standings', 'Team share vs points % (r)', r2],
  ['halfPtsNg', 'halfPtsSat', 'Predicts 2nd half', 'First-half share vs second-half points % (r)', r2],
  ['aheadGdNg', 'aheadGdSat', 'Predicts next game', 'Season-to-date share gap vs the next game\'s goal gap (r)', r2],
];
const diff = (v, base, isPct) => {
  if (v == null || base == null) return '';
  const raw = isPct ? (v - base) * 100 : v - base;
  const d = Math.abs(raw) < (isPct ? 0.05 : 0.005) ? 0 : raw;
  const txt = isPct ? `${d > 0 ? '+' : d < 0 ? '−' : ''}${Math.abs(d).toFixed(1)}` : `${d > 0 ? '+' : d < 0 ? '−' : ''}${Math.abs(d).toFixed(2)}`;
  return ` <small class="${d > 0 ? 'ml-up' : d < 0 ? 'ml-down' : ''}">${txt}</small>`;
};

function labCard(lab, view) {
  if (!lab?.versions?.length) return '';
  const seasons = Object.keys(lab.seasons).map(Number).sort((a, b) => b - a);
  const block = view === 'all' ? lab.pooled : lab.seasons[view];
  if (!block) return '';
  const first = block[lab.versions[0].id];
  const sat = `<tr class="ml-sat"><td class="l">Shot attempts (SAT) <small>yardstick</small></td>${LAB_CHECKS.map(([, k, , , f]) => `<td>${f(first.checks[k])}</td>`).join('')}</tr>`;
  const rows = lab.versions.map((v) => {
    const c = block[v.id]?.checks ?? {};
    return `<tr class="${v.live ? 'ml-live' : ''}"><td class="l">${esc(v.name)}${v.live ? ' <span class="ml-tag">live</span>' : ''}</td>${LAB_CHECKS.map(([k, base, , , f], i) => {
      const leak = i === 0 && v.leaky;
      return `<td class="pc-o${leak ? ' ml-leak' : ''}" ${leak ? 'title="Uses the score, so this number partly counts the result"' : ''}>${f(c[k])}${leak ? '†' : diff(c[k], first.checks[base], f === pct)}</td>`;
    }).join('')}</tr>`;
  }).join('');
  const views = [['all', `All ${seasons.length} seasons`], ...seasons.map((x) => [String(x), fmt.season(x)])];
  const games = view === 'all' ? lab.pooled[lab.versions[0].id].games : first.games;
  return card('Model versions', `${games.toLocaleString()} games${view === 'all' ? `, ${seasons.length} seasons averaged` : ''}`, `
    <p class="ms-lede">Each version of the momentum model scored over the same past games, next to shot attempts. Small numbers show the gap to SAT: green beats it. The last two checks never see the game they judge, so they are the fairest tests of real skill. Hockey is random, so a few points over SAT is a real gain.</p>
    <div class="ms-toggle" role="group" aria-label="Seasons">${views.map(([k, l]) => `<button type="button" data-lab="${k}" aria-pressed="${k === String(view)}">${l}</button>`).join('')}</div>
    <div class="pc-scroll"><table class="pc-table ml-table"><thead><tr><th class="l">Version</th>${LAB_CHECKS.map(([, , l, tip]) => `<th class="pc-o" title="${tip}">${l}</th>`).join('')}</tr></thead>
      <tbody>${sat}${rows}</tbody></table></div>
    <p class="pq-note">Same game: how often the team with more momentum, goals left out, won. Standings: how closely each team's season share lines up with its points % (r, 1 = perfect). Predicts 2nd half: first-half share against second-half points %. Predicts next game: before every game, the gap between the two teams' season-to-date shares, against the goal gap in that game (10+ games each; small r values are normal for a single game). With all seasons selected, the two prediction checks pool every season into one test. † uses the score, so its same-game number partly counts the result.</p>
    <details class="ms-fold"><summary>What each version changes</summary><ul class="ml-notes">${lab.versions.map((v) => `<li><b>${esc(v.name)}</b>: ${esc(v.note || '')}</li>`).join('')}</ul></details>`, 'ml-card');
}

let state = null;

function render() {
  const { list, season, pos, showAll } = state;
  const sel = list.find((s) => s.season === season);
  const total = sel?.total;
  const head = `<section class="ms-hero"><span class="pc-kicker">Our model${total?.v ? ` v${total.v}` : ''} · regular season</span><h1>Momentum <b>stats</b></h1>
    <p>How the momentum model rates players and teams, and how well it lines up with winning, season by season.</p>${chips(list, season)}</section>`;
  if (!total) {
    main.innerHTML = `${head}<section class="pc-card"><p class="pq-note">${fmt.season(season)} hasn't been built yet. Seasons are rebuilt from the NHL play-by-play a few at a time; pick another season above.</p></section>${trendsCard(list)}${marketCard(state.odds)}${labCard(state.lab, state.labView)}`;
    return;
  }
  const m = sel.model;
  const banner = sel.state === 'partial'
    ? `<p class="ms-banner">${fmt.season(season)} is still being built: <b>${total.games}</b> of about 1,300 games so far. The numbers will move as the rest arrive.</p>`
    : sel.state === 'current' ? `<p class="ms-banner ms-now">Season in progress: <b>${total.games}</b> finished games.</p>` : '';
  main.innerHTML = `${head}${banner}
    <div class="pc-cols">
      ${modelCard(m, season, sel.state)}
      ${m.games ? card('Win % by share of the game', 'does a bigger edge mean more wins?', `${binsChart(m.bins)}<p class="pq-note">Every game counts twice, once from each side. A model that works climbs from left to right; a steeper climb means it separates winners from losers better.</p>${binsTable(m.bins)}`) : ''}
      ${teamsCard(m)}
      ${playersCard(total, pos, showAll, state.team)}
      ${finishingCard(total, m, state.finView, state.finPos, state.finAll, state.finTeam)}
      ${trendsCard(list)}
      ${marketCard(state.odds)}
      ${labCard(state.lab, state.labView)}
    </div>`;
  makeSortable(main);
}

const selected = () => state.list.find((x) => x.season === state.season);
function swapCard(cls, html) {
  const tmp = document.createElement('div');
  tmp.innerHTML = html;
  main.querySelector(cls).replaceWith(tmp.firstElementChild);
  makeSortable(main.querySelector(cls));
}
const redrawPlayers = () => swapCard('.ms-players-card', playersCard(selected().total, state.pos, state.showAll, state.team));
const redrawFin = () => { const sel = selected(); swapCard('.ms-fin-card', finishingCard(sel.total, sel.model, state.finView, state.finPos, state.finAll, state.finTeam)); };

/** Keep season and team filters in the URL so a filtered view can be shared or reloaded. */
function syncUrl() {
  const q = new URLSearchParams({ season: state.season });
  if (state.team) q.set('team', state.team);
  if (state.finTeam) q.set('finteam', state.finTeam);
  history.replaceState(null, '', `?${q}`);
}

main.addEventListener('change', (e) => {
  const t = e.target;
  if (t.matches('[data-team]')) { state.team = t.value || null; state.showAll = false; syncUrl(); redrawPlayers(); main.querySelector('[data-team]')?.focus(); }
  else if (t.matches('[data-finteam]')) { state.finTeam = t.value || null; state.finAll = false; syncUrl(); redrawFin(); main.querySelector('[data-finteam]')?.focus(); }
});

main.addEventListener('click', (e) => {
  const x = e.target.closest('[data-x]');
  if (x) {
    const sel = state.list.find((s) => s.season === state.season);
    x.parentNode.querySelectorAll('button').forEach((b) => b.setAttribute('aria-pressed', String(b === x)));
    main.querySelector('.ms-scatter').innerHTML = scatter(sel.model.teams, x.dataset.x);
    return;
  }
  const l = e.target.closest('[data-lab]');
  if (l) {
    state.labView = l.dataset.lab;
    const old = main.querySelector('.ml-card');
    const tmp = document.createElement('div');
    tmp.innerHTML = labCard(state.lab, state.labView);
    old.replaceWith(tmp.firstElementChild);
    return;
  }
  const fv = e.target.closest('[data-fin], [data-finpos], [data-finmore]');
  if (fv) {
    if (fv.dataset.fin) state.finView = fv.dataset.fin;
    if (fv.dataset.finpos != null) { state.finPos = fv.dataset.finpos || null; state.finAll = false; }
    if (fv.dataset.finmore != null) state.finAll = true;
    redrawFin();
    return;
  }
  const p = e.target.closest('[data-pos]');
  if (p) { state.pos = p.dataset.pos || null; state.showAll = false; redrawPlayers(); return; }
  if (e.target.closest('[data-more]')) { state.showAll = true; redrawPlayers(); return; }
  const a = e.target.closest('a.ms-chip, .pc-table a[href^="?season="]');
  if (a && !e.metaKey && !e.ctrlKey) {
    e.preventDefault();
    const s = Number(new URL(a.href).searchParams.get('season'));
    state.season = s;
    state.showAll = false;
    state.finAll = false;
    const teams = teamsOf(selected()?.total);
    if (!teams.includes(state.team)) state.team = null;
    if (!teams.includes(state.finTeam)) state.finTeam = null;
    syncUrl();
    render();
    scrollTo({ top: 0 });
  }
});

async function start() {
  const seasons = allSeasons();
  const [totals, lab, odds] = await Promise.all([Promise.all(seasons.map((s) => loadSeason(s))), fetch('model-lab.json').then((r) => (r.ok ? r.json() : null)).catch(() => null), getStatic('odds.json').catch(() => null)]);
  const list = seasons.map((season, i) => {
    const total = totals[i];
    return { season, total, state: stateOf(season, total), model: total ? seasonModel(total) : null };
  });
  const asked = Number(params.get('season'));
  // Default: the current season once it has a few weeks of games, else the newest finished one.
  const fallback = list.find((s) => s.state === 'current' && s.total.games >= 150) ?? list.find((s) => s.state === 'complete') ?? list.find((s) => s.total);
  state = { list, lab, odds, labView: 'all', season: list.some((s) => s.season === asked) ? asked : fallback?.season ?? seasons[0], pos: null, showAll: false, finView: 'players', finPos: null, finAll: false };
  const teams = teamsOf(selected()?.total);
  const want = (k) => { const t = (params.get(k) || '').toUpperCase(); return teams.includes(t) ? t : null; };
  state.team = want('team');
  state.finTeam = want('finteam');
  render();
}

start().catch((err) => {
  console.error(err);
  main.innerHTML = '<p class="msg">Could not load the season files. Try again in a minute.</p>';
});

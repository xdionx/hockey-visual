// Standings page. Layout follows NHL.com/standings (Wild Card, Division, Conference, League), with three model columns
// from src/standings.js (projected points, playoff odds, strength of schedule left) and a Scenarios view that shows
// where each team finishes across 10,000 simulated seasons. Data: data/standings.json, written by scripts/update-data.js.
import { getStatic } from '../data.js';
import { esc, logo } from '../game/core.js';

const VIEWS = [['wildcard', 'Wild Card'], ['division', 'Division'], ['conference', 'Conference'], ['league', 'League'], ['scenarios', 'Scenarios']];
const CONF = { E: 'Eastern', W: 'Western' };
const CONF_DIVS = { E: [['A', 'Atlantic'], ['M', 'Metropolitan']], W: [['C', 'Central'], ['P', 'Pacific']] };
const root = document.getElementById('standings');
const params = new URLSearchParams(location.search);
let view = VIEWS.some(([k]) => k === params.get('view')) ? params.get('view') : 'wildcard';

const ord = (n) => `${n}${['th', 'st', 'nd', 'rd'][(n % 100 >> 3 ^ 1) && n % 10 < 4 ? n % 10 : 0]}`;
const sgn = (n) => (n > 0 ? `+${n}` : String(n));
const pctTxt = (p) => { const n = Math.round(p * 100); return p >= 0.995 ? '>99' : p > 0 && n < 1 ? '<1' : String(n); };
const oddsPill = (p) => `<span class="sd-odds ${p >= 0.95 ? 'hi' : p >= 0.5 ? 'mid' : p >= 0.1 ? 'lo' : 'no'}">${pctTxt(p)}%</span>`;
const pctP = (p) => p.toFixed(3).replace(/^0/, '');
const team = (t) => ({ abbrev: t.a, logo: t.logo, darkLogo: t.darkLogo });
const teamCell = (t) => `<div class="sd-team">${logo(team(t), 'sd-logo', true)}<b>${esc(t.name)}</b></div>`;
const status = (t) => (t.divSeq <= 3 ? `${t.div}${t.divSeq}` : t.wcSeq >= 1 && t.wcSeq <= 2 ? `WC${t.wcSeq}` : 'out');

const HEAD = `<thead><tr><th></th><th class="tm"></th><th>GP</th><th>W</th><th>L</th><th>OTL</th><th>PTS</th><th>P%</th><th>ROW</th><th class="x">GF</th><th class="x">GA</th><th>DIFF</th><th class="x">HOME</th><th class="x">ROAD</th><th>L10</th><th class="x">STRK</th><th class="mdl s">PROJ PTS</th><th class="mdl">PLAYOFFS</th><th class="mdl">SOS LEFT</th></tr></thead>`;
const COLS = 19;

function row(t, pos, cls = '') {
  return `<tr class="${cls}"><td class="pos">${pos}</td><td class="tm">${teamCell(t)}</td>
  <td>${t.gp}</td><td>${t.w}</td><td>${t.l}</td><td>${t.otl}</td><td class="pts">${t.pts}</td><td>${pctP(t.pct)}</td><td>${t.row}</td>
  <td class="x">${t.gf}</td><td class="x">${t.ga}</td><td class="${t.diff < 0 ? 'neg' : t.diff > 0 ? 'up' : ''}">${sgn(t.diff)}</td>
  <td class="x">${t.home}</td><td class="x">${t.road}</td><td>${t.l10}</td><td class="x">${t.strk}</td>
  <td class="mdl s">${t.med}<small>${t.p10}&ndash;${t.p90}</small></td><td class="mdl">${oddsPill(t.po)}</td>
  <td class="mdl">${t.sosRank ? ord(t.sosRank) : ''}<small>${t.left} left</small></td></tr>`;
}
const grp = (title, cls = '') => `<tr class="grp ${cls}"><th colspan="${COLS}">${esc(title)}</th></tr>`;
const table = (body) => `<div class="sd-scroll"><table class="sd-table">${HEAD}${body}</table></div>`;
const conf = (c, body) => `<section class="sd-conf"><h2>${CONF[c]} Conference</h2>${body}</section>`;
const byConf = (teams, c) => teams.filter((t) => t.conf === c);

function wildcard(teams, c) {
  const ts = byConf(teams, c);
  let body = '';
  const top = new Set();
  for (const [d, name] of CONF_DIVS[c]) {
    const rows = ts.filter((t) => t.div === d && t.divSeq <= 3).sort((x, y) => x.divSeq - y.divSeq);
    rows.forEach((t) => top.add(t));
    body += `<tbody class="div">${grp(name)}${rows.map((t, i) => row(t, i + 1)).join('')}</tbody>`;
  }
  const rest = ts.filter((t) => !top.has(t)).sort((x, y) => x.confSeq - y.confSeq);
  body += `<tbody class="wc">${grp('Wild Card')}${rest.slice(0, 2).map((t, i) => row(t, i + 1)).join('')}</tbody>`;
  body += `<tbody class="out">${grp('Outside the playoff picture', 'dim')}${rest.slice(2).map((t, i) => row(t, i + 3)).join('')}</tbody>`;
  return conf(c, table(body));
}
const division = (teams, c) => conf(c, table(CONF_DIVS[c].map(([d, name]) => `<tbody>${grp(name)}${teams.filter((t) => t.div === d).sort((x, y) => x.divSeq - y.divSeq).map((t, i) => row(t, i + 1)).join('')}</tbody>`).join('')));
const conference = (teams, c) => conf(c, table(`<tbody>${byConf(teams, c).sort((x, y) => x.confSeq - y.confSeq).map((t, i) => row(t, i + 1)).join('')}</tbody>`));
const league = (teams) => `<section class="sd-conf"><h2>League</h2>${table(`<tbody>${[...teams].sort((x, y) => x.leagueSeq - y.leagueSeq).map((t, i) => row(t, i + 1)).join('')}</tbody>`)}</section>`;

// Scenarios: share of simulated seasons in which each team finishes in each spot.
const heat = (p, kind) => `<td class="h ${kind}" style="--a:${Math.min(1, p * 1.15).toFixed(2)}">${p < 0.005 ? '' : pctTxt(p)}</td>`;
function scenarioRow(t) {
  const [d1, d2, d3, w1, w2] = t.pos;
  const miss = Math.max(0, 1 - t.po);
  return `<tr><td class="tm"><div class="sd-team">${logo(team(t), 'sd-logo', true)}<span><b>${esc(t.a)}</b><small>${t.pts} pts &middot; ${t.gp} GP &middot; now ${status(t)}</small></span></div></td>
  ${heat(d1, 'g')}${heat(d2, 'g')}${heat(d3, 'g')}${heat(w1, 'w')}${heat(w2, 'w')}${heat(miss, 'm')}
  <td class="pts"><b>${t.med}</b><small>${t.p10}&ndash;${t.p90}</small></td>
  <td class="opp">${t.opp.slice(0, 2).map(([a, p]) => `${esc(a)} ${Math.round(p * 100)}%`).join(' &middot; ')}</td></tr>`;
}
const SHEAD = `<thead><tr><th class="tm"></th><th class="g" colspan="3">DIVISION FINISH</th><th class="w" colspan="2">WILD CARD</th><th>MISS</th><th>FINAL PTS<small>median, 10th&ndash;90th</small></th><th class="opp">LIKELY ROUND 1 OPPONENT</th></tr><tr class="sub"><th class="tm"></th><th>1st</th><th>2nd</th><th>3rd</th><th>WC1</th><th>WC2</th><th></th><th></th><th class="opp"></th></tr></thead>`;
function scenarios(teams, c) {
  const body = CONF_DIVS[c].map(([d, name]) => `<tbody><tr class="grp"><th colspan="9">${name}</th></tr>${teams.filter((t) => t.div === d).sort((x, y) => x.divSeq - y.divSeq).map(scenarioRow).join('')}</tbody>`).join('');
  return conf(c, `<div class="sd-scroll"><table class="sd-table sd-scen">${SHEAD}${body}</table></div>`);
}

const LEGEND = {
  model: (d) => `<p class="sd-legend"><span class="k">Model columns</span> <b>PROJ PTS</b> is expected final points from our pre-game pick model (momentum, goalie, back-to-back) played out over the rest of the season, with the 10th&ndash;90th percentile range of ${d.sims.toLocaleString()} simulated seasons. <b>PLAYOFFS</b> is the share of those seasons in which the team finishes top 3 in its division or takes a wild card. <b>SOS LEFT</b> ranks the average momentum share of remaining opponents (1st = hardest). See <a href="stats.html">Momentum stats</a> for how the model works.</p>`,
  scen: (d) => `<p class="sd-legend"><b>${d.sims.toLocaleString()} simulated seasons</b> from today. Each cell is the share of seasons in which the team finishes in that spot; the six cells add to 100%. Wild card teams are listed by their division. Round 1 pairs the better division winner with the 2nd wild card, the other winner with the 1st, and 2nd v 3rd in each division. Tiebreakers: points, then regulation + OT wins.</p>`,
};

function render(d) {
  const t = d.teams;
  document.getElementById('asof').textContent = `updated ${new Date(`${d.asOf}T12:00:00Z`).toLocaleDateString(undefined, { month: 'short', day: 'numeric', timeZone: 'UTC' })} · ${d.gamesPerTeam ? `${Math.round(t.reduce((n, x) => n + x.gp, 0) / t.length)} of ${d.gamesPerTeam} games` : ''}`;
  let html;
  if (view === 'league') html = league(t);
  else if (view === 'scenarios') html = ['E', 'W'].map((c) => scenarios(byConf(t, c), c)).join('');
  else html = ['E', 'W'].map((c) => ({ wildcard, division, conference })[view](t, c)).join('');
  root.innerHTML = html + (view === 'scenarios' ? LEGEND.scen(d) : LEGEND.model(d));
}

function tabs() {
  const nav = document.getElementById('tabs');
  nav.innerHTML = VIEWS.map(([k, label]) => `<a href="standings.html${k === 'wildcard' ? '' : `?view=${k}`}" data-view="${k}"${k === view ? ' aria-current="page"' : ''}>${label}</a>`).join('');
}

tabs();
try {
  const data = await getStatic('standings.json');
  if (!data?.teams?.length) root.innerHTML = '<p class="sd-msg">Standings aren’t available yet. Check back after the next update.</p>';
  else render(data);
} catch (err) {
  root.innerHTML = `<p class="sd-msg">Couldn’t load the standings (${esc(err.message)}).</p>`;
}

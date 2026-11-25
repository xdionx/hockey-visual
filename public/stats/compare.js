import '../horn.js'; // goal horns for games with a horn on, on every page
// Compare view of Momentum stats: stats.html?view=compare&season=<20262027>&g=skaters|F|D|G|T&team=<ABC>&span=last10&dir=best&sort=<col>
// Every skater, goalie and team side by side on each area, colored green (top of the league) to red (bottom)
// against the same position group. Logic: src/compare.js.
import { loadSeason, currentSeason, fmt } from '../player/store.js';
import { getStatic } from '../data.js';
import { recentFile, recentAll } from '../src/seasonStats.js';
import { installPlayerLinks, playerLink } from '../player/link.js';
import { esc } from '../game/core.js';
import { COLS, compareRows, withPercentiles } from '../src/compare.js';

installPlayerLinks();
const main = document.querySelector('#stats');
const params = new URLSearchParams(location.search);
const FIRST = 20202021;
const LAST = 10;
const SHOWN = 40;
const prev = (s) => Number(`${Math.floor(s / 10000) - 1}${Math.floor(s / 10000)}`);
const seasons = () => { const out = []; for (let s = currentSeason(); s >= FIRST; s = prev(s)) out.push(s); return out; };
const GROUPS = [['skaters', 'All skaters'], ['F', 'Forwards'], ['D', 'Defense'], ['G', 'Goalies'], ['T', 'Teams']];
const FMT = {
  signed1: (v) => fmt.signed(v, 1), signed2: (v) => fmt.signed(v, 2), pct0: (v) => fmt.pct(v, 0), pct1: (v) => fmt.pct(v, 1), dec1: (v) => v.toFixed(1), dec2: (v) => v.toFixed(2),
};
const SHORT = matchMedia('(max-width: 640px)');
let state = null;
const recentCache = new Map();
const loadRecent = (season) => { if (!recentCache.has(season)) recentCache.set(season, getStatic(`seasons/${recentFile(season)}`).catch(() => null)); return recentCache.get(season); };

const colsFor = () => (state.g === 'T' ? COLS.teams : state.g === 'G' ? COLS.goalies : COLS.skaters);
const tint = (p) => (p == null ? '' : p < 0.5 ? `background:rgba(248,113,113,${((0.5 - p) * 0.9).toFixed(2)})` : `background:rgba(74,222,128,${((p - 0.5) * 0.75).toFixed(2)})`);

const defCache = new Map();
const prevSeasonOf = (s) => Number(`${Math.floor(s / 10000) - 1}${Math.floor(s / 10000)}`);
const loadDef = (season) => { if (!defCache.has(season)) defCache.set(season, Promise.all([season, prevSeasonOf(season), prevSeasonOf(prevSeasonOf(season))].map((x) => getStatic(`seasons/${x}-def.json`).catch(() => null)))); return defCache.get(season); };

async function load() {
  const total = await loadSeason(state.season);
  state.total = total;
  if (!total) { state.data = null; return; }
  let opts = {};
  if (state.last) {
    const recent = await loadRecent(state.season);
    opts = { last: LAST, recent, recentTotal: recentAll(recent, LAST) };
    if (!recent) { state.last = false; opts = {}; }
  }
  opts.defFiles = await loadDef(state.season);
  const d = compareRows(total, opts);
  withPercentiles(d.skaters, COLS.skaters);
  withPercentiles(d.goalies, COLS.goalies);
  withPercentiles(d.teams, COLS.teams);
  state.data = d;
}

function rows() {
  const d = state.data;
  let list = state.g === 'T' ? d.teams : state.g === 'G' ? d.goalies : d.skaters.filter((r) => state.g === 'skaters' || r.group === state.g);
  if (state.team && state.g !== 'T') list = list.filter((r) => r.team === state.team);
  const key = state.sort;
  const val = (r) => (key === 'overall' ? r.overall : key === 'name' ? r.name : key === 'gp' ? r.gp : r.pct[key]);
  list = list.filter((r) => val(r) != null);
  const dir = state.dir === 'worst' ? 1 : -1;
  return list.sort((a, b) => (key === 'name' ? dir * a.name.localeCompare(b.name) : dir * (val(a) - val(b))));
}

function render() {
  const { season } = state;
  const chips = `<nav class="ms-seasons" aria-label="Season">${seasons().map((s) => `<a class="ms-chip" href="?view=compare&season=${s}"${s === season ? ' aria-current="true"' : ''}>${fmt.season(s)}</a>`).join('')}</nav>`;
  const head = `<section class="ms-hero"><span class="pc-kicker">Our model · regular season</span><h1>Compare <b>everyone</b></h1>
    <p>Every skater, goalie and team side by side on each area. Green is good, red is bad, colored against the rest of the league.</p>${chips}</section>`;
  if (!state.data) { main.innerHTML = `${head}<section class="pc-card"><p class="pq-note">${fmt.season(season)} hasn't been built yet. Pick another season above.</p></section>`; return; }
  const C = colsFor();
  const list = rows();
  const teams = [...new Set(state.data.skaters.concat(state.data.goalies).map((r) => r.team))].sort();
  const btn = (attr, k, label, on) => `<button type="button" ${attr}="${k}" aria-pressed="${on}">${label}</button>`;
  const ctl = `<div class="cm-ctl"><div class="ms-toggle" role="group" aria-label="Group">${GROUPS.map(([k, l]) => btn('data-g', k, l, state.g === k)).join('')}</div>
    ${state.g === 'T' ? '' : `<label class="ms-select${state.team ? ' ms-on' : ''}"><span>Team</span><select data-cteam aria-label="Team"><option value="">All teams</option>${teams.map((t) => `<option${t === state.team ? ' selected' : ''}>${t}</option>`).join('')}</select></label>`}
    <div class="pc-type td-span" role="group" aria-label="Span">${btn('data-span', 'all', 'All games', !state.last)}${btn('data-span', 'last', `Last ${LAST} games`, !!state.last)}</div>
    <div class="pc-type td-span" role="group" aria-label="Order">${btn('data-dir', 'worst', 'Worst first', state.dir === 'worst')}${btn('data-dir', 'best', 'Best first', state.dir === 'best')}</div></div>`;
  const short = SHORT.matches;
  const th = (k, l, title, cl = '') => `<th class="${cl}" data-sort="${k}" title="${esc(title ?? '')}"${state.sort === k ? ` aria-sort="${state.dir === 'worst' ? 'ascending' : 'descending'}"` : ''}>${l}${state.sort === k ? (state.dir === 'worst' ? ' ▲' : ' ▼') : ''}</th>`;
  const gpLabel = state.g === 'G' ? 'GS' : 'GP';
  const thead = `<thead><tr>${short ? '' : '<th class="l">#</th>'}${th('name', state.g === 'T' ? 'Team' : 'Player', '', 'l')}${state.g === 'T' || short ? '' : '<th class="l">Pos</th>'}${short ? '' : th('gp', gpLabel)}${C.map((c) => th(c[0], short ? c[2] : c[1], c[5])).join('')}${th('overall', short ? 'Ovr' : 'Overall', 'Average of the columns, colored against the league')}${short ? '' : '<th class="l">Standout</th>'}</tr></thead>`;
  const body = list.slice(0, state.all ? 9999 : SHOWN).map((r, i) => `<tr>${short ? '' : `<td class="l">${i + 1}</td>`}<td class="l">${state.g === 'T' ? `<b>${esc(r.name)}</b>` : `${playerLink(r.id, r.name)} <small>${esc(r.team)}</small>`}</td>${state.g === 'T' || short ? '' : `<td class="l">${esc(r.pos)}</td>`}${short ? '' : `<td>${r.gp}</td>`}
    ${C.map((c) => { const v = r.v[c[0]]; return `<td class="v" style="${tint(r.pct[c[0]])}">${v == null ? '<small>-</small>' : `<i>${FMT[c[3]](v)}</i>`}</td>`; }).join('')}
    <td class="v" style="${tint(r.overall)}"><i>${r.overall == null ? '-' : Math.round(r.overall * 100)}</i></td>
    ${short ? '' : `<td class="l so">${r.good.map((x) => `<span class="cm-ch g">${x}</span>`).join('')}${r.bad.map((x) => `<span class="cm-ch b">${x}</span>`).join('')}</td>`}</tr>`).join('');
  const mins = state.g === 'T' ? '' : `Minimums: ${state.g === 'G' ? `${state.last ? 2 : 3}+ starts` : `${state.last ? '5' : 'a quarter of the most games'}+ games`}; shot volume, faceoffs and goalie zones need enough shots or draws to show.`;
  main.innerHTML = `${head}<section class="pc-card">${ctl}<div class="cm-key"><span style="background:#7f1d1d"></span>bottom <span style="background:#1e293b"></span>middle <span style="background:#14532d"></span>top of the league · tap a column to sort</div>
    <div class="cm-scroll"><table class="cm-t">${thead}<tbody>${body}</tbody></table></div>
    ${list.length > SHOWN && !state.all ? `<button type="button" class="ms-more" data-cmore>Show all ${list.length}</button>` : ''}
    <p class="cm-note">${list.length} shown (${state.last ? `each team's last ${LAST} games, small samples` : 'whole season'}). ${mins} Colors compare each player with the same position group (forwards, defense, goalies, teams) league-wide, so filtering to one team does not change them. Standout = top or bottom 15% in that column. Overall is the average rank across the columns (giveaways and points % left out), not a prediction.</p></section>`;
}

function syncUrl() {
  const q = new URLSearchParams({ view: 'compare', season: state.season });
  if (state.g !== 'skaters') q.set('g', state.g);
  if (state.team) q.set('team', state.team);
  if (state.last) q.set('span', 'last10');
  if (state.dir !== 'worst') q.set('dir', state.dir);
  if (state.sort !== 'overall') q.set('sort', state.sort);
  history.replaceState(null, '', `?${q}`);
}

main.addEventListener('click', async (e) => {
  const a = e.target.closest('a.ms-chip');
  if (a && !e.metaKey && !e.ctrlKey) { e.preventDefault(); state.season = Number(new URL(a.href).searchParams.get('season')); await load(); syncUrl(); render(); return; }
  const b = e.target.closest('[data-g],[data-span],[data-dir],[data-sort],[data-cmore]');
  if (!b) return;
  if (b.dataset.g) { state.g = b.dataset.g; state.sort = 'overall'; if (state.g === 'T') state.team = null; }
  if (b.dataset.span) { state.last = b.dataset.span === 'last'; await load(); }
  if (b.dataset.dir) state.dir = b.dataset.dir;
  if (b.dataset.sort) { if (state.sort === b.dataset.sort) state.dir = state.dir === 'worst' ? 'best' : 'worst'; state.sort = b.dataset.sort; }
  if (b.hasAttribute('data-cmore')) state.all = true;
  syncUrl(); render();
});
main.addEventListener('change', (e) => { if (e.target.matches('[data-cteam]')) { state.team = e.target.value || null; syncUrl(); render(); } });
SHORT.addEventListener?.('change', () => state?.data && render());

async function start() {
  const list = seasons();
  const asked = Number(params.get('season'));
  let season = list.includes(asked) ? asked : list[0];
  if (!list.includes(asked)) {
    const cur = await loadSeason(season);
    if (!cur || (cur.games ?? 0) < 150) season = list[1] ?? season;
  }
  const g = params.get('g');
  state = { season, g: ['F', 'D', 'G', 'T'].includes(g) ? g : 'skaters', team: (params.get('team') || '').toUpperCase() || null, last: params.get('span') === 'last10',
    dir: params.get('dir') === 'best' ? 'best' : 'worst', sort: params.get('sort') || 'overall', all: false };
  await load();
  render();
}
start().catch((err) => { console.error(err); main.innerHTML = '<p class="msg">Could not load the season file. Try again in a minute.</p>'; });

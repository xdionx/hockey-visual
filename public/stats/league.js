import '../horn.js'; // goal horns for games with a horn on, on every page
// League deficiencies view of Momentum stats: stats.html?view=league&season=<20262027>&pos=F|D&lteam=<ABC>
// Every skater in the league who is costing their team goals, worst first, each with the numbers behind it.
// Logic: leaguePlayers() in src/deficiencies.js (same numbers and wording as the Team deficiencies cards).
import { loadSeason, currentSeason, fmt } from '../player/store.js';
import { installPlayerLinks, playerLink } from '../player/link.js';
import { esc, makeSortable, teamColor } from '../game/core.js';
import { leaguePlayers } from '../src/deficiencies.js';
import { getStatic } from '../data.js';
import { recentFile } from '../src/seasonStats.js';
import { tagChips, goalieZones } from './tags.js';

installPlayerLinks();
const main = document.querySelector('#stats');
const params = new URLSearchParams(location.search);
const FIRST = 20202021;
const PAGE = 40;
const prev = (s) => Number(`${Math.floor(s / 10000) - 1}${Math.floor(s / 10000)}`);
const seasons = () => { const out = []; for (let s = currentSeason(); s >= FIRST; s = prev(s)) out.push(s); return out; };
let state = null;
const LAST = 10;
const recentCache = new Map();
const loadRecent = (season) => { if (!recentCache.has(season)) recentCache.set(season, getStatic(`seasons/${recentFile(season)}`).catch(() => null)); return recentCache.get(season); };
const AREAS = [[null, 'All areas', []], ['fin', 'Finishing', ['fin']], ['vol', 'Shot volume', ['vol']], ['mom', 'Driving play', ['mom', 'mn']], ['disc', 'Penalties', ['disc']], ['fo', 'Faceoffs', ['fo']], ['goalie', 'Goalies', ['gsax', 'out', 'inn']], ['give', 'Giveaways', ['give']]];
const inArea = (p, key) => !key || p.reasons.some((r) => AREAS.find((a) => a[0] === key)[2].includes(r.k));

const chips = (list, sel) => `<nav class="ms-seasons" aria-label="Season">${list.map((s) => `<a class="ms-chip" href="?view=league&season=${s}"${s === sel ? ' aria-current="true"' : ''}>${fmt.season(s)}</a>`).join('')}</nav>`;

function filters(r) {
  const btns = [[null, 'All'], ['F', 'Forwards'], ['D', 'Defense'], ['G', 'Goalies']].map(([p, l]) => `<button type="button" data-lpos="${p ?? ''}" aria-pressed="${p === state.pos}">${l}</button>`).join('');
  const teams = [...new Set(r.players.map((p) => p.team))].sort();
  const opts = teams.map((t) => `<option value="${esc(t)}"${t === state.team ? ' selected' : ''}>${esc(t)}</option>`).join('');
  const span = [['all', 'All games'], ['last', `Last ${LAST} games`]].map(([k, l]) => `<button type="button" data-lspan="${k}" aria-pressed="${(k === 'last') === !!state.last}">${l}</button>`).join('');
  return `<div class="ms-filters"><div class="ms-toggle" role="group" aria-label="Position">${btns}</div>
    <label class="ms-select${state.team ? ' ms-on' : ''}"${state.team ? ` style="--team:${teamColor(state.team)}"` : ''}><span>Team</span><select data-lteam aria-label="Team"><option value="">All teams</option>${opts}</select></label>
    <div class="pc-type td-span" role="group" aria-label="All games or the last ${LAST}">${span}</div></div>`;
}

const posOk = (p) => !state.pos || (state.pos === 'G' ? p.goalie : state.pos === 'D' ? p.pos === 'D' : !p.goalie && p.pos !== 'D' && state.pos === 'F');

function areaChips(r) {
  const base = r.players.filter((p) => posOk(p) && (!state.team || p.team === state.team));
  return `<div class="ms-filters" role="group" aria-label="Area">${AREAS.map(([k, l]) => `<button type="button" class="dx-chip${(state.area ?? null) === k ? ' on' : ''}" data-larea="${k ?? ''}">${l}<b>${base.filter((p) => inArea(p, k)).length}</b></button>`).join('')}</div>`;
}

function row(p, rank) {
  const flagOnly = p.cost > -0.05;
  return `<li class="td-player lg-row" style="--team:${teamColor(p.team)}">
    <div class="td-player-h"><span class="td-pn"><span class="lg-rank">${rank}</span>${playerLink(p.id, p.name)} <small><a class="lg-team" href="?view=teams&season=${state.season}&tteam=${esc(p.team)}">${esc(p.team)}</a> · ${esc(p.pos)} · ${p.gp} ${p.goalie ? 'starts' : 'GP'}</small></span>
      ${flagOnly ? '<span class="td-flagonly" title="Flagged for a specific area, no total cost">area flag only</span>' : `<span class="td-cost" title="Goals of goal difference lost against a typical player at the position, momentum plus scoring">${fmt.signed(p.cost, 1)} goals</span>`}</div>
    ${tagChips(p.reasons)}${p.goalie ? goalieZones(p.areas) : ''}
    <ul class="td-why">${p.reasons.map((x) => `<li>${x.text}</li>`).join('')}</ul></li>`;
}

function list(r) {
  const all = r.players.filter((p) => posOk(p) && (!state.team || p.team === state.team) && inArea(p, state.area ?? null));
  const shown = state.all ? all : all.slice(0, PAGE);
  return `<section class="pc-card lg-card"><h2>Players and goalies costing their team <small>${all.length} of ${r.n} judged${r.windowed ? `, each team's last ${LAST} games` : ''}</small></h2>
    ${filters(r)}${areaChips(r)}
    ${shown.length ? `<ol class="td-players lg-list">${shown.map((p, i) => row(p, i + 1)).join('')}</ol>` : '<p class="pq-note">No one matches.</p>'}
    ${all.length > shown.length ? `<button type="button" class="ms-more" data-lmore>Show all ${all.length}</button>` : ''}
    <p class="pq-note">Worst first. Goals lost = momentum plus scoring (finishing and assists) against a typical forward or defenseman, momentum counting 0.023 goals per point as in "How it was won"; goalies are goals allowed above an average goalie on the same shots. Colored tags name the specific area; "area flag only" means a player is flagged for shot volume, penalties or faceoffs but is not losing goals overall. Skaters need ${r.minGp}+ games${r.windowed ? ' (3+ in the last 10)' : ''}, goalies ${r.windowed ? 2 : 3}+ starts. A traded player counts for their latest team.${r.windowed ? ' Last-10 numbers are small and noisy.' : ''}</p></section>`;
}

function render() {
  const { season, report: r } = state;
  const head = `<section class="ms-hero"><span class="pc-kicker">Our model · regular season</span><h1>League <b>deficiencies</b></h1>
    <p>Every skater and goalie across the league who is holding their team back, the specific area that is wrong, and the numbers that say why.</p>${chips(seasons(), season)}</section>`;
  main.innerHTML = r ? `${head}<div class="pc-cols">${list(r)}</div>` : `${head}<section class="pc-card"><p class="pq-note">${fmt.season(season)} hasn't been built yet. Pick another season above.</p></section>`;
  makeSortable(main);
}

function syncUrl() {
  const q = new URLSearchParams({ view: 'league', season: state.season });
  if (state.last) q.set('span', 'last10');
  if (state.area) q.set('area', state.area);
  if (state.pos) q.set('pos', state.pos);
  if (state.team) q.set('lteam', state.team);
  history.replaceState(null, '', `?${q}`);
}

async function build() {
  const recent = state.last ? await loadRecent(state.season) : null;
  return leaguePlayers(state.total, state.last ? { last: LAST, recent } : {});
}

async function show(season) {
  state.season = season;
  state.all = false;
  const total = await loadSeason(season);
  state.total = total;
  state.report = total ? await build() : null;
  if (state.team && !state.report?.players.some((p) => p.team === state.team)) state.team = null;
  render();
}

main.addEventListener('change', (e) => {
  if (!e.target.matches('[data-lteam]')) return;
  state.team = e.target.value || null; state.all = false; syncUrl(); render();
  main.querySelector('[data-lteam]')?.focus();
});
main.addEventListener('click', async (e) => {
  const sp = e.target.closest('[data-lspan]');
  if (sp && state.total) { state.last = sp.dataset.lspan === 'last'; state.all = false; state.report = await build(); syncUrl(); render(); return; }
  const ar = e.target.closest('[data-larea]');
  if (ar) { state.area = ar.dataset.larea || null; state.all = false; syncUrl(); render(); return; }
  const p = e.target.closest('[data-lpos]');
  if (p) { state.pos = p.dataset.lpos || null; state.all = false; syncUrl(); render(); return; }
  if (e.target.closest('[data-lmore]')) { state.all = true; render(); return; }
  const a = e.target.closest('a.ms-chip');
  if (a && !e.metaKey && !e.ctrlKey) {
    e.preventDefault();
    show(Number(new URL(a.href).searchParams.get('season'))).then(syncUrl);
  }
});

async function start() {
  const ss = seasons();
  const asked = Number(params.get('season'));
  let season = ss.includes(asked) ? asked : ss[0];
  if (!ss.includes(asked)) {
    const cur = await loadSeason(season);
    if (!cur || (cur.games ?? 0) < 150) season = ss[1] ?? season;
  }
  const pos = params.get('pos');
  state = { last: params.get('span') === 'last10', area: AREAS.some((a) => a[0] && a[0] === params.get('area')) ? params.get('area') : null, pos: ['F', 'D', 'G'].includes(pos) ? pos : null, team: (params.get('lteam') || '').toUpperCase() || null, all: false };
  await show(season);
}

start().catch((err) => {
  console.error(err);
  main.innerHTML = '<p class="msg">Could not load the season file. Try again in a minute.</p>';
});

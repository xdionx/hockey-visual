import '../horn.js'; // goal horns for games with a horn on, on every page
// League deficiencies view of Momentum stats: stats.html?view=league&season=<20262027>&pos=F|D&lteam=<ABC>
// Every skater in the league who is costing their team goals, worst first, each with the numbers behind it.
// Logic: leaguePlayers() in src/deficiencies.js (same numbers and wording as the Team deficiencies cards).
import { loadSeason, currentSeason, fmt } from '../player/store.js';
import { installPlayerLinks, playerLink } from '../player/link.js';
import { esc, makeSortable, teamColor } from '../game/core.js';
import { leaguePlayers } from '../src/deficiencies.js';

installPlayerLinks();
const main = document.querySelector('#stats');
const params = new URLSearchParams(location.search);
const FIRST = 20202021;
const PAGE = 40;
const prev = (s) => Number(`${Math.floor(s / 10000) - 1}${Math.floor(s / 10000)}`);
const seasons = () => { const out = []; for (let s = currentSeason(); s >= FIRST; s = prev(s)) out.push(s); return out; };
let state = null;

const chips = (list, sel) => `<nav class="ms-seasons" aria-label="Season">${list.map((s) => `<a class="ms-chip" href="?view=league&season=${s}"${s === sel ? ' aria-current="true"' : ''}>${fmt.season(s)}</a>`).join('')}</nav>`;

function filters(r) {
  const btns = [[null, 'All skaters'], ['F', 'Forwards'], ['D', 'Defense']].map(([p, l]) => `<button type="button" data-lpos="${p ?? ''}" aria-pressed="${p === state.pos}">${l}</button>`).join('');
  const teams = [...new Set(r.players.map((p) => p.team))].sort();
  const opts = teams.map((t) => `<option value="${esc(t)}"${t === state.team ? ' selected' : ''}>${esc(t)}</option>`).join('');
  return `<div class="ms-filters"><div class="ms-toggle" role="group" aria-label="Position">${btns}</div>
    <label class="ms-select${state.team ? ' ms-on' : ''}"${state.team ? ` style="--team:${teamColor(state.team)}"` : ''}><span>Team</span><select data-lteam aria-label="Team"><option value="">All teams</option>${opts}</select></label></div>`;
}

function row(p, rank) {
  return `<li class="td-player lg-row" style="--team:${teamColor(p.team)}">
    <div class="td-player-h"><span class="td-pn"><span class="lg-rank">${rank}</span>${playerLink(p.id, p.name)} <small><a class="lg-team" href="?view=teams&season=${state.season}&tteam=${esc(p.team)}">${esc(p.team)}</a> · ${esc(p.pos)} · ${p.gp} GP</small></span>
      <span class="td-cost" title="Goals of goal difference lost against a typical player at the position, momentum plus scoring">${fmt.signed(p.cost, 1)} goals</span></div>
    <ul class="td-why">${p.reasons.map((x) => `<li>${x.text}</li>`).join('')}</ul></li>`;
}

function list(r) {
  const all = r.players.filter((p) => (!state.pos || (state.pos === 'D' ? p.pos === 'D' : p.pos !== 'D')) && (!state.team || p.team === state.team));
  const shown = state.all ? all : all.slice(0, PAGE);
  return `<section class="pc-card lg-card"><h2>Players costing their team <small>${all.length} skater${all.length === 1 ? '' : 's'} of ${r.n} judged</small></h2>
    ${filters(r)}
    ${shown.length ? `<ol class="td-players lg-list">${shown.map((p, i) => row(p, i + 1)).join('')}</ol>` : '<p class="pq-note">No skaters match.</p>'}
    ${all.length > shown.length ? `<button type="button" class="ms-more" data-lmore>Show all ${all.length}</button>` : ''}
    <p class="pq-note">Worst first. Goals lost = momentum plus scoring (finishing and assists) against a typical forward or defenseman, this season; momentum counts 0.023 goals per point, as in "How it was won". Skaters need ${r.minGp}+ games and at least 1.5 goals lost to make the list. A traded player counts for their latest team. Tap a team for its full card.</p></section>`;
}

function render() {
  const { season, report: r } = state;
  const head = `<section class="ms-hero"><span class="pc-kicker">Our model · regular season</span><h1>League <b>deficiencies</b></h1>
    <p>Every player across the league who is holding their team back, and the numbers that say why.</p>${chips(seasons(), season)}</section>`;
  main.innerHTML = r ? `${head}<div class="pc-cols">${list(r)}</div>` : `${head}<section class="pc-card"><p class="pq-note">${fmt.season(season)} hasn't been built yet. Pick another season above.</p></section>`;
  makeSortable(main);
}

function syncUrl() {
  const q = new URLSearchParams({ view: 'league', season: state.season });
  if (state.pos) q.set('pos', state.pos);
  if (state.team) q.set('lteam', state.team);
  history.replaceState(null, '', `?${q}`);
}

async function show(season) {
  state.season = season;
  state.all = false;
  const total = await loadSeason(season);
  state.report = total ? leaguePlayers(total) : null;
  if (state.team && !state.report?.players.some((p) => p.team === state.team)) state.team = null;
  render();
}

main.addEventListener('change', (e) => {
  if (!e.target.matches('[data-lteam]')) return;
  state.team = e.target.value || null; state.all = false; syncUrl(); render();
  main.querySelector('[data-lteam]')?.focus();
});
main.addEventListener('click', (e) => {
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
  state = { pos: pos === 'F' || pos === 'D' ? pos : null, team: (params.get('lteam') || '').toUpperCase() || null, all: false };
  await show(season);
}

start().catch((err) => {
  console.error(err);
  main.innerHTML = '<p class="msg">Could not load the season file. Try again in a minute.</p>';
});

// Box score page: loads one game's data/games/<id>.json and renders it in the chosen design.
// Switch designs with the bar at the top, keys 1-4, or ?design=<name> in the URL.
import { hornToggles, watchGoals } from '../horn.js';
import { esc, initVideo, makeSortable, makeTabs, upgradeShots, morphInner, setMountSignal, resetRinkIds } from './core.js';
import { getData, LIVE_REFRESH_MS } from '../data.js';
import { startSim } from './sim.js';
import momentum from './d3-momentum.js';
import analytics from './d4-analytics.js';
import scorecards from './d5-scorecards.js';
import story from './d6-story.js';

// Game Story is the main design; the others stay for comparison while it settles.
const DESIGNS = [story, momentum, analytics, scorecards];
const params = new URLSearchParams(location.search);
const gameId = params.get('id');
const box = document.querySelector('#box');
const switcher = document.querySelector('#switcher');
let game = null;
let timer = null;

const stored = () => { try { return localStorage.getItem('boxDesign.v2'); } catch { return null; } };
const store = (v) => { try { localStorage.setItem('boxDesign.v2', v); } catch { /* private mode */ } };
let design = DESIGNS.find((d) => d.id === params.get('design'))?.id ?? DESIGNS.find((d) => d.id === stored())?.id ?? DESIGNS[0].id;

switcher.innerHTML = DESIGNS.map((d, i) => `<button type="button" data-design="${d.id}" title="${esc(d.inspiration)} (key ${i + 1})"><span class="n">${i + 1}</span>${esc(d.name)}</button>`).join('');
switcher.addEventListener('click', (e) => {
  const b = e.target.closest('[data-design]');
  if (b) setDesign(b.dataset.design);
});
document.addEventListener('keydown', (e) => {
  if (e.target.closest('input, textarea, select') || e.metaKey || e.ctrlKey || e.altKey) return;
  const d = DESIGNS[Number(e.key) - 1];
  if (d) setDesign(d.id);
});

function setDesign(id) {
  design = id;
  store(id);
  const url = new URL(location.href);
  url.searchParams.set('design', id);
  history.replaceState(null, '', url);
  render();
}

let mountCtl = null;
let rendered = null; // design id currently in the page

/** UI choices the user made (open tabs, sorted columns) so a live refresh keeps them. */
function uiState() {
  const tabs = [...box.querySelectorAll('[data-tabs]')].map((g) => g.querySelector('[data-tab][aria-selected="true"]')?.dataset.tab);
  const sorts = [...box.querySelectorAll('table.sortable')].map((t) => {
    const th = t.querySelector('th[data-dir]');
    return th ? { col: [...th.parentNode.children].indexOf(th), dir: th.dataset.dir } : null;
  });
  return { tabs, sorts };
}

function restoreUi({ tabs, sorts }) {
  box.querySelectorAll('[data-tabs]').forEach((g, i) => {
    const btn = tabs[i] && g.querySelector(`[data-tab="${tabs[i]}"]`);
    if (btn && btn.getAttribute('aria-selected') !== 'true') btn.click();
  });
  box.querySelectorAll('table.sortable').forEach((t, i) => {
    const s = sorts[i];
    const th = s && t.querySelector('thead tr')?.children[s.col];
    if (!th) return;
    th.click(); // first click sorts descending
    if (s.dir === 'asc') th.click();
  });
}

function render() {
  switcher.querySelectorAll('[data-design]').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.design === design)));
  document.body.dataset.design = design;
  if (!game) return;
  const d = DESIGNS.find((x) => x.id === design);
  // Same design already showing (a live refresh): patch only what changed, so nothing blinks,
  // images don't reload and the page doesn't jump.
  const patch = rendered === d.id && box.firstElementChild;
  const ui = patch ? uiState() : null;
  const y = scrollY;
  mountCtl?.abort();
  mountCtl = new AbortController();
  setMountSignal(mountCtl.signal);
  box.className = `design d-${d.id} ${d.classes ?? ''}`;
  resetRinkIds();
  if (patch) morphInner(box, d.render(game));
  else box.innerHTML = d.render(game);
  rendered = d.id;
  makeSortable(box);
  makeTabs(box);
  d.mount?.(box, game);
  if (ui) restoreUi(ui);
  else scrollTo(0, y);
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
/** "2026-11-17" -> "Nov 17, 2026" */
function shortDate(d) {
  const [y, m, day] = String(d).split('-').map(Number);
  return `${MONTHS[m - 1]} ${day}, ${y}`;
}

let lastText = '';
let simStarted = false;

function showGame(data) {
  watchGoals([data]);
  const text = JSON.stringify(data);
  if (text === lastText) return;
  game = upgradeShots(data);
  lastText = text;
  document.title = `${game.away.abbrev} @ ${game.home.abbrev} ${shortDate(game.gameDate)}${params.has('sim') ? ' (sim)' : ''}`;
  document.querySelector('#back').href = params.has('sim') ? 'sim.html' : `./?date=${game.gameDate}`;
  // Finished games have no horns to blow, except while replaying one in the simulator.
  document.querySelector('#horns').innerHTML = game.status.state === 'final' && !params.has('sim') ? '' : hornToggles(game);
  render();
}

async function load(quiet = false) {
  clearTimeout(timer);
  if (!gameId || !/^\d{10}$/.test(gameId)) {
    box.innerHTML = '<p class="msg">No game selected. <a href="./">Back to scores</a></p>';
    return;
  }
  if (quiet && document.hidden) { // don't spend requests on a hidden tab
    timer = setTimeout(() => load(true), LIVE_REFRESH_MS);
    return;
  }
  if (params.has('sim')) {
    if (simStarted) return;
    simStarted = true;
    box.innerHTML = '<p class="msg">Loading the replay… the first load of a game can take a few seconds.</p>';
    try {
      await startSim({
        id: gameId,
        speed: Number(params.get('sim')),
        bar: document.querySelector('#sim'),
        show: showGame,
        onMissing: () => { box.innerHTML = '<p class="msg">This game\'s replay data isn\'t available here. Replays need the live data service. <a href="sim.html">Pick another game</a></p>'; },
      });
    } catch (err) { box.innerHTML = `<p class="msg">Couldn't start the simulation: ${esc(err.message)}</p>`; }
    return;
  }
  try {
    const data = await getData(`games/${gameId}.json`);
    if (!data) {
      box.innerHTML = '<p class="msg">This box score isn\'t ready yet. Box scores appear once a game starts.</p>';
      return;
    }
    showGame(data);
    if (game.status.state === 'live') timer = setTimeout(() => load(true), LIVE_REFRESH_MS);
    else if (game.status.state === 'pre') timer = setTimeout(() => load(true), 60_000);
  } catch (err) {
    if (!quiet) box.innerHTML = `<p class="msg">Couldn't load this box score: ${esc(err.message)}</p>`;
    else timer = setTimeout(() => load(true), LIVE_REFRESH_MS);
  }
}

initVideo(box);
render();
load();

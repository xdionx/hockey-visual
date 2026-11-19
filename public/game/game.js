// Box score page: loads one game's data/games/<id>.json and renders it in the chosen design.
// Switch designs with the bar at the top, keys 1-5, or ?design=<name> in the URL.
import { esc, initVideo, makeSortable, makeTabs } from './core.js';
import classic from './d1-classic.js';
import broadcast from './d2-broadcast.js';
import analytics from './d4-analytics.js';
import scorecards from './d5-scorecards.js';
import story from './d6-story.js';

// Game Story is the main design; the others stay for comparison while it settles.
const DESIGNS = [story, broadcast, analytics, scorecards, classic];
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

function render() {
  switcher.querySelectorAll('[data-design]').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.design === design)));
  document.body.dataset.design = design;
  if (!game) return;
  const d = DESIGNS.find((x) => x.id === design);
  const y = scrollY;
  box.className = `design d-${d.id} ${d.classes ?? ''}`;
  box.innerHTML = d.render(game);
  makeSortable(box);
  makeTabs(box);
  d.mount?.(box, game);
  scrollTo(0, y);
}

async function load(quiet = false) {
  clearTimeout(timer);
  if (!gameId || !/^\d{10}$/.test(gameId)) {
    box.innerHTML = '<p class="msg">No game selected. <a href="./">Back to scores</a></p>';
    return;
  }
  try {
    const res = await fetch(`data/games/${gameId}.json`, { cache: 'no-store' });
    if (res.status === 404) {
      box.innerHTML = '<p class="msg">This box score isn\'t ready yet. Box scores appear once a game starts (the hosted site refreshes about every 10 minutes).</p>';
      return;
    }
    if (!res.ok) throw new Error(res.statusText);
    game = await res.json();
    document.title = `${game.away.abbrev} ${game.linescore.totals.away}, ${game.home.abbrev} ${game.linescore.totals.home} · Box score`;
    document.querySelector('#back').href = `./?date=${game.gameDate}`;
    render();
    if (game.status.state === 'live') timer = setTimeout(() => load(true), 60_000);
  } catch (err) {
    if (!quiet) box.innerHTML = `<p class="msg">Couldn't load this box score: ${esc(err.message)}</p>`;
  }
}

initVideo(box);
render();
load();

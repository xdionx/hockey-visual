// Box score page: loads one game's data/games/<id>.json and renders it in the chosen design.
// Switch designs with the bar at the top, keys 1-4, or ?design=<name> in the URL.
import { hornToggles, watchGoals, radioOpen } from '../horn.js';
import { setHtmlFilter, filterHtml, esc, initVideo, makeSortable, makeTabs, upgradeShots, morphInner, setMountSignal, resetRinkIds, withFinishRate } from './core.js';
import { loadSeason } from '../player/store.js';
import { leagueRate } from '../src/seasonStats.js';
import { tierVsSeason } from '../src/impact.js';
import { getData, getStatic, LIVE_REFRESH_MS } from '../data.js';
import { predictGame } from '../src/predict.js';
import { topPlayers, missingTop } from '../src/lineupAlert.js';
import { noVigAway, BOOK_NAMES } from '../src/odds.js';
import { startSim } from './sim.js';
import momentum from './d3-momentum.js';
import analytics from './d4-analytics.js';
import scorecards from './d5-scorecards.js';
import story from './d6-story.js';
import { playerIndex, linkPlayers, installPlayerLinks } from '../player/link.js';

// Game Story is the main design; the others stay for comparison while it settles.
const DESIGNS = [story, momentum, analytics, scorecards];
const params = new URLSearchParams(location.search);
const gameId = params.get('id');
// League goals per expected goal for this game's season, so finishing reads against an average shooter.
const FALLBACK_RATE = 1.17;
const startYear = Number(String(gameId).slice(0, 4));
const seasonP = (/^\d{10}$/.test(gameId ?? '') ? loadSeason(Number(`${startYear}${startYear + 1}`)) : Promise.resolve(null)).catch(() => null);
const finRate = seasonP.then((t) => (t ? leagueRate(t) : FALLBACK_RATE)).catch(() => FALLBACK_RATE);
let seasonTotal = null; // this season's totals, so each skater's game is read against the player's own season average
let rate = FALLBACK_RATE;
const box = document.querySelector('#box');
const switcher = document.querySelector('#switcher');
let game = null;
let names = null; // player names on this page -> ids, so every mention links to the player card
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
  else box.innerHTML = filterHtml(d.render(game));
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

/** Each skater's tier for this game: 1 above, 0 average, -1 below a typical game for the position. */
function withTiers(g, r) {
  for (const side of ['away', 'home']) {
    for (const k of ['forwards', 'defense']) {
      for (const p of g.players?.[side]?.[k] ?? []) p.tier = tierVsSeason({ mom: p.momentum, xg: p.xg, xgg: p.xgGoals }, p.position === 'D' ? 'D' : 'F', seasonTotal?.players?.[String(p.id)], r);
    }
  }
  return g;
}

// Before puck drop: our pick (same model as the Scores page), the books and the lineup check.
let pickP = null;
function loadPick(g) {
  pickP ??= (async () => {
    if (String(g.id).slice(4, 6) !== '02' || !seasonTotal) return null;
    const season = Number(`${startYear}${startYear + 1}`);
    const day = new Date(`${g.gameDate}T12:00:00Z`);
    day.setUTCDate(day.getUTCDate() - 1);
    const [prev, yesterday, odds] = await Promise.all([
      loadSeason(season - 10001).catch(() => null),
      getData(`scores/${day.toISOString().slice(0, 10)}.json`).catch(() => null),
      getStatic('odds.json').catch(() => null),
    ]);
    const played = new Set((yesterday?.games ?? []).filter((x) => x.status.state !== 'postponed').flatMap((x) => [x.away.abbrev, x.home.abbrev]));
    const pick = predictGame({ total: seasonTotal, prev, away: g.away.abbrev, home: g.home.abbrev, n: Number(String(g.id).slice(-4)), b2b: { away: played.has(g.away.abbrev), home: played.has(g.home.abbrev) } });
    const books = Object.entries(odds?.games?.[g.id]?.books ?? {}).map(([k, b]) => ({ name: BOOK_NAMES[k], short: k.toUpperCase(), p: noVigAway(b.a, b.h) })).filter((x) => x.name && x.p != null);
    return { pick, books, prev };
  })().catch(() => null);
  return pickP;
}

function withPregame(g, info) {
  if (g.status.state !== 'pre') return g;
  const side = (k) => {
    const top = topPlayers(seasonTotal, info?.prev, g[k].abbrev);
    return { top, out: g[k].scratches?.length ? missingTop(top, g[k].scratches, g[k].scratchIds) : [] };
  };
  g.pregame = { pick: info?.pick ?? null, books: info?.books ?? [], lineup: seasonTotal ? { away: side('away'), home: side('home') } : null };
  return g;
}

async function showGame(data) {
  const info = data.status?.state === 'pre' && !params.has('sim') ? await loadPick(data) : null;
  watchGoals([data]);
  const text = JSON.stringify(data) + (radioOpen(data) ? '1' : '0'); // redraw when the pregame radio buttons appear
  if (text === lastText) return;
  game = withPregame(withTiers(withFinishRate(upgradeShots(data), rate), rate), info);
  lastText = text;
  names = gameNames(game);
  setHtmlFilter((html) => linkPlayers(html, names));
  document.title = `${game.away.abbrev} @ ${game.home.abbrev} ${shortDate(game.gameDate)}${params.has('sim') ? ' (sim)' : ''}`;
  document.querySelector('#back').href = params.has('sim') ? 'sim.html' : `./?date=${game.gameDate}`;
  // Finished games have no horns to blow, except while replaying one in the simulator.
  document.querySelector('#horns').innerHTML = game.status.state === 'final' && !params.has('sim') ? '' : hornToggles(game);
  render();
}

/** Everyone in this game, for linking names to player cards. */
function gameNames(g) {
  const people = [];
  for (const side of ['away', 'home']) {
    const p = g.players?.[side] ?? {};
    people.push(...(p.forwards ?? []), ...(p.defense ?? []), ...(p.goalies ?? []));
  }
  for (const goal of g.scoring ?? []) people.push(goal.scorer, ...(goal.assists ?? []));
  const avoid = ['away', 'home'].flatMap((s) => [g[s]?.placeName, g[s]?.commonName, g[s]?.name, g[s]?.abbrev]);
  return playerIndex(people, { avoid });
}

async function load(quiet = false) {
  clearTimeout(timer);
  if (window.__radioShell) return; // this page now only hosts the radio; the page on screen is in the frame
  if (!gameId || !/^\d{10}$/.test(gameId)) {
    box.innerHTML = '<p class="msg">No game selected. <a href="./">Back to scores</a></p>';
    return;
  }
  if (quiet && document.hidden) { // don't spend requests on a hidden tab
    timer = setTimeout(() => load(true), LIVE_REFRESH_MS);
    return;
  }
  rate = await finRate;
  seasonTotal = await seasonP;
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
    await showGame(data);
    if (game.status.state === 'live' || game.status.imminent) timer = setTimeout(() => load(true), LIVE_REFRESH_MS);
    else if (game.status.state === 'pre' || game.status.settling) timer = setTimeout(() => load(true), 60_000);
  } catch (err) {
    if (!quiet) box.innerHTML = `<p class="msg">Couldn't load this box score: ${esc(err.message)}</p>`;
    else timer = setTimeout(() => load(true), LIVE_REFRESH_MS);
  }
}

initVideo(box);
installPlayerLinks();
render();
load();

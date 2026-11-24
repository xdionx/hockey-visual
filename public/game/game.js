// Box score page: loads one game's data/games/<id>.json and renders it in the chosen design.
// Switch views with the bar at the top, keys 0-4, or ?design=<name> in the URL.
import { hornIcons, watchGoals, radioOpen, resetGoals } from '../horn.js';
import { getDelay, delayBuffer, delayButton, onDelayChange, delayable, delayScores } from '../delay.js';
import { noteClock, startClocks, clockSpan, timeoutChip } from '../clock.js';
import { hasRecentGoal } from '../src/liveClock.js';
import { setStatusHtml, setHtmlFilter, filterHtml, esc, initVideo, makeSortable, makeTabs, upgradeShots, morphInner, setMountSignal, resetRinkIds, withFinishRate } from './core.js';
import { loadSeason } from '../player/store.js';
import { leagueRate } from '../src/seasonStats.js';
import { tierVsSeason } from '../src/impact.js';
import { getData, getStatic, LIVE_REFRESH_MS, later, cancelLater } from '../data.js';
import { predictGame } from '../src/predict.js';
import { notablePlayers, missingTop } from '../src/lineupAlert.js';
import { teamTable, goalieLine, teamGoalies, teamSkaters } from '../src/matchup.js';
import { noVigAway, BOOK_NAMES } from '../src/odds.js';
import { startSim } from './sim.js';
import momentum from './d3-momentum.js';
import analytics from './d4-analytics.js';
import scorecards from './d5-scorecards.js';
import story from './d6-story.js';
import pregame from './d0-pregame.js';
import { playerIndex, linkPlayers, installPlayerLinks } from '../player/link.js';

// Views by key: 0 Pregame, 1 Game Story (the default), 2 Momentum, 3 Game Stats, 4 Scorecards.
// Each holds its own part of the game, so swapping between them repeats as little as possible.
const DESIGNS = [pregame, story, momentum, analytics, scorecards];
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
const asked = DESIGNS.find((d) => d.id === params.get('design'))?.id;
let design = asked ?? DESIGNS.find((d) => d.id === stored() && d.id !== 'pregame')?.id ?? 'story';
// Before puck drop the Pregame view opens first (unless a view was asked for); once the game starts the
// page moves on to your usual view by itself, unless you picked one in the meantime.
let autoPregame = false;

switcher.innerHTML = DESIGNS.map((d, i) => `<button type="button" data-design="${d.id}" title="${esc(d.inspiration)} (key ${i})"><span class="n">${i}</span>${esc(d.name)}</button>`).join('');
switcher.addEventListener('click', (e) => {
  const b = e.target.closest('[data-design]');
  if (b) setDesign(b.dataset.design);
});
// Links to other views inside a view (the Story's "more views" row).
box.addEventListener('click', (e) => {
  const a = e.target.closest('a[data-design]');
  if (!a || e.metaKey || e.ctrlKey || e.shiftKey || e.button) return;
  e.preventDefault();
  setDesign(a.dataset.design);
  scrollTo(0, 0);
});
document.addEventListener('keydown', (e) => {
  if (e.target.closest('input, textarea, select') || e.metaKey || e.ctrlKey || e.altKey) return;
  const d = /^\d$/.test(e.key) ? DESIGNS[Number(e.key)] : null;
  if (d) setDesign(d.id);
});

function setDesign(id) {
  design = id;
  autoPregame = false;
  if (id !== 'pregame') store(id); // Pregame is a look-up, not a default to come back to
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

// Filled for every game, so the Pregame view (key 0) works before, during and after it.
function withPregame(g, info) {
  if (params.has('sim') || g.status.state === 'postponed') return g;
  const side = (k) => {
    const top = notablePlayers(seasonTotal, info?.prev, g[k].abbrev);
    return { top, out: g[k].scratches?.length ? missingTop(top, g[k].scratches, g[k].scratchIds) : [] };
  };
  const n = Number(String(g.id).slice(-4));
  const table = seasonTotal ? teamTable(seasonTotal, rate, n) : null;
  const team = (k) => {
    if (!seasonTotal) return null;
    const ab = g[k].abbrev;
    // Our pick's probable starter, unless he's scratched: then the dressed goalie with the most starts.
    let probable = info?.pick?.parts.goalie[k]?.id;
    let replaced = null;
    const dressed = (g.players?.[k]?.goalies ?? []).map((x) => goalieLine(seasonTotal, x.id, rate) ?? { id: x.id, name: x.fullName ?? x.name, gs: 0, gsax: null });
    if (probable && g[k].scratchIds?.includes(probable) && dressed.length) {
      replaced = goalieLine(seasonTotal, probable, rate);
      probable = dressed.sort((a, b) => (b.gs ?? 0) - (a.gs ?? 0))[0].id;
    }
    const starter = probable ? goalieLine(seasonTotal, probable, rate) : null;
    return {
      m: table.get(ab) ?? null,
      starter: starter && { ...starter, replaced },
      goalies: teamGoalies(seasonTotal, ab, rate),
      skaters: teamSkaters(seasonTotal, ab, rate),
    };
  };
  g.pregame = {
    pick: info?.pick ?? null,
    books: info?.books ?? [],
    lineup: seasonTotal ? { away: side('away'), home: side('home') } : null,
    teams: table ? { away: team('away'), home: team('home'), of: table.teams } : null,
  };
  return g;
}

// ── Data delay for video/audio (see delay.js): show the refresh from now minus this game's delay ──
const buf = /^\d{10}$/.test(gameId ?? '') && !params.has('sim') ? delayBuffer(`games/${gameId}`) : null;
let latest = null; // newest data fetched
let wait = 0; // ms of history still missing (page just opened)
let hold = false; // still filling and a goal the video may not have shown is in the data: keep the box score back
let tick = null;
let showing = Promise.resolve();
function delayed() {
  const s = getDelay(gameId);
  const p = buf ? buf.pick(s) : null;
  wait = s && p && delayable(p.data) ? p.waitMs : 0;
  const data = p?.data ?? latest;
  hold = wait > 0 && spoils(data, wait / 1000);
  // When this reading reaches the viewer: it arrived at p.t and is shown s seconds later (for the live clock).
  if (data?.status) data.seenAt = p && !wait ? p.t + s * 1000 : undefined;
  return data;
}
/**
 * Opened with a delay and no history yet: the newest data is ahead of the video. If the Scores page (or the goal
 * watcher) kept this game's delayed score in this tab, compare goals with it; otherwise hide anything with a goal
 * in the stretch of game time the video may not have reached.
 */
function spoils(data, aheadS) {
  if (!data?.scoring) return false;
  const sb = delayScores(data.gameDate, null).games.find((g) => String(g.id) === String(gameId));
  const shown = (data.scoring ?? []).filter((g) => g.period !== 'SO').length;
  if (sb?.goals && sb.status?.state === 'live' && !sb.masked) return shown > sb.goals.filter((g) => g.period !== 'SO').length;
  return hasRecentGoal(data, aheadS);
}
/** Draw what's due now; while a delay is on this runs every second so held-back plays land on time. */
function showDue(force = false) {
  cancelLater(tick); tick = null;
  if (!latest) return showing;
  if (force) lastText = '';
  const v = delayed();
  showing = showing.then(() => showGame(v)).catch(() => {});
  if (getDelay(gameId) && (delayable(v) || delayable(latest))) tick = later(() => showDue(), 1000);
  return showing;
}
onDelayChange((id) => { if (id === String(gameId)) { resetGoals(id); showDue(true); } });

async function showGame(data) {
  const info = !params.has('sim') ? await loadPick(data) : null;
  // First look at a game that hasn't started: open on Pregame. When it starts, move to the usual view.
  if (!game && !asked && data.status?.state === 'pre') { design = 'pregame'; autoPregame = true; }
  else if (autoPregame && data.status?.state !== 'pre') { autoPregame = false; design = DESIGNS.find((d) => d.id === stored())?.id ?? 'story'; }
  if (params.has('sim')) watchGoals([data]); // live horns come from horn.js's own watcher, on every page
  // Redraw when the pregame radio buttons appear, or the delay chip changes.
  const text = JSON.stringify(data) + (radioOpen(data) ? '1' : '0') + getDelay(gameId) + Math.ceil(wait / 1000) + hold;
  if (text === lastText) return;
  if (hold) { // the box score would give away a goal the video hasn't shown yet: wait it out
    lastText = text;
    rendered = null;
    document.querySelector('#horns').innerHTML = hornIcons(data) + delayButton(data, wait);
    box.className = 'design';
    box.innerHTML = `<p class="msg hold">⏱ Syncing with your video… ${Math.ceil(wait / 1000)}s<br><small>The box score is held back so a goal you haven't seen yet doesn't show early.</small></p>`;
    return;
  }
  game = withPregame(withTiers(withFinishRate(upgradeShots(data), rate), rate), info);
  lastText = text;
  names = gameNames(game);
  setHtmlFilter((html) => linkPlayers(html, names));
  document.title = `${game.away.abbrev} @ ${game.home.abbrev} ${shortDate(game.gameDate)}${params.has('sim') ? ' (sim)' : ''}`;
  document.querySelector('#back').href = params.has('sim') ? 'sim.html' : `./?date=${game.gameDate}`;
  // Finished games have no horns to blow, except while replaying one in the simulator.
  const done = game.status.state === 'final' && !params.has('sim');
  document.querySelector('#horns').innerHTML = hornIcons(game, { horn: !done }) + (done ? '' : delayButton(game, wait));
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

// Score and clock come from the light scores feed (one small answer shared by every game that day), checked
// every refresh. The heavy box score (box + play-by-play + shifts) is only fetched when that feed shows a new
// goal or a new period, or every FULL_EVERY_MS to keep the stats current.
const FULL_EVERY_MS = 30_000;
let fullAt = 0;
/** Score, clock, period and strength always come from the scores feed row, never from the box score. */
function overlay(d, g) {
  if (!g || d.status.state !== 'live' || g.status.state !== 'live') return d;
  return { ...d, status: g.status, strength: g.strength ?? d.strength, away: { ...d.away, score: g.away.score }, home: { ...d.home, score: g.home.score } };
}
async function fastCheck() {
  cancelLater(timer); timer = null;
  try {
    const day = await getData(`scores/${latest.gameDate}.json`);
    const g = day?.games?.find((x) => String(x.id) === String(gameId));
    const same = g && latest && g.status.state === 'live' && latest.status.state === 'live'
      && g.away.score === latest.away.score && g.home.score === latest.home.score
      && g.status.clock?.n === latest.status.clock?.n && Date.now() - fullAt < FULL_EVERY_MS;
    if (!same) return load(true);
    const data = overlay(latest, g);
    if (!buf || buf.push(data, getDelay(gameId))) { latest = data; noteClock(data); }
    await showDue();
    timer = later(() => fastCheck(), LIVE_REFRESH_MS);
  } catch { return load(true); }
}

async function load(quiet = false) {
  cancelLater(timer); timer = null;
  if (window.__radioShell) return; // this page now only hosts the radio; the page on screen is in the frame
  if (!gameId || !/^\d{10}$/.test(gameId)) {
    box.innerHTML = '<p class="msg">No game selected. <a href="./">Back to scores</a></p>';
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
    let data = await getData(`games/${gameId}.json`);
    if (data?.status?.state === 'live') {
      const day = await getData(`scores/${data.gameDate}.json`).catch(() => null);
      data = overlay(data, day?.games?.find((x) => String(x.id) === String(gameId)));
    }
    if (!data) {
      box.innerHTML = '<p class="msg">This box score isn\'t ready yet. Box scores appear once a game starts.</p>';
      return;
    }
    if (!buf || buf.push(data, getDelay(gameId))) { latest = data; noteClock(data); }
    else latest ??= data; // a stale answer (older than what we have): keep showing the newer one
    await showDue();
    fullAt = Date.now();
    if (data.status.state === 'live' || data.status.imminent) timer = later(() => fastCheck(), LIVE_REFRESH_MS);
    else if (data.status.state === 'pre' || data.status.settling) timer = later(() => load(true), 60_000);
  } catch (err) {
    if (!quiet) box.innerHTML = `<p class="msg">Couldn't load this box score: ${esc(err.message)}</p>`;
    else timer = later(() => load(true), LIVE_REFRESH_MS);
  }
}

// Back to the tab: if a browser froze it anyway (phones do), catch up right away.
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible' && timer && !params.has('sim')) load(true);
});

startClocks();
setStatusHtml((g, text) => clockSpan(g, text, g.seenAt) + timeoutChip(g));
initVideo(box);
installPlayerLinks();
render();
load();

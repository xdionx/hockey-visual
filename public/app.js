import { getData, LIVE_REFRESH_MS } from './data.js';
import { teamColors, strengthBadge, contrastRatio } from './game/core.js';
import { hornToggles, watchGoals } from './horn.js';

const $ = (s) => document.querySelector(s);
const dateInput = $('#date');
const gamesEl = $('#games');
let refreshTimer = null;
let current = null; // last scoreboard response

// Cards: goals are a scrolling strip; the button opens the full list (remembered per game).
const store = (k, v) => { try { return v === undefined ? localStorage.getItem(k) : localStorage.setItem(k, v); } catch { return null; } };
const openGames = new Set(); // cards the user expanded

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

function shiftDate(iso, days) {
  const d = new Date(`${iso}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/** The browser tab title carries the date being shown. */
function setTitle(iso) {
  const short = new Date(`${iso}T12:00:00Z`).toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric', timeZone: 'UTC' });
  document.title = `NHL Scores · ${short}`;
}

function prettyDate(iso) {
  return new Date(`${iso}T12:00:00Z`).toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric', timeZone: 'UTC' });
}

function statusText(game) {
  if (game.status.state === 'pre') {
    return new Date(game.startTimeUTC).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit', timeZoneName: 'short' });
  }
  return game.status.label;
}

/** Bar color by game state: grey = not live, blue = live, orange = last 5 min of the 3rd or any OT/SO, red = final. */
function phase(game) {
  const st = game.status.state;
  if (st === 'final') return 'final';
  if (st !== 'live') return 'idle';
  const label = game.status.label || '';
  if (/OT|Shootout|SO\b/i.test(label)) return 'late';
  if (/^3rd Intermission/i.test(label)) return 'late'; // a live game after the 3rd is heading to OT
  const m = label.match(/^3rd\s+(\d+):(\d+)$/);
  if (m && Number(m[1]) * 60 + Number(m[2]) <= 300) return 'late';
  return 'live';
}

const started = (game) => game.status.state !== 'pre' && game.status.state !== 'postponed';
const sideOf = (game, abbrev) => (abbrev === game.away.abbrev ? 'away' : 'home');
/** Text color that reads on a team color. */
const onColor = (c) => (contrastRatio(c, '#ffffff') >= 3 ? '#fff' : '#0a0e17');
const initials = (g) => `${(g.scorer.firstName || g.scorer.name || '?')[0]}${(g.scorer.lastName || '')[0] ?? ''}`.toUpperCase();

// Shot attempts per game come from a small separate feed (the scoreboard doesn't have them).
const satById = new Map();
async function loadSat(games) {
  let changed = false;
  await Promise.all(games.filter((g) => started(g) && (g.status.state === 'live' || !satById.has(g.id))).map(async (g) => {
    try {
      const sat = await getData(`sat/${g.id}.json`);
      if (sat && JSON.stringify(sat) !== JSON.stringify(satById.get(g.id))) { satById.set(g.id, sat); changed = true; }
    } catch { /* SAT is a bonus: the scores still show without it */ }
  }));
  return changed;
}

/** SOG and SAT as two thin split bars, one above the other. */
function statLines(game, tc) {
  if (!started(game)) return '';
  const row = (label, a, b) => {
    if (a == null || b == null) return '';
    const pa = a + b ? Math.round((100 * a) / (a + b)) : 50;
    return `<div class="sx"><b>${a}</b><span class="bar"><i style="width:${pa}%;background:${tc.away}"></i><i style="flex:1;background:${tc.home}"></i></span><b>${b}</b><em>${label}</em></div>`;
  };
  const sat = satById.get(game.id);
  const ls = game.linescore.shots;
  return `<div class="sxs">${row('SOG', ls.away, ls.home)}${row('SAT', sat?.away, sat?.home)}</div>`;
}

const playIcon = '<svg width="12" height="12" viewBox="0 0 12 12" aria-hidden="true"><path d="M2.5 1.5v9l8-4.5z" fill="currentColor"/></svg>';

/** Link attributes that open a goal in the video lightbox (same as the other video links). */
function goalAttrs(game, g) {
  const title = `${g.team} · ${g.scorer.name} (${g.period === 'SO' ? 'SO' : `${g.time} ${g.periodName}`})`;
  return g.highlight
    ? `href="${esc(g.highlight)}"${g.highlightId ? ` data-video-id="${esc(g.highlightId)}" data-video-title="${esc(title)}"` : ' target="_blank" rel="noopener"'} aria-label="Watch ${esc(g.scorer.name)}'s goal"`
    : '';
}

/** Period as 1st / 2nd / 3rd (OT and SO stay as they are). */
const ordPeriod = (p) => ({ 1: '1st', 2: '2nd', 3: '3rd' })[p] ?? p;

/** An assist with the player's season assist total, e.g. "W. Nylander (12)". */
const assistText = (a) => `${esc(a.name)}${a.assistsToDate != null ? ` (${a.assistsToDate})` : ''}`;

/** Which goal of the game this is for its scorer (2 = second goal), or 0 for a first goal or a shootout goal. */
function nthInGame(game, g) {
  if (g.period === 'SO') return 0;
  const n = game.goals.filter((x) => x.period !== 'SO' && x.scorer.id === g.scorer.id && game.goals.indexOf(x) <= game.goals.indexOf(g)).length;
  return n >= 2 ? n : 0;
}
const nthLabel = (n) => (n === 3 ? 'Hat trick' : `${n}${{ 2: 'nd', 4: 'th', 5: 'th' }[n] ?? 'th'} goal`);

/** Strength tags as PP / SH / EN (even-strength goals get none). */
const STRENGTH = { PPG: 'PP', SHG: 'SH', EN: 'EN' };
const strengthTags = (g) => g.tags.map((t) => STRENGTH[t]).filter(Boolean);

/** A goal chip for the scrolling strip: scorer, when, assists; opens the clip. */
function goalChip(game, g, tc) {
  const attrs = goalAttrs(game, g);
  const color = tc[sideOf(game, g.team)];
  const so = g.period === 'SO';
  const nth = nthInGame(game, g);
  const when = so ? 'SO' : `${ordPeriod(g.period)} ${g.time}`;
  const assists = so ? 'Shootout' : g.assists.length ? g.assists.map(assistText).join(', ') : 'Unassisted';
  const tag = attrs ? 'a' : 'div';
  return `<${tag} class="gc"${attrs ? ` ${attrs}` : ''} style="--team:${color}"><b>${attrs ? playIcon : ''}${esc(g.scorer.lastName || g.scorer.name)}${g.scorer.goalsToDate != null ? ` <span class="cnt">(${g.scorer.goalsToDate})</span>` : ''}</b><small>${esc(when)}${strengthTags(g).map((t) => ` <em class="st">${t}</em>`).join('')}${nth ? ` <em class="nth">${nthLabel(nth)}</em>` : ''}</small><small>${assists}</small></${tag}>`;
}

/** A goal tile: who, assists, the running score and a play button. */
function goalTile(game, g, tc) {
  const side = sideOf(game, g.team);
  const attrs = goalAttrs(game, g);
  const so = g.period === 'SO';
  const assists = so ? '' : g.assists.length ? g.assists.map(assistText).join(', ') : 'Unassisted';
  const count = g.scorer.goalsToDate != null ? ` <small>(${g.scorer.goalsToDate})</small>` : '';
  const nth = nthInGame(game, g);
  const tags = (nth ? [nthLabel(nth)] : []).concat(strengthTags(g), g.tags.filter((t) => !STRENGTH[t])).map((t) => `<i class="tag">${esc(t)}</i>`).join('');
  const meta = so ? 'Deciding shootout goal' : `${esc(game.away.abbrev)} ${g.score.away} – ${esc(game.home.abbrev)} ${g.score.home} · ${esc(ordPeriod(g.period))} ${esc(g.time)}`;
  const mug = g.scorer.mugshot ? `<img src="${esc(g.scorer.mugshot)}" alt="" loading="lazy" onerror="this.remove()">` : '';
  return `<${attrs ? 'a' : 'div'} class="gt"${attrs ? ` ${attrs}` : ''} style="--team:${tc[side]};--on:${onColor(tc[side])}">
    <span class="gt-mug">${mug}<b>${esc(initials(g))}</b></span>
    <span class="gt-who"><strong>${esc(g.scorer.name)}${count}${tags}</strong>${assists ? `<em>${assists}</em>` : ''}<small>${meta}</small></span>
    ${attrs ? `<span class="gt-play">${playIcon}</span>` : ''}
  </${attrs ? 'a' : 'div'}>`;
}

// Videos play in a lightbox using NHL's public Brightcove embed player.
// The href stays the NHL.com page, so a middle-click or a missing id still works.
const BRIGHTCOVE_PLAYER = 'https://players.brightcove.net/6415718365001/EXtG1xJ7H_default/index.html';

function videoLink(href, id, title, text, cls = '', label = title) {
  const data = id ? ` data-video-id="${esc(id)}" data-video-title="${esc(title)}"` : ' target="_blank" rel="noopener"';
  return `<a${cls ? ` class="${cls}"` : ''} href="${esc(href)}"${data} title="${esc(label)}" aria-label="${esc(label)}">${esc(text)}</a>`;
}

const lightbox = $('#lightbox');
const lightboxFrame = $('#lightbox-frame');

function openVideo(link) {
  lightboxFrame.innerHTML = `<iframe src="${BRIGHTCOVE_PLAYER}?videoId=${encodeURIComponent(link.dataset.videoId)}&autoplay=true"
    title="${esc(link.dataset.videoTitle)}" allow="autoplay; fullscreen; encrypted-media; picture-in-picture" allowfullscreen></iframe>`;
  $('#lightbox-title').textContent = link.dataset.videoTitle;
  $('#lightbox-nhl').href = link.href;
  lightbox.showModal();
}

gamesEl.addEventListener('click', (e) => {
  const link = e.target.closest('a[data-video-id]');
  if (!link || e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return;
  e.preventDefault();
  openVideo(link);
});
$('#lightbox-close').addEventListener('click', () => lightbox.close());
lightbox.addEventListener('click', (e) => e.target === lightbox && lightbox.close()); // backdrop
lightbox.addEventListener('close', () => { lightboxFrame.innerHTML = ''; }); // stops playback

function teamBlock(game, side, tc, big) {
  const team = game[side];
  const ls = game.linescore;
  const other = side === 'away' ? 'home' : 'away';
  const loser = game.status.state === 'final' && ls.totals[side] < ls.totals[other];
  return `<div class="tb ${side}${loser ? ' loser' : ''}${big ? ' big' : ''}" style="--team:${tc[side]}">
    <img src="${esc(team.logo.replace('_light.', '_dark.'))}" alt="" loading="lazy" onerror="this.style.visibility='hidden'">
    <span class="nm">${esc(team.name || team.abbrev)}${team.record && big ? `<small>${esc(team.record)}</small>` : ''}</span>
    <b class="tot">${started(game) ? ls.totals[side] : ''}</b>
  </div>`;
}

// Horns only matter while a game is on (or being replayed in the simulator), so finished games have none.
const horns = (game) => (game.status.state === 'final' ? '' : hornToggles(game));

function gameHtml(game) {
  const tc = teamColors(game, { dark: true });
  const hasBox = game.status.state === 'live' || game.status.state === 'final';
  const open = openGames.has(game.id);
  const n = game.goals.length;
  const goals = !started(game) ? ''
    : !n ? '<p class="no-goals">No goals yet.</p>'
    : `${open ? `<div class="gts"><h3>Goals</h3>${game.goals.map((g) => goalTile(game, g, tc)).join('')}</div>` : `<div class="gstrip" tabindex="0" aria-label="Goals, scroll sideways">${game.goals.map((g) => goalChip(game, g, tc)).join('')}</div>`}
    <button type="button" class="more" aria-expanded="${open}" data-id="${game.id}">${open ? '▴ Hide goals' : `▾ Show all goals (${n})`}</button>`;
  const links = [
    game.video?.recap ? videoLink(game.video.recap, game.video.recapId, `${game.away.abbrev} @ ${game.home.abbrev} · Recap`, 'Recap') : '',
    game.video?.condensed ? videoLink(game.video.condensed, game.video.condensedId, `${game.away.abbrev} @ ${game.home.abbrev} · Condensed game`, 'Condensed') : '',
  ].join('');
  return `<article class="game cd ph-${phase(game)}" data-id="${game.id}" style="--away:${tc.away};--home:${tc.home}">
    <div class="status ${game.status.state}"><span class="label">${esc(statusText(game))}${strengthBadge(game, tc)}</span><span class="venue">${esc(game.venue)}</span></div>
    <div class="tbs">${teamBlock(game, 'away', tc, true)}${teamBlock(game, 'home', tc, true)}</div>
    ${statLines(game, tc)}
    ${goals}
    <div class="cd-foot"><span class="videos">${links}</span>${hasBox ? `<a class="cg-box" href="game.html?id=${game.id}" aria-label="Box score: ${esc(game.away.abbrev)} at ${esc(game.home.abbrev)}">Box score ›</a>` : ''}${horns(game)}</div>
  </article>`;
}

// Goal strips scroll sideways: touch swipes natively, a mouse drags (below).
// A refresh rebuilds the cards, so remember where each strip was scrolled to.
const stripPos = new Map();
function saveStrips() { gamesEl.querySelectorAll('.cd').forEach((c) => { const st = c.querySelector('.gstrip'); if (st) stripPos.set(c.dataset.id, st.scrollLeft); }); }
function restoreStrips() { gamesEl.querySelectorAll('.cd').forEach((c) => { const st = c.querySelector('.gstrip'); if (st && stripPos.has(c.dataset.id)) st.scrollLeft = stripPos.get(c.dataset.id); }); }

function render(data) {
  saveStrips();
  $('#dateLabel').textContent = prettyDate(data.date);
  setTitle(data.date);
  gamesEl.innerHTML = data.games.length
    ? data.games.map(gameHtml).join('')
    : '<p class="msg">No games scheduled on this date.</p>';
  restoreStrips();
}

gamesEl.addEventListener('click', (e) => {
  const more = e.target.closest('.cd .more');
  if (!more) return;
  const id = Number(more.dataset.id);
  if (openGames.has(id)) openGames.delete(id); else openGames.add(id);
  if (current?.games) render(current);
});

let drag = null;
gamesEl.addEventListener('pointerdown', (e) => {
  const strip = e.target.closest('.gstrip');
  if (!strip || e.pointerType !== 'mouse' || e.button !== 0) return;
  drag = { strip, x: e.clientX, left: strip.scrollLeft, moved: false };
});
window.addEventListener('pointermove', (e) => {
  if (!drag) return;
  const dx = e.clientX - drag.x;
  if (!drag.moved && Math.abs(dx) < 5) return;
  drag.moved = true;
  drag.strip.classList.add('dragging');
  drag.strip.scrollLeft = drag.left - dx;
});
window.addEventListener('pointerup', () => {
  if (!drag) return;
  const { strip, moved } = drag;
  drag = null;
  strip.classList.remove('dragging');
  if (moved) { // a drag is not a click: swallow the click that follows so no video opens
    const stop = (ev) => { ev.preventDefault(); ev.stopPropagation(); };
    window.addEventListener('click', stop, { capture: true, once: true });
    setTimeout(() => window.removeEventListener('click', stop, { capture: true }), 0);
  }
});
gamesEl.addEventListener('dragstart', (e) => { if (e.target.closest('.gstrip')) e.preventDefault(); });

let lastText = '';

// Which date is "Today"? Games belong to their start date in Eastern time (what the NHL API
// uses). The day only turns over at 10:00 local time, and any date with live games wins.
const TURNOVER_HOUR = 10;
function etDate(ms) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(ms));
}
async function defaultDate() {
  const now = Date.now();
  const shifted = new Date(now - TURNOVER_HOUR * 3600_000);
  const local = `${shifted.getFullYear()}-${String(shifted.getMonth() + 1).padStart(2, '0')}-${String(shifted.getDate()).padStart(2, '0')}`;
  const et = etDate(now);
  const base = local < et ? local : et; // never ahead of Eastern today
  const hasLive = async (d) => {
    try { return !!(await getData(`scores/${d}.json`))?.games?.some((g) => g.status.state === 'live'); } catch { return false; }
  };
  for (const d of [shiftDate(base, 1), base, shiftDate(base, -1)]) {
    if (d <= et && await hasLive(d)) return d;
  }
  return base;
}

// Scores come from the live Worker when configured, else the static data/scores/<date>.json
// files a GitHub Action saves (server.js serves those live when running locally).
async function load(date, { quiet = false } = {}) {
  clearTimeout(refreshTimer);
  // Don't spend requests on a hidden tab; check again shortly.
  if (quiet && document.hidden) {
    refreshTimer = setTimeout(() => load(date, { quiet: true }), LIVE_REFRESH_MS);
    return;
  }
  if (!quiet) { gamesEl.innerHTML = '<p class="msg">Loading…</p>'; lastText = ''; }
  try {
    if (!date) date = await defaultDate();
    dateInput.value = date;
    history.replaceState(null, '', `?date=${date}`);
    const data = await getData(`scores/${date}.json`);
    if (!data) {
      current = { date };
      $('#dateLabel').textContent = prettyDate(date);
      setTitle(date);
      gamesEl.innerHTML = '<p class="msg">No scores saved for this date.</p>';
      return;
    }
    current = data;
    watchGoals(data.games);
    const text = JSON.stringify(data);
    if (text !== lastText) render(data); // only redraw when something changed
    lastText = text;
    loadSat(data.games).then((changed) => { if (changed && current === data) render(data); });
    // Keep live games fresh: every few seconds while a game is on, every minute before puck drop.
    const states = data.games.map((g) => g.status.state);
    if (states.includes('live')) refreshTimer = setTimeout(() => load(data.date, { quiet: true }), LIVE_REFRESH_MS);
    else if (states.includes('pre')) refreshTimer = setTimeout(() => load(data.date, { quiet: true }), 60_000);
  } catch (err) {
    if (!quiet) gamesEl.innerHTML = `<p class="msg">Couldn't load scores: ${esc(err.message)}</p>`;
  }
}

dateInput.addEventListener('change', () => dateInput.value && load(dateInput.value));
$('#prev').addEventListener('click', () => current && load(shiftDate(current.date, -1)));
$('#next').addEventListener('click', () => current && load(shiftDate(current.date, 1)));
$('#today').addEventListener('click', () => load());

load(new URLSearchParams(location.search).get('date'));

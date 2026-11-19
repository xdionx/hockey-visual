import { getData, LIVE_REFRESH_MS } from './data.js';
import { teamColors, strengthBadge, contrastRatio } from './game/core.js';
import { hornToggles, watchGoals } from './horn.js';

const $ = (s) => document.querySelector(s);
const dateInput = $('#date');
const gamesEl = $('#games');
let refreshTimer = null;
let current = null; // last scoreboard response

// Layout: compact rows (every game on one screen, scorers on one line) or full cards.
const store = (k, v) => { try { return v === undefined ? localStorage.getItem(k) : localStorage.setItem(k, v); } catch { return null; } };
let view = store('scores-view') === 'cards' ? 'cards' : 'compact';
const openGames = new Set(); // compact rows the user expanded

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

function shiftDate(iso, days) {
  const d = new Date(`${iso}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/** Page heading and browser tab title both carry the date being shown. */
function setTitle(iso) {
  const short = new Date(`${iso}T12:00:00Z`).toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric', timeZone: 'UTC' });
  document.title = `NHL Scores · ${short}`;
  const h = document.querySelector('header h1, h1');
  if (h) h.innerHTML = `NHL Scores <span class="h1-date">· ${esc(short)}</span>`;
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

/** One line of play pills, one per goal (compact view). */
function goalPills(game, tc) {
  return game.goals.map((g) => {
    const attrs = goalAttrs(game, g);
    const color = tc[sideOf(game, g.team)];
    const when = g.period === 'SO' ? 'SO' : `${g.period} ${g.time}`;
    return `<${attrs ? 'a' : 'span'} class="gp"${attrs ? ` ${attrs}` : ''} style="--team:${color}">${attrs ? playIcon : ''}<span>${esc(g.scorer.lastName || g.scorer.name)}</span><small>${esc(when)}</small></${attrs ? 'a' : 'span'}>`;
  }).join('');
}

/** A goal tile: who, assists, the running score and a play button. */
function goalTile(game, g, tc) {
  const side = sideOf(game, g.team);
  const attrs = goalAttrs(game, g);
  const so = g.period === 'SO';
  const assists = so ? '' : g.assists.length ? g.assists.map((a) => esc(a.name)).join(', ') : 'Unassisted';
  const count = g.scorer.goalsToDate != null ? ` <small>(${g.scorer.goalsToDate})</small>` : '';
  const tags = g.tags.map((t) => `<i class="tag">${esc(t)}</i>`).join('');
  const meta = so ? 'Deciding shootout goal' : `${esc(game.away.abbrev)} ${g.score.away} – ${esc(game.home.abbrev)} ${g.score.home} · ${esc(g.period)} ${esc(g.time)}`;
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

function videoLinksHtml(game) {
  const links = [];
  const matchup = `${game.away.abbrev} @ ${game.home.abbrev}`;
  if (game.video?.recap) links.push(videoLink(game.video.recap, game.video.recapId, `${matchup} · Recap`, 'Recap'));
  if (game.video?.condensed) links.push(videoLink(game.video.condensed, game.video.condensedId, `${matchup} · Condensed game`, 'Condensed game'));
  return links.length ? `<div class="videos">${links.join('')}</div>` : '';
}

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

const horns = (game) => (game.status.state === 'final' ? '' : hornToggles(game));

function gameHtml(game) {
  const tc = teamColors(game, { dark: true });
  const hasBox = game.status.state === 'live' || game.status.state === 'final';
  const goals = started(game)
    ? (game.goals.length ? `<div class="gts"><h3>Goals</h3>${game.goals.map((g) => goalTile(game, g, tc)).join('')}</div>` : '<p class="no-goals">No goals yet.</p>')
    : '';
  const links = [
    game.video?.recap ? videoLink(game.video.recap, game.video.recapId, `${game.away.abbrev} @ ${game.home.abbrev} · Recap`, 'Recap') : '',
    game.video?.condensed ? videoLink(game.video.condensed, game.video.condensedId, `${game.away.abbrev} @ ${game.home.abbrev} · Condensed game`, 'Condensed') : '',
  ].join('');
  return `<article class="game cd" style="--away:${tc.away};--home:${tc.home}">
    <div class="status ${game.status.state}"><span class="label">${esc(statusText(game))}${strengthBadge(game, tc)}</span><span class="venue">${esc(game.venue)}</span></div>
    <div class="tbs">${teamBlock(game, 'away', tc, true)}${teamBlock(game, 'home', tc, true)}</div>
    ${statLines(game, tc)}
    ${goals}
    <div class="cd-foot"><span class="videos">${links}</span>${hasBox ? `<a class="cg-box" href="game.html?id=${game.id}" aria-label="Box score: ${esc(game.away.abbrev)} at ${esc(game.home.abbrev)}">Box score ›</a>` : ''}${horns(game)}</div>
  </article>`;
}

function compactHtml(game) {
  const tc = teamColors(game, { dark: true });
  const hasBox = game.status.state === 'live' || game.status.state === 'final';
  const open = openGames.has(game.id);
  const links = open ? videoLinksHtml(game) : '';
  let goals = '';
  if (started(game) && game.goals.length) {
    goals = open
      ? `<div class="gts two">${game.goals.map((g) => goalTile(game, g, tc)).join('')}</div>${links}`
      : `<div class="gps">${goalPills(game, tc)}</div>`;
  }
  return `<article class="game cg${open ? ' open' : ''}" data-id="${game.id}" style="--away:${tc.away};--home:${tc.home}">
    <div class="cg-head">
      <div class="status ${game.status.state}"><span class="label">${esc(statusText(game))}${strengthBadge(game, tc)}</span></div>
      <div class="cg-teams">${teamBlock(game, 'away', tc, false)}<span class="dash">–</span>${teamBlock(game, 'home', tc, false)}</div>
      ${statLines(game, tc)}
      <div class="cg-act">${started(game) && game.goals.length ? `<button type="button" class="more" aria-expanded="${open}" aria-label="Show goals">${open ? '▴' : '▾'}</button>` : ''}${hasBox ? `<a class="cg-box" href="game.html?id=${game.id}" aria-label="Box score: ${esc(game.away.abbrev)} at ${esc(game.home.abbrev)}">Box ›</a>` : ''}</div>
    </div>
    ${goals ? `<div class="cg-goals">${goals}</div>` : ''}
    ${horns(game) ? `<div class="cg-foot">${horns(game)}</div>` : ''}
  </article>`;
}

function render(data) {
  $('#dateLabel').textContent = prettyDate(data.date);
  setTitle(data.date);
  gamesEl.className = view;
  gamesEl.innerHTML = data.games.length
    ? data.games.map(view === 'compact' ? compactHtml : gameHtml).join('')
    : '<p class="msg">No games scheduled on this date.</p>';
}

gamesEl.addEventListener('click', (e) => {
  const more = e.target.closest('.cg .more');
  if (!more) return;
  const id = Number(more.closest('.cg').dataset.id);
  if (openGames.has(id)) openGames.delete(id); else openGames.add(id);
  if (current?.games) render(current);
});

const viewEl = $('#view');
function syncView() { viewEl.querySelectorAll('button').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.view === view))); }
viewEl.addEventListener('click', (e) => {
  const b = e.target.closest('button[data-view]');
  if (!b || b.dataset.view === view) return;
  view = b.dataset.view;
  store('scores-view', view);
  syncView();
  if (current?.games) render(current);
});
syncView();

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

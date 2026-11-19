import { getData, LIVE_REFRESH_MS } from './data.js';
import { teamColors, strengthBadge } from './game/core.js';

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

function prettyDate(iso) {
  return new Date(`${iso}T12:00:00Z`).toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric', timeZone: 'UTC' });
}

function statusText(game) {
  if (game.status.state === 'pre') {
    return new Date(game.startTimeUTC).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit', timeZoneName: 'short' });
  }
  return game.status.label;
}

function teamRow(game, side) {
  const team = game[side];
  const ls = game.linescore;
  const other = side === 'away' ? 'home' : 'away';
  const loser = game.status.state === 'final' && ls.totals[side] < ls.totals[other];
  const started = game.status.state !== 'pre' && game.status.state !== 'postponed';
  const periodCells = ls.periods.map((p) => `<td>${started ? p[side] : ''}</td>`).join('');
  const color = teamColors(game, { dark: true })[side];
  return `<tr class="${side} ${loser ? 'loser' : ''}" style="--team:${color}">
    <td class="team"><div class="team-cell">
      <img src="${esc(team.logo.replace('_light.', '_dark.'))}" alt="" loading="lazy" onerror="this.style.visibility='hidden'">
      <div><span class="abbr">${esc(team.abbrev)}</span>${team.record ? `<span class="rec">${esc(team.record)}</span>` : ''}<div class="name">${esc(team.name)}</div></div>
    </div></td>
    ${periodCells}
    <td class="tot">${started ? ls.totals[side] : ''}</td>
    <td class="sog">${started && ls.shots[side] != null ? ls.shots[side] : ''}</td>
  </tr>`;
}

function goalsHtml(game) {
  if (!game.goals.length) {
    return game.status.state === 'pre' || game.status.state === 'postponed' ? '' : '<p class="no-goals">No goals yet.</p>';
  }
  let html = '';
  let lastPeriod = null;
  for (const g of game.goals) {
    if (g.period !== lastPeriod) {
      html += `<h3>${esc(g.periodName)}</h3>`;
      lastPeriod = g.period;
    }
    const assists = g.period === 'SO' ? '' : g.assists.length ? g.assists.map((a) => `${esc(a.name)}${a.assistsToDate != null ? ` (${a.assistsToDate})` : ''}`).join(', ') : 'Unassisted';
    const tags = g.tags.map((t) => `<span class="tag">${esc(t)}</span>`).join('');
    const count = g.scorer.goalsToDate != null ? ` (${g.scorer.goalsToDate})` : '';
    const meta = g.period === 'SO' ? 'Deciding goal' : `${esc(g.time)} · ${g.score.away}-${g.score.home}`;
    html += `<div class="goal">
      <span class="tm" style="color:${teamColors(game, { dark: true })[g.team === game.away.abbrev ? 'away' : 'home']}">${esc(g.team)}</span>
      <div class="who"><strong>${esc(g.scorer.name)}</strong>${count}${tags}${assists ? `<div class="ast">${assists}</div>` : ''}</div>
      <span class="meta">${meta}</span>
      ${g.highlight ? videoLink(g.highlight, g.highlightId, `${g.team} · ${g.scorer.name} (${g.period === 'SO' ? 'SO' : `${g.time} ${g.periodName}`})`, '', 'play', `Watch ${g.scorer.name}'s goal`) : '<span></span>'}
    </div>`;
  }
  return `<div class="goals">${html}</div>${videoLinksHtml(game)}`;
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

function gameHtml(game) {
  const ls = game.linescore;
  const hasBox = game.status.state === 'live' || game.status.state === 'final';
  const head = ls.periods.map((p) => `<th>${esc(p.label)}</th>`).join('');
  const tc = teamColors(game, { dark: true });
  return `<article class="game" style="--away:${tc.away};--home:${tc.home}">
    <div class="status ${game.status.state}"><span class="label">${esc(statusText(game))}${strengthBadge(game, tc)}</span><span class="venue">${esc(game.venue)}</span></div>
    <table class="ls">
      <thead><tr><th></th>${head}<th>T</th><th>SOG</th></tr></thead>
      <tbody>${teamRow(game, 'away')}${teamRow(game, 'home')}</tbody>
    </table>
    ${goalsHtml(game)}
    ${hasBox ? `<a class="box-btn" href="game.html?id=${game.id}" aria-label="Box score: ${esc(game.away.abbrev)} at ${esc(game.home.abbrev)}">Box score &#8250;</a>` : ''}
  </article>`;
}

/** "N. Suzuki" -> "Suzuki" */
const lastName = (n) => String(n ?? '').replace(/^(?:[A-Z]\.\s*)+/, '');

/** One line of scorers per team: "Peterka, Zacha PP 2, Pastrnak". */
function scorerLine(game, side) {
  const abbrev = game[side].abbrev;
  const mine = game.goals.filter((g) => g.team === abbrev);
  if (!mine.length) return '';
  const by = new Map();
  for (const g of mine) {
    const key = g.scorer.name;
    const e = by.get(key) ?? { name: lastName(key), n: 0, tags: new Set() };
    e.n++;
    if (g.period === 'SO') e.tags.add('SO');
    for (const t of g.tags) e.tags.add(t === 'PPG' ? 'PP' : t === 'SHG' ? 'SH' : t);
    by.set(key, e);
  }
  return [...by.values()].map((e) => `<span class="sc">${esc(e.name)}${e.n > 1 ? `<b>${e.n}</b>` : ''}${[...e.tags].map((t) => `<i>${esc(t)}</i>`).join('')}</span>`).join('');
}

function compactTeam(game, side, tc) {
  const team = game[side];
  const ls = game.linescore;
  const other = side === 'away' ? 'home' : 'away';
  const started = game.status.state !== 'pre' && game.status.state !== 'postponed';
  const loser = game.status.state === 'final' && ls.totals[side] < ls.totals[other];
  return `<div class="ct ${side}${loser ? ' loser' : ''}" style="--team:${tc[side]}">
    <img src="${esc(team.logo.replace('_light.', '_dark.'))}" alt="" loading="lazy" onerror="this.style.visibility='hidden'">
    <span class="abbr">${esc(team.abbrev)}</span><b class="tot">${started ? ls.totals[side] : ''}</b>
  </div>`;
}

function compactHtml(game) {
  const tc = teamColors(game, { dark: true });
  const hasBox = game.status.state === 'live' || game.status.state === 'final';
  const started = game.status.state !== 'pre' && game.status.state !== 'postponed';
  const open = openGames.has(game.id);
  const lines = ['away', 'home'].map((side) => {
    const sc = scorerLine(game, side);
    return sc ? `<div class="sl" style="--team:${tc[side]}"><span class="tm">${esc(game[side].abbrev)}</span><div>${sc}</div></div>` : '';
  }).join('');
  return `<article class="game cg${open ? ' open' : ''}" data-id="${game.id}" style="--away:${tc.away};--home:${tc.home}">
    <div class="cg-head">
      <div class="status ${game.status.state}"><span class="label">${esc(statusText(game))}${strengthBadge(game, tc)}</span></div>
      <div class="cg-score">${compactTeam(game, 'away', tc)}<span class="dash">–</span>${compactTeam(game, 'home', tc)}</div>
      <div class="cg-act">${started && game.goals.length ? `<button type="button" class="more" aria-expanded="${open}" aria-label="Show all goals">${open ? '▴' : '▾'}</button>` : ''}${hasBox ? `<a class="cg-box" href="game.html?id=${game.id}" aria-label="Box score: ${esc(game.away.abbrev)} at ${esc(game.home.abbrev)}">Box ›</a>` : ''}</div>
    </div>
    ${started ? `<div class="cg-scorers">${lines || '<span class="none">No goals yet</span>'}</div>` : ''}
    ${open ? `<div class="cg-more">${goalsHtml(game)}</div>` : ''}
  </article>`;
}

function render(data) {
  $('#dateLabel').textContent = prettyDate(data.date);
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
    if (!date) date = (await getData('latest.json'))?.date ?? new Date().toISOString().slice(0, 10);
    dateInput.value = date;
    history.replaceState(null, '', `?date=${date}`);
    const data = await getData(`scores/${date}.json`);
    if (!data) {
      current = { date };
      $('#dateLabel').textContent = prettyDate(date);
      gamesEl.innerHTML = '<p class="msg">No scores saved for this date.</p>';
      return;
    }
    current = data;
    const text = JSON.stringify(data);
    if (text !== lastText) render(data); // only redraw when something changed
    lastText = text;
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

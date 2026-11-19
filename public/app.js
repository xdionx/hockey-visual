import { getData, LIVE_REFRESH_MS } from './data.js';

const $ = (s) => document.querySelector(s);
const dateInput = $('#date');
const gamesEl = $('#games');
let refreshTimer = null;
let current = null; // last scoreboard response

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
  return `<tr class="${loser ? 'loser' : ''}">
    <td class="team"><div class="team-cell">
      <picture><source srcset="${esc(team.logo.replace('_light.', '_dark.'))}" media="(prefers-color-scheme: dark)"><img src="${esc(team.logo)}" alt="" loading="lazy" onerror="this.style.visibility='hidden'"></picture>
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
      <span class="tm">${esc(g.team)}</span>
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
  return `<article class="game">
    <div class="status ${game.status.state}"><span class="label">${esc(statusText(game))}</span><span class="venue">${esc(game.venue)}</span></div>
    <table class="ls">
      <thead><tr><th></th>${head}<th>T</th><th>SOG</th></tr></thead>
      <tbody>${teamRow(game, 'away')}${teamRow(game, 'home')}</tbody>
    </table>
    ${goalsHtml(game)}
    ${hasBox ? `<a class="box-btn" href="game.html?id=${game.id}" aria-label="Box score: ${esc(game.away.abbrev)} at ${esc(game.home.abbrev)}">Box score &#8250;</a>` : ''}
  </article>`;
}

function render(data) {
  $('#dateLabel').textContent = prettyDate(data.date);
  gamesEl.innerHTML = data.games.length
    ? data.games.map(gameHtml).join('')
    : '<p class="msg">No games scheduled on this date.</p>';
}

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

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
    </div>`;
  }
  return `<div class="goals">${html}</div>`;
}

function gameHtml(game) {
  const ls = game.linescore;
  const head = ls.periods.map((p) => `<th>${esc(p.label)}</th>`).join('');
  return `<article class="game">
    <div class="status ${game.status.state}"><span class="label">${esc(statusText(game))}</span><span class="venue">${esc(game.venue)}</span></div>
    <table class="ls">
      <thead><tr><th></th>${head}<th>T</th><th>SOG</th></tr></thead>
      <tbody>${teamRow(game, 'away')}${teamRow(game, 'home')}</tbody>
    </table>
    ${goalsHtml(game)}
  </article>`;
}

function render(data) {
  $('#dateLabel').textContent = prettyDate(data.date);
  gamesEl.innerHTML = data.games.length
    ? data.games.map(gameHtml).join('')
    : '<p class="msg">No games scheduled on this date.</p>';
}

async function getJson(path) {
  const res = await fetch(path, { cache: 'no-store' });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(res.statusText);
  return res.json();
}

// Scores are static files: data/scores/<date>.json, refreshed by a GitHub Action
// (or served live by server.js when running locally).
async function load(date, { quiet = false } = {}) {
  clearTimeout(refreshTimer);
  if (!quiet) gamesEl.innerHTML = '<p class="msg">Loading…</p>';
  try {
    if (!date) date = (await getJson('data/latest.json'))?.date ?? new Date().toISOString().slice(0, 10);
    dateInput.value = date;
    history.replaceState(null, '', `?date=${date}`);
    const data = await getJson(`data/scores/${date}.json`);
    if (!data) {
      current = { date };
      $('#dateLabel').textContent = prettyDate(date);
      gamesEl.innerHTML = '<p class="msg">No scores saved for this date.</p>';
      return;
    }
    current = data;
    render(data);
    // Keep live games fresh.
    if (data.games.some((g) => g.status.state === 'live' || g.status.state === 'pre')) {
      refreshTimer = setTimeout(() => load(data.date, { quiet: true }), 60_000);
    }
  } catch (err) {
    if (!quiet) gamesEl.innerHTML = `<p class="msg">Couldn't load scores: ${esc(err.message)}</p>`;
  }
}

dateInput.addEventListener('change', () => dateInput.value && load(dateInput.value));
$('#prev').addEventListener('click', () => current && load(shiftDate(current.date, -1)));
$('#next').addEventListener('click', () => current && load(shiftDate(current.date, 1)));
$('#today').addEventListener('click', () => load());

load(new URLSearchParams(location.search).get('date'));

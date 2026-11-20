// Goal horns: per team and per game, off by default, remembered in this browser.
// Shared by the Scores page and the box score. Horn files live in audio/horns/<ABBREV>.mp3.
const HORNS = new Set(['ANA', 'BOS', 'BUF', 'CGY', 'CAR', 'CHI', 'COL', 'CBJ', 'DAL', 'DET', 'EDM', 'FLA', 'LAK', 'MIN', 'MTL', 'NSH', 'NJD', 'NYI', 'NYR', 'OTT', 'PHI', 'PIT', 'SJS', 'SEA', 'STL', 'TBL', 'TOR', 'UTA', 'VAN', 'VGK', 'WSH', 'WPG']); // every team has a horn file
const KEY = (id, abbrev) => `horn:${id}:${abbrev}`;
const store = (k, v) => { try { return v === undefined ? localStorage.getItem(k) : (v === null ? localStorage.removeItem(k) : localStorage.setItem(k, v)); } catch { return null; } };

export const hornOn = (id, abbrev) => store(KEY(id, abbrev)) === '1';

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

/** Toggle buttons for the teams in this game that have a horn. */
export function hornToggles(game, cls = '') {
  const btns = ['away', 'home'].map((s) => game[s].abbrev).filter((a) => HORNS.has(a)).map((a) => {
    const on = hornOn(game.id, a);
    return `<button type="button" class="horn-btn${on ? ' on' : ''}" data-horn-game="${game.id}" data-horn-team="${esc(a)}" aria-pressed="${on}" title="Play the ${esc(a)} goal horn when they score">🚨 ${esc(a)} horn ${on ? 'on' : 'off'}</button>`;
  });
  const listen = listenButtons(game);
  return btns.length || listen ? `<span class="horn-toggles ${cls}">${listen}${btns.join('')}</span>` : '';
}

// ── Team radio: NHL.com's own HLS radio feeds, played in the page ──
// Feeds live at <cdn>/<team>/<season>/<team>-radio.m3u8 while a game is on. Chrome and Firefox need
// hls.js (loaded only when someone taps Listen); Safari plays HLS natively. If a feed won't start we say so
// and link to the game on NHL.com, whose Listen button opens the same feed.
const RADIO = (abbrev, season) => `https://d2igy0yla8zi0u.cloudfront.net/${abbrev.toLowerCase()}/${season}/${abbrev.toLowerCase()}-radio.m3u8`;
const HLS_JS = 'https://cdnjs.cloudflare.com/ajax/libs/hls.js/1.5.17/hls.min.js';
const gamePage = (game) => {
  const d = new Date(game.startTimeUTC);
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(d).map((x) => [x.type, x.value]));
  return `https://www.nhl.com/gamecenter/${game.away.abbrev.toLowerCase()}-vs-${game.home.abbrev.toLowerCase()}/${p.year}/${p.month}/${p.day}/${game.id}`;
};
function listenButtons(game) {
  if (game.status?.state !== 'live' || !game.season || /[?&]sim\b/.test(location.search)) return '';
  return ['away', 'home'].map((s) => game[s].abbrev).filter((a) => HORNS.has(a)).map((a) =>
    `<button type="button" class="horn-btn listen-btn${radio?.abbrev === a ? ' on' : ''}" data-listen="${esc(a)}" data-listen-game="${game.id}" data-listen-season="${esc(game.season)}" data-listen-page="${esc(gamePage(game))}" title="Listen to the ${esc(a)} radio broadcast here">${radio?.abbrev === a ? '■' : '🎧'} ${esc(a)} radio</button>`).join('');
}

let radio = null; // { abbrev, audio, hls }
function radioBar() {
  let bar = document.getElementById('radio-bar');
  if (!bar) { bar = document.createElement('div'); bar.id = 'radio-bar'; document.body.append(bar); }
  return bar;
}
function stopRadio() {
  if (radio) { radio.hls?.destroy(); radio.audio.pause(); radio.audio.removeAttribute('src'); radio.audio.load(); radio = null; }
  document.getElementById('radio-bar')?.remove();
  document.querySelectorAll('.listen-btn.on').forEach((b) => { b.classList.remove('on'); b.textContent = `🎧 ${b.dataset.listen} radio`; });
}
function radioFailed(abbrev, page) {
  const bar = radioBar();
  bar.innerHTML = `<span>Couldn't start the ${esc(abbrev)} radio feed here.</span> <a href="${esc(page)}" target="_blank" rel="noopener">Open on NHL.com ›</a> <button type="button" data-radio-stop>Close</button>`;
}
function loadHls() {
  if (window.Hls) return Promise.resolve(window.Hls);
  return new Promise((ok, no) => { const s = document.createElement('script'); s.src = HLS_JS; s.onload = () => ok(window.Hls); s.onerror = no; document.head.append(s); });
}
async function startRadio(btn) {
  const abbrev = btn.dataset.listen; const page = btn.dataset.listenPage;
  const url = RADIO(abbrev, btn.dataset.listenSeason);
  stopRadio();
  const audio = new Audio(); audio.autoplay = true;
  radio = { abbrev, audio, hls: null };
  document.querySelectorAll(`.listen-btn[data-listen="${abbrev}"]`).forEach((b) => { b.classList.add('on'); b.textContent = `■ ${abbrev} radio`; });
  radioBar().innerHTML = `<span>🎧 ${esc(abbrev)} radio · connecting…</span> <button type="button" data-radio-stop>Stop</button>`;
  const ok = () => { if (radio?.audio === audio) radioBar().innerHTML = `<span>🎧 ${esc(abbrev)} radio · live</span> <button type="button" data-radio-stop>Stop</button>`; };
  const fail = () => { if (radio?.audio !== audio) return; stopRadio(); radioFailed(abbrev, page); };
  audio.addEventListener('playing', ok);
  audio.addEventListener('error', fail);
  try {
    if (audio.canPlayType('application/vnd.apple.mpegurl')) { audio.src = url; await audio.play(); return; }
    const Hls = await loadHls();
    if (!Hls?.isSupported()) return fail();
    const hls = new Hls({ lowLatencyMode: true });
    radio.hls = hls;
    hls.on(Hls.Events.ERROR, (_, e) => { if (e.fatal) fail(); });
    hls.loadSource(url); hls.attachMedia(audio);
    audio.play().catch(() => {});
  } catch { fail(); }
}
document.addEventListener('click', (e) => {
  if (e.target.closest('[data-radio-stop]')) return stopRadio();
  const b = e.target.closest('[data-listen]');
  if (!b) return;
  if (b.classList.contains('on')) stopRadio(); else startRadio(b);
});

let audio = null;
let alertTimer = null;
const queue = [];
const ALERT_MS = 8000;
const word = (s) => String(s ?? '').toUpperCase();
const LIGHT = '<svg viewBox="0 0 100 130" aria-hidden="true"><ellipse class="halo" cx="50" cy="52" rx="42" ry="46"/><rect x="16" y="104" width="68" height="18" rx="4" fill="#3b4558"/><rect x="24" y="92" width="52" height="14" rx="3" fill="#59647a"/><path class="dome" d="M22 92V52a28 28 0 0 1 56 0v40z"/><g stroke="#cfd6e4" stroke-width="2.5" fill="none" opacity=".8"><path d="M22 92V52a28 28 0 0 1 56 0v40"/><path d="M36 92V30M50 92V24M64 92V30"/><path d="M24 70h52M26 50h48"/></g></svg>';

function hideAlert() {
  if (audio) { audio.pause(); audio = null; }
  clearTimeout(alertTimer);
  document.getElementById('goal-flash')?.remove();
}
/** Skip: end this alert and go on to the next goal in the queue. */
function skip() { hideAlert(); next(); }
/** Stop all: end this alert, forget the queue and silence the horn. */
function stopAll() { queue.length = 0; hideAlert(); }

function show(a) {
  hideAlert();
  const el = document.createElement('div');
  el.id = 'goal-flash';
  el.setAttribute('role', 'alert');
  const more = queue.length;
  el.innerHTML = `<div class="ga-lights"><div class="ga-light l">${LIGHT}</div>
    <div class="ga-msg"><div class="ga-big">${esc(word(a.team))} SCORE${/S$/i.test(a.team) ? '' : 'S'}!</div>
    <div class="ga-sc">${a.line}</div></div><div class="ga-light r">${LIGHT}</div></div>
    <div class="ga-ctl">${more ? `<span class="ga-q">+${more} more goal${more > 1 ? 's' : ''} queued</span>` : ''}<button type="button" class="ga-btn" data-ga="skip">${more ? 'Skip' : 'Dismiss'}</button>${more ? '<button type="button" class="ga-btn stop" data-ga="stop">Stop all</button>' : ''}</div>`;
  document.body.append(el);
  audio = new Audio(new URL(`audio/horns/${a.abbrev}.mp3`, document.baseURI).href);
  audio.play().catch(() => {}); // blocked until the reader has tapped a horn toggle once
  alertTimer = setTimeout(skip, ALERT_MS);
}
function next() { const a = queue.shift(); if (a) show(a); }
function play(a) {
  const busy = document.getElementById('goal-flash');
  queue.push(a);
  if (busy) { // keep the queue counter on screen current
    const q = busy.querySelector('.ga-ctl'); if (q) { const n = queue.length; q.innerHTML = `<span class="ga-q">+${n} more goal${n > 1 ? 's' : ''} queued</span><button type="button" class="ga-btn" data-ga="skip">Skip</button><button type="button" class="ga-btn stop" data-ga="stop">Stop all</button>`; }
  } else next();
}

document.addEventListener('click', (e) => {
  const c = e.target.closest('[data-ga]');
  if (c) { if (c.dataset.ga === 'stop') stopAll(); else skip(); }
});

document.addEventListener('click', (e) => {
  const b = e.target.closest('[data-horn-team]');
  if (!b) return;
  const id = b.dataset.hornGame; const a = b.dataset.hornTeam;
  const on = !hornOn(id, a);
  store(KEY(id, a), on ? '1' : null);
  // Tapping is the browser's permission to play sound later: unlock audio now.
  if (on) { const u = new Audio(); u.muted = true; u.play().catch(() => {}); } else stopAll();
  document.querySelectorAll(`[data-horn-game="${id}"][data-horn-team="${a}"]`).forEach((x) => {
    x.classList.toggle('on', on);
    x.setAttribute('aria-pressed', String(on));
    x.textContent = `🚨 ${a} horn ${on ? 'on' : 'off'}`;
  });
});

const seen = new Map();
/** Forget the goal counts, so the next frame is a fresh baseline (after a seek or restart). */
export function resetGoals() { seen.clear(); }
 // `${gameId}:${abbrev}` -> goals counted so far
/** Call with every game on each refresh. The first sight of a game sets the baseline, so opening the page never honks. */
export function watchGoals(games) {
  for (const g of games ?? []) {
    if (g.status?.state !== 'live') continue;
    const list = (g.goals ?? g.scoring ?? []).filter((x) => x.period !== 'SO');
    for (const side of ['away', 'home']) {
      const a = g[side].abbrev;
      const n = list.filter((x) => x.team === a).length;
      const k = `${g.id}:${a}`;
      const before = seen.get(k);
      seen.set(k, n);
      if (before != null && n > before && HORNS.has(a) && hornOn(g.id, a)) play(alertFor(g, side));
    }
  }
}

function alertFor(g, side) {
  const o = side === 'away' ? 'home' : 'away';
  const nm = (t) => word(t.name || t.abbrev);
  const line = `<span class="hit">${esc(nm(g[side]))} ${esc(g[side].score ?? '')}</span> – ${esc(g[o].score ?? '')} ${esc(nm(g[o]))}`;
  return { abbrev: g[side].abbrev, team: nm(g[side]), line };
}

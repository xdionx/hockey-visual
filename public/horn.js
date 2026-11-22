// Goal horns: per team and per game, off by default, remembered in this browser.
// Shared by the Scores page and the box score. Horn files live in audio/horns/<ABBREV>.mp3.
const HORNS = new Set(['ANA', 'BOS', 'BUF', 'CGY', 'CAR', 'CHI', 'COL', 'CBJ', 'DAL', 'DET', 'EDM', 'FLA', 'LAK', 'MIN', 'MTL', 'NSH', 'NJD', 'NYI', 'NYR', 'OTT', 'PHI', 'PIT', 'SJS', 'SEA', 'STL', 'TBL', 'TOR', 'UTA', 'VAN', 'VGK', 'WSH', 'WPG']); // every team has a horn file
const KEY = (id, abbrev) => `horn:${id}:${abbrev}`;
const store = (k, v) => { try { return v === undefined ? localStorage.getItem(k) : (v === null ? localStorage.removeItem(k) : localStorage.setItem(k, v)); } catch { return null; } };

export const hornOn = (id, abbrev) => store(KEY(id, abbrev)) === '1';

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

/** Toggle buttons for the teams in this game that have a horn. */
export function hornToggles(game, cls = '', extra = '') {
  const btns = ['away', 'home'].map((s) => game[s].abbrev).filter((a) => HORNS.has(a)).map((a) => {
    const on = hornOn(game.id, a);
    return `<button type="button" class="horn-btn${on ? ' on' : ''}" data-horn-game="${game.id}" data-horn-team="${esc(a)}" aria-pressed="${on}" title="Play the ${esc(a)} goal horn when they score">🚨 ${esc(a)} horn ${on ? 'on' : 'off'}</button>`;
  });
  const listen = listenButtons(game);
  return btns.length || listen || extra ? `<span class="horn-toggles ${cls}">${listen}${btns.join('')}${extra}</span>` : '';
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
// Many teams' radio broadcasts start with a pregame show, so the buttons show up this long before puck drop.
export const RADIO_PREGAME_MS = 30 * 60_000;
/** True while a game's radio could be on: live, or within RADIO_PREGAME_MS of its start time (UTC from the feed). */
export function radioOpen(game, now = Date.now()) {
  const state = game.status?.state;
  if (state === 'live') return true;
  if (state !== 'pre') return false;
  const start = Date.parse(game.startTimeUTC ?? game.status?.startTimeUTC ?? '');
  return Number.isFinite(start) && now >= start - RADIO_PREGAME_MS;
}
const teamName = (game, a) => { const t = game.away.abbrev === a ? game.away : game.home; return t.name || t.abbrev; };
function listenButtons(game) {
  if (!radioOpen(game) || !game.season || /[?&]sim\b/.test(location.search)) return '';
  return ['away', 'home'].map((s) => game[s].abbrev).filter((a) => HORNS.has(a)).map((a) =>
    `<button type="button" class="horn-btn listen-btn${playing() === a ? ' on' : ''}" data-listen="${esc(a)}" data-listen-game="${game.id}" data-listen-name="${esc(teamName(game, a))}" data-listen-matchup="${esc(`${teamName(game, game.away.abbrev)} at ${teamName(game, game.home.abbrev)}`)}" data-listen-season="${esc(game.season)}" data-listen-page="${esc(gamePage(game))}"${game.status?.state === 'pre' ? ' data-listen-pre="1"' : ''} title="Listen to the ${esc(a)} radio broadcast here">${playing() === a ? '■' : '🎧'} ${esc(a)} radio</button>`).join('');
}

let radio = null; // { abbrev, name, matchup, url, page, pre, hls, state, played, tries, … }, only ever in the top window
// Inside the radio shell (see below) the page is in an iframe and the top window owns the audio.
const host = (() => { try { return window.top !== window ? window.top.__radioHost ?? null : null; } catch { return null; } })();
const playing = () => (host ? host.abbrev() : radio?.abbrev ?? null);

// ── Playing on in the background (phone in a pocket, screen locked, another app open) ──
// Phones keep a page's sound going in the background only for a real media element that the reader started
// with a tap, so the radio uses one <audio> element for the whole visit (started by the Listen tap, then
// reused for every reconnect, which the phone then allows without another tap). Nothing here pauses on
// visibilitychange or pagehide. Media Session puts the game on the lock screen / notification with
// play, pause and stop, and Safari's audioSession "playback" type tells iOS this is listening audio.
const STALL_MS = 15000; // stuck buffering this long: reconnect
const RESUME_FRESH_MS = 20000; // paused longer than this: reconnect at the live edge instead of resuming behind
const MAX_TRIES = 6; // reconnect attempts in a row (2s, 4s, 8s, 16s, 20s, 20s) before giving up
let radioEl = null;
function radioAudio() {
  if (radioEl) return radioEl;
  const el = radioEl = document.createElement('audio');
  el.id = 'radio-audio';
  el.preload = 'none';
  el.hidden = true;
  el.setAttribute('playsinline', '');
  el.setAttribute('x-webkit-airplay', 'allow');
  document.body.append(el);
  let lastT = -1;
  el.addEventListener('playing', () => { const r = radio; if (!r) return; r.played = true; r.tries = 0; clearTimeout(r.stallTimer); setState('live'); });
  el.addEventListener('waiting', armStall);
  el.addEventListener('stalled', armStall);
  el.addEventListener('pause', () => {
    // A pause we didn't ask for: a phone call, Siri, headphones pulled, or another app taking the sound.
    if (radio?.state === 'live') { radio.pausedAt = Date.now(); setState('paused'); }
  });
  el.addEventListener('error', () => { if (radio && el.getAttribute('src')) lost(); });
  // Watchdog: some stalls never fire 'waiting' (seen in background tabs). If time stops moving, reconnect.
  setInterval(() => {
    const r = radio;
    if (!r || r.state !== 'live' || el.paused) { lastT = -1; return; }
    if (el.currentTime === lastT) armStall(); else { lastT = el.currentTime; clearTimeout(r.stallTimer); }
  }, 5000);
  return el;
}
function armStall() {
  const r = radio;
  if (!r || r.state !== 'live' || r.stallTimer) return;
  r.stallTimer = setTimeout(() => { r.stallTimer = null; if (radio === r && r.state === 'live') lost(); }, STALL_MS);
}

function radioBar() {
  let bar = document.getElementById('radio-bar');
  if (!bar) { bar = document.createElement('div'); bar.id = 'radio-bar'; document.body.append(bar); }
  return bar;
}
const STATE_TEXT = { connecting: 'connecting…', live: 'live', paused: 'paused', reconnecting: 'reconnecting…' };
function setState(state) {
  const r = radio;
  if (!r) return;
  r.state = state;
  const resume = state === 'paused' ? '<button type="button" data-radio-resume>Resume</button> ' : '';
  radioBar().innerHTML = `<span>🎧 ${esc(r.abbrev)} radio · ${STATE_TEXT[state]}</span> ${resume}<button type="button" data-radio-stop>Stop</button>`;
  lockScreen();
}
/** Lock screen / notification: what's playing, and play / pause / stop that work without opening the page. */
function lockScreen() {
  const ms = navigator.mediaSession;
  if (!ms) return;
  const r = radio;
  try {
    if (!r) { ms.metadata = null; ms.playbackState = 'none'; return; }
    const art = (p, s) => ({ src: new URL(p, document.baseURI).href, sizes: s, type: 'image/png' });
    const status = r.state === 'live' ? 'Live' : STATE_TEXT[r.state][0].toUpperCase() + STATE_TEXT[r.state].slice(1);
    if (typeof MediaMetadata === 'function') {
      ms.metadata = new MediaMetadata({ title: `${r.name} radio`, artist: `${r.matchup} · ${status}`, album: 'NHL Scores', artwork: [art('icons/icon-192.png', '192x192'), art('icons/icon-512.png', '512x512')] });
    }
    ms.playbackState = r.state === 'paused' ? 'paused' : 'playing';
  } catch { /* older browsers */ }
  if (lockScreen.hooked) return;
  lockScreen.hooked = true;
  const on = (action, fn) => { try { ms.setActionHandler(action, fn); } catch { /* action not supported here */ } };
  on('play', () => resumeRadio());
  on('pause', () => pauseRadio());
  on('stop', () => stopRadio());
  // A live broadcast can't skip or seek: leave those buttons off the lock screen.
  for (const a of ['seekbackward', 'seekforward', 'seekto', 'previoustrack', 'nexttrack']) on(a, null);
}
/** Repaint every Listen button, here and in the page shown inside the shell. */
function syncButtons() {
  const docs = [document];
  try { const d = shellFrame?.contentDocument; if (d) docs.push(d); } catch { /* cross-origin page */ }
  const on = radio?.abbrev ?? null;
  for (const d of docs) d.querySelectorAll('.listen-btn').forEach((b) => {
    const is = on === b.dataset.listen;
    b.classList.toggle('on', is);
    b.textContent = `${is ? '■' : '🎧'} ${b.dataset.listen} radio`;
  });
}
/** Unload the stream from the element (the element itself stays, so later plays keep the tap's permission). */
function detach() {
  const r = radio;
  if (r) { clearTimeout(r.stallTimer); clearTimeout(r.retryTimer); r.stallTimer = r.retryTimer = null; r.hls?.destroy(); r.hls = null; }
  if (radioEl) { radioEl.pause(); radioEl.removeAttribute('src'); radioEl.load(); }
}
function stopRadio() {
  detach();
  radio = null;
  document.getElementById('radio-bar')?.remove();
  lockScreen();
  try { if (navigator.audioSession) navigator.audioSession.type = 'auto'; } catch { /* ignore */ }
  syncButtons();
}
function radioFailed(r, lostIt) {
  const bar = radioBar();
  const why = lostIt ? ' The feed dropped and wouldn\'t come back.' : r.pre ? ' It may not be on the air yet; try again closer to puck drop.' : '';
  bar.innerHTML = `<span>Couldn't ${lostIt ? 'keep' : 'start'} the ${esc(r.abbrev)} radio feed here.${why}</span> <a href="${esc(r.page)}" target="_blank" rel="noopener">Open on NHL.com ›</a> <button type="button" data-radio-stop>Close</button>`;
}
function loadHls() {
  if (window.Hls) return Promise.resolve(window.Hls);
  return new Promise((ok, no) => { const s = document.createElement('script'); s.src = HLS_JS; s.onload = () => ok(window.Hls); s.onerror = no; document.head.append(s); });
}
/** Load the feed into the element and play it. Safari (iPhone, iPad, Mac) plays HLS itself; others use hls.js. */
async function attach(r) {
  const el = radioAudio();
  if (el.canPlayType('application/vnd.apple.mpegurl')) { el.src = r.url; return el.play(); }
  const Hls = await loadHls();
  if (radio !== r) return undefined;
  if (!Hls?.isSupported()) throw new Error('unsupported');
  // A bigger buffer than low-latency mode rides out patchy phone signal, which matters most in a pocket.
  const hls = new Hls({ liveSyncDurationCount: 3, maxBufferLength: 30, backBufferLength: 30, manifestLoadingMaxRetry: 4, levelLoadingMaxRetry: 4, fragLoadingMaxRetry: 6 });
  r.hls = hls;
  hls.on(Hls.Events.ERROR, (_, e) => {
    if (!e.fatal || radio !== r || r.hls !== hls) return;
    if (e.type === Hls.ErrorTypes.MEDIA_ERROR && !r.recovered) { r.recovered = true; hls.recoverMediaError(); return; }
    lost();
  });
  hls.loadSource(r.url); hls.attachMedia(el);
  return el.play();
}
function connect(r) {
  attach(r).catch((err) => {
    if (radio !== r || err?.name === 'AbortError') return;
    // Started without a tap (a reconnect the phone won't allow): wait for Resume on the bar or lock screen.
    if (err?.name === 'NotAllowedError' && r.played) { detach(); r.pausedAt = 0; setState('paused'); return; }
    lost();
  });
}
/** The feed broke. Before it ever played, that's a failure; after, try again with growing waits. */
function lost() {
  const r = radio;
  if (!r || (r.state === 'reconnecting' && r.retryTimer)) return; // already on it
  if (!r.played || r.tries >= MAX_TRIES) { stopRadio(); radioFailed(r, r.played); return; }
  detach();
  const wait = Math.min(2000 * 2 ** r.tries, 20000);
  r.tries++;
  setState('reconnecting');
  r.retryTimer = setTimeout(() => { if (radio === r) { r.recovered = false; connect(r); } }, wait);
}
function pauseRadio() {
  const r = radio;
  if (!r || r.state === 'paused') return;
  r.pausedAt = Date.now();
  if (r.state !== 'live') detach(); // nothing to hold on to while connecting
  setState('paused');
  radioEl?.pause();
}
function resumeRadio() {
  const r = radio;
  if (!r || r.state !== 'paused') return;
  r.tries = 0;
  const fresh = !r.pausedAt || Date.now() - r.pausedAt > RESUME_FRESH_MS || !(radioEl?.getAttribute('src') || r.hls);
  setState(fresh ? 'reconnecting' : 'connecting');
  if (fresh) { detach(); connect(r); } else radioEl.play().catch(() => { if (radio === r) { detach(); connect(r); } });
}
/** d: a Listen button's dataset ({ listen, listenName, listenMatchup, listenSeason, listenPage, listenPre }). */
function startRadio(d) {
  stopRadio();
  const abbrev = d.listen;
  radio = { abbrev, name: d.listenName || abbrev, matchup: d.listenMatchup || 'NHL', url: RADIO(abbrev, d.listenSeason), page: d.listenPage, pre: d.listenPre === '1', hls: null, state: 'connecting', played: false, tries: 0 };
  try { if (navigator.audioSession) navigator.audioSession.type = 'playback'; } catch { /* not Safari */ }
  syncButtons();
  setState('connecting');
  connect(radio);
}
// Coming back to the page: if the phone silently stopped the sound while it was away, offer Resume.
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible' && radio?.state === 'live' && radioEl?.paused) { radio.pausedAt = 0; setState('paused'); }
});
// Back online after a dropout: don't wait out the backoff.
window.addEventListener('online', () => {
  const r = radio;
  if (r?.state === 'reconnecting' && r.retryTimer) { clearTimeout(r.retryTimer); r.retryTimer = null; connect(r); }
});
document.addEventListener('click', (e) => {
  if (e.target.closest('[data-radio-stop]')) return host ? host.stop() : stopRadio();
  if (e.target.closest('[data-radio-resume]')) return resumeRadio();
  const b = e.target.closest('[data-listen]');
  if (!b) return;
  const on = playing() === b.dataset.listen;
  if (host) return on ? host.stop() : host.start({ ...b.dataset });
  if (on) stopRadio(); else startRadio({ ...b.dataset });
});

// ── Keep the radio playing while moving between pages ──
// Every page is its own HTML file, and a normal page load would kill the audio. So the first time someone
// follows a link on this site while the radio is on, this page turns into a "shell": it hides its own
// content, stops refreshing, and shows the next page in a full-window iframe. The audio and the radio bar
// stay here in the top window, and every later page opens inside the iframe, so the sound never stops.
// The address bar and tab title follow the page in the frame, so reloading or sharing still works.
let shellFrame = null;
const sameSite = (u) => u.origin === location.origin;
function enterShell(href) {
  window.__radioShell = true; // app.js and game.js stop refreshing this hidden copy
  stopAll();
  for (const el of document.body.children) if (el.id !== 'radio-bar' && el.id !== 'radio-audio') el.style.display = 'none';
  document.documentElement.style.overflow = 'hidden';
  const f = document.createElement('iframe');
  f.id = 'radio-shell';
  f.title = 'Page';
  f.allow = 'autoplay; fullscreen; clipboard-write';
  f.style.cssText = 'position:fixed;inset:0;width:100%;height:100%;border:0;margin:0;z-index:9990;background:#0b1020';
  shellFrame = f;
  history.pushState(null, '', href);
  f.src = href;
  document.body.insertBefore(f, document.getElementById('radio-bar'));
  f.addEventListener('load', () => { followFrame(); hookFrame(); syncButtons(); });
  setInterval(followFrame, 1000); // pages update their own URL (?date=, ?season=) without a load event
  // Back past the first page in the frame lands on our own history entry: show that URL in the frame.
  window.addEventListener('popstate', () => {
    try { if (f.contentWindow.location.href !== location.href) f.contentWindow.location.replace(location.href); } catch { /* ignore */ }
  });
}
function followFrame() {
  try {
    const w = shellFrame.contentWindow;
    const u = w.location.href;
    if (u && u !== 'about:blank' && u !== location.href && sameSite(new URL(u))) history.replaceState(null, '', u);
    if (w.document.title && w.document.title !== document.title) document.title = w.document.title;
  } catch { /* left the site */ }
}
/** Links to other sites can't load in the frame (most refuse to be framed): open them in a new tab. */
function hookFrame() {
  let doc; try { doc = shellFrame.contentDocument; } catch { return; }
  if (!doc || doc.__radioHooked) return;
  doc.__radioHooked = true;
  doc.addEventListener('click', (e) => {
    const a = e.target.closest?.('a[href]');
    if (!a) return;
    const t = a.getAttribute('target');
    if (t === '_top' || t === '_parent') { a.target = '_self'; return; }
    if (t && t !== '_self') return;
    try { if (!sameSite(new URL(a.href))) { a.target = '_blank'; a.rel = 'noopener'; } } catch { /* ignore */ }
  }, true);
}
if (!host && window.top === window) {
  window.__radioHost = { start: (d) => startRadio(d), stop: () => stopRadio(), abbrev: () => radio?.abbrev ?? null };
  // On window, bubbling: runs after the page's own handlers, so links they take over (player cards) are left alone.
  window.addEventListener('click', (e) => {
    if (!radio || shellFrame || e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
    const a = e.target.closest?.('a[href]');
    if (!a || a.hasAttribute('download') || (a.getAttribute('target') && a.getAttribute('target') !== '_self')) return;
    let u; try { u = new URL(a.href); } catch { return; }
    if (!sameSite(u) || !/^https?:$/.test(u.protocol)) return;
    if (u.hash && u.pathname === location.pathname && u.search === location.search) return; // a jump within this page
    e.preventDefault();
    enterShell(u.href);
  });
}

let audio = null;
let alertTimer = null;
const queue = [];
const ALERT_MS = 8000; // how long the alert stays when the horn can't play (sound blocked or file missing)
const MAX_MS = 150000; // safety cap if the horn never reports that it ended (longest horn is ~100s)
const word = (s) => String(s ?? '').toUpperCase();
const LIGHT = '<svg viewBox="0 0 100 130" aria-hidden="true"><ellipse class="halo" cx="50" cy="52" rx="42" ry="46"/><rect x="16" y="104" width="68" height="18" rx="4" fill="#3b4558"/><rect x="24" y="92" width="52" height="14" rx="3" fill="#59647a"/><path class="dome" d="M22 92V52a28 28 0 0 1 56 0v40z"/><g stroke="#cfd6e4" stroke-width="2.5" fill="none" opacity=".8"><path d="M22 92V52a28 28 0 0 1 56 0v40"/><path d="M36 92V30M50 92V24M64 92V30"/><path d="M24 70h52M26 50h48"/></g></svg>';

// A tiny silent clip, played muted on the reader's first tap or key press, to win the browser's permission.
const SILENCE = 'data:audio/wav;base64,UklGRiQAAABXQVZFZm10IBAAAAABAAEAQB8AAEAfAAABAAgAZGF0YQAAAAA=';
let hornEl = null;
function hornAudio() {
  if (!hornEl) { hornEl = new Audio(); hornEl.preload = 'auto'; hornEl.setAttribute('playsinline', ''); }
  return hornEl;
}
let primed = false;
function primeHorn() {
  if (primed || audio) return;
  primed = true;
  const el = hornAudio();
  el.muted = true; el.src = SILENCE;
  el.play().then(() => { if (audio !== el) el.pause(); }).catch(() => { primed = false; });
}
// Any tap or key press on the page counts, so horns work in the background even after a reload.
for (const ev of ['pointerdown', 'keydown', 'touchend']) document.addEventListener(ev, primeHorn, { capture: true, passive: true });

// While the tab is in the background, a goal also shows in the tab's title, until the reader comes back.
let badge = '';
const awayGoals = []; // goals while hidden
function setBadge(text) {
  badge = text;
  const base = document.title.replace(/^🚨 [^·]*· /, '');
  document.title = badge ? `🚨 ${badge} · ${base}` : base;
}
// Pages retitle themselves on redraw: keep the badge in front.
try {
  new MutationObserver(() => { if (badge && !document.title.startsWith('🚨 ')) setBadge(badge); })
    .observe(document.querySelector('title') ?? document.head, { childList: true, characterData: true, subtree: true });
} catch { /* ignore */ }
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible' && badge) { awayGoals.length = 0; setBadge(''); } });

function hideAlert() {
  if (audio) { audio.pause(); audio.onended = audio.onerror = null; audio = null; }
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
  // The alert stays up for the whole horn and ends when the MP3 does (or when the reader skips).
  // One <audio> element, started by an earlier tap, is reused for every horn: Safari only lets an element
  // the reader has already started play later on its own, which a background tab needs.
  const me = hornAudio();
  me.muted = false;
  me.src = new URL(`audio/horns/${a.abbrev}.mp3`, document.baseURI).href;
  audio = me;
  const done = () => { if (audio === me) skip(); };
  const short = () => { if (audio !== me) return; clearTimeout(alertTimer); alertTimer = setTimeout(done, ALERT_MS); };
  me.onended = done;
  me.onerror = short;
  alertTimer = setTimeout(done, MAX_MS);
  me.play().catch(short); // blocked until the reader has tapped a horn toggle once: fall back to a short alert
}
function next() { const a = queue.shift(); if (a) show(a); }
function play(a) {
  if (document.hidden) { awayGoals.push(a.abbrev); setBadge(awayGoals.length === 1 ? `${a.abbrev} goal` : `${awayGoals.length} goals`); }
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
  if (on) primeHorn(); else stopAll();
  document.querySelectorAll(`[data-horn-game="${id}"][data-horn-team="${a}"]`).forEach((x) => {
    x.classList.toggle('on', on);
    x.setAttribute('aria-pressed', String(on));
    x.textContent = `🚨 ${a} horn ${on ? 'on' : 'off'}`;
  });
});

const seen = new Map();
/** Forget the goal counts, so the next frame is a fresh baseline (after a seek or restart, or a game's data delay changed). */
export function resetGoals(gameId) {
  if (gameId == null) { seen.clear(); return; }
  for (const k of [...seen.keys()]) if (k.startsWith(`${gameId}:`)) seen.delete(k);
}
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

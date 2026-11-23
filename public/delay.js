// Data delay for video/audio (shared by the Scores page and the box score).
// Live data arrives 30-45 s before TV or radio shows the play. A viewer can hold the data back per game, so the
// score, goals, momentum, goal horns and goal alerts land when the play does on their screen. The delay is saved
// per game in this browser (localStorage "dataDelay:<gameId>"), so it carries over between every page and tab.
// Each page keeps its recent live refreshes in a buffer (also kept in sessionStorage, so going back and forth
// between pages doesn't lose the history) and shows the one from now minus the delay.
import { pushSnapshot, trimSnapshots, pickSnapshot, clampDelay, delayLabel, MAX_DELAY_S, MIN_KEEP_MS, GAP_MS, NUDGES_S } from './src/delayBuffer.js';
import { maskRecentGoals, progress, delayFromClock, clockStr } from './src/liveClock.js';
import { noteClock, readClockLog } from './clock.js';

const KEY = (id) => `dataDelay:${id}`;
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const inSim = () => /[?&]sim\b/.test(location.search);

/** Seconds of delay for a game (0 = off). Never in the simulator. */
export function getDelay(id) {
  if (inSim()) return 0;
  try { return clampDelay(localStorage.getItem(KEY(id))); } catch { return 0; }
}
export function setDelay(id, s) {
  const v = clampDelay(s);
  try { if (v) localStorage.setItem(KEY(id), String(v)); else localStorage.removeItem(KEY(id)); } catch { /* private mode */ }
  window.dispatchEvent(new CustomEvent('datadelay', { detail: { id: String(id), s: v } }));
  syncPanel();
}
/** Call fn(gameId) when a delay changes here or in another tab / page (the radio frame counts). */
export function onDelayChange(fn) {
  window.addEventListener('datadelay', (e) => fn(e.detail.id));
  window.addEventListener('storage', (e) => { if (e.key?.startsWith('dataDelay:')) { fn(e.key.slice(10)); syncPanel(); } });
}

const buffers = new Map();
/** A buffer of live refreshes for one data file ("scores/2026-11-22", "games/2026020339"). One per name per page. */
export function delayBuffer(name) {
  if (!buffers.has(name)) buffers.set(name, makeBuffer(name));
  return buffers.get(name);
}
/** True when a refresh is behind what we already have (a stale cache or the saved-data fallback answered). */
function behind(data, last) {
  if (!data || !last) return false;
  if (!data.games) return progress(data) < progress(last);
  const was = new Map((last.games ?? []).map((g) => [g.id, progress(g)]));
  return data.games.some((g) => was.has(g.id) && progress(g) < was.get(g.id));
}
function makeBuffer(name) {
  const sk = `delayBuf:${name}`;
  const seenKey = `delayBufSeen:${name}`;
  let list = [];
  let seen = 0; // when the last refresh arrived (identical ones included)
  try {
    const saved = JSON.parse(sessionStorage.getItem(sk) || '[]');
    list = saved.map((x) => ({ t: x.t, data: x.data, key: JSON.stringify(x.data) }));
    seen = Number(sessionStorage.getItem(seenKey)) || (list.at(-1)?.t ?? 0);
  } catch { list = []; }
  const save = () => {
    try { sessionStorage.setItem(sk, JSON.stringify(list.map(({ t, data }) => ({ t, data })))); }
    catch { try { sessionStorage.removeItem(sk); } catch { /* storage off */ } }
  };
  return {
    /** Add a fresh refresh; keepS = the longest delay in use, so enough history stays. Returns false if it was stale. */
    push(data, keepS = 0, key) {
      const now = Date.now();
      // Nothing arrived for a while (page closed, phone asleep): we don't know what happened in the gap, so the
      // old history can't stand in for it. Start over, the same as opening the page fresh ("Syncing…").
      if (list.length && now - seen > GAP_MS) list = [];
      if (behind(data, list.at(-1)?.data)) return false;
      const n = list.length;
      const last = list.at(-1);
      seen = now;
      try { sessionStorage.setItem(seenKey, String(now)); } catch { /* storage off */ }
      pushSnapshot(list, data, now, key);
      trimSnapshots(list, now, Math.max(MIN_KEEP_MS, keepS * 1000) + 15_000);
      if (list.length !== n || list.at(-1) !== last || n === 0) save();
      return true;
    },
    /** { data, t, waitMs } for a delay in seconds. */
    pick(s, now = Date.now()) { return pickSnapshot(list, s * 1000, now); },
  };
}

/**
 * For any code that polls scores/<date>.json (the Scores page, a site-wide goal watcher): store the refresh, then
 * get the games as each one's viewer should see them. Returns { games, wait: Map(gameId -> ms still filling) }.
 */
export function delayScores(date, data, now = Date.now()) {
  const buf = delayBuffer(`scores/${date}`);
  if (data && buf.push(data, Math.max(0, ...(data.games ?? []).map((g) => getDelay(g.id))))) for (const g of data.games ?? []) noteClock(g);
  const top = buf.pick(0, now);
  const newest = top?.data ?? data;
  const wait = new Map();
  const seenAt = new Map(); // gameId -> when the reading shown reached the viewer (for the live clock)
  const games = (newest?.games ?? []).map((g) => {
    const s = getDelay(g.id);
    if (top) seenAt.set(g.id, top.t);
    if (!s) return g;
    const p = buf.pick(s, now);
    const old = p?.data.games?.find((x) => x.id === g.id);
    if (!old) return g;
    if (p.waitMs > 0 && delayable(old)) {
      wait.set(g.id, p.waitMs);
      seenAt.delete(g.id);
      return maskRecentGoals(old, p.waitMs / 1000); // still filling: hide goals the video may not have shown yet
    }
    seenAt.set(g.id, p.t + s * 1000);
    return old;
  });
  return { games, wait, seenAt };
}

/** Delay only matters while a game can still change: live, or close enough to puck drop that the radio is on. */
export function delayable(game) {
  if (inSim() || !game) return false;
  const st = game.status?.state;
  if (st === 'live') return true;
  if (st !== 'pre') return false;
  const start = Date.parse(game.startTimeUTC ?? '');
  return Number.isFinite(start) && Date.now() >= start - 30 * 60_000;
}

/** The chip that shows and opens the delay: "⏱ Sync" (off), "⏱ Delayed 40s", "⏱ Syncing 28s" (history filling). */
export function delayButton(game, waitMs = 0) {
  if (!delayable(game)) return '';
  const s = getDelay(game.id);
  const title = `${game.away?.abbrev} @ ${game.home?.abbrev}`;
  const label = !s ? 'Sync video' : waitMs > 0 ? `Syncing… ${Math.ceil(waitMs / 1000)}s` : `Delayed ${delayLabel(s)}`;
  const tip = s ? `Live data is held back ${delayLabel(s)} to line up with your video or radio. Tap to change or turn off.` : 'Delay the live data so goals don\'t show before you see them on TV or hear them on radio';
  return `<button type="button" class="horn-btn delay-btn${s ? ' on' : ''}" data-delay-game="${esc(game.id)}" data-delay-title="${esc(title)}" aria-haspopup="dialog" title="${esc(tip)}">⏱ ${esc(label)}</button>`;
}

// ── The control: set the delay from the clock on your video, then nudge it ±1 / 5 / 10 seconds ──
let panel = null;
let panelGame = null;
let panelAnchor = null;
function css() {
  if (document.getElementById('delay-css')) return;
  const st = document.createElement('style');
  st.id = 'delay-css';
  st.textContent = `
.horn-btn.delay-btn.on { background: #f59e0b; border-color: #f59e0b; color: #111; opacity: 1; }
.delay-panel { position: fixed; z-index: 1000; width: min(340px, calc(100vw - 32px)); box-sizing: border-box; padding: 14px; border-radius: 12px;
  background: #111827; color: #e8edf5; border: 1px solid #334155; box-shadow: 0 12px 40px rgba(0,0,0,.5); font: 14px/1.4 Inter, system-ui, sans-serif; }
.delay-panel h4 { margin: 0 0 2px; font-size: 15px; }
.delay-panel h5 { margin: 12px 0 6px; font-size: 12px; text-transform: uppercase; letter-spacing: .06em; color: #94a3b8; }
.delay-panel .dp-sub { margin: 0 0 8px; color: #94a3b8; font-size: 12px; }
.delay-panel output { display: block; text-align: center; font: 800 30px "Barlow Condensed", Inter, sans-serif; font-variant-numeric: tabular-nums; }
.delay-panel button, .delay-panel select, .delay-panel input { font: 600 14px Inter, sans-serif; color: inherit; background: #1e293b; border: 1px solid #334155; border-radius: 8px; padding: 7px 10px; }
.delay-panel button { cursor: pointer; }
.delay-panel button:disabled { opacity: .4; cursor: default; }
.delay-panel .dp-vid { display: flex; gap: 6px; }
.delay-panel .dp-vid input { flex: 1; min-width: 0; font: 700 18px "JetBrains Mono", ui-monospace, monospace; text-align: center; }
.delay-panel .dp-vid .dp-set { background: #f59e0b; border-color: #f59e0b; color: #111; }
.delay-panel .dp-msg { min-height: 1.4em; margin: 6px 0 0; font-size: 12px; color: #94a3b8; }
.delay-panel .dp-msg.bad { color: #fca5a5; }
.delay-panel .dp-msg.ok { color: #86efac; }
.delay-panel .dp-nudge { display: grid; grid-template-columns: repeat(6, 1fr); gap: 4px; }
.delay-panel .dp-nudge button { padding: 8px 0; font-variant-numeric: tabular-nums; }
.delay-panel .dp-nudge-sub { display: flex; justify-content: space-between; margin-top: 3px; font-size: 11px; color: #94a3b8; }
.delay-panel .dp-foot { margin-top: 12px; }
.delay-panel .dp-off { background: transparent; }
.delay-panel .dp-x { position: absolute; top: 8px; right: 8px; border: 0; background: transparent; font-size: 16px; padding: 4px 8px; }
.delay-panel .dp-note { margin: 10px 0 0; color: #94a3b8; font-size: 12px; }
@media (max-width: 560px) { .delay-panel { left: 16px !important; right: 16px; top: auto !important; bottom: 16px; width: auto; max-height: calc(100vh - 32px); overflow: auto; } }`;
  document.head.append(st);
}
const pName = (n) => (n <= 3 ? ['1st', '2nd', '3rd'][n - 1] : n === 4 ? 'OT' : `${n - 3}OT`);
function syncPanel() {
  if (!panel || !panelGame) return;
  const s = getDelay(panelGame);
  panel.querySelector('output').textContent = s ? `${delayLabel(s)} behind live` : 'No delay';
  panel.querySelectorAll('[data-dp-add]').forEach((b) => {
    const v = s + Number(b.dataset.dpAdd);
    b.disabled = v < 0 || v > MAX_DELAY_S;
  });
  panel.querySelector('.dp-off').hidden = !s;
}
function msg(text, kind = '') {
  const el = panel?.querySelector('.dp-msg');
  if (el) { el.textContent = text; el.className = `dp-msg ${kind}`; }
}
/** "1234" or "12:34" -> seconds left in the period, or null. */
function parseClock(v) {
  const t = String(v ?? '').trim().replace(/[.,;]/, ':');
  let m = t.match(/^(\d{1,2}):(\d{1,2})$/);
  if (!m) { const d = t.match(/^(\d{1,4})$/)?.[1]; if (d) m = [d, d.length > 2 ? d.slice(0, -2) : '0', d.slice(-2)]; }
  if (!m) return null;
  const mins = Number(m[1]); const secs = Number(m[2]);
  if (secs > 59 || mins > 20 || (mins === 20 && secs)) return null;
  return mins * 60 + secs;
}
/** Work out the delay from what the video's clock shows right now. */
function setFromVideo() {
  const id = panelGame;
  const n = Number(panel.querySelector('[name="dp-period"]').value);
  const raw = panel.querySelector('[name="dp-clock"]').value;
  const secs = parseClock(raw);
  if (secs == null) { msg('Type the clock as it shows on your video, like 12:34.', 'bad'); return; }
  const r = delayFromClock(readClockLog(id), n, secs, Date.now());
  const at = `${pName(n)} ${clockStr(secs)}`;
  if (r.error === 'ahead') { msg(`The live data hasn't reached ${at} yet, so your video isn't behind. Check the period and time.`, 'bad'); return; }
  if (r.error === 'old') { msg(`${at} is further back than this browser has kept clock data for. Try the time on your video now.`, 'bad'); return; }
  if (r.error === 'none') { msg('No live clock yet for this game. Leave the page open a few seconds and try again.', 'bad'); return; }
  const v = clampDelay(r.s);
  setDelay(id, v);
  msg(v < r.s ? `Your video is ${delayLabel(r.s)} behind; the most this can wait is ${delayLabel(MAX_DELAY_S)}.` : `Synced to your video at ${at}: ${delayLabel(v)} behind live. Fine-tune below if goals still land early or late.`, v < r.s ? 'bad' : 'ok');
}
function closePanel() { panel?.remove(); panel = null; panelGame = null; panelAnchor?.focus?.(); panelAnchor = null; }
function openPanel(btn) {
  css();
  closePanel();
  panelGame = btn.dataset.delayGame;
  panelAnchor = btn;
  const log = readClockLog(panelGame);
  const nowN = log.at(-1)?.[1] ?? 1;
  const maxN = Math.max(3, nowN);
  panel = document.createElement('div');
  panel.className = 'delay-panel';
  panel.setAttribute('role', 'dialog');
  panel.setAttribute('aria-label', 'Data delay for video and audio');
  const nudges = [...NUDGES_S].reverse().map((k) => `<button type="button" data-dp-add="${-k}" aria-label="${k} second${k > 1 ? 's' : ''} less delay">−${k}</button>`).join('')
    + NUDGES_S.map((k) => `<button type="button" data-dp-add="${k}" aria-label="${k} second${k > 1 ? 's' : ''} more delay">+${k}</button>`).join('');
  panel.innerHTML = `<button type="button" class="dp-x" data-dp="x" aria-label="Close">✕</button>
    <h4>Data delay for video/audio</h4>
    <p class="dp-sub">${esc(btn.dataset.delayTitle)} · saved for this game</p>
    <output aria-live="polite"></output>
    <h5>Match your video's clock</h5>
    <form class="dp-vid" data-dp-form>
      <select name="dp-period" aria-label="Period on your video">${Array.from({ length: maxN }, (_, i) => i + 1).map((n) => `<option value="${n}"${n === nowN ? ' selected' : ''}>${pName(n)}</option>`).join('')}</select>
      <input name="dp-clock" inputmode="numeric" autocomplete="off" placeholder="12:34" aria-label="Game clock on your video" maxlength="5">
      <button type="submit" class="dp-set">Set</button>
    </form>
    <p class="dp-msg">Type the time a little ahead of your video, then press Set the moment the clock there shows it.</p>
    <h5>Fine-tune</h5>
    <div class="dp-nudge">${nudges}</div>
    <div class="dp-nudge-sub"><span>← score shows late</span><span>score shows early →</span></div>
    <div class="dp-foot"><button type="button" class="dp-off" data-dp-set="0">Turn off (no delay)</button></div>
    <p class="dp-note">Scores, goals, momentum, horns and goal alerts wait this long, so they land with the play on your TV or radio. Works best while the clock is running.</p>`;
  document.body.append(panel);
  const r = btn.getBoundingClientRect();
  const w = panel.offsetWidth;
  panel.style.left = `${Math.max(16, Math.min(innerWidth - w - 16, r.left))}px`;
  const below = r.bottom + 8;
  panel.style.top = `${below + panel.offsetHeight > innerHeight - 8 ? Math.max(8, r.top - panel.offsetHeight - 8) : below}px`;
  syncPanel();
  panel.querySelector('[name="dp-clock"]').focus();
}
document.addEventListener('submit', (e) => {
  if (!panel || !e.target.closest?.('[data-dp-form]')) return;
  e.preventDefault();
  setFromVideo();
});
document.addEventListener('click', (e) => {
  const btn = e.target.closest?.('[data-delay-game]');
  if (btn) { if (panel && panelGame === btn.dataset.delayGame) closePanel(); else openPanel(btn); return; }
  if (!panel) return;
  if (!panel.contains(e.target)) { closePanel(); return; }
  const set = e.target.closest('[data-dp-set]');
  const add = e.target.closest('[data-dp-add]');
  const act = e.target.closest('[data-dp]')?.dataset.dp;
  if (set) { setDelay(panelGame, Number(set.dataset.dpSet)); msg(''); }
  else if (add) { setDelay(panelGame, getDelay(panelGame) + Number(add.dataset.dpAdd)); msg(''); }
  else if (act === 'x') closePanel();
});
document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && panel) closePanel(); });
css();

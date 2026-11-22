// Data delay for video/audio (shared by the Scores page and the box score).
// Live data arrives 30-45 s before TV or radio shows the play. A viewer can hold the data back per game, so the
// score, goals, momentum, goal horns and goal alerts land when the play does on their screen. The delay is saved
// per game in this browser (localStorage "dataDelay:<gameId>"), so it carries over between every page and tab.
// Each page keeps its recent live refreshes in a buffer (also kept in sessionStorage, so going back and forth
// between pages doesn't lose the history) and shows the one from now minus the delay.
import { pushSnapshot, trimSnapshots, pickSnapshot, clampDelay, delayLabel, MAX_DELAY_S, STEP_S, PRESETS_S, MIN_KEEP_MS } from './src/delayBuffer.js';

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
function makeBuffer(name) {
  const sk = `delayBuf:${name}`;
  let list = [];
  try {
    const saved = JSON.parse(sessionStorage.getItem(sk) || '[]');
    list = saved.map((x) => ({ t: x.t, data: x.data, key: JSON.stringify(x.data) }));
  } catch { list = []; }
  const save = () => {
    try { sessionStorage.setItem(sk, JSON.stringify(list.map(({ t, data }) => ({ t, data })))); }
    catch { try { sessionStorage.removeItem(sk); } catch { /* storage off */ } }
  };
  return {
    /** Add a fresh refresh; keepS = the longest delay in use, so enough history stays. */
    push(data, keepS = 0, key) {
      const n = list.length;
      const now = Date.now();
      pushSnapshot(list, data, now, key);
      trimSnapshots(list, now, Math.max(MIN_KEEP_MS, keepS * 1000) + 15_000);
      if (list.length !== n || n === 0) save();
    },
    /** { data, waitMs } for a delay in seconds. */
    pick(s, now = Date.now()) { return pickSnapshot(list, s * 1000, now); },
  };
}

/**
 * For any code that polls scores/<date>.json (the Scores page, a site-wide goal watcher): store the refresh, then
 * get the games as each one's viewer should see them. Returns { games, wait: Map(gameId -> ms still filling) }.
 */
export function delayScores(date, data, now = Date.now()) {
  const buf = delayBuffer(`scores/${date}`);
  if (data) buf.push(data, Math.max(0, ...(data.games ?? []).map((g) => getDelay(g.id))));
  const newest = buf.pick(0, now)?.data ?? data;
  const wait = new Map();
  const games = (newest?.games ?? []).map((g) => {
    const s = getDelay(g.id);
    if (!s) return g;
    const p = buf.pick(s, now);
    const old = p?.data.games?.find((x) => x.id === g.id);
    if (!old) return g;
    if (p.waitMs > 0 && delayable(old)) wait.set(g.id, p.waitMs);
    return old;
  });
  return { games, wait };
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

// ── The control: a small panel with − / + , presets and Off ──
let panel = null;
let panelGame = null;
let panelAnchor = null;
function css() {
  if (document.getElementById('delay-css')) return;
  const st = document.createElement('style');
  st.id = 'delay-css';
  st.textContent = `
.horn-btn.delay-btn.on { background: #f59e0b; border-color: #f59e0b; color: #111; opacity: 1; }
.delay-panel { position: fixed; z-index: 1000; width: min(320px, calc(100vw - 32px)); box-sizing: border-box; padding: 14px; border-radius: 12px;
  background: #111827; color: #e8edf5; border: 1px solid #334155; box-shadow: 0 12px 40px rgba(0,0,0,.5); font: 14px/1.4 Inter, system-ui, sans-serif; }
.delay-panel h4 { margin: 0 0 2px; font-size: 15px; }
.delay-panel .dp-sub { margin: 0 0 12px; color: #94a3b8; font-size: 12px; }
.delay-panel .dp-step { display: flex; align-items: center; gap: 8px; margin-bottom: 10px; }
.delay-panel .dp-step output { flex: 1; text-align: center; font: 800 28px "Barlow Condensed", Inter, sans-serif; font-variant-numeric: tabular-nums; }
.delay-panel button { font: 600 13px Inter, sans-serif; color: inherit; background: #1e293b; border: 1px solid #334155; border-radius: 8px; padding: 6px 10px; cursor: pointer; }
.delay-panel .dp-step button { width: 52px; height: 40px; font-size: 16px; }
.delay-panel .dp-pre { display: flex; flex-wrap: wrap; gap: 6px; margin-bottom: 10px; }
.delay-panel .dp-pre button[aria-pressed="true"] { background: #f59e0b; border-color: #f59e0b; color: #111; }
.delay-panel .dp-foot { display: flex; gap: 8px; justify-content: space-between; align-items: center; }
.delay-panel .dp-off { background: transparent; }
.delay-panel .dp-x { position: absolute; top: 8px; right: 8px; border: 0; background: transparent; font-size: 16px; padding: 4px 8px; }
.delay-panel .dp-note { margin: 10px 0 0; color: #94a3b8; font-size: 12px; }
@media (max-width: 560px) { .delay-panel { left: 16px !important; right: 16px; top: auto !important; bottom: 16px; width: auto; } }`;
  document.head.append(st);
}
function syncPanel() {
  if (!panel || !panelGame) return;
  const s = getDelay(panelGame);
  panel.querySelector('output').textContent = s ? delayLabel(s) : 'Off';
  panel.querySelectorAll('[data-dp-set]').forEach((b) => b.setAttribute('aria-pressed', String(Number(b.dataset.dpSet) === s)));
  panel.querySelector('[data-dp="-"]').disabled = s <= 0;
  panel.querySelector('[data-dp="+"]').disabled = s >= MAX_DELAY_S;
  panel.querySelector('.dp-off').hidden = !s;
}
function closePanel() { panel?.remove(); panel = null; panelGame = null; panelAnchor?.focus?.(); panelAnchor = null; }
function openPanel(btn) {
  css();
  closePanel();
  panelGame = btn.dataset.delayGame;
  panelAnchor = btn;
  panel = document.createElement('div');
  panel.className = 'delay-panel';
  panel.setAttribute('role', 'dialog');
  panel.setAttribute('aria-label', 'Data delay for video and audio');
  panel.innerHTML = `<button type="button" class="dp-x" data-dp="x" aria-label="Close">✕</button>
    <h4>Data delay for video/audio</h4>
    <p class="dp-sub">${esc(btn.dataset.delayTitle)} · saved for this game</p>
    <div class="dp-step"><button type="button" data-dp="-" aria-label="${STEP_S} seconds less">−${STEP_S}</button><output aria-live="polite"></output><button type="button" data-dp="+" aria-label="${STEP_S} seconds more">+${STEP_S}</button></div>
    <div class="dp-pre">${PRESETS_S.map((s) => `<button type="button" data-dp-set="${s}">${delayLabel(s)}</button>`).join('')}</div>
    <div class="dp-foot"><button type="button" class="dp-off" data-dp-set="0">Turn off (no delay)</button></div>
    <p class="dp-note">Scores, goals, momentum, horns and goal alerts wait this long, so they land with the play on your TV or radio. Most streams run 30-45s behind. If the score still shows first, add time; if it shows late, take some off.</p>`;
  document.body.append(panel);
  const r = btn.getBoundingClientRect();
  const w = panel.offsetWidth;
  panel.style.left = `${Math.max(16, Math.min(innerWidth - w - 16, r.left))}px`;
  const below = r.bottom + 8;
  panel.style.top = `${below + panel.offsetHeight > innerHeight - 8 ? Math.max(8, r.top - panel.offsetHeight - 8) : below}px`;
  syncPanel();
  panel.querySelector('[data-dp="+"]').focus();
}
document.addEventListener('click', (e) => {
  const btn = e.target.closest?.('[data-delay-game]');
  if (btn) { if (panel && panelGame === btn.dataset.delayGame) closePanel(); else openPanel(btn); return; }
  if (!panel) return;
  if (!panel.contains(e.target)) { closePanel(); return; }
  const set = e.target.closest('[data-dp-set]');
  const act = e.target.closest('[data-dp]')?.dataset.dp;
  if (set) setDelay(panelGame, Number(set.dataset.dpSet));
  else if (act === '+') setDelay(panelGame, Math.floor(getDelay(panelGame) / STEP_S) * STEP_S + STEP_S);
  else if (act === '-') setDelay(panelGame, Math.ceil(getDelay(panelGame) / STEP_S) * STEP_S - STEP_S);
  else if (act === 'x') closePanel();
});
document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && panel) closePanel(); });
css();

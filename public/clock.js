// Live game clock on the page: counts down a second at a time between refreshes and snaps back to the feed's
// clock on each one. Intermissions count down the same way (the feed gives the break's clock, about 18:00).
// Also keeps the clock log (when each clock reading arrived) that "Set from video clock" in delay.js uses.
import { clockNow, clockLabel, logClock } from './src/liveClock.js';

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const inSim = () => /[?&]sim\b/.test(location.search);

// When each game's current clock reading first showed on this page, so the countdown runs from there.
const anchors = new Map(); // gameId -> { key, t }
function anchor(id, clock, seenAt) {
  const key = `${clock.n}|${clock.s}|${clock.run}|${clock.int}`;
  const a = anchors.get(String(id));
  if (a?.key === key) return a.t;
  const t = Math.min(Date.now(), seenAt ?? Date.now());
  anchors.set(String(id), { key, t });
  return t;
}

/**
 * The status text for a game, as a span the ticker keeps counting down. label = what the page shows otherwise.
 * seenAt (ms) = when this reading should have reached the viewer (after any delay), if the page knows.
 */
export function clockSpan(game, label, seenAt) {
  const c = game?.status?.state === 'live' && !inSim() ? game.status.clock : null;
  if (!c || c.s == null || !c.p) return esc(label);
  const t = anchor(game.id, c, seenAt);
  const secs = clockNow(c, Date.now() - t);
  return `<span class="live-clock" data-clk="${esc(JSON.stringify({ ...c, t }))}">${esc(clockLabel(c, secs))}</span>`;
}

/** Icon + "BUF Timeout" / "TV Timeout" while a timeout is on (box score data only). */
export function timeoutChip(game) {
  const to = game?.status?.state === 'live' ? game.timeout : null;
  if (!to) return '';
  const text = to.team ? `${to.team} Timeout` : 'TV Timeout';
  const icon = '<svg class="to-ico" viewBox="0 0 24 24" aria-hidden="true"><path d="M4 4h16v4h-6v12h-4V8H4z" fill="currentColor"/></svg>';
  return `<span class="timeout-chip${to.team ? '' : ' tv'}" title="${esc(text)}">${icon}${esc(text)}</span>`;
}

function tick() {
  const now = Date.now();
  for (const el of document.querySelectorAll('[data-clk]')) {
    let c; try { c = JSON.parse(el.dataset.clk); } catch { continue; }
    const text = clockLabel(c, clockNow(c, now - c.t));
    if (el.textContent !== text) el.textContent = text;
  }
}
let ticking = null;
/** Start the once-a-second countdown (any page that shows live clocks). */
export function startClocks() {
  if (ticking || typeof document === 'undefined') return;
  ticking = setInterval(tick, 250); // 4x a second, so each second turns over close to on time
  const css = document.createElement('style');
  css.textContent = `.live-clock { font-variant-numeric: tabular-nums; }
.timeout-chip { display: inline-flex; align-items: center; gap: 4px; margin-left: 8px; padding: 1px 8px 1px 5px; border-radius: 999px;
  background: #f59e0b; color: #111; font: 700 12px/1.6 Inter, system-ui, sans-serif; letter-spacing: .02em; white-space: nowrap; vertical-align: middle; }
.timeout-chip.tv { background: #334155; color: #e8edf5; }
.timeout-chip .to-ico { width: 13px; height: 13px; }`;
  document.head.append(css);
}

// ── Clock log, shared by every page and tab of this site (localStorage "clockLog:<gameId>") ──
const LOG = (id) => `clockLog:${id}`;
const mem = new Map();
export function readClockLog(id) {
  try { const v = JSON.parse(localStorage.getItem(LOG(id)) || '[]'); return Array.isArray(v) ? v : []; } catch { return mem.get(String(id)) ?? []; }
}
/** Note a fresh (not delayed) refresh of a live game's clock. t = when it arrived. */
export function noteClock(game, t = Date.now()) {
  if (inSim() || game?.status?.state !== 'live' || !game.status.clock) return;
  const log = readClockLog(game.id);
  const n = log.length;
  const last = log[n - 1];
  logClock(log, game.status.clock, t);
  if (log.length === n && log[n - 1] === last) return;
  mem.set(String(game.id), log);
  try { localStorage.setItem(LOG(game.id), JSON.stringify(log)); } catch { /* storage full or off */ }
}
/** Tidy logs of games that ended long ago. */
try {
  for (const k of Object.keys(localStorage)) {
    if (!k.startsWith('clockLog:')) continue;
    const log = JSON.parse(localStorage.getItem(k) || '[]');
    if (!log.length || Date.now() - log[log.length - 1][0] > 6 * 3600_000) localStorage.removeItem(k);
  }
} catch { /* storage off */ }

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
  // Undelayed: start from when any page of this browser first saw the reading (shared clock log), so the
  // Scores page and the box score count from the same moment instead of each from its own refresh.
  let first = null;
  if (seenAt == null) {
    const e = readClockLog(id).findLast((r) => r[1] === clock.n && r[2] === clock.s && r[3] === (clock.run ? 1 : 0) && r[4] === (clock.int ? 1 : 0));
    if (e) first = e[0];
  }
  const t = Math.min(Date.now(), seenAt ?? first ?? Date.now());
  anchors.set(String(id), { key, t });
  return t;
}

// Status icons (24x24, solid fill in the text color): a clock for timeouts, a Zamboni for intermissions.
const CLOCK_ICO = '<svg class="to-ico" viewBox="0 0 24 24" aria-hidden="true"><path fill-rule="evenodd" fill="currentColor" d="M12 2a10 10 0 1 0 0 20a10 10 0 1 0 0-20zm0 2.4a7.6 7.6 0 1 1 0 15.2a7.6 7.6 0 1 1 0-15.2zM11 6.5h2v4.9l3.4 2-1 1.7-4.4-2.6z"/></svg>';
const ZAMBONI = '<svg class="int-ico" viewBox="0 0 24 24" role="img" aria-label="Intermission"><title>Intermission: ice resurfacing</title><path fill="currentColor" d="M11 4h7.5l3.5 5v8H11zM4 11h7v6H4zM5.3 6.3a1.7 1.7 0 1 0 3.4 0a1.7 1.7 0 1 0-3.4 0zM5.3 8.6h3.4V11H5.3zM9 9.6l2.2-1.4.6.9-2.2 1.4zM1 14.5h3.5V19H1zM6.3 18.5a2 2 0 1 0 4 0a2 2 0 1 0-4 0zM15.5 18.5a2 2 0 1 0 4 0a2 2 0 1 0-4 0zM0 21.5h11v1.3H0z"/></svg>';

/**
 * The status text for a game, as a span the ticker keeps counting down. label = what the page shows otherwise.
 * seenAt (ms) = when this reading should have reached the viewer (after any delay), if the page knows.
 */
export function clockSpan(game, label, seenAt) {
  const live = game?.status?.state === 'live';
  const icon = live && (game.status.clock?.int || /Intermission/i.test(game.status.label ?? '')) ? ZAMBONI : '';
  const c = live && !inSim() ? game.status.clock : null;
  if (!c || c.s == null || !c.p) return icon + esc(label);
  const t = anchor(game.id, c, seenAt);
  const secs = clockNow(c, Date.now() - t);
  return `${icon}<span class="live-clock" data-clk="${esc(JSON.stringify({ ...c, t }))}">${esc(clockLabel(c, secs))}</span>`;
}

/** Icon + "BUF Timeout" / "TV Timeout" while a timeout is on (box score data only). */
export function timeoutChip(game) {
  const to = game?.status?.state === 'live' ? game.timeout : null;
  if (!to) return '';
  const text = to.team ? `${to.team} Timeout` : 'TV Timeout';
  return `<span class="timeout-chip${to.team ? '' : ' tv'}" title="${esc(text)}">${CLOCK_ICO}${esc(text)}</span>`;
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
.timeout-chip .to-ico { width: 13px; height: 13px; }
.int-ico { width: 1.15em; height: 1.15em; margin-right: .3em; vertical-align: -.2em; flex: none; }`;
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

// Fetches site data from the live Worker when configured, else from static data/ files.
import { LIVE_API } from './config.js';

export const live = Boolean(LIVE_API);

async function get(url) {
  const res = await fetch(url, { cache: 'no-store' });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(res.statusText || `HTTP ${res.status}`);
  return res.json();
}

/** path like "scores/2026-11-18.json"; base is where data/ lives relative to the page. */
export async function getData(path, base = '') {
  if (live) {
    try {
      return await get(`${LIVE_API.replace(/\/$/, '')}/${path}`);
    } catch (err) {
      console.warn(`Live data failed (${err.message}); using saved data.`);
    }
  }
  return get(`${base}data/${path}`);
}

/** A file only the GitHub Action saves (no live version), like the season totals. */
export function getStatic(path, base = '') {
  return get(`${base}data/${path}`);
}

/** How long to wait before refreshing a page that shows live games. */
export const LIVE_REFRESH_MS = live ? 2_000 : 60_000;

// ── Timers that keep running in a background tab ──
// Browsers slow down a hidden tab's setTimeout (Chrome: to once a minute after ~5 minutes hidden), which
// made live scores and goal horns wait until the reader came back. A Web Worker's timers aren't throttled
// that way, so live refreshes are timed there and the page is told when to fetch. Falls back to setTimeout.
let ticker = null;
const waiting = new Map();
let nextId = 1;
function tickerWorker() {
  if (ticker !== null) return ticker;
  ticker = false;
  try {
    if (typeof Worker !== 'function' || typeof Blob !== 'function' || typeof URL?.createObjectURL !== 'function') return ticker;
    const src = 'const t=new Map();onmessage=(e)=>{const{id,ms}=e.data;if(ms<0){clearTimeout(t.get(id));t.delete(id);return;}t.set(id,setTimeout(()=>{t.delete(id);postMessage(id);},ms));};';
    const w = new Worker(URL.createObjectURL(new Blob([src], { type: 'text/javascript' })));
    w.onmessage = (e) => { const fn = waiting.get(e.data); waiting.delete(e.data); fn?.(); };
    w.onerror = () => { ticker = false; for (const [id, fn] of waiting) { waiting.delete(id); setTimeout(fn, 0); } };
    ticker = w;
  } catch { ticker = false; }
  return ticker;
}
/** Like setTimeout, but keeps time in a background tab. Returns a handle for cancelLater. */
export function later(fn, ms) {
  const w = tickerWorker();
  if (!w) return { t: setTimeout(fn, ms) };
  const id = nextId++;
  waiting.set(id, fn);
  w.postMessage({ id, ms });
  return { id };
}
export function cancelLater(h) {
  if (!h) return;
  if (h.t != null) clearTimeout(h.t);
  if (h.id != null && waiting.delete(h.id) && ticker) ticker.postMessage({ id: h.id, ms: -1 });
}

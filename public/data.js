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
export const LIVE_REFRESH_MS = live ? 5_000 : 60_000;

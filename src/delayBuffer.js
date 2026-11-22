// Data delay for video/audio: live data reaches us 30-45 s before TV or radio shows it, so a viewer can hold it
// back. Every live refresh is kept as a timestamped snapshot; the page then shows the snapshot from
// (now - delay). Pure logic here (no DOM, no storage) so it can be tested; public/delay.js wires it to the page.

export const MAX_DELAY_S = 180;
export const STEP_S = 5;
export const PRESETS_S = [15, 30, 45, 60, 90];
/** History is always kept this long, so turning a delay on takes effect right away instead of filling up first. */
export const MIN_KEEP_MS = 60_000;

export const clampDelay = (s) => Math.max(0, Math.min(MAX_DELAY_S, Math.round(Number(s) || 0)));

/**
 * A list of { t, data } snapshots, oldest first. Each snapshot stands until the next one, so identical
 * consecutive refreshes are stored once.
 */
export function pushSnapshot(list, data, t, key = JSON.stringify(data)) {
  const last = list[list.length - 1];
  if (last && t < last.t) return list; // clock went backwards: ignore
  if (last && last.key === key) return list;
  list.push({ t, data, key });
  return list;
}

/** Drop snapshots older than keepMs, but keep the one in force at the cutoff. */
export function trimSnapshots(list, now, keepMs) {
  const cutoff = now - keepMs;
  let i = 0;
  while (i + 1 < list.length && list[i + 1].t <= cutoff) i++;
  if (i) list.splice(0, i);
  return list;
}

/**
 * The snapshot to show for a delay (ms). Returns { data, t, waitMs }: waitMs > 0 means there isn't enough
 * history yet (the page just opened), so the oldest snapshot is shown and stays put until the delay is reached.
 */
export function pickSnapshot(list, delayMs, now) {
  if (!list.length) return null;
  const newest = list[list.length - 1];
  if (!delayMs) return { data: newest.data, t: newest.t, waitMs: 0 };
  const target = now - delayMs;
  if (target < list[0].t) return { data: list[0].data, t: list[0].t, waitMs: list[0].t - target };
  let lo = 0;
  let hi = list.length - 1;
  while (lo < hi) { // last snapshot with t <= target
    const mid = (lo + hi + 1) >> 1;
    if (list[mid].t <= target) lo = mid; else hi = mid - 1;
  }
  return { data: list[lo].data, t: list[lo].t, waitMs: 0 };
}

/** "40s", "1:30" */
export function delayLabel(s) {
  if (s < 60) return `${s}s`;
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

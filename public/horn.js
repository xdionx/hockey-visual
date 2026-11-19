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
  return btns.length ? `<span class="horn-toggles ${cls}">${btns.join('')}</span>` : '';
}

let audio = null;
let flashTimer = null;
function stop() {
  if (audio) { audio.pause(); audio = null; }
  clearTimeout(flashTimer);
  document.getElementById('goal-flash')?.remove();
}

function flash() {
  document.getElementById('goal-flash')?.remove();
  const el = document.createElement('div');
  el.id = 'goal-flash';
  el.setAttribute('aria-hidden', 'true');
  document.body.append(el);
  flashTimer = setTimeout(() => el.remove(), 10_000);
}

function play(abbrev) {
  stop();
  flash();
  audio = new Audio(new URL(`audio/horns/${abbrev}.mp3`, document.baseURI).href);
  audio.play().catch(() => {}); // blocked until the reader has tapped a horn toggle once
}

document.addEventListener('click', (e) => {
  const b = e.target.closest('[data-horn-team]');
  if (!b) return;
  const id = b.dataset.hornGame; const a = b.dataset.hornTeam;
  const on = !hornOn(id, a);
  store(KEY(id, a), on ? '1' : null);
  // Tapping is the browser's permission to play sound later: unlock audio now.
  if (on) { const u = new Audio(); u.muted = true; u.play().catch(() => {}); } else stop();
  document.querySelectorAll(`[data-horn-game="${id}"][data-horn-team="${a}"]`).forEach((x) => {
    x.classList.toggle('on', on);
    x.setAttribute('aria-pressed', String(on));
    x.textContent = `🚨 ${a} horn ${on ? 'on' : 'off'}`;
  });
});

const seen = new Map(); // `${gameId}:${abbrev}` -> goals counted so far
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
      if (before != null && n > before && HORNS.has(a) && hornOn(g.id, a)) play(a);
    }
  }
}

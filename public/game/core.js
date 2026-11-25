// Shared helpers for the box score designs.
import { rinkSurface, HOME_PLATE } from './rink.js';

export const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

// Primary and secondary colors per team (approximate, for accents only).
const TEAM_COLORS = {
  ANA: ['#F47A38', '#B9975B'], BOS: ['#FFB81C', '#111111'], BUF: ['#003087', '#FFB81C'], CGY: ['#C8102E', '#F1BE48'],
  CAR: ['#CE1126', '#111111'], CHI: ['#CF0A2C', '#111111'], COL: ['#6F263D', '#236192'], CBJ: ['#002654', '#CE1126'],
  DAL: ['#006847', '#8F8F8C'], DET: ['#CE1126', '#8a8a8a'], EDM: ['#041E42', '#FF4C00'], FLA: ['#C8102E', '#041E42'],
  LAK: ['#111111', '#A2AAAD'], MIN: ['#154734', '#A6192E'], MTL: ['#AF1E2D', '#192168'], NSH: ['#FFB81C', '#041E42'],
  NJD: ['#CE1126', '#111111'], NYI: ['#00539B', '#F47D30'], NYR: ['#0038A8', '#CE1126'], OTT: ['#DA1A32', '#B79257'],
  PHI: ['#F74902', '#111111'], PIT: ['#FCB514', '#111111'], SJS: ['#006D75', '#EA7200'], SEA: ['#001628', '#68A2B9'],
  STL: ['#002F87', '#FCB514'], TBL: ['#002868', '#8a9bb8'], TOR: ['#00205B', '#8a9bb8'], UTA: ['#6CACE4', '#010101'],
  VAN: ['#00205B', '#00843D'], VGK: ['#B4975A', '#A2AAAD'], WSH: ['#C8102E', '#041E42'], WPG: ['#041E42', '#AC162C'],
};

const hex = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
const dist = (a, b) => Math.hypot(...hex(a).map((v, i) => v - hex(b)[i]));

const luminance = (h) => hex(h).reduce((acc, v, i) => acc + [0.2126, 0.7152, 0.0722][i] * (v / 255), 0);
/** Raise a dark color's lightness (keeping its hue) so it reads on a dark page. */
function lift(h, minL = 0.5) {
  const [r, g, b] = hex(h).map((v) => v / 255);
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  let l = (max + min) / 2;
  const d = max - min;
  let s = d === 0 ? 0 : d / (1 - Math.abs(2 * l - 1));
  let hue = 0;
  if (d) hue = max === r ? ((g - b) / d) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
  hue = (hue * 60 + 360) % 360;
  l = Math.max(l, minL);
  s = d === 0 ? 0 : Math.max(s, 0.45);
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const x = c * (1 - Math.abs(((hue / 60) % 2) - 1));
  const m = l - c / 2;
  const [r1, g1, b1] = hue < 60 ? [c, x, 0] : hue < 120 ? [x, c, 0] : hue < 180 ? [0, c, x] : hue < 240 ? [0, x, c] : hue < 300 ? [x, 0, c] : [c, 0, x];
  return `#${[r1, g1, b1].map((v) => Math.round((v + m) * 255).toString(16).padStart(2, '0')).join('')}`;
}

/** Hero panel color: true team color, but near-black ones are raised so they stand off the black page. */
export function panelColor(h) { return luminance(h) < 0.08 ? lift(h, 0.3) : h; }

/** WCAG relative luminance and contrast ratio. */
const relLum = (h) => hex(h).map((v) => v / 255).map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4)).reduce((a, v, i) => a + [0.2126, 0.7152, 0.0722][i] * v, 0);
export function contrastRatio(a, b) {
  const [hi, lo] = [relLum(a), relLum(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}
/**
 * Background for a big team panel (the box score header). A white or silver accent (Utah, Boston, Chicago
 * away) would put white names on white, so those use the team's darkest brand color instead.
 */
export function teamPanel(accent, abbrev) {
  if (contrastRatio(accent, '#ffffff') >= 1.6) return deepen(panelColor(accent), 3);
  const dark = [...(TEAM_COLORS[abbrev] ?? []), ...(TEAM_EXTRA[abbrev] ?? [])].sort((a, b) => luminance(a) - luminance(b))[0];
  return deepen(panelColor(dark ?? '#334155'), 3);
}

/**
 * Darken a color (same hue) until white text on it reaches the given contrast. Every surface that carries
 * white text on a team color goes through this, so a white or silver team color can never put white on white.
 */
export function deepen(h, min = 4.5) {
  let [r, g, b] = hex(h);
  for (let i = 0; i < 40 && contrastRatio(`#${[r, g, b].map((v) => Math.round(v).toString(16).padStart(2, '0')).join('')}`, '#ffffff') < min; i++) [r, g, b] = [r, g, b].map((v) => v * 0.93);
  return `#${[r, g, b].map((v) => Math.round(v).toString(16).padStart(2, '0')).join('')}`;
}

/** Text color for a label sitting on a team color: white, or near-black when the color is light (Utah's white). */
export const onColor = (c) => (contrastRatio(c, '#ffffff') >= 3 ? '#fff' : '#0a0e17');

/** Make a team color readable as text, bars and borders on the dark page (default 4.5:1). */
export function readable(color, bg = '#111827', min = 4.5) {
  for (let l = 0.3; contrastRatio(color, bg) < min && l <= 0.9; l += 0.04) color = lift(color, l);
  return color;
}

/**
 * { away, home } accent colors that are clearly different from each other.
 * With { dark: true }, very dark colors (navy, black) are lifted so they show on a dark page.
 */
const SILVER = '#e4e8ef';
const chromatic = (h) => Math.max(...hex(h)) - Math.min(...hex(h)) >= 60;

// Extra brand colors, tried for the away team after its secondary when both clash with the home team.
const TEAM_EXTRA = {
  SEA: ['#C8102E'], SJS: ['#A2AAAD'], TBL: ['#A2AAAD'], TOR: ['#A2AAAD'], VAN: ['#97999B'], WPG: ['#7B303E'],
  EDM: ['#A2AAAD'], NYR: ['#A2AAAD'], STL: ['#A2AAAD'], BUF: ['#A2AAAD'], CBJ: ['#A4A9AD'], NSH: ['#A2AAAD'],
  DAL: ['#A2AAAD'], MIN: ['#EAAA00', '#DDCBA4'], COL: ['#A2AAAD'], UTA: ['#FFFFFF'], CGY: ['#A2AAAD'],
  CAR: ['#A2AAAD'], CHI: [], DET: [], FLA: ['#B9975B'], MTL: [], NJD: ['#A2AAAD'],
  OTT: ['#A2AAAD'], PHI: ['#A2AAAD'], WSH: ['#A2AAAD'], NYI: ['#A2AAAD'], ANA: ['#89734C'], LAK: ['#FFFFFF'],
  VGK: ['#C8102E'], PIT: ['#CFC493'], BOS: ['#FFFFFF'],
};

/** sRGB hex -> CIELAB (for overall closeness). */
function lab(h) {
  const [r, g, b] = hex(h).map((v) => v / 255).map((v) => (v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
  const f = (t) => (t > 0.008856 ? Math.cbrt(t) : 7.787 * t + 16 / 116);
  const x = f((0.4124 * r + 0.3576 * g + 0.1805 * b) / 0.95047);
  const y = f(0.2126 * r + 0.7152 * g + 0.0722 * b);
  const z = f((0.0193 * r + 0.1192 * g + 0.9505 * b) / 1.08883);
  return [116 * y - 16, 500 * (x - y), 200 * (y - z)];
}
/** Color-wheel hue in degrees (HSL), which groups colors the way people name them: reds, teals, blues. */
function hue(h) {
  const [r, g, b] = hex(h);
  const max = Math.max(r, g, b);
  const d = max - Math.min(r, g, b);
  if (!d) return 0;
  const x = max === r ? ((g - b) / d) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return (x * 60 + 360) % 360;
}
/**
 * True when two on-screen colors read as the same family: any red vs any red, teal vs teal, navy vs royal.
 * Two real colors clash when their hues are within 40 degrees on the color wheel; greys and silvers
 * clash with each other when their lightness is close.
 */
export function colorsClash(c1, c2) {
  const [l1, a1, b1] = lab(c1);
  const [l2, a2, b2] = lab(c2);
  if (Math.hypot(l1 - l2, a1 - a2, b1 - b2) < 30) return true;
  const ch1 = chromatic(c1);
  const ch2 = chromatic(c2);
  if (!ch1 && !ch2) return Math.abs(l1 - l2) < 20;
  if (ch1 !== ch2) return false;
  let dh = Math.abs(hue(c1) - hue(c2));
  if (dh > 180) dh = 360 - dh;
  return dh < 40;
}

export function teamColors(game, { dark = false } = {}) {
  const a = TEAM_COLORS[game.away.abbrev] ?? ['#4b5563', '#9ca3af'];
  const h = TEAM_COLORS[game.home.abbrev] ?? ['#1f2937', '#6b7280'];
  // The home team always keeps its primary color. If the away team's color is in the same family as the
  // home team's (compared after any lifting for the dark page, since that is what is on screen), the away
  // team moves down its list: secondary, then any extra brand colors, then white-silver.
  const fit = (c) => (dark ? readable(c) : c);
  const home = fit(h[0]);
  // A black secondary is skipped: lifted for the dark page it turns into a muddy grey.
  const alts = [a[1], ...(TEAM_EXTRA[game.away.abbrev] ?? [])].filter((c) => c && luminance(c) > 0.08);
  const options = [a[0], ...alts].map(fit);
  let away = options.find((c) => !colorsClash(c, home)) ?? SILVER;
  if (colorsClash(away, home)) away = fit(a[0]);
  return { away, home, awayAlt: a[1], homeAlt: h[1], awayBase: away, homeBase: home };
}

export function logo(team, cls = 'logo', dark = false) {
  // NHL ships a _light and a _dark version of every logo; the dark one is for dark backgrounds.
  const src = dark ? (team.darkLogo ?? team.logo?.replace('_light.', '_dark.')) : team.logo;
  if (!src) return `<span class="${cls} logo-fallback">${esc(team.abbrev)}</span>`;
  return `<img class="${cls}" src="${esc(src)}" alt="${esc(team.abbrev)}" loading="lazy" onerror="const s=Object.assign(document.createElement('span'),{className:'${cls} logo-fallback',textContent:'${esc(team.abbrev)}'});s.dataset.imgSrc=this.getAttribute('src');this.replaceWith(s)">`;
}

const initials = (name) => String(name ?? '').split(/\s+/).map((w) => w[0]).filter(Boolean).slice(0, 2).join('').toUpperCase();

export function headshot(p, cls = 'mug') {
  const fallback = `<span class="${cls} mug-fallback">${esc(initials(p.fullName ?? p.name))}</span>`;
  if (!p.headshot) return fallback;
  // The fallback remembers which image failed, so live refreshes keep it instead of retrying.
  const failed = `<span class="${cls} mug-fallback" data-img-src="${esc(p.headshot)}">${esc(initials(p.fullName ?? p.name))}</span>`;
  return `<img class="${cls}" src="${esc(p.headshot)}" alt="" loading="lazy" onerror="this.outerHTML=this.dataset.fb" data-fb="${esc(failed)}">`;
}

export const signed = (n) => (n > 0 ? `+${n}` : String(n));
/** Faceoffs a skater took: { won, total, text: '6 / 10', pct: '60%' }, or null when they took none (so nothing is shown). */
export function faceoffLine(p) {
  const total = (p.fow ?? 0) + (p.fol ?? 0);
  if (!total) return null;
  return { won: p.fow, total, text: `${p.fow} / ${total}`, pct: `${Math.round((100 * p.fow) / total)}%` };
}

export const pct = (v, d = 3) => (v == null ? '-' : v.toFixed(d).replace(/^0/, ''));

/** The status for a header: a live clock that counts down between refreshes, plus a timeout chip ("BUF Timeout"). */
let statusHook = null; // set by game.js (the live clock lives in ../clock.js, outside these designs)
export function setStatusHtml(fn) { statusHook = fn; }
export function statusHtml(game) {
  return statusHook ? statusHook(game, statusText(game)) : esc(statusText(game));
}

export function statusText(game) {
  if (game.status.state === 'pre') {
    return new Date(game.startTimeUTC).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit', timeZoneName: 'short' });
  }
  return game.status.label;
}

/**
 * Live strength-of-play chip: "5v5", "WPG power play 5v4 · 1:45", "CHI empty net 6v5".
 * game.strength comes from src/strength.js and is only set while the game is live.
 */
export function strengthBadge(game, colors = null, cls = 'strength') {
  const st = game.strength;
  if (!st) return '';
  const side = st.emptyNet ?? st.pp;
  const color = side && colors ? colors[side] : null;
  const what = st.kind === 'pp' ? 'power play' : st.kind === 'empty-net' ? 'empty net' : 'even strength';
  const text = side ? `${game[side].abbrev} ${what}` : what;
  return `<span class="${cls} ${st.kind}"${color ? ` style="--team:${color};--on:${onColor(color)}"` : ''} title="${esc(`${text} ${st.label}`)}"><b>${esc(st.label)}</b>${esc(text)}${st.remaining ? ` <i>${esc(st.remaining)}</i>` : ''}</span>`;
}

export function prettyDate(iso, opts = { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' }) {
  return new Date(`${iso}T12:00:00Z`).toLocaleDateString(undefined, { ...opts, timeZone: 'UTC' });
}

export const skaters = (game, side) => [...game.players[side].forwards, ...game.players[side].defense];
export const goaliesOf = (game, side) => [...game.players[side].goalies].sort((a, b) => b.starter - a.starter || b.toiSeconds - a.toiSeconds);
export const allSkaters = (game) => [
  ...skaters(game, 'away').map((p) => ({ ...p, side: 'away', team: game.away.abbrev })),
  ...skaters(game, 'home').map((p) => ({ ...p, side: 'home', team: game.home.abbrev })),
];
export const allGoalies = (game) => [
  ...goaliesOf(game, 'away').map((p) => ({ ...p, side: 'away', team: game.away.abbrev })),
  ...goaliesOf(game, 'home').map((p) => ({ ...p, side: 'home', team: game.home.abbrev })),
].filter((g) => g.played);

export const sideOf = (game, abbrev) => (abbrev === game.away.abbrev ? 'away' : 'home');

/** Goals and penalties in game order. */
export function timeline(game) {
  const order = (period) => (period === 'SO' ? 99 : period === 'OT' ? 4 : /OT$/.test(period) ? 3 + Number(period.slice(0, -2)) : Number(period));
  const secs = (t) => t.split(':').reduce((m, s) => m * 60 + Number(s), 0);
  const items = [
    ...game.scoring.map((g) => ({ kind: 'goal', ...g })),
    ...game.penalties.map((p) => ({ kind: 'penalty', ...p })),
  ];
  return items.sort((a, b) => order(a.period) - order(b.period) || secs(a.time) - secs(b.time) || (a.kind === 'goal' ? -1 : 1));
}

/** Elapsed game seconds for a period label + clock time. */
export function elapsed(period, time) {
  const n = period === 'OT' ? 4 : /OT$/.test(period) ? 3 + Number(period.slice(0, -2)) : Number(period);
  const [m, s] = time.split(':').map(Number);
  return (n - 1) * 1200 + m * 60 + s;
}

// Videos play in a lightbox using NHL's public Brightcove embed player (same as the scores page).
const BRIGHTCOVE_PLAYER = 'https://players.brightcove.net/6415718365001/EXtG1xJ7H_default/index.html';

export function videoButton(id, title, text, cls = 'vid', href = '') {
  if (!id) return '';
  return `<a class="${cls}" href="${esc(href || `https://www.nhl.com/video/${id}`)}" data-video-id="${esc(id)}" data-video-title="${esc(title)}" title="${esc(title)}" aria-label="${esc(title)}">${text}</a>`;
}

/**
 * Link to NHL.com's goal visualizer (puck and player tracking replay). NHL.com only lets its own
 * sites frame that page (CSP frame-ancestors 'self' *.nhle.com), so it opens in a new tab.
 */
export function visualizerButton(url, title, text, cls = 'viz') {
  if (!url) return '';
  return `<a class="${cls}" href="${esc(url)}" target="_blank" rel="noopener" title="${esc(title)} (opens NHL.com)" aria-label="${esc(title)} (opens NHL.com)">${text}</a>`;
}

export function initVideo(root) {
  const lb = document.querySelector('#lightbox');
  const frame = document.querySelector('#lightbox-frame');
  root.addEventListener('click', (e) => {
    const link = e.target.closest('[data-video-id], [data-embed-url]');
    if (!link || e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return;
    e.preventDefault();
    openLightbox(link);
  });
  // Goal markers on the rink are SVG, not links: open them with Enter too.
  root.addEventListener('keydown', (e) => {
    const link = e.target.closest?.('g[data-video-id], g[data-embed-url]');
    if (link && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); openLightbox(link); }
  });
  function openLightbox(link) {
    const embed = link.dataset.embedUrl;
    const src = embed || `${BRIGHTCOVE_PLAYER}?videoId=${encodeURIComponent(link.dataset.videoId)}&autoplay=true`;
    frame.innerHTML = `<iframe src="${esc(src)}" title="${esc(link.dataset.videoTitle)}" allow="autoplay; fullscreen; encrypted-media; picture-in-picture" allowfullscreen></iframe>`;
    frame.classList.toggle('embed', !!embed);
    document.querySelector('#lightbox-title').textContent = link.dataset.videoTitle;
    document.querySelector('#lightbox-nhl').href = embed || link.getAttribute('href') || `https://www.nhl.com/video/${link.dataset.videoId}`;
    lb.showModal();
  }
  document.querySelector('#lightbox-close').addEventListener('click', () => lb.close());
  lb.addEventListener('click', (e) => e.target === lb && lb.close());
  lb.addEventListener('close', () => { frame.innerHTML = ''; });
}

/** Rink outline as SVG markup in rink feet: x -100..100, y -42.5..42.5. Use viewBox "-100 -42.5 200 85". */
let rinkId = 0;
/** Start rink ids over for each render so a live refresh produces the same ids. */
export function resetRinkIds() { rinkId = 0; }
export function rinkMarkup(home) {
  const id = `rink-clip-${++rinkId}`;
  return `
    <clipPath id="${id}"><rect x="-100" y="-42.5" width="200" height="85" rx="28" ry="28"/></clipPath>
    <g class="rink" clip-path="url(#${id})">
      ${rinkSurface(home)}
      <path class="plate" d="M ${HOME_PLATE.map(([x, y]) => `${-x} ${-y}`).join(' L ')}"/>
      <path class="plate" d="M ${HOME_PLATE.map(([x, y]) => `${x} ${y}`).join(' L ')}"/>
      <path class="plate-split" d="M -79 -11.5 L -79 11.5 M 79 -11.5 L 79 11.5"/>
    </g>
    <rect class="boards" x="-100" y="-42.5" width="200" height="85" rx="28" ry="28"/>`;
}

/** Small "shots by type" glyph for a shot on the rink. */
export function shotMark(s, color, r = 2.2) {
  const y = -s.y;
  const tip = `${s.kind === 'goal' ? 'Goal' : s.kind === 'sog' ? 'Shot on goal' : s.kind === 'miss' ? 'Missed' : 'Blocked'} · ${s.period === 'OT' ? 'OT' : `P${s.period}`} ${s.time}${s.shotType ? ` · ${s.shotType}` : ''}`;
  if (s.kind === 'goal') return `<circle class="shot goal" cx="${s.x}" cy="${y}" r="${r * 1.35}" fill="${color}" stroke="#fff" stroke-width="0.7"><title>${esc(tip)}</title></circle>`;
  if (s.kind === 'sog') return `<circle class="shot sog" cx="${s.x}" cy="${y}" r="${r}" fill="none" stroke="${color}" stroke-width="0.9"><title>${esc(tip)}</title></circle>`;
  if (s.kind === 'miss') return `<g class="shot miss" stroke="${color}" stroke-width="0.7" opacity=".75"><path d="M${s.x - r * 0.7} ${y - r * 0.7} l${r * 1.4} ${r * 1.4} M${s.x + r * 0.7} ${y - r * 0.7} l${-r * 1.4} ${r * 1.4}"/><title>${esc(tip)}</title></g>`;
  return `<rect class="shot block" x="${s.x - r * 0.6}" y="${y - r * 0.6}" width="${r * 1.2}" height="${r * 1.2}" fill="${color}" opacity=".45"><title>${esc(tip)}</title></rect>`;
}

/** Make every table.sortable sortable by clicking its headers (numbers sort high to low first). */
export function makeSortable(root) {
  root.querySelectorAll('table.sortable').forEach((table) => {
    table.querySelectorAll('thead th[data-sort]').forEach((th) => {
      th.tabIndex = 0;
      const sort = () => {
        const col = [...th.parentNode.children].indexOf(th);
        const body = table.tBodies[0];
        const dir = th.dataset.dir === 'desc' ? 'asc' : 'desc';
        table.querySelectorAll('th[data-dir]').forEach((x) => delete x.dataset.dir);
        th.dataset.dir = dir;
        const val = (tr) => {
          const cell = tr.children[col];
          const v = cell?.dataset.v ?? cell?.textContent ?? '';
          const n = Number(v);
          return Number.isNaN(n) || v === '' ? v : n;
        };
        const rows = [...body.rows].sort((a, b) => {
          const x = val(a);
          const y = val(b);
          const c = typeof x === 'number' && typeof y === 'number' ? x - y : String(x).localeCompare(String(y));
          return dir === 'desc' ? -c : c;
        });
        rows.forEach((r) => body.appendChild(r));
      };
      on(th, 'click', sort);
      on(th, 'keydown', (e) => (e.key === 'Enter' || e.key === ' ') && (e.preventDefault(), sort()));
    });
  });
}

/** Wire up [data-tabs] groups: buttons with data-tab="x" show the [data-panel="x"] siblings. */
export function makeTabs(root) {
  root.querySelectorAll('[data-tabs]').forEach((group) => {
    const scope = group.closest('[data-tab-scope]') ?? root;
    const name = group.dataset.tabs;
    on(group, 'click', (e) => {
      const btn = e.target.closest('[data-tab]');
      if (!btn) return;
      group.querySelectorAll('[data-tab]').forEach((b) => b.setAttribute('aria-selected', String(b === btn)));
      scope.querySelectorAll(`[data-panel-group="${name}"]`).forEach((p) => { p.hidden = p.dataset.panel !== btn.dataset.tab; });
    });
  });
}

/**
 * The order for "best player of the game", with every tie-break spelled out. Ratings show one decimal, so two
 * players often share one; then the unrounded game score decides, then points, goals and momentum.
 */
export const RANK_ORDER = [
  ['rating', 'rating', (v) => v.toFixed(1)],
  ['gameScore', 'game score', (v) => `${v > 0 ? '+' : v < 0 ? '−' : ''}${Math.abs(v).toFixed(2)}`],
  ['points', 'points', String],
  ['goals', 'goals', String],
  ['momentum', 'momentum', (v) => v.toFixed(1)],
];
const rankVal = (p, k) => p[k] ?? (k === 'gameScore' || k === 'rating' ? -Infinity : 0);
export function byRating(a, b) {
  for (const [k] of RANK_ORDER) {
    const d = rankVal(b, k) - rankVal(a, k);
    if (d) return d;
  }
  return 0;
}

/** Why p ranks ahead of q when both show the same rating: "ahead on game score (+2.79 to +2.49)", or null. */
export function tieBreak(p, q) {
  if (!p || !q || p.rating?.toFixed(1) !== q.rating?.toFixed(1)) return null;
  for (const [k, label, fmt] of RANK_ORDER.slice(1)) {
    if (rankVal(p, k) !== rankVal(q, k) && p[k] != null && q[k] != null) return { label, p: fmt(p[k]), q: fmt(q[k]) };
  }
  return { label: 'nothing', p: '', q: '' };
}

/** Color for a 3-10 rating: red → amber → green → blue. */
export function ratingColor(r) {
  if (r >= 8.5) return '#2563eb'; // blue stays for everything above, including ratings over 10
  if (r >= 7.3) return '#16a34a';
  if (r >= 6.6) return '#65a30d';
  if (r >= 6.0) return '#ca8a04';
  if (r >= 5.3) return '#ea580c';
  return '#dc2626';
}

export const GS_PARTS = [
  ['scoring', 'Scoring'], ['momentum', 'Momentum'], ['shooting', 'Shots'], ['onIce', 'On-ice +/-'], ['defense', 'Defense'], ['discipline', 'Penalties'], ['faceoffs', 'Faceoffs'],
];

/**
 * Offensive-zone areas (see shotZone in src/gameDetail.js) for the home team's attacking end:
 * [key, label, polygon points [x, y] in rink feet (y > 0 = left side), label anchor [x, y], tall].
 * Home plate (8 ft at the goal line -> 19 ft out -> top of the circles), one side zone on each flank of it down
 * to the goal line, the blue line to the top of the circles split left/right, and behind the net.
 */
const rect = (x1, x2, y1, y2) => [[x1, y1], [x2, y1], [x2, y2], [x1, y2]];
export const ZONES = [
  ['home-plate', 'Home plate', [[89, -8], [69, -19], [54, -19], [54, 19], [69, 19], [89, 8]], [68.5, 0], true],
  ['side-left', 'Left side', [[54, 19], [69, 19], [89, 8], [89, 42.5], [54, 42.5]], [68, 32], true],
  ['side-right', 'Right side', [[54, -19], [69, -19], [89, -8], [89, -42.5], [54, -42.5]], [68, -32], true],
  ['point-left', 'Left point', rect(25, 54, 0, 42.5), [39.5, 21], true],
  ['point-right', 'Right point', rect(25, 54, -42.5, 0), [39.5, -21], true],
  ['behind-net', 'Behind the net', rect(89, 100, -42.5, 42.5), [94.5, 0], false],
  ['outside', 'Outside the zone', null],
];
/** Same rules as inHomePlate in src/momentum.js (rink feet, either end). */
export function inHomePlate(x, y) {
  const ax = Math.abs(x);
  const ay = Math.abs(y);
  if (ax > 89 || ax < 54) return false;
  return ax >= 69 ? ay <= 8 + ((89 - ax) * 11) / 20 : ay <= 19;
}

/** Same rules as shotZone in src/gameDetail.js; lets older saved games use the current zones. */
export function zoneOf(team, x, y) {
  const dx = team === 'home' ? 89 - x : x + 89;
  const side = (team === 'home' ? y : -y) >= 0 ? 'left' : 'right';
  if (dx < 0) return 'behind-net';
  if (dx > 64) return 'outside';
  if (inHomePlate(89 - dx, y)) return 'home-plate';
  if (dx > 35) return `point-${side}`;
  return `side-${side}`;
}

/** Bring shots saved by an older version up to the current zone rules. */
export function upgradeShots(game) {
  for (const s of game?.shots ?? []) {
    s.zone = zoneOf(s.team, s.x, s.y);
    s.homePlate = inHomePlate(s.x, s.y);
  }
  return game;
}

export const zoneName = (key) => ZONES.find((z) => z[0] === key)?.[1] ?? key;

// ---- Live updates without flicker ----------------------------------------------------------
// Listeners added while mounting a design go through on(), tied to the current render, so a
// live refresh can drop them all at once instead of piling up a copy every 5 seconds.
let mountSignal;
export function setMountSignal(signal) { mountSignal = signal; }
export function on(target, type, fn, opts = {}) {
  target?.addEventListener(type, fn, { ...opts, signal: mountSignal });
}

const SVG_NS = 'http://www.w3.org/2000/svg';
function parse(html, svg) {
  const t = document.createElement('template');
  if (!svg) { t.innerHTML = html; return t.content; }
  t.innerHTML = `<svg xmlns="${SVG_NS}">${html}</svg>`;
  const frag = document.createDocumentFragment();
  frag.append(...t.content.firstChild.childNodes);
  return frag;
}

function same(a, b) {
  if (a.nodeType !== b.nodeType) return false;
  if (a.nodeType !== 1) return true;
  return a.tagName === b.tagName && (a.id || '') === (b.id || '');
}

function syncAttrs(from, to) {
  // A folded note the reader opened stays open through live refreshes.
  const keep = from.tagName === 'DETAILS' ? 'open' : null;
  for (const { name } of [...from.attributes]) if (name !== keep && !to.hasAttribute(name)) from.removeAttribute(name);
  for (const { name, value } of [...to.attributes]) if (name !== keep && from.getAttribute(name) !== value) from.setAttribute(name, value);
}

function morphChildren(from, to) {
  const next = [...to.childNodes];
  next.forEach((b, i) => {
    const a = from.childNodes[i];
    if (!a) from.appendChild(b);
    else if (b.nodeName === 'IMG' && a.dataset?.imgSrc && a.dataset.imgSrc === b.getAttribute('src')) return; // image already failed: keep its fallback
    else if (!same(a, b)) from.replaceChild(b, a);
    else if (a.nodeType === 1) morphNode(a, b);
    else if (a.nodeValue !== b.nodeValue) a.nodeValue = b.nodeValue;
  });
  while (from.childNodes.length > next.length) from.lastChild.remove();
}

function morphNode(from, to) {
  syncAttrs(from, to);
  // Containers a design draws itself after mounting (data-js) keep their children; the
  // design's own draw step updates them.
  if (from.hasAttribute('data-js')) return;
  morphChildren(from, to);
}

/** Penalty kind for a game.penalties entry. Older stored games have no kind, so work it out from the type and name. */
export function penKind(x) {
  if (x.kind) return x.kind;
  const key = String(x.infraction ?? '').toLowerCase();
  const type = String(x.type ?? '').toUpperCase();
  if (key.startsWith('fighting')) return 'fight';
  if (type === 'MAT' || key.includes('match')) return 'match';
  if (type === 'GAM' || type === 'GMIS' || key.includes('game misconduct')) return 'game-misconduct';
  if (type === 'MIS' || key === 'misconduct') return 'misconduct';
  if (type === 'MAJ' || (x.minutes === 5 && type !== 'BEN')) return 'major';
  if (type === 'BEN') return 'bench';
  if (type === 'PS') return 'penalty-shot';
  return 'minor';
}

/** A folded explanation: a short title that opens to the full description. */
export function fold(title, html, { cls = '', attrs = '' } = {}) {
  return `<details class="fold ${cls}"${attrs ? ` ${attrs}` : ''}><summary>${title}</summary><div class="fold-body">${html}</div></details>`;
}

/** Update el's contents to match html, changing only what differs (no reloads or flashes). */
export function morphInner(el, html) {
  const svg = el.namespaceURI === SVG_NS && el.tagName.toLowerCase() !== 'foreignobject';
  morphChildren(el, parse(svg ? html : htmlFilter(html), svg));
}

// A page-wide pass over HTML before it goes in (the box score uses it to link player names).
let htmlFilter = (html) => html;
export function setHtmlFilter(fn) { htmlFilter = fn ?? ((html) => html); }
export const filterHtml = (html) => htmlFilter(html);

/** Expected-goals line for a goalie: expected SV%, actual SV%, the difference and goals saved above expected. */
export function goalieXg(g) {
  if (g.gsax == null || g.expectedSavePct == null) return '';
  const sv3 = (n) => n.toFixed(3).replace(/^0/, '');
  const sign = (n, d = 1) => `${n > 0 ? '+' : n < 0 ? '\u2212' : ''}${Math.abs(n).toFixed(d)}`;
  const cls = (n) => (n > 0.0001 ? 'up' : n < -0.0001 ? 'down' : '');
  const actual = g.shotsAgainst ? g.saves / g.shotsAgainst : null;
  return `<div class="g-xg" title="Expected goals are our own estimate from shot distance, angle and type. Not an official NHL stat.">
    <span><b>${sv3(g.expectedSavePct)}</b>xSV%</span>
    <span><b>${actual != null ? sv3(actual) : '-'}</b>SV%</span>
    <span class="${cls(g.savePctAboveExpected)}"><b>${g.savePctAboveExpected != null ? sign(g.savePctAboveExpected * 100) + '%' : '-'}</b>SV% above exp.</span>
    <span class="${cls(g.gsax)}"><b>${sign(g.gsax, 2)}</b>GSAx</span>
  </div>`;
}

/** A team's primary color, lifted to read on the dark pages (player cards). */
export function teamColor(abbrev) {
  return readable((TEAM_COLORS[abbrev] ?? ['#64748b'])[0]);
}

/**
 * Finishing the way a fan reads it, using the season's league rate (goals per expected goal; our xG runs a
 * little low, so it is scaled to real scoring): each skater gets shPct (goals on a goalie per shot on goal),
 * xShPct (what an average NHL shooter scores from the same shots) and gaa (goals vs that average shooter).
 * The team stats swap "Finishing %" (goals per xG, which read like 167% of chances) for Shooting % and
 * Avg shooter %, and expected goals are scaled the same way. Returns a new game object.
 */
export function withFinishRate(game, rate = 1) {
  if (!game?.players) return game;
  const team = { away: { g: 0, xg: 0, sog: 0 }, home: { g: 0, xg: 0, sog: 0 } };
  const players = {};
  for (const side of ['away', 'home']) {
    const p = game.players[side] ?? {};
    const fix = (s) => {
      if (s.xg == null) return s;
      const avg = s.xg * rate;
      const goals = s.xgGoals ?? 0;
      team[side].g += goals;
      team[side].xg += s.xg;
      team[side].sog += s.sog ?? 0;
      return { ...s, avgGoals: avg, gaa: goals - avg, shPct: s.sog ? goals / s.sog : null, xShPct: s.sog ? avg / s.sog : null };
    };
    players[side] = { ...p, forwards: (p.forwards ?? []).map(fix), defense: (p.defense ?? []).map(fix) };
  }
  const pctOf = (n, d) => (d ? (100 * n) / d : null);
  const teamStats = (game.teamStats ?? []).flatMap((s) => {
    if (s.key === 'xg') {
      const a = s.awayNum * rate;
      const h = s.homeNum * rate;
      return [{ ...s, label: 'Expected goals', away: a.toFixed(1), home: h.toFixed(1), awayNum: a, homeNum: h }];
    }
    if (s.key !== 'finPct') return [s];
    const [a, h] = [team.away, team.home];
    const sh = [pctOf(a.g, a.sog), pctOf(h.g, h.sog)];
    const xs = [pctOf(a.xg * rate, a.sog), pctOf(h.xg * rate, h.sog)];
    const txt = (v) => (v == null ? '-' : `${v.toFixed(1)}%`);
    return [
      { key: 'shPct', label: 'Shooting %', away: txt(sh[0]), home: txt(sh[1]), awayNum: sh[0] ?? 0, homeNum: sh[1] ?? 0 },
      { key: 'xShPct', label: 'Avg shooter %', away: txt(xs[0]), home: txt(xs[1]), awayNum: xs[0] ?? 0, homeNum: xs[1] ?? 0 },
    ];
  });
  return { ...game, players, teamStats, finishRate: rate };
}

/** How a game ended, from its line score: 'SO', 'OT' or 'REG'. */
export function gameEnd(game) {
  const labels = (game?.linescore?.periods ?? []).map((p) => String(p.label));
  return labels.includes('SO') ? 'SO' : labels.some((l) => /OT$/.test(l)) ? 'OT' : 'REG';
}

/**
 * A result in Dion's labels: W or L in regulation, OTW / OTL in overtime, SOW / SOL in a shootout.
 * `base` is 'W', 'L' or 'O' (the NHL's goalie decision for an OT or shootout loss).
 */
export function resultLabel(base, end) {
  if (!base) return base;
  if (end !== 'OT' && end !== 'SO') return base === 'O' ? 'OTL' : base;
  return `${end}${base === 'W' ? 'W' : 'L'}`;
}

/** A goalie's decision for this game, e.g. 'SOW' or 'OTL'. */
export const decisionLabel = (game, d) => resultLabel(d, gameEnd(game));

const fmtOdds = (n) => (n > 0 ? `+${n}` : n < 0 ? `−${-n}` : String(n));
/**
 * The book's line next to ours for one game (view from src/spread.js lineView): moneyline, puck line and total on one
 * row, our win chance, expected margin and puck-line cover chance on the next, and whether we agree on the winner.
 */
export function lineCompareHtml(view, game) {
  if (!view) return '';
  const ab = (s) => esc(game[s].abbrev);
  const short = view.book.toUpperCase();
  const pc = (v) => `${Math.round(v * 100)}%`;
  const goals = (g) => `${g < 0 ? '−' : ''}${Math.abs(g).toFixed(1)}`;
  const o = view.ours;
  const hasCover = view.market.cover != null;
  // Every number is for the team the book makes the favorite, so the two rows read straight across.
  const cell = (v, cls = '') => `<span class="ln-c${cls}">${v}</span>`;
  const better = hasCover && o.layer === view.fav ? o.cover - view.market.cover : 0;
  const tape = [
    view.pl ? `${ab(view.pl.fav)} −1.5 (${fmtOdds(view.pl.favPrice)})` : null,
    `ML ${fmtOdds(view.fav === 'away' ? view.ml.a : view.ml.h)}`,
    view.total ? `O/U ${view.total}` : null,
  ].filter(Boolean).join(' · ');
  const title = `${view.name}'s closing prices with its margin removed, against our model, all for ${game[view.fav].abbrev}. The book's margin is what its moneyline implies through our own win-chance curve. Cover: the chance ${game[view.fav].abbrev} wins by 2+ goals (the puck line).`;
  return `<div class="ln${view.agree ? ' agree' : ' differ'}" title="${esc(title)}">
    <div class="ln-g">
      <span class="ln-h ln-fav">${ab(view.fav)}</span>${cell('Win', ' ln-hd')}${cell('Margin', ' ln-hd')}${hasCover ? cell('Cover −1.5', ' ln-hd') : ''}
      <span class="ln-h">${esc(short)}</span>${cell(pc(view.pFav))}${cell(`≈${goals(view.market.gapFav)}`)}${hasCover ? cell(pc(view.market.cover)) : ''}
      <span class="ln-h">US</span>${cell(pc(o.pFav), ' ln-us')}${cell(goals(o.gapFav), ' ln-us')}${hasCover ? cell(pc(o.layer === view.fav ? o.cover : 1 - o.cover), ' ln-us') : ''}
    </div>
    <p class="ln-tape"><span class="ln-flag">${view.agree ? '✓ Agree' : `✗ We pick ${ab(view.ourFav)}`}</span>${esc(short)}: ${tape}</p></div>`;
}

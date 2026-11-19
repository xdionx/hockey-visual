// Shared helpers for the box score designs.

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
  VAN: ['#00205B', '#00843D'], VGK: ['#B4975A', '#333F42'], WSH: ['#C8102E', '#041E42'], WPG: ['#041E42', '#004C97'],
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
  hue *= 60;
  l = Math.max(l, minL);
  s = d === 0 ? 0 : Math.max(s, 0.55);
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const x = c * (1 - Math.abs(((hue / 60) % 2) - 1));
  const m = l - c / 2;
  const [r1, g1, b1] = hue < 60 ? [c, x, 0] : hue < 120 ? [x, c, 0] : hue < 180 ? [0, c, x] : hue < 240 ? [0, x, c] : hue < 300 ? [x, 0, c] : [c, 0, x];
  return `#${[r1, g1, b1].map((v) => Math.round((v + m) * 255).toString(16).padStart(2, '0')).join('')}`;
}

/** Hero panel color: true team color, but near-black ones are raised so they stand off the black page. */
export function panelColor(h) { return luminance(h) < 0.08 ? lift(h, 0.3) : h; }

/**
 * { away, home } accent colors that are distinguishable from each other.
 * With { dark: true }, very dark colors (navy, black) are lifted so they show on a dark page.
 */
export function teamColors(game, { dark = false } = {}) {
  const a = TEAM_COLORS[game.away.abbrev] ?? ['#4b5563', '#9ca3af'];
  const h = TEAM_COLORS[game.home.abbrev] ?? ['#1f2937', '#6b7280'];
  let away = a[0];
  let home = dist(a[0], h[0]) < 90 ? h[1] : h[0];
  if (dark) {
    const up = (c) => (luminance(c) < 0.12 ? lift(c) : c);
    away = up(away);
    home = up(home);
    if (dist(away, home) < 90) home = up(h[1]);
  }
  return { away, home, awayAlt: a[1], homeAlt: h[1], awayBase: a[0], homeBase: dist(a[0], h[0]) < 90 ? h[1] : h[0] };
}

export function logo(team, cls = 'logo', dark = false) {
  const src = dark && team.darkLogo ? team.darkLogo : team.logo;
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
export const pct = (v, d = 3) => (v == null ? '-' : v.toFixed(d).replace(/^0/, ''));

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
  return `<span class="${cls} ${st.kind}"${color ? ` style="--team:${color}"` : ''} title="${esc(`${text} ${st.label}`)}"><b>${esc(st.label)}</b>${esc(text)}${st.remaining ? ` <i>${esc(st.remaining)}</i>` : ''}</span>`;
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
export function rinkMarkup() {
  const id = `rink-clip-${++rinkId}`;
  const circles = [-69, 69].flatMap((x) => [-22, 22].map((y) => `<circle class="circle" cx="${x}" cy="${y}" r="15"/><circle class="dot" cx="${x}" cy="${y}" r="1"/>`)).join('');
  const dots = [-20, 20].flatMap((x) => [-22, 22].map((y) => `<circle class="dot" cx="${x}" cy="${y}" r="1"/>`)).join('');
  return `
    <clipPath id="${id}"><rect x="-100" y="-42.5" width="200" height="85" rx="28" ry="28"/></clipPath>
    <g class="rink" clip-path="url(#${id})">
      <rect class="ice" x="-100" y="-42.5" width="200" height="85"/>
      <line class="red" x1="0" y1="-42.5" x2="0" y2="42.5"/>
      <line class="blue" x1="-25" y1="-42.5" x2="-25" y2="42.5"/>
      <line class="blue" x1="25" y1="-42.5" x2="25" y2="42.5"/>
      <line class="goal-line" x1="-89" y1="-42.5" x2="-89" y2="42.5"/>
      <line class="goal-line" x1="89" y1="-42.5" x2="89" y2="42.5"/>
      <circle class="circle" cx="0" cy="0" r="15"/>
      ${circles}${dots}
      <path class="crease" d="M -89 -4 L -85 -4 A 4 4 0 0 1 -85 4 L -89 4 Z"/>
      <path class="crease" d="M 89 -4 L 85 -4 A 4 4 0 0 0 85 4 L 89 4 Z"/>
      <rect class="net" x="-92" y="-3" width="3" height="6"/>
      <rect class="net" x="89" y="-3" width="3" height="6"/>
      <path class="plate" d="M -89 -4 L -69 -22 L -54 -22 L -54 22 L -69 22 L -89 4"/>
      <path class="plate" d="M 89 -4 L 69 -22 L 54 -22 L 54 22 L 69 22 L 89 4"/>
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

/** Color for a 3-10 rating: red → amber → green → blue. */
export function ratingColor(r) {
  if (r >= 8.5) return '#2563eb';
  if (r >= 7.3) return '#16a34a';
  if (r >= 6.6) return '#65a30d';
  if (r >= 6.0) return '#ca8a04';
  if (r >= 5.3) return '#ea580c';
  return '#dc2626';
}

export const GS_PARTS = [
  ['scoring', 'Scoring'], ['momentum', 'Momentum'], ['shooting', 'Shots'], ['onIce', 'On-ice +/-'], ['defense', 'Blocks'], ['discipline', 'Penalties'], ['faceoffs', 'Faceoffs'],
];

/**
 * Offensive-zone areas (see shotZone in src/gameDetail.js) for the home team's attacking end:
 * [key, label, polygon points [x, y] in rink feet (y > 0 = left side), label anchor [x, y], tall].
 * Home plate (posts -> faceoff dots -> top of the circles), one side zone on each flank of it down
 * to the goal line, the blue line to the top of the circles split left/right, and behind the net.
 */
const rect = (x1, x2, y1, y2) => [[x1, y1], [x2, y1], [x2, y2], [x1, y2]];
export const ZONES = [
  ['home-plate', 'Home plate', [[89, -4], [69, -22], [54, -22], [54, 22], [69, 22], [89, 4]], [68.5, 0], true],
  ['side-left', 'Left side', [[54, 22], [69, 22], [89, 4], [89, 42.5], [54, 42.5]], [68, 32], true],
  ['side-right', 'Right side', [[54, -22], [69, -22], [89, -4], [89, -42.5], [54, -42.5]], [68, -32], true],
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
  return ax >= 69 ? ay <= 4 + ((89 - ax) * 18) / 20 : ay <= 22;
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
  for (const { name } of [...from.attributes]) if (!to.hasAttribute(name)) from.removeAttribute(name);
  for (const { name, value } of [...to.attributes]) if (from.getAttribute(name) !== value) from.setAttribute(name, value);
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

/** Update el's contents to match html, changing only what differs (no reloads or flashes). */
export function morphInner(el, html) {
  morphChildren(el, parse(html, el.namespaceURI === SVG_NS && el.tagName.toLowerCase() !== 'foreignobject'));
}

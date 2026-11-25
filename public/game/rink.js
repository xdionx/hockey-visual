// Official NHL rink surface (2026-27 Official Rules, "Official Dimensions of Rink Surface", Rink and Goal Crease detail,
// Face-Off Configuration). Rink feet, origin at center ice: x -100..100 (end boards), y -42.5..42.5 (sideboards).
// Every drawing (full rink, half-rink shot maps) is built from this one file so the dimensions live in one place.
export const RINK = {
  halfLength: 100, halfWidth: 42.5, corner: 28,
  goalLine: 89,            // 11 ft from the end boards
  blueInner: 25,           // neutral-zone edge of the blue line: 75 ft from the end boards, 50 ft between the two lines
  blueWidth: 1, redWidth: 1, thin: 2 / 12,   // blue and center lines are 12 in wide, every other line 2 in
  centerRadius: 15, centerDot: 0.5,
  faceoff: { x: 69, y: 22, radius: 15, dot: 1 },  // end-zone circles: 20 ft from the goal line, 44 ft apart, 30 ft across
  neutralDot: { x: 20, y: 22, dot: 1 },           // 5 ft outside each blue line
  hash: { y: 2.9, length: 2 },                    // 2 ft marks, 5 ft 7 in apart, outside each circle
  lMark: { gap: 2, arm: 3 + 10 / 12, stem: 3, half: 0.9 }, // face-off configuration around each end-zone dot
  crease: { halfWidth: 4, depth: 4.5, round: 1.5 },        // 8 ft wide on the goal line, 4 ft 6 in deep
  net: { halfWidth: 3, depth: 40 / 12 },                   // 6 ft wide posts, 40 in deep
  trapezoid: { goalLineHalf: 11, boardsHalf: 14 },         // 22 ft at the goal line, 28 ft at the end boards
};

/** Home plate (8 ft either side of the net at the goal line -> 19 ft out -> top of the circles). Kept as data so it can be resized without touching the drawing. */
export const HOME_PLATE = [[89, -8], [69, -19], [54, -19], [54, 19], [69, 19], [89, 8]];

const f = (n) => +n.toFixed(3);

/** One end of the ice, drawn at the +x end. Mirror it with a 180 degree rotation for the other end. */
export function endZone() {
  const { goalLine: g, faceoff: o, crease: c, net: n, trapezoid: t, hash: h, lMark: l } = RINK;
  const circles = [-o.y, o.y].map((y) => `<circle class="circle" cx="${o.x}" cy="${y}" r="${o.radius}"/><circle class="dot" cx="${o.x}" cy="${y}" r="${o.dot}"/>`).join('');
  const hashes = [-o.y, o.y].flatMap((y) => [-1, 1].flatMap((sx) => [-1, 1].map((sy) => {
    const x0 = o.x + sx * o.radius, x1 = o.x + sx * (o.radius + h.length);
    return `<line class="hash" x1="${x0}" x2="${x1}" y1="${y + sy * h.y}" y2="${y + sy * h.y}"/>`;
  }))).join('');
  const marks = [-o.y, o.y].flatMap((y) => [-1, 1].flatMap((sx) => [-1, 1].map((sy) => {
    const cx = o.x + sx * l.gap, cy = y + sy * l.half;
    return `<path class="lmark" d="M ${f(cx + sx * l.arm)} ${f(cy)} L ${f(cx)} ${f(cy)} L ${f(cx)} ${f(cy + sy * l.stem)}"/>`;
  }))).join('');
  const dome = `M ${g} ${-c.halfWidth} L ${g - c.depth + c.round} ${-c.halfWidth} A ${c.round} ${c.halfWidth} 0 0 0 ${g - c.depth + c.round} ${c.halfWidth} L ${g} ${c.halfWidth} Z`;
  return `<line class="goal-line" x1="${g}" x2="${g}" y1="-42.5" y2="42.5"/>
    <path class="trapezoid" d="M ${g} ${-t.goalLineHalf} L 100 ${-t.boardsHalf} M ${g} ${t.goalLineHalf} L 100 ${t.boardsHalf}"/>
    ${circles}${hashes}${marks}
    <path class="crease" d="${dome}"/>
    <rect class="net" x="${g}" y="${-n.halfWidth}" width="${f(n.depth)}" height="${n.halfWidth * 2}" rx=".8"/>`;
}

/** Everything inside the boards for the full rink. `home` ({abbrev, logo, color}) puts that team's center ice on the circle. */
export function rinkSurface(home) {
  if (home?.ice && !home.drawn) return fullIce(home.ice);
  const r = RINK;
  const nz = [-r.neutralDot.x, r.neutralDot.x].flatMap((x) => [-r.neutralDot.y, r.neutralDot.y].map((y) => `<circle class="dot" cx="${x}" cy="${y}" r="${r.neutralDot.dot}"/>`)).join('');
  const bc = r.blueInner + r.blueWidth / 2;
  return `<rect class="ice" x="-100" y="-42.5" width="200" height="85"/>
    <line class="red" x1="0" y1="-42.5" x2="0" y2="42.5"/>
    <line class="blue" x1="${-bc}" y1="-42.5" x2="${-bc}" y2="42.5"/><line class="blue" x1="${bc}" y1="-42.5" x2="${bc}" y2="42.5"/>
    <circle class="circle" cx="0" cy="0" r="${r.centerRadius}"/><circle class="dot" cx="0" cy="0" r="${r.centerDot}"/>${nz}
    ${centerIce(home)}
    <g>${endZone()}</g><g transform="rotate(180)">${endZone()}</g>`;
}

/** Teams with their full 2026-27 ice graphic in public/centerice/<ABBREV>.jpg (theFaceoff.net artwork, cropped to the boards). */
export const FULL_ICE = new Set(['ANA', 'BOS', 'BUF', 'CAR', 'CBJ', 'CGY', 'CHI', 'COL', 'DAL', 'DET', 'EDM', 'FLA', 'LAK', 'MIN', 'MTL', 'NJD', 'NSH', 'NYI', 'NYR', 'OTT', 'PHI', 'PIT', 'SEA', 'SJS', 'STL', 'TBL', 'TOR', 'UTA', 'VAN', 'VGK', 'WPG', 'WSH']);
/** One-off ice for special games, matched on date and teams (key = file name in public/centerice/). */
const SPECIAL_ICE = [
  { key: 'HERITAGE-2026', date: '2026-10-25', home: 'WPG', away: 'MTL' },
  { key: 'GLOBAL-FINLAND-2026', date: '2026-11-12', home: 'SEA', away: 'CAR' },  // Global Series, Veikkaus Arena, Tampere
  { key: 'GLOBAL-FINLAND-2026', date: '2026-11-14', home: 'CAR', away: 'SEA' },
];

/** Which ice graphic to use for a game: its special ice, else the home team's, else none. */
export function iceKey(game) {
  const sp = SPECIAL_ICE.find((x) => x.home === game.home.abbrev && x.away === game.away.abbrev && String(game.gameDate ?? '').startsWith(x.date));
  if (sp) return sp.key;
  return FULL_ICE.has(game.home.abbrev) ? game.home.abbrev : null;
}

export const ICE_CREDIT = 'Ice artwork \u00a9 theFaceoff.net';

/** The home team's whole surface as the shot map background; it replaces the drawn lines (same 200 x 85 ft frame). */
export function fullIce(abbrev) {
  return `<image href="centerice/${abbrev}.jpg" x="-100" y="-42.5" width="200" height="85" preserveAspectRatio="none"/>`;
}

/** Center ice for the home team when there is no full graphic: a team-color ring and logo stand-in. */
export function centerIce(home) {
  if (!home) return '';
  const r = RINK.centerRadius;
  const color = home.color ?? '#64748b';
  const logo = home.logo ? `<image href="${home.logo}" x="${-r + 2.5}" y="${-r + 2.5}" width="${2 * r - 5}" height="${2 * r - 5}" preserveAspectRatio="xMidYMid meet"/>` : '';
  return `<g class="center-ice"><circle cx="0" cy="0" r="${r}" fill="${color}" opacity=".16"/><circle cx="0" cy="0" r="${r - 1.2}" fill="none" stroke="${color}" stroke-width="1.6" opacity=".8"/>${logo}</g>`;
}

/** Same end-zone detail for a half-rink map (net at the bottom, blue line at the top) drawn at S pixels per foot. */
export function halfRinkLines(S) {
  return `<g transform="matrix(0 ${S} ${S} 0 ${f(RINK.halfWidth * S)} ${-RINK.blueInner * S})" class="rink-half">${endZone()}</g>`;
}

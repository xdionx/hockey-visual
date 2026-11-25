// Skater card v2: the skater's page grouped by what belongs together (summary and spider, scoring with goal and
// assist clips, driving play, shooting, defense, discipline, faceoffs, NHL rank, last 10 games). Every ranked stat
// shows its NHL rank, is tinted in the top / bottom 10%, and explains itself on hover. Pure numbers: ../src/skaterCard.js.
import { esc, videoButton } from '../game/core.js';
import { HOME_PLATE, RINK, halfRinkLines } from '../game/rink.js';
import { fmt } from './store.js';
import { rankBoxes } from './quick.js';
import { getData } from '../data.js';
import { gameObj } from '../src/seasonStats.js';
import { tierOf } from '../src/impact.js';
import { METRIC, ofN, teamOrd, hoverText } from '../src/skaterCard.js';

const UP = '#4ade80';
const DOWN = '#f87171';
const BLUE = '#38bdf8';
const sg = (n, d = 1) => fmt.signed(n, d);
const day = (d) => new Date(`${d}T12:00:00Z`).toLocaleDateString(undefined, { month: 'short', day: 'numeric', timeZone: 'UTC' });
const FMT = {
  signed: (v) => sg(v, 1), signed2: (v) => sg(v, 2), dec: (v) => v.toFixed(1), dec1: (v) => v.toFixed(1), dec2: (v) => v.toFixed(2), pct: (v) => fmt.pct(v, 1),
};
const fv = (x) => FMT[x.kind] ?? FMT.dec;
const sec = (id, title, sub, html) => `<section class="pc-card gc-sec" id="${id}"><h2>${title}${sub ? ` <small>${sub}</small>` : ''}</h2>${html}</section>`;
const fig = (inner) => `<div class="gc-fig">${inner}</div>`;
const none = () => '<p class="pq-note">No game-by-game data for this view.</p>';
const rkb = (t) => (t ? `<span class="rkb">${t}</span>` : '');
const wait = () => '<p class="pq-note gc-wait">Loading every game…</p>';

export const NAV = [['sk-sum', 'Summary'], ['sk-rate', 'Ratings'], ['sk-sco', 'Scoring'], ['sk-drv', 'Driving play'], ['sk-sho', 'Shooting'], ['sk-def', 'Defense'], ['sk-dis', 'Discipline'], ['sk-lg', 'NHL rank'], ['sk-hist', 'History'], ['sk-last', 'Last 10 games']];
export const navHtml = () => `<nav class="gc-nav" aria-label="Sections">${NAV.map(([id, l]) => `<a href="#${id}">${l}</a>`).join('')}</nav>`;

/** A ranked tile: value, label, "15th NHL" line, tinted in the top / bottom 10%, hover explains. */
function rtile(x, value, label, sub = '') {
  if (!x) return `<div class="pq-t pq-ours"><span class="pq-v">${value}</span><span class="pq-k">${label}</span>${sub ? `<span class="pq-s">${sub}</span>` : ''}</div>`;
  const tone = x.ctx ? '' : x.pct >= 0.9 ? ' rk-top' : x.pct <= 0.1 ? ' rk-low' : '';
  return `<div class="pq-t pq-ours${tone}" title="${esc(hoverText(x, fv(x)))}" tabindex="0"><span class="pq-v">${value}</span><span class="pq-k">${label}</span><span class="pq-s">${rkb(ofN(x.rank))}${x.teamRank ? ` ${rkb(teamOrd(x.team, x.teamRank))}` : ''}${sub ? ` <i>${sub}</i>` : ''}</span></div>`;
}
const TIPS = {
  G: 'Goals scored.', A: 'Assists: primary and secondary.', P: 'Points: goals plus assists.', PIM: 'Penalty minutes.',
  Playmaking: 'Three quarters of the assists above what an average player at his position gets in the same games.',
  'MOM +/GP': 'Momentum he creates per game: the positive swings in our play-by-play model.',
  'MOM −/GP': 'Momentum he gives up per game: the negative swings in our play-by-play model.',
  'Above avg games': 'Share of his games rated above average for the position (momentum plus finishing, in goals). Below-average share is shown underneath.',
  Shots: 'Shots on goal.', 'S%': 'Shooting percentage on shots that reached the goalie, against what an average shooter would shoot on the same shots.',
  Attempts: 'All shot attempts he took: shots, misses and blocks (SAT).',
  'Attempts against /60': 'Shot attempts the other team takes per 60 minutes while he is on the ice (all strengths). Lower is better.',
  'On-ice shot share': 'His team\'s share of all shot attempts while he is on the ice.',
  Blocks: 'Shots he blocked. Context only: not a model-validated skill.', Takeaways: 'Takeaways. Context only: rinks count them differently.',
  'TOI/GP': 'Average ice time per game.', Drawn: 'Penalties he drew.', Taken: 'Penalties he took.', 'Takeaways /GP': 'Takeaways per game. Context only.',
};
const plain = (label, value, sub = '', tip = '') => `<div class="pq-t" tabindex="0"${(tip || TIPS[label]) ? ` title="${esc(`${label}\n${tip || TIPS[label]}\nValue¦${String(value).replace(/<[^>]*>/g, '')}`)}"` : ''}><span class="pq-v">${value}</span><span class="pq-k">${label}</span>${sub ? `<span class="pq-s">${sub}</span>` : ''}</div>`;

function spider(points) {
  if (points.length < 3) return '';
  const S = 320, c = S / 2, R = 108;
  const ang = (i) => -Math.PI / 2 + (i * 2 * Math.PI) / points.length;
  const pt = (i, f) => [c + Math.cos(ang(i)) * R * f, c + Math.sin(ang(i)) * R * f];
  const poly = (f) => points.map((_, i) => pt(i, f).join(',')).join(' ');
  const shape = points.map((q, i) => pt(i, Math.max(0.03, q.pct / 100)).join(',')).join(' ');
  const avg = Math.round(points.reduce((a, q) => a + q.pct, 0) / points.length);
  return `<figure class="gc-radar"><svg viewBox="-40 0 ${S + 80} ${S}" role="img" aria-label="Offense spider graph of NHL percentiles: ${points.map((q) => `${q.label} ${q.pct}`).join(', ')}">
    ${[0.25, 0.5, 0.75, 1].map((f) => `<polygon points="${poly(f)}" fill="none" stroke="${f === 0.5 ? '#64748b' : '#26344f'}" stroke-width="${f === 0.5 ? 1.5 : 1}" ${f === 0.5 ? 'stroke-dasharray="4 3"' : ''}/>`).join('')}
    ${points.map((_, i) => `<line x1="${c}" y1="${c}" x2="${pt(i, 1)[0]}" y2="${pt(i, 1)[1]}" stroke="#26344f"/>`).join('')}
    <polygon points="${shape}" fill="${BLUE}" fill-opacity=".28" stroke="${BLUE}" stroke-width="2.4" stroke-linejoin="round"/>
    ${points.map((q, i) => { const [x, y] = pt(i, Math.max(0.03, q.pct / 100)); const [lx, ly] = pt(i, 1.2); const a = Math.cos(ang(i)); const anchor = Math.abs(a) < 0.2 ? 'middle' : a > 0 ? 'start' : 'end'; return `<circle cx="${x}" cy="${y}" r="4.5" fill="${q.pct >= 50 ? UP : DOWN}" stroke="#0b1220" stroke-width="1.5"><title>${esc(q.label)}: ${esc(FMT[METRIC[q.key].kind](q.value))}, ${ofN(q.rank)} (${q.pct}th percentile)</title></circle><text class="gc-rl" x="${lx}" y="${ly - 2}" text-anchor="${anchor}">${esc(q.label)}</text><text class="gc-rv" x="${lx}" y="${ly + 10}" text-anchor="${anchor}">${q.pct}</text>`; }).join('')}
  </svg><figcaption>Offense: percentile vs NHL skaters, 100 = best. Dashed ring = NHL median. <b>Average ${avg}</b></figcaption></figure>`;
}

const bars = (pts) => (pts.length ? `<div class="gc-bars" aria-label="NHL percentile">${pts.map((q) => `<div title="${esc(q.label)}: ${esc(FMT[METRIC[q.key].kind](q.value))}, ${ofN(q.rank)}"><span>${esc(q.label)}</span><i><b style="width:${Math.max(2, q.pct)}%;background:${q.pct >= 50 ? UP : DOWN}"></b></i><em>${q.pct}</em></div>`).join('')}</div>` : '');

const chip = (x, good) => `<span class="sk-chip ${good ? 'up' : x.ugly ? 'ugly' : 'down'}" title="${esc(hoverText(x, fv(x)))}">${esc(x.label)} <b>${fv(x)(x.value)}</b> ${rkb(ofN(x.rank))}</span>`;

function summary(card) {
  const { summary: s, m } = card;
  const tierLine = (name, pct, tier, det) => `<div class="sk-row"><b>${name}</b> <span class="sk-tier ${pct == null ? '' : pct >= 0.7 ? 'up' : pct < 0.4 ? 'down' : ''}">${tier ?? 'not enough ice time yet'}</span>${det ? ` <span class="sk-det">${det}</span>` : ''}</div>`;
  const offDet = ['scoring', 'play'].filter((k) => m[k]).map((k) => `${m[k].label.toLowerCase()} ${ofN(m[k].rank)}`).join(', ');
  const defDet = m.def ? (card.split ? `defending ${sg(m.def.value)} goals/82 ${ofN(m.def.rank)}${m.puck ? `, puck control ${ofN(m.puck.rank)}` : ''}` : `${sg(m.def.value)} goals prevented at 5v5, ${ofN(m.def.rank)} among ${card.group === 'D' ? 'defensemen' : 'forwards'}`) : '';
  const flags = card.row ? '' : '';
  return `<div class="gc-verdict ${s.headline.startsWith('Struggling') ? 'bad' : ''}"><b>${esc(s.headline)}.</b>
    ${tierLine('Offense', s.off, s.offTier, offDet)}${tierLine(card.split ? 'Defending' : 'Defense', s.def, s.defTier, defDet)}
    ${card.strengths.length ? `<div class="sk-sub">Strengths</div><div class="gc-chips">${card.strengths.map((x) => chip(x, true)).join('')}</div>` : ''}
    ${card.weak.length ? `<div class="sk-sub">Weak spots</div><div class="gc-chips">${card.weak.map((x) => chip(x, false)).join('')}</div>` : ''}${flags}</div>`;
}

// ── per-game charts ──
function gameBars(games, get, label, color) {
  if (!games) return wait();
  if (!games.length) return none();
  const Wd = 560, Hh = 170, pad = 30, mid = (Hh - 24) / 2;
  const bw = (Wd - pad - 10) / games.length;
  const mx = Math.max(1, ...games.map((g) => Math.abs(get(g))));
  return `<svg viewBox="0 0 ${Wd} ${Hh}" role="img" aria-label="${esc(label)} by game"><line class="gc-zero" x1="${pad}" x2="${Wd - 6}" y1="${mid}" y2="${mid}"/>${games.map((g, i) => {
    const v = get(g), h = Math.max(1, (Math.abs(v) / mx) * (mid - 8));
    return `<rect x="${pad + i * bw + 1}" y="${v >= 0 ? mid - h : mid}" width="${Math.max(2, bw - 2)}" height="${h}" rx="2" fill="${color(g, v)}"><title>Game ${g.n} ${g.home ? 'vs' : '@'} ${esc(g.opp)}: ${esc(label)} ${sg(v, 1)}</title></rect>`;
  }).join('')}<text x="${pad}" y="${Hh - 4}">first game</text><text x="${Wd - 60}" y="${Hh - 4}">latest</text></svg>`;
}
const pointsBars = (games) => {
  if (!games) return wait();
  if (!games.length) return none();
  const Wd = 560, Hh = 150, pad = 30, bw = (Wd - pad - 10) / games.length;
  const mx = Math.max(2, ...games.map((g) => g.g + g.a));
  return `<svg viewBox="0 0 ${Wd} ${Hh}" role="img" aria-label="Goals and assists by game">${games.map((g, i) => {
    const x = pad + i * bw + 1, u = (Hh - 30) / mx, hg = g.g * u, ha = g.a * u;
    return `<g><title>Game ${g.n} ${g.home ? 'vs' : '@'} ${esc(g.opp)}: ${g.g} G, ${g.a} A</title><rect x="${x}" y="${Hh - 20 - hg}" width="${Math.max(2, bw - 2)}" height="${hg}" fill="${UP}"/><rect x="${x}" y="${Hh - 20 - hg - ha}" width="${Math.max(2, bw - 2)}" height="${ha}" fill="${BLUE}"/></g>`;
  }).join('')}<line class="gc-zero" x1="${pad}" x2="${Wd - 6}" y1="${Hh - 20}" y2="${Hh - 20}"/><text x="${pad}" y="${Hh - 4}">goals green, assists blue</text></svg>`;
};


/** Rating by game: bars from 6.0 (an average night), green above, red below. */
function ratingBars(games, loaded) {
  const rated = (games ?? []).filter((g) => g.rating != null);
  if (!games) return wait();
  if (!rated.length) return loaded ? '<p class="pq-note">Game ratings are not available for these games yet.</p>' : wait();
  const Wd = 560, Hh = 170, pad = 30, base = 6, lo = Math.min(3, ...rated.map((g) => g.rating)), hi = Math.max(9, ...rated.map((g) => g.rating));
  const Y = (v) => 10 + ((hi - v) * (Hh - 34)) / (hi - lo);
  const bw = (Wd - pad - 10) / games.length;
  return `<svg viewBox="0 0 ${Wd} ${Hh}" role="img" aria-label="Game rating by game"><line class="gc-zero" x1="${pad}" x2="${Wd - 6}" y1="${Y(base)}" y2="${Y(base)}"/><text x="2" y="${Y(base) + 3}">6.0</text>
    ${games.map((g, i) => (g.rating == null ? '' : `<rect x="${pad + i * bw + 1}" y="${Math.min(Y(g.rating), Y(base))}" width="${Math.max(2, bw - 2)}" height="${Math.max(1.5, Math.abs(Y(g.rating) - Y(base)))}" rx="2" fill="${g.rating >= base ? UP : DOWN}"><title>Game ${g.n} ${g.home ? 'vs' : '@'} ${esc(g.opp)}: rating ${g.rating.toFixed(1)}</title></rect>`)).join('')}
    <text x="${pad}" y="${Hh - 4}">first game</text><text x="${Wd - 40}" y="${Hh - 4}">latest</text></svg>`;
}

/** Running scoring vs average across the season: goals above an average shooter plus 3/4 of assists above average, game by game. */
function runningChart(games, rate, base) {
  if (!games) return wait();
  if (!games.length) return none();
  let c = 0;
  const pts = games.map((g) => (c += (g.g - (g.line.xg ?? 0) * rate) + 0.75 * (g.a - base)));
  const Wd = 560, Hh = 170, pad = 34;
  const mn = Math.min(0, ...pts) - 0.5, mx = Math.max(0, ...pts) + 0.5;
  const X = (i) => pad + (i * (Wd - pad - 10)) / Math.max(1, pts.length - 1);
  const Y = (v) => 10 + ((mx - v) * (Hh - 34)) / (mx - mn);
  return `<svg viewBox="0 0 ${Wd} ${Hh}" role="img" aria-label="Running scoring vs average"><line class="gc-zero" x1="${pad}" x2="${Wd - 6}" y1="${Y(0)}" y2="${Y(0)}"/>
    <polyline fill="none" stroke="${BLUE}" stroke-width="2.4" points="${pts.map((v, i) => `${X(i)},${Y(v)}`).join(' ')}"/>
    ${pts.map((v, i) => `<circle cx="${X(i)}" cy="${Y(v)}" r="3" fill="${v >= 0 ? UP : DOWN}"><title>Game ${games[i].n} ${games[i].home ? 'vs' : '@'} ${esc(games[i].opp)}: running total ${sg(v)}</title></circle>`).join('')}
    <text x="4" y="${Y(0) + 3}">0</text><text class="gc-v" x="${Math.min(X(pts.length - 1), Wd - 40)}" y="${Y(pts.at(-1)) - 8}">${sg(pts.at(-1))}</text></svg>`;
}

/** Half rink, net at the bottom, every attempt he took; goals gold, shots on goal blue, misses and blocks hollow. */
function shotMap(shots) {
  if (!shots) return wait();
  if (!shots.length) return '<p class="pq-note">No shots yet.</p>';
  const S = 6.2, w = 85 * S, h = 75 * S;
  const P = (x, y) => { const f = x < 0 ? -1 : 1; return [(y * f + 42.5) * S, (Math.abs(x) - 25) * S]; };
  const poly = (pts) => pts.map(([x, y]) => P(x, y).join(',')).join(' ');
  const plate = HOME_PLATE;
  const [px, py] = P(61, 0);
  const dot = (q) => {
    const [a, b] = P(q.x, q.y);
    const t = `<title>${q.kind === 'goal' ? 'Goal' : q.kind === 'sog' ? 'Shot on goal' : q.kind === 'miss' ? 'Missed' : 'Blocked'}${q.type ? `, ${esc(q.type)}` : ''} · ${day(q.date)} ${q.home ? 'vs' : '@'} ${esc(q.opp)} · ${esc(q.period)} ${esc(q.time)}</title>`;
    if (q.kind === 'goal') return `<circle cx="${a}" cy="${b}" r="6" fill="#fbbf24" stroke="#fff" stroke-width="1.2">${t}</circle>`;
    if (q.kind === 'sog') return `<circle cx="${a}" cy="${b}" r="4.2" fill="${BLUE}" opacity=".7">${t}</circle>`;
    return `<circle cx="${a}" cy="${b}" r="3.6" fill="none" stroke="#8b95a7" stroke-width="1.3" opacity=".8">${t}</circle>`;
  };
  const order = { block: 0, miss: 0, sog: 1, goal: 2 };
  const n = (k) => shots.filter((q) => q.kind === k).length;
  return `<svg class="gc-map" viewBox="-6 -6 ${w + 12} ${h + 12}" role="img" aria-label="Where his shot attempts came from">
    <path d="M 0 0 H ${w} V ${h - RINK.corner * S} A ${RINK.corner * S} ${RINK.corner * S} 0 0 1 ${w - RINK.corner * S} ${h} H ${RINK.corner * S} A ${RINK.corner * S} ${RINK.corner * S} 0 0 1 0 ${h - RINK.corner * S} Z" fill="#0b1626" stroke="#2a3b58"/><line x1="0" x2="${w}" y1="0" y2="0" stroke="#3b6fd6" stroke-width="4"/>${halfRinkLines(S)}
    <polygon points="${poly(plate)}" fill="${BLUE}" opacity=".1" stroke="${BLUE}" stroke-width="1.5" stroke-dasharray="5 4"/>
    <text x="${px}" y="${py}" text-anchor="middle" style="fill:${BLUE};font-size:13px;font-weight:700">HOME PLATE</text>${shots.slice().sort((a, b) => order[a.kind] - order[b.kind]).map(dot).join('')}</svg>
    <p class="pq-note">${n('goal')} goals (gold), ${n('sog')} shots on goal (blue), ${n('miss')} missed and ${n('block')} blocked (hollow). Dashed shape = the home plate, where most goals come from.</p>`;
}

/** Points per game against goals prevented for every skater at his position group; he is the gold dot. */
function twoWay(card) {
  const pool = card.pool;
  if (pool.length < 5) return '';
  const Wd = 440, Hh = 260, pad = 30;
  const xs = pool.map((q) => q.x), ys = pool.map((q) => q.y);
  const x0 = Math.min(...xs), x1 = Math.max(...xs), y0 = Math.min(...ys), y1 = Math.max(...ys);
  const X = (v) => pad + ((v - x0) / (x1 - x0 || 1)) * (Wd - pad - 10), Y = (v) => 10 + ((y1 - v) / (y1 - y0 || 1)) * (Hh - 34);
  const mx = xs.reduce((a, b) => a + b, 0) / xs.length;
  return `<svg viewBox="0 0 ${Wd} ${Hh}" role="img" aria-label="Two-way map: points per game against goals prevented">
    <line x1="${pad}" x2="${Wd - 6}" y1="${Y(0)}" y2="${Y(0)}" stroke="#2a3b58" stroke-dasharray="4 4"/><line x1="${X(mx)}" x2="${X(mx)}" y1="10" y2="${Hh - 24}" stroke="#2a3b58" stroke-dasharray="4 4"/>
    <text x="${pad + 4}" y="22">defense-first</text><text x="${Wd - 70}" y="22">both</text><text x="${pad + 4}" y="${Hh - 28}">neither</text><text x="${Wd - 100}" y="${Hh - 28}">offense-first</text>
    ${pool.map((q) => (q.id === card.id ? '' : `<circle cx="${X(q.x)}" cy="${Y(q.y)}" r="3" fill="#8b95a7" opacity=".45"><title>${esc(q.name)}: ${q.x.toFixed(2)} P/GP, ${sg(q.y)} ${card.split ? "Defending" : "goals prevented"}</title></circle>`)).join('')}
    ${pool.filter((q) => q.id === card.id).map((q) => `<circle cx="${X(q.x)}" cy="${Y(q.y)}" r="7" fill="#fbbf24" stroke="#fff" stroke-width="1.5"><title>${esc(q.name)}: ${q.x.toFixed(2)} P/GP, ${sg(q.y)} ${card.split ? 'Defending' : 'goals prevented'}</title></circle>`).join('')}
    <text x="${pad}" y="${Hh - 6}">points per game →</text><text x="2" y="${Hh - 28}" transform="rotate(-90 8 ${Hh / 2})" style="text-anchor:middle">${card.split ? 'Defending (goals/82)' : 'goals prevented'} →</text></svg>`;
}

/** Best and worst few areas as tiles: value, NHL rank, tinted. */
function stripSection(card) {
  const t = (x, good) => `<div class="pq-t pq-ours ${good ? 'rk-top' : x.ugly ? 'rk-low' : ''}" title="${esc(hoverText(x, fv(x)))}" tabindex="0"><span class="pq-v">${fv(x)(x.value)}</span><span class="pq-k">${esc(x.label)}</span><span class="pq-s">${rkb(ofN(x.rank))}</span></div>`;
  const col = (title, sub, list, good) => `<div class="sk-strip"><h3 class="pc-sub">${title} <small>${sub}</small></h3>${list.length ? `<div class="pq-grid pc-grid">${list.map((x) => t(x, good)).join('')}</div>` : '<p class="pq-note">Nothing stands out.</p>'}</div>`;
  return `<div class="sk-strips" id="sk-str">${col('Strengths', 'best areas vs the NHL', card.strengths, true)}${col('Weak spots', 'worst areas, ugly = bottom 10%', card.weak, false)}</div>`;
}

// ── clips ──
const clipRow = (c) => `<li><span class="sk-clip-d">${day(c.date)}</span> ${c.home ? 'vs' : '@'} ${esc(c.opp)} <span class="sk-tag">${c.kind}</span> <span class="sk-clip-t">${esc(c.period)} ${esc(c.time)}${c.tags?.length ? ` · ${esc(c.tags.join(' '))}` : ''}${c.kind === 'G' ? '' : ` · goal by ${esc(c.scorer)}`}</span> ${c.id ? videoButton(c.id, `${c.kind === 'G' ? 'Goal' : 'Assist'}: ${c.scorer}, ${day(c.date)} ${c.home ? 'vs' : '@'} ${c.opp}`, '▶ Watch') : c.href ? `<a class="sk-watch" href="${esc(c.href)}" target="_blank" rel="noopener">▶ Watch</a>` : ''}</li>`;
export function clipsHtml(clips, tab, all, seasonLabel, seasons = [], season = '') {
  if (!clips) return `${seasonSelect(seasons, season)}${wait()}`;
  const list = clips.filter((c) => (tab === 'all' ? true : tab === 'g' ? c.kind === 'G' : c.kind !== 'G')).slice().reverse();
  const shown = all ? list : list.slice(0, 5);
  return `<div class="sk-clips">${seasonSelect(seasons, season)}<div class="pc-type" role="group" aria-label="Goals or assists">${[['g', 'Goals'], ['a', 'Assists'], ['all', 'All']].map(([k, l]) => `<button type="button" data-sk-tab="${k}" aria-pressed="${k === tab}">${l}</button>`).join('')}</div>
    ${shown.length ? `<ul class="sk-cliplist${all ? ' sk-scroll' : ''}">${shown.map(clipRow).join('')}</ul>` : `<p class="pq-note">No ${tab === 'a' ? 'assists' : tab === 'g' ? 'goals' : 'goals or assists'} yet this ${seasonLabel}.</p>`}
    ${list.length > 5 ? `<button type="button" class="sk-more" data-sk-all="${all ? 0 : 1}">${all ? 'Show fewer' : `Show all ${list.length}`}</button>` : ''}</div>`;
}

const seasonSelect = (seasons, cur) => (seasons.length > 1 ? `<label class="sk-sel">Season <select data-sk-season>${seasons.map((x) => `<option value="${x}"${String(x) === String(cur) ? ' selected' : ''}>${fmt.season(x)}</option>`).join('')}</select></label>` : '');

/** Goal and assist clips for a past season: the Worker lists the games he scored or assisted in, then each saved game. */
export async function loadSeasonClips(p, season, gameType = 2) {
  const log = await getData(`log/${p.id}/${season}/${gameType}.json`).catch(() => null);
  const list = log?.games ?? [];
  const out = [];
  let next = 0;
  const worker = async () => {
    while (next < list.length) {
      const g = list[next++];
      const game = await getData(`games/${g.id}.json`).catch(() => null);
      if (!game) continue;
      for (const s of game.scoring ?? []) {
        const goal = s.scorer?.id === p.id;
        if (!goal && !(s.assists ?? []).some((x) => x.id === p.id)) continue;
        out.push({ ...g, n: g.id, date: game.gameDate ?? g.date, kind: goal ? 'G' : (s.assists[0].id === p.id ? 'A1' : 'A2'), period: s.period, time: s.time, tags: s.tags, scorer: s.scorer?.fullName, id: s.highlightId, href: s.highlight });
      }
    }
  };
  await Promise.all(Array.from({ length: 12 }, worker));
  return out.sort((a, b) => (a.date ?? '').localeCompare(b.date ?? '') || a.time.localeCompare(b.time));
}

export const rangeToggle = (n) => `<div class="pc-type gc-range" role="group" aria-label="All games or last 10 games">${[[0, 'All games'], [10, 'Last 10']].map(([k, l]) => `<button type="button" data-gc-range="${k}" aria-pressed="${k === n}">${l}</button>`).join('')}</div>`;

/** Every game this regular season for the player, from the saved per-game lines. */
export async function loadSkaterGames(p, v) {
  if (v.playoffs || !v.file || !v.ours) return [];
  const team = v.ours.row.t;
  const season = String(v.file.season).slice(0, 4);
  const games = v.file.g.map(gameObj).filter((g) => g.away === team || g.home === team);
  const out = [];
  let next = 0;
  const worker = async () => {
    while (next < games.length) {
      const g = games[next++];
      const id = `${season}02${String(g.n).padStart(4, '0')}`;
      const doc = await getData(`lines/${id}.json`).catch(() => null);
      const l = doc?.lines?.find((x) => x.id === p.id);
      if (!l) continue;
      const home = g.home === team;
      out.push({ id, n: g.n, home, opp: home ? g.away : g.home, line: l, g: l.g ?? 0, a: (l.a1 ?? 0) + (l.a2 ?? 0), mom: l.mom ?? 0, sat: l.sat ?? 0, tier: tierOf(l, l.pos === 'D' ? 'D' : 'F'), date: null });
    }
  };
  await Promise.all(Array.from({ length: 12 }, worker));
  out.sort((a, b) => a.n - b.n);
  return out;
}

/** Goal and assist clips: loads the saved game file of every game he scored or assisted in. */
export async function loadClips(p, games) {
  const out = [];
  let next = 0;
  const list = games;
  const shots = [];
  const worker = async () => {
    while (next < list.length) {
      const g = list[next++];
      const game = await getData(`games/${g.id}.json`).catch(() => null);
      if (!game) continue;
      g.date = game.gameDate;
      for (const side of ['away', 'home']) {
        const me = ['forwards', 'defense'].flatMap((k) => game.players?.[side]?.[k] ?? []).find((x) => x.id === p.id);
        if (me) { g.rating = me.rating ?? null; g.gameScore = me.gameScore ?? null; }
      }
      for (const sh of game.shots ?? []) if (sh.shooterId === p.id && sh.x != null) shots.push({ gid: g.id, x: sh.x, y: sh.y, kind: sh.kind, type: sh.shotType, plate: sh.homePlate, opp: g.opp, home: g.home, date: game.gameDate, period: sh.period, time: sh.time });
      for (const s of game.scoring ?? []) {
        const goal = s.scorer?.id === p.id;
        if (!goal && !(s.assists ?? []).some((x) => x.id === p.id)) continue;
        out.push({ ...g, date: game.gameDate, kind: goal ? 'G' : (s.assists[0].id === p.id ? 'A1' : 'A2'), period: s.period, time: s.time, tags: s.tags, scorer: s.scorer?.fullName, id: s.highlightId, href: s.highlight });
      }
    }
  };
  await Promise.all(Array.from({ length: 12 }, worker));
  out.shots = shots;
  return out.sort((a, b) => (a.date ?? '').localeCompare(b.date ?? '') || a.n - b.n || a.time.localeCompare(b.time));
}

/** The grouped sections. games / clips are null until loaded. */
const hlCell = (label, value, sub, tip) => `<div class="hl-c" title="${esc(tip)}" tabindex="0"><span class="hl-k">${label}</span><span class="hl-v">${value}</span><span class="hl-s">${sub}</span></div>`;
/** The two numbers that drive the site, big, at the top of the card. */
export function headlineStrip(cells) { return `<div class="hl-strip">${cells.join('')}</div>`; }

export function skaterSections({ card, now: nowIn, games, clips, tab, all, playoffs, range = 0, seasons = [], season = '', clipSeason = '' }) {
  const { m, row, pg } = card;
  const gl = games ? (range ? games.slice(-range) : games) : null;
  const ids = new Set((gl ?? []).map((g) => g.id));
  const now = range && gl ? { goals: gl.reduce((a, g) => a + g.g, 0), assists: gl.reduce((a, g) => a + g.a, 0), get points() { return this.goals + this.assists; }, pim: row.pim } : nowIn;
  const shots = clips?.shots ? (range ? clips.shots.filter((q) => ids.has(q.gid)) : clips.shots) : clips?.shots;
  const out = [];
  const spiderHtml = spider(card.spider);
  const defHtml = card.defBars.length ? `<figure class="gc-defbars"><figcaption>${card.split ? 'Defending and puck control' : 'Defense'}: percentile vs NHL ${card.group === 'D' ? 'defensemen' : 'forwards'}, 100 = best</figcaption>${bars(card.defBars)}</figure>` : '<p class="pq-note">Defense numbers need more ice time.</p>';
  const gs = m.rating, mo = m.play;
  out.push(headlineStrip([
    hlCell('Game score', gs ? gs.value.toFixed(1) : '-', gs ? `${rkb(ofN(gs.rank))}<em>${card.row.rn} games</em>` : 'builds as games are rated', 'Average game score (0-10) from our scorecards. 6.0 is an average night, 9+ is a huge game.'),
    hlCell('Momentum / GP', mo ? sg(mo.value) : '-', mo ? rkb(ofN(mo.rank)) : '', 'Momentum per game: our play-by-play model of the shifts in pressure the player creates or gives up.'),
  ]));
  out.push(`<div class="gc-top" id="sk-sum">${summary(card)}<div>${spiderHtml}${defHtml}</div></div>`, stripSection(card));
  const seasonWord = playoffs ? 'playoff run' : 'season';
  const rated = (gl ?? []).filter((g) => g.rating != null);
  const best = rated.length ? rated.reduce((a, b) => (b.rating > a.rating ? b : a)) : null;
  const worst = rated.length ? rated.reduce((a, b) => (b.rating < a.rating ? b : a)) : null;
  const ratedN = card.row.rn ?? 0;
  out.push(sec('sk-rate', 'Game ratings', 'our scorecard score for every game: 6.0 is an average night', `<div class="pq-grid pc-grid">
    ${m.rating ? rtile(m.rating, m.rating.value.toFixed(1), 'Avg rating', `${ratedN} games`) : plain('Avg rating', '-', ratedN ? `needs ${card.isWin ? 3 : 5} games` : 'builds as games are rated')}
    ${best ? plain('Best game', best.rating.toFixed(1), `${best.home ? 'vs' : '@'} ${esc(best.opp)}`, 'His highest-rated game this season.') : ''}
    ${worst ? plain('Worst game', worst.rating.toFixed(1), `${worst.home ? 'vs' : '@'} ${esc(worst.opp)}`, 'His lowest-rated game this season.') : ''}
    ${rated.length ? plain('7+ games', fmt.pct(rated.filter((g) => g.rating >= 7).length / rated.length, 0), 'rated 7.0 or better', 'Share of his games rated 7.0 or better.') : ''}
    ${rated.length ? plain('Under 5', fmt.pct(rated.filter((g) => g.rating < 5).length / rated.length, 0), 'rated below 5.0', 'Share of his games rated below 5.0.') : ''}</div>
    ${fig(`<h4 class="sk-h">Rating by game <small>green above 6.0, red below</small></h4>${ratingBars(gl, !!clips)}`)}`));
  const pr = Object.fromEntries(['g', 'a', 'p', 'pim'].map((k) => [k, range ? '' : rankBoxes(card.prod?.[k])]));
  out.push(sec('sk-sco', 'Scoring', 'goals, assists and what they are worth', `<div class="pq-grid pc-grid">
    ${plain('G', now?.goals ?? row.g ?? '-', pr.g)}${plain('A', now?.assists ?? '-', pr.a)}${plain('P', now?.points ?? '-', pr.p)}
    ${rtile(m.scoring, sg(pg.scoringVsAvg), 'Scoring vs avg', 'per game rank')}${rtile(m.fin, sg(pg.gaa), 'Goals vs avg', 'finishing')}
    ${plain('Playmaking', sg(pg.playVsAvg), 'assists vs avg', 'Three quarters of the assists above an average player at the position.')}${plain('PIM', now?.pim ?? row.pim ?? '-', pr.pim)}</div>
    <div class="sk-two">${fig(`<h4 class="sk-h">Points by game</h4>${pointsBars(gl?.length ? gl : null)}`)}${fig(`<h4 class="sk-h">Running scoring vs average</h4>${runningChart(gl?.length ? gl : null, card.rate, card.sbase?.[card.group] ?? 0)}`)}</div>
    <h3 class="pc-sub">Clips <small>goals and assists, last 5 first</small></h3><div id="sk-clips">${clipsHtml(clips, tab, all, seasonWord, seasons, clipSeason)}</div>`));
  out.push(sec('sk-drv', 'Driving play', 'shot attempts and momentum', `<div class="pq-grid pc-grid">
    ${rtile(m.sat, fmt.dec(pg.satPerGame), 'SAT/GP')}${rtile(m.play, sg(pg.momPerGame), 'MOM/GP')}
    ${plain('MOM +/GP', sg(pg.momPosPerGame), 'created')}${plain('MOM −/GP', sg(pg.momNegPerGame), 'given up')}
    ${pg.abovePct != null ? plain('Above avg games', fmt.pct(pg.abovePct, 0), `below avg ${fmt.pct(pg.belowPct, 0)}`) : ''}</div>
    <div class="sk-two">${fig(`<h4 class="sk-h">Momentum by game <small>green above average, red below</small></h4>${gameBars(gl?.length ? gl : null, (g) => g.mom, 'Momentum', (g) => (g.tier > 0 ? UP : g.tier < 0 ? DOWN : '#8b95a7'))}`)}${fig(`<h4 class="sk-h">Shot attempts by game</h4>${gameBars(gl?.length ? gl : null, (g) => g.sat, 'Shot attempts', () => BLUE)}`)}</div>`));
  out.push(sec('sk-sho', 'Shooting', 'what he does with the puck near the net', `<div class="pq-grid pc-grid">
    ${plain('Shots', pg.sogPerGame != null ? (pg.sogPerGame * pg.gp).toFixed(0) : '-')}${plain('S%', fmt.pct(pg.shPct), `avg shooter ${fmt.pct(pg.xShPct)}`)}
    ${rtile(m.xg, fmt.dec(row.xg ?? 0, 1), 'xG', `${(m.xg?.value ?? 0).toFixed(2)}/game`)}${rtile(m.vol, fmt.pct(card.areas.vol?.share, 0), 'Shot volume', 'attempts on net')}
    ${plain('Attempts', row.sat)}</div>
    <h3 class="pc-sub">Shot map <small>${range ? `last ${range} games` : 'every attempt this season'}</small></h3>${fig(shotMap(shots))}`));
  const att60 = row.oto ? ((row.oca ?? 0) * 3600) / row.oto : null;
  const grpName = card.group === 'D' ? 'defensemen' : 'forwards';
  const WHEN = ['This season', 'Last season', 'Two seasons ago'];
  const hist = card.split && card.dseasons?.some(Boolean) ? `<h3 class="pc-sub">Across seasons <small>goals per 82 games; this season counts 50%, last season 30%, the one before 20%</small></h3><div class="sk-hist"><table class="pt"><thead><tr><th></th><th>Defending</th><th>Puck control</th><th>5v5 time</th></tr></thead><tbody>${card.dseasons.map((q, i) => (q ? `<tr><th>${WHEN[i]}</th><td>${sg(q.def)}</td><td>${sg(q.puck)}</td><td>${q.h.toFixed(0)} h</td></tr>` : `<tr><th>${WHEN[i]}</th><td colspan="3" class="pq-note">no data</td></tr>`)).join('')}</tbody></table></div>` : '';
  const defNote = card.split
    ? 'Defending is the 5v5 shot attempts the other team takes while he is on the ice, adjusted for his teammates and opponents (a ridge regression over every shift), with the part his own offense explains taken out, then compared with other ' + grpName + '. That part is Puck control: keeping the puck is real defense too, but a different skill, so it is shown on its own. Both blend this season with the last two (50 / 30 / 20 once he has a full season of ice time; early on last seasons count for more) and are shown in goals per 82 games at an average amount of ice time for his position. Penalty kill needs 60 minutes shorthanded. Blocks are context only: they track role, not skill. Goals against and plus/minus are not used: too noisy.'
    : card.adjusted ? 'Goals prevented = the shot attempts the other team takes at 5v5 while he is on the ice, adjusted for his teammates and the opponents he faces, turned into goals. It overlaps with puck possession.' : 'Goals prevented = how many fewer shot attempts than his teammates at the same position the other team gets while he is on the ice, turned into goals. The adjusted 5v5 version appears once the season has enough shifts saved.';
  out.push(sec('sk-def', card.split ? 'Defending' : 'Defense', `${grpName} are compared with the same position`, `<div class="pq-grid pc-grid">
    ${rtile(m.def, m.def ? sg(m.def.value) : '-', card.split ? 'Defending' : 'Goals prevented', card.split ? 'goals / 82, offense removed' : card.adjusted ? '5v5, adjusted' : 'vs teammates')}
    ${card.split ? rtile(m.puck, m.puck ? sg(m.puck.value) : '-', 'Puck control', 'goals / 82') : ''}
    ${card.split ? rtile(m.pk, m.pk ? sg(m.pk.value, 1) : '-', 'Penalty kill', m.pk ? 'attempts /60 vs teammates' : 'needs 60 min shorthanded') : ''}
    ${card.adj ? plain('Attempts against /60 (5v5, adjusted)', sg(card.adj.d, 1), 'vs average skater, lower is better', 'Shot attempts per 60 the other team takes at 5v5 while he is on the ice, after adjusting for teammates and opponents, compared with the average skater. Negative is good.') : att60 != null ? plain('Attempts against /60', att60.toFixed(1), 'on ice, all strengths') : ''}
    ${card.adj ? plain('5v5 time', `${card.adj.h.toFixed(1)} h`, 'this season') : ''}
    ${row.oto ? plain('On-ice shot share', fmt.pct((row.ocf ?? 0) / Math.max(1, (row.ocf ?? 0) + (row.oca ?? 0)), 0)) : ''}
    ${m.blk ? rtile(m.blk, m.blk.value.toFixed(2), 'Blocks /GP', 'context') : ''}${plain('Takeaways', row.tk ?? '-', 'context')}${row.toi ? plain('TOI/GP', fmt.toi(row.toi / row.gp)) : ''}</div>
    ${hist}
    ${m.def && m.puck ? `<h3 class="pc-sub">Two-way map <small>points per game against Defending, ${grpName}</small></h3><div class="sk-tw">${fig(twoWay(card))}</div>` : m.def ? `<h3 class="pc-sub">Two-way map <small>points per game against goals prevented, ${grpName}</small></h3><div class="sk-tw">${fig(twoWay(card))}</div>` : ''}
    <p class="pq-note">${defNote}</p>`));
  out.push(sec('sk-dis', 'Discipline and puck', 'penalties and giveaways', `<div class="pq-grid pc-grid">
    ${rtile(m.pen, m.pen ? sg(m.pen.value, 2) : '-', 'Net penalties /GP', 'drawn − taken')}${plain('Drawn', card.areas.pen?.drawn ?? '-')}${plain('Taken', card.areas.pen?.taken ?? '-')}
    ${rtile(m.give, m.give ? m.give.value.toFixed(1) : '-', 'Giveaways /GP', 'context')}${plain('Takeaways /GP', card.areas.give ? card.areas.give.takePerGame.toFixed(1) : '-', 'context')}
    ${m.fo ? rtile(m.fo, fmt.pct(m.fo.value, 1), 'Faceoff %', `of ${(card.areas.fo?.n ?? 0)}`) : ''}</div>`));
  const dots = Object.values(m).filter((x) => !x.ctx);
  out.push(sec('sk-lg', 'NHL rank', 'every NHL skater is a dot; gold marker = NHL average, big dot = him; left = worst, right = best', dots.map((x) => {
    const sorted = x.vals.slice().sort((a, b) => a - b), lo = sorted[Math.floor(sorted.length * 0.02)], hi2 = sorted[Math.floor(sorted.length * 0.98)] ?? sorted.at(-1), span = hi2 - lo || 1;
    const pos = (v) => Math.max(1, Math.min(99, ((v - lo) / span) * 100)), flip = (p) => (x.hi ? p : 100 - p);
    return `<div class="sk-dot" title="${esc(hoverText(x, fv(x)))}" tabindex="0"><span>${esc(x.label)}</span><i>${x.vals.map((v) => `<u style="left:${flip(pos(v)).toFixed(1)}%"></u>`).join('')}<s style="left:${flip(pos(x.mean)).toFixed(1)}%" title="NHL AVG"></s><b style="left:${flip(pos(x.value)).toFixed(1)}%;background:${x.pct >= 0.5 ? UP : DOWN}"></b></i><em>${fv(x)(x.value)} · ${ofN(x.rank)}</em></div>`;
  }).join('')));
  return out.join('');
}

/** Last 10 games: his line in each, with tier color. */
export function lastGamesSection(games, playoffs) {
  if (playoffs) return '';
  if (!games) return sec('sk-last', 'Last 10 games', '', wait());
  const last = games.slice(-10).reverse();
  if (!last.length) return '';
  return sec('sk-last', 'Last 10 games', 'newest first', `<div class="pc-scroll"><table class="pc-table"><thead><tr><th class="l">Game</th><th>G</th><th>A</th><th>SOG</th><th>SAT</th><th>MOM</th><th>Impact</th><th>Rating</th></tr></thead><tbody>${last.map((g) => `<tr><td class="l">${g.home ? 'vs' : '@'} ${esc(g.opp)}</td><td>${g.g}</td><td>${g.a}</td><td>${g.line.sog ?? 0}</td><td>${g.sat}</td><td class="${g.mom >= 0 ? 'up' : 'down'}">${sg(g.mom)}</td><td class="${g.tier > 0 ? 'up' : g.tier < 0 ? 'down' : ''}">${g.tier > 0 ? 'Above avg' : g.tier < 0 ? 'Below avg' : 'Average'}</td><td>${g.rating != null ? `<b class="${g.rating >= 6 ? 'up' : 'down'}">${g.rating.toFixed(1)}</b>` : '-'}</td></tr>`).join('')}</tbody></table></div>`);
}

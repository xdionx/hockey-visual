// Goalie card v2: the goalie's page grouped by what belongs together (results, saves vs expected, shot location,
// consistency, league rank, starter quality) with a chart or diagram for each, plus a last-10-starts list with
// a highlight clip for every goal let in. Pure helpers live in ../src/goalieCard.js.
import { esc, videoButton } from '../game/core.js';
import { HOME_PLATE, RINK, halfRinkLines } from '../game/rink.js';
import { fmt } from './store.js';
import { rankAmong, median, summarize, zoneVs, radarPoints } from '../src/goalieCard.js';
import { W } from '../src/predict.js';

const UP = '#4ade80';
const DOWN = '#f87171';
const BLUE = '#38bdf8';
const sv3 = fmt.sv;
const sg = (n, d = 1) => fmt.signed(n, d);
const cls = (v) => (v > 0.05 ? 'up' : v < -0.05 ? 'down' : '');
const tile = (label, value, sub = '', c = '', tip = '') => `<div class="pq-t pq-ours"${tip ? ` title="${esc(tip)}"` : ''}><span class="pq-v ${c}">${value}</span><span class="pq-k">${label}</span>${sub ? `<span class="pq-s">${sub}</span>` : ''}</div>`;
const plain = (label, value, sub = '', c = '') => `<div class="pq-t ${c === 'hl' ? 'pq-hl' : ''}"><span class="pq-v">${value}</span><span class="pq-k">${label}</span>${sub ? `<span class="pq-s">${sub}</span>` : ''}</div>`;
/** Rank label: "15th NHL", "T1st NHL" when tied. */
const rb = (r) => (r ? `<span class="rkb">${ofN(r)}</span>` : '');
const ofN = (r) => (r ? `${r.tied ? 'T' : ''}${fmt.ord(r.rank)} NHL` : '');
const sec = (id, title, sub, html) => `<section class="pc-card gc-sec" id="${id}"><h2>${title}${sub ? ` <small>${sub}</small>` : ''}</h2>${html}</section>`;
const fig = (inner) => `<div class="gc-fig">${inner}</div>`;
const day = (d) => new Date(`${d}T12:00:00Z`).toLocaleDateString(undefined, { month: 'short', day: 'numeric', timeZone: 'UTC' });

export const NAV = [['gc-res', 'Results'], ['gc-exp', 'Saves vs expected'], ['gc-loc', 'Shot location'], ['gc-con', 'Consistency'], ['gc-lg', 'NHL rank'], ['gc-pick', 'Starter quality'], ['gc-hist', 'History'], ['gc-last', 'Last 10 starts']];
export const navHtml = () => `<nav class="gc-nav" aria-label="Sections">${NAV.map(([id, l]) => `<a href="#${id}">${l}</a>`).join('')}</nav>`;

/** The All games / Last 10 switch. */
export const rangeToggle = (n) => `<div class="pc-type gc-range" role="group" aria-label="All games or last 10 starts">${[[0, 'All games'], [10, 'Last 10']].map(([k, l]) => `<button type="button" data-gc-range="${k}" aria-pressed="${k === n}">${l}</button>`).join('')}</div>`;

/**
 * Numbers for the cards. All games = the season file's totals (what the old card showed); Last 10 = built from the
 * saved game files. Same shape either way.
 */
function bundle(ours, now, starts, n) {
  if (n && starts?.length) {
    const s = summarize(starts.slice(-n));
    return { ...s, last: true, label: `last ${s.n} starts`, so: s.so };
  }
  const r = ours?.row ?? {};
  const sa = r.sa ?? now?.shotsAgainst ?? 0;
  const hasPlate = r.psa != null;
  return {
    last: false, label: 'season to date', n: ours?.qsStarts ?? ours?.starts ?? 0, sa, ga: ours?.ga ?? 0, xga: ours?.xgaAvg ?? 0, gsax: ours?.gsax ?? 0,
    sv: r.sa ? 1 - (r.sg ?? 0) / r.sa : now?.savePct ?? null, expSv: sa ? 1 - (ours?.xgaAvg ?? 0) / sa : null,
    qs: ours?.qs, hasPlate, inSa: r.psa, inGa: r.pga, outSa: r.osa, outGa: r.oga, soft: r.sf, so: now?.shutouts ?? null, bad: null,
  };
}

// ── charts ──
function cumChart(starts) {
  if (!starts?.length) return pending();
  let c = 0;
  const pts = starts.map((s) => (c += s.gsax));
  const Wd = 560, Hh = 190, pad = 34;
  const mn = Math.min(0, ...pts) - 1, mx = Math.max(0, ...pts) + 1;
  const X = (i) => pad + (i * (Wd - pad - 10)) / Math.max(1, pts.length - 1);
  const Y = (v) => 10 + ((mx - v) * (Hh - 30)) / (mx - mn);
  const l10 = Math.max(0, pts.length - 10);
  const last = pts[pts.length - 1];
  return `<svg viewBox="0 0 ${Wd} ${Hh}" role="img" aria-label="Running goals saved above expected by start">
    ${pts.length > 10 ? `<rect x="${X(l10)}" y="8" width="${X(pts.length - 1) - X(l10) + 4}" height="${Hh - 28}" fill="${BLUE}" opacity=".09"/><text x="${X(l10) + 4}" y="20">last 10</text>` : ''}
    <line class="gc-zero" x1="${pad}" x2="${Wd - 6}" y1="${Y(0)}" y2="${Y(0)}"/>
    <polyline fill="none" stroke="${BLUE}" stroke-width="2.4" points="${pts.map((v, i) => `${X(i)},${Y(v)}`).join(' ')}"/>
    ${pts.map((v, i) => `<circle cx="${X(i)}" cy="${Y(v)}" r="3" fill="${starts[i].gsax >= 0 ? UP : DOWN}"><title>${day(starts[i].date)} ${starts[i].home ? 'vs' : '@'} ${esc(starts[i].opp)}: ${sg(starts[i].gsax)} (total ${sg(v)})</title></circle>`).join('')}
    <text x="4" y="${Y(0) + 3}">0</text><text x="4" y="${Y(mn) - 2}">${sg(mn + 1, 0)}</text>
    <text class="gc-v" x="${Math.min(X(pts.length - 1), Wd - 40)}" y="${Y(last) - 8}">${sg(last)}</text>
    <text x="${pad}" y="${Hh - 2}">${day(starts[0].date)}</text><text x="${Wd - 50}" y="${Hh - 2}">${day(starts[starts.length - 1].date)}</text></svg>`;
}

function startBars(starts) {
  if (!starts?.length) return pending();
  const Wd = 560, Hh = 190, pad = 34, mid = (Hh - 20) / 2;
  const bw = (Wd - pad - 10) / starts.length;
  const m = Math.max(1, ...starts.map((s) => Math.abs(s.gsax)));
  return `<svg viewBox="0 0 ${Wd} ${Hh}" role="img" aria-label="Goals saved above expected in each start"><line class="gc-zero" x1="${pad}" x2="${Wd - 6}" y1="${mid}" y2="${mid}"/>
    ${starts.map((s, i) => { const h = Math.max(1, (Math.abs(s.gsax) / m) * (Hh - 50) / 2); return `<rect x="${pad + i * bw + 2}" y="${s.gsax >= 0 ? mid - h : mid}" width="${Math.max(3, bw - 4)}" height="${h}" rx="2" fill="${s.gsax >= 0 ? UP : DOWN}"><title>${day(s.date)} ${s.home ? 'vs' : '@'} ${esc(s.opp)}: ${sg(s.gsax)}</title></rect>`; }).join('')}
    ${starts.map((s, i) => (starts.length > 12 && i % Math.ceil(starts.length / 12) ? '' : `<text x="${pad + i * bw + bw / 2}" y="${Hh - 4}" text-anchor="middle">${esc(s.opp)}</text>`)).join('')}</svg>`;
}

function qsChart(starts, lgSv) {
  if (!starts?.length) return pending();
  const Wd = 560, pad = 34, bw = (Wd - pad - 10) / starts.length;
  const y = (v) => 20 + (1 - (v - 0.7) / 0.3) * 130;
  return `<svg viewBox="0 0 ${Wd + 20} 190" role="img" aria-label="Save percentage of every start, quality starts in blue">
    <line x1="${pad}" x2="${Wd + 10}" y1="${y(lgSv)}" y2="${y(lgSv)}" stroke="#8b95a7" stroke-dasharray="4 4"/><text x="2" y="${y(lgSv) + 3}">${sv3(lgSv)}</text>
    ${starts.map((s, i) => { const v = s.sa ? 1 - s.ga / s.sa : 1; const top = y(Math.max(0.7, v)); const x = pad + i * bw; return `<rect x="${x + 2}" y="${top}" width="${Math.max(3, bw - 4)}" height="${150 - top}" rx="2" fill="${s.qs ? BLUE : DOWN}" opacity=".9"><title>${day(s.date)} ${esc(s.opp)}: ${s.ga} GA on ${s.sa} (${sv3(v)})${s.qs ? ', quality start' : ''}</title></rect>
      <text class="gc-v" x="${x + bw / 2}" y="${top - 4}" text-anchor="middle">${v === 1 ? '1.0' : sv3(v).slice(1)}</text><text x="${x + bw / 2}" y="165" text-anchor="middle">${esc(s.opp)}</text><text x="${x + bw / 2}" y="177" text-anchor="middle">${s.ga}/${s.sa}</text>`; }).join('')}</svg>`;
}

/** Half rink, net at the bottom, every shot he faced. Goal dots with a clip play it; perimeter goals are ringed. */
function shotMap(starts) {
  if (!starts?.length) return pending();
  const S = 6.2, w = 85 * S, h = 75 * S;
  const P = (x, y) => { const f = x < 0 ? -1 : 1; return [(y * f + 42.5) * S, (Math.abs(x) - 25) * S]; };
  const poly = (pts) => pts.map(([x, y]) => P(x, y).join(',')).join(' ');
  const plate = HOME_PLATE;
  const [px, py] = P(61, 0);
  const saves = starts.flatMap((s) => s.shots.filter((x) => !x.goal)).map((x) => { const [a, b] = P(x.x, x.y); return `<circle cx="${a}" cy="${b}" r="3.1" fill="#8b95a7" opacity=".5"/>`; }).join('');
  const goals = starts.flatMap((s) => s.goals.map((g) => ({ ...g, s }))).map((g) => {
    const [a, b] = P(g.x, g.y);
    const title = `${g.scorer ?? 'Goal'} · ${day(g.s.date)} ${g.s.home ? 'vs' : '@'} ${g.s.opp} · ${g.period} ${g.time}${g.soft ? ' · perimeter goal' : ''}`;
    const dot = `${g.soft ? `<circle cx="${a}" cy="${b}" r="10" fill="none" stroke="#fbbf24" stroke-width="2.4"/>` : ''}<circle cx="${a}" cy="${b}" r="5.6" fill="${DOWN}" stroke="#fff" stroke-width="1"/>`;
    return g.clipId
      ? `<g class="gc-goal" data-video-id="${esc(g.clipId)}" data-video-title="${esc(title)}" tabindex="0" role="button" aria-label="Watch: ${esc(title)}"><title>${esc(title)} (tap to watch)</title><circle cx="${a}" cy="${b}" r="13" fill="transparent"/>${dot}</g>`
      : `<g><title>${esc(title)}</title>${dot}</g>`;
  }).join('');
  return `<svg class="gc-map" viewBox="-6 -6 ${w + 12} ${h + 12}" role="img" aria-label="Where the shots against him came from">
    <path d="M 0 0 H ${w} V ${h - RINK.corner * S} A ${RINK.corner * S} ${RINK.corner * S} 0 0 1 ${w - RINK.corner * S} ${h} H ${RINK.corner * S} A ${RINK.corner * S} ${RINK.corner * S} 0 0 1 0 ${h - RINK.corner * S} Z" fill="#0b1626" stroke="#2a3b58"/><line x1="0" x2="${w}" y1="0" y2="0" stroke="#3b6fd6" stroke-width="4"/>${halfRinkLines(S)}
    <polygon points="${poly(plate)}" fill="${BLUE}" opacity=".1" stroke="${BLUE}" stroke-width="1.5" stroke-dasharray="5 4"/>
    <line x1="${P(79, -11.5)[0]}" x2="${P(79, 11.5)[0]}" y1="${P(79, 0)[1]}" y2="${P(79, 0)[1]}" stroke="${BLUE}" opacity=".5" stroke-dasharray="3 3"/>
    <text x="${px}" y="${py}" text-anchor="middle" style="fill:${BLUE};font-size:13px;font-weight:700">HOME PLATE</text>${saves}${goals}</svg>`;
}

function zoneChart(b, inRate, outRate) {
  const zs = [['Inside plate', b.inSa, b.inGa, inRate], ['Outside plate', b.outSa, b.outGa, outRate]];
  return `<svg viewBox="0 0 440 120" role="img" aria-label="Save percentage inside and outside the home plate against the league">${zs.map(([l, sa, ga, rt], i) => {
    const s = 1 - ga / sa, base = 1 - rt, lo = 0.7, sx = (v) => 110 + ((v - lo) / (1 - lo)) * 300, y = 18 + i * 50;
    return `<text class="gc-v" x="4" y="${y + 11}">${l}</text><rect x="110" y="${y}" width="300" height="14" rx="7" fill="#1a2740"/><rect x="110" y="${y}" width="${Math.max(0, sx(s) - 110)}" height="14" rx="7" fill="${s >= base ? UP : DOWN}"/>
      <line x1="${sx(base)}" x2="${sx(base)}" y1="${y - 5}" y2="${y + 19}" stroke="#fff" stroke-width="2"/><text class="gc-v" x="${sx(s) - 36}" y="${y + 11}" style="fill:#04101a">${sv3(s)}</text><text x="${sx(base) + 6}" y="${y + 31}">NHL AVG ${sv3(base)}</text>`;
  }).join('')}</svg>`;
}

function strips(lg, id, row) {
  const mets = [
    ['GSAx per game', 'saves vs expected', (g) => g.gsaxPerGame, true, (v) => sg(v, 2)],
    ['Quality start %', 'share of starts', (g) => g.qsPct, true, (v) => fmt.pct(v, 0)],
    ['Save %', 'raw, not shot-adjusted', (g) => g.sv, true, sv3],
    ['Inside-plate SV%', 'slot shots', (g) => g.inSv, true, sv3],
    ['Outside-plate SV%', 'perimeter shots', (g) => g.outSv, true, sv3],
    ['Perimeter goals per start', 'fewer is better', (g) => g.softPer, false, (v) => v.toFixed(2)],
  ];
  const me = lg.rows.find((g) => g.id === Number(id));
  if (!me) return '<p class="pq-note">Not enough starts to rank yet (5 needed).</p>';
  return mets.map(([k, sub, f, hi, fm]) => {
    const vals = lg.rows.map(f).filter((v) => v != null), mine = f(me);
    if (mine == null || vals.length < 2) return '';
    const lo = Math.min(...vals), top = Math.max(...vals), span = top - lo || 1;
    const X = (v) => 6 + (hi ? (v - lo) / span : 1 - (v - lo) / span) * 388;
    const r = rankAmong(vals, mine, hi);
    return `<div class="gc-strip"><div class="gc-k">${k}<small>${sub}</small></div><svg viewBox="0 0 400 30" role="img" aria-label="${k}: ${ofN(r)}"><line x1="6" x2="394" y1="15" y2="15" stroke="#26344f" stroke-width="2"/><line x1="${X(median(vals))}" x2="${X(median(vals))}" y1="5" y2="25" stroke="#8b95a7"/>${vals.map((v) => `<circle cx="${X(v)}" cy="15" r="3" fill="#5a6f94" opacity=".55"/>`).join('')}<circle cx="${X(mine)}" cy="15" r="6.5" fill="${BLUE}" stroke="#fff"/></svg><div class="gc-r"><b>${fm(mine)}</b><span>${ofN(r)}</span></div></div>`;
  }).join('');
}


const RADAR_FMT = { gsax: (v) => sg(v, 2), sv: sv3, qs: (v) => fmt.pct(v, 0), inn: sv3, out: sv3, soft: (v) => v.toFixed(2) };

/** The spider graph: an overall picture of the goalie against the league. The 50 ring is the league median. */
export function radarChart(points, n) {
  if (points.length < 3) return '';
  const S = 320, c = S / 2, R = 108;
  const ang = (i) => -Math.PI / 2 + (i * 2 * Math.PI) / points.length;
  const pt = (i, f) => [c + Math.cos(ang(i)) * R * f, c + Math.sin(ang(i)) * R * f];
  const poly = (f) => points.map((_, i) => pt(i, f).join(',')).join(' ');
  const shape = points.map((q, i) => pt(i, Math.max(0.03, q.pct / 100)).join(',')).join(' ');
  const avg = Math.round(points.reduce((a, q) => a + q.pct, 0) / points.length);
  return `<figure class="gc-radar"><svg viewBox="-40 0 ${S + 80} ${S}" role="img" aria-label="Spider graph of league percentiles: ${points.map((q) => `${q.label} ${q.pct}`).join(', ')}">
    ${[0.25, 0.5, 0.75, 1].map((f) => `<polygon points="${poly(f)}" fill="none" stroke="${f === 0.5 ? '#64748b' : '#26344f'}" stroke-width="${f === 0.5 ? 1.5 : 1}" ${f === 0.5 ? 'stroke-dasharray="4 3"' : ''}/>`).join('')}
    ${points.map((_, i) => `<line x1="${c}" y1="${c}" x2="${pt(i, 1)[0]}" y2="${pt(i, 1)[1]}" stroke="#26344f"/>`).join('')}
    <polygon points="${shape}" fill="${BLUE}" fill-opacity=".28" stroke="${BLUE}" stroke-width="2.4" stroke-linejoin="round"/>
    ${points.map((q, i) => { const [x, y] = pt(i, Math.max(0.03, q.pct / 100)); const [lx, ly] = pt(i, 1.2); const a = Math.cos(ang(i)); return `<circle cx="${x}" cy="${y}" r="4.5" fill="${q.pct >= 50 ? UP : DOWN}" stroke="#0b1220" stroke-width="1.5"><title>${q.tip}: ${RADAR_FMT[q.key](q.value)}, ${ofN(q.rank)} (${q.pct}th percentile)</title></circle>
      <text class="gc-rl" x="${lx}" y="${ly - 2}" text-anchor="${Math.abs(a) < 0.2 ? 'middle' : a > 0 ? 'start' : 'end'}">${esc(q.label)}</text><text class="gc-rv" x="${lx}" y="${ly + 10}" text-anchor="${Math.abs(a) < 0.2 ? 'middle' : a > 0 ? 'start' : 'end'}">${q.pct}</text>`; }).join('')}
  </svg><figcaption>Overall picture: percentile vs NHL goalies, 100 = best. Dashed ring = NHL median.${n ? ' Season totals, not the last 10.' : ''} <b>Average ${avg}</b></figcaption></figure>`;
}

const pending = () => '<p class="pq-note gc-wait">Loading every start…</p>';
const unavailable = (why) => `<p class="pq-note">${why}</p>`;

/** Last 10 starts, each with a line of its goals against and their clips. */
function lastStarts(starts) {
  if (!starts) return pending();
  if (!starts.length) return unavailable('No finished starts yet.');
  const rows = starts.slice(-10).reverse().map((s) => `<tr><td class="l"><a href="game.html?id=${s.id}">${day(s.date)}</a></td><td class="l">${s.home ? 'vs' : '@'} ${esc(s.opp)}</td><td class="${s.qs ? 'up' : 'down'}" title="${s.qs ? 'Quality start' : 'Not a quality start'}">${s.qs ? '✓' : '✗'}</td><td>${s.sa}</td><td>${s.ga}</td><td>${s.sa ? sv3(1 - s.ga / s.sa) : '-'}</td><td class="pc-o ${cls(s.gsax)}">${sg(s.gsax)}</td></tr>
    ${s.goals.length ? `<tr class="gc-goals"><td colspan="7"><ul>${s.goals.map((g) => `<li>${videoButton(g.clipId, `${g.scorer ?? 'Goal'} · ${day(s.date)} ${s.home ? 'vs' : '@'} ${s.opp} · ${g.period} ${g.time}`, '<span aria-hidden="true">&#9654;</span>', 'st-clip', g.clipHref ?? '') || '<span class="st-clip none" aria-hidden="true"></span>'}<span class="gc-gt">${/^\d$/.test(g.period) ? `P${esc(g.period)}` : esc(g.period)} ${esc(g.time)}</span> ${esc(g.scorer ?? 'Goal')}<small>${esc(g.type ?? '')}${g.p != null ? `, ${(g.p * 100).toFixed(0)}% chance` : ''}</small>${g.soft ? ' <span class="gc-soft">perimeter goal</span>' : ''}${g.inside ? '' : ' <small>outside the plate</small>'}</li>`).join('')}</ul></td></tr>` : ''}`).join('');
  return `<div class="pc-scroll"><table class="pc-table"><thead><tr><th class="l">Date</th><th class="l">Opp</th><th title="Quality start">QS</th><th>SA</th><th>GA</th><th>SV%</th><th class="pc-o" title="Goals saved above expected that start">GSAx</th></tr></thead><tbody>${rows}</tbody></table></div>
    <p class="pq-note">Under each start: the goals he let in. Tap &#9654; to watch the highlight; perimeter goals (outside the plate, under 6% chance) are marked.</p>`;
}

/**
 * Sections 1-6 and the last starts. ctx = { lg (league table), ours, now, pick, starts (or null while loading, [] when
 * unavailable), n (0 | 10), playoffs, name }.
 */
export function goalieSections(ctx) {
  const { lg, ours, now, pick, starts, n, playoffs } = ctx;
  if (!ours || ours.gsax == null) return '';
  const b = bundle(ours, now, starts, n);
  const me = lg.rows.find((g) => g.id === ctx.id);
  const season = !b.last;
  const lgSv = lg.lgSv;
  const nStarts = b.n || 1;
  const gsaxPerStart = b.gsax / nStarts;
  const rate = (v) => (b.sa ? v / b.sa : null);
  const inVs = b.inSa != null ? zoneVs(b.inSa, b.inGa, lg.inRate) : null;
  const outVs = b.outSa != null ? zoneVs(b.outSa, b.outGa, lg.outRate) : null;
  const gl = ours.gsaxRank;
  const bad = b.gsax <= -3 ? 'bad' : b.gsax >= 3 ? 'good' : 'ctx';
  const headline = b.gsax <= -3 ? (n ? 'Costing his team goals lately' : 'Costing his team goals') : b.gsax >= 3 ? (n ? 'Saving goals for his team lately' : 'Saving goals for his team') : 'About an average goalie';
  const where = inVs != null && outVs != null ? (inVs < outVs - 1 ? 'The damage is mostly on shots inside the home plate, from the slot.' : outVs < inVs - 1 ? 'The damage is mostly on shots from outside the home plate.' : '') : '';
  const qsLg = lg.lgQsPct;
  const chips = [
    `<span class="gc-chip ${bad}">Goaltending ${sg(b.gsax)}</span>`,
    inVs != null ? `<span class="gc-chip ${inVs <= -3 ? 'bad' : 'ctx'}">Inside the plate ${sg(inVs)}</span><span class="gc-chip ${outVs <= -3 ? 'bad' : 'ctx'}">Outside the plate ${sg(outVs)}</span>` : '',
    b.soft != null ? `<span class="gc-chip ${b.soft >= nStarts * 0.5 ? 'bad' : 'ctx'}">${b.soft} perimeter goal${b.soft === 1 ? '' : 's'}</span>` : '',
    b.qs != null ? `<span class="gc-chip ${qsLg != null && b.qs / nStarts < qsLg - 0.08 ? 'bad' : qsLg != null && b.qs / nStarts > qsLg + 0.08 ? 'good' : 'ctx'}">QS ${b.qs}/${b.n}</span>` : '',
  ].join('');
  const pts = radarPoints(lg, ctx.id);
  const bars = pts.length >= 3 ? `<div class="gc-bars" aria-label="NHL percentile by area">${pts.map((q) => `<div title="${esc(`${q.label}\n${q.tip}\nValue¦${RADAR_FMT[q.key](q.value)}\nNHL rank¦${ofN(q.rank).replace(' NHL', '')} of ${q.rank.of}`)}"><span>${esc(q.label)}</span><i><b style="width:${Math.max(2, q.pct)}%;background:${q.pct >= 50 ? UP : DOWN}"></b></i><em>${q.pct}</em></div>`).join('')}</div>` : '';
  const verdict = `<div class="gc-verdict ${bad}"><b>${headline}.</b> ${sg(b.gsax)} goals against an average goalie on the same shots${b.n ? ` over ${b.n} starts` : ''} (${playoffs ? 'this playoff run' : b.label}${season && gl ? `, ${ofN(gl)}` : ''}). ${b.sv != null && b.expSv != null ? `Save % ${sv3(b.sv)} against an expected ${sv3(b.expSv)}.` : ''}<div class="gc-chips">${chips}</div>${where ? `<p>${where}</p>` : ''}${bars}</div>`;

  const spider = radarChart(pts, n);
  const rk0 = season && me && me.rating != null ? rankAmong(lg.rows.map((g) => g.rating), me.rating, true) : null;
  const hl = `<div class="hl-strip"><div class="hl-c" tabindex="0" title="Average game score (0-10) from our scorecards. 6.0 is an average night."><span class="hl-k">Game score</span><span class="hl-v">${rk0 ? me.rating.toFixed(1) : '-'}</span><span class="hl-s">${rk0 ? `${rb(rk0)}<em>${me.rated} games</em>` : 'builds as games are rated'}</span></div><div class="hl-c" tabindex="0" title="Goals saved above expected"><span class="hl-k">GSAx</span><span class="hl-v">${sg(b.gsax)}</span><span class="hl-s">${season && gl ? rb(gl) : b.label}</span></div></div>`;
  const out = [hl, spider ? `<div class="gc-top">${verdict}${spider}</div>` : verdict];
  // Average game rating (our scorecard score; 6.0 = an average night), ranked among goalies with 5+ starts.
  const ratingTile = () => {
    if (!season || !me || me.rating == null) return '';
    const rk = rankAmong(lg.rows.map((g) => g.rating), me.rating, true);
    return `<div class="pq-t pq-ours" title="Average game rating from our scorecards: 6.0 is an average night. ${esc(ofN(rk))} of ${rk.of} goalies."><span class="pq-v">${me.rating.toFixed(1)}</span><span class="pq-k">Avg rating</span><span class="pq-s">${rb(rk)} ${me.rated} games</span></div>`;
  };
  // 1 Results
  const n0 = now;
  out.push(sec('gc-res', 'Results', 'what the NHL box score says', `<div class="pq-grid pc-grid">${n && b.last
    ? [plain('Starts', b.n), plain('QS', `${b.qs}/${b.n}`), plain('SV%', sv3(b.sv), '', 'hl'), plain('GAA', (b.ga / b.n).toFixed(2)), plain('Shutouts', b.so), plain('Shots against', b.sa)].join('')
    : [plain('GP', n0?.gp ?? 0), plain('W', n0?.wins ?? '-'), plain('L', n0?.losses ?? '-'), ...(playoffs ? [] : [plain('OTL', n0?.otLosses ?? '-')]), plain('SV%', sv3(n0?.savePct), '', 'hl'), plain('GAA', fmt.dec(n0?.gaa, 2)), plain('SO', n0?.shutouts ?? '-'), plain('Shots against', n0?.shotsAgainst ?? '-'), plain('TOI/GP', fmt.toi(n0?.toiPerGame)), ratingTile()].join('')}</div>`));
  // 2 Saves vs expected
  out.push(sec('gc-exp', 'Saves vs expected', 'goals kept out beyond an average goalie on the same shots', `
    <div class="pq-grid pc-grid">${[
      tile('GSAx', sg(b.gsax), season && gl ? rb(gl) : b.label, cls(b.gsax)),
      tile('GSAx/GP', sg(season ? ours.gsaxPerGame : gsaxPerStart, 2), season ? 'per game played' : 'per start', cls(b.gsax)),
      tile('Goals against', b.ga, `avg goalie ${fmt.dec(b.xga)} on the same shots`),
      b.sa ? tile('SV% vs exp', `${sg(((b.sv ?? 0) - (b.expSv ?? 0)) * 100, 1)}%`, `expected ${sv3(b.expSv)} on these shots`, cls(b.gsax)) : '',
      b.n ? tile('Shots per start', (b.sa / b.n).toFixed(1), 'workload') : '',
      b.sa ? tile('Saved per 100 shots', sg(rate(b.gsax) * 100, 2), 'size-neutral', cls(b.gsax)) : '',
    ].join('')}</div>
    ${playoffs ? '' : `    <div class="gc-cols"><div><h3 class="pc-sub">Running total by start</h3>${fig(playoffs ? unavailable('Start-by-start charts are built for the regular season.') : cumChart(starts))}</div>
    <div><h3 class="pc-sub">Each start</h3>${fig(playoffs ? '' : startBars(starts))}<p class="pq-note">Above the line: he beat an average goalie on the shots he faced. Below: goals the shots did not call for.</p></div></div>`}`));
  // 3 Shot location
  const rowHasPlate = ours.row?.psa != null;
  const shots = starts?.slice(n ? -n : 0) ?? null;
  out.push(sec('gc-loc', 'Shot location', 'where the shots come from and where they beat him', `
    <div class="gc-cols"${playoffs ? ' style="grid-template-columns:1fr"' : ''}>${playoffs ? '' : `<div><h3 class="pc-sub">Shots against him${shots ? ` <small>${shots.length} starts</small>` : ''}</h3>${fig(shotMap(shots))}
      <div class="gc-legend"><span><i style="background:#8b95a7"></i>Save</span><span><i style="background:${DOWN}"></i>Goal (tap to watch)</span><span><i class="ring"></i>Perimeter goal: outside the plate, under 6%</span></div></div>`}
    <div>${b.inSa != null && b.inSa + b.outSa > 0 ? `<div class="pq-grid pc-grid">${[
      tile('Inside plate SV%', sv3(1 - b.inGa / b.inSa), `${b.inGa} goals on ${b.inSa} · NHL AVG ${sv3(1 - lg.inRate)}`, cls(inVs)),
      tile('Outside plate SV%', sv3(1 - b.outGa / b.outSa), `${b.outGa} goals on ${b.outSa} · NHL AVG ${sv3(1 - lg.outRate)}`, cls(outVs)),
      tile('Inside vs avg', sg(inVs), 'goals', cls(inVs)), tile('Outside vs avg', sg(outVs), 'goals', cls(outVs)),
      tile('Perimeter goals', b.soft ?? 0, b.n ? `${((b.soft ?? 0) / b.n).toFixed(2)} per start` : '', (b.soft ?? 0) >= nStarts * 0.5 ? 'down' : ''),
      tile('Shots inside plate', fmt.pct(b.inSa / b.sa, 0), 'share of shots faced'),
    ].join('')}</div><h3 class="pc-sub">Save % against the NHL AVG, by area</h3>${fig(zoneChart(b, lg.inRate, lg.outRate))}<p class="pq-note">White tick = NHL AVG save % on shots from that area. Home plate = the slot (8 ft either side of the net at the goal line, widening to 19 ft, out to the top of the circles).</p>`
      : unavailable(playoffs ? 'Shot areas and the shot map are built for regular seasons.' : rowHasPlate || b.last ? 'No shots in this stretch.' : 'Shot areas are not built for this season yet; they fill in as the backfill rebuilds it.')}</div></div>`));
  // 4 Consistency
  const lgQs = lg.lgQsPct != null ? `NHL AVG ${fmt.pct(lg.lgQsPct, 0)}` : '';
  out.push(sec('gc-con', 'Consistency', 'quality starts and the bad nights', `
    <div class="pq-grid pc-grid">${[
      b.qs != null ? tile('Quality starts', b.qs, `of ${b.n} starts`, '', QS_TIP(lgSv)) : '',
      b.qs != null ? tile('QS%', fmt.pct(b.qs / nStarts, 0), season && ours.qsRank ? `${rb(ours.qsRank)} ${lgQs}` : lgQs, qsLg != null && b.qs / nStarts < qsLg - 0.08 ? 'down' : qsLg != null && b.qs / nStarts > qsLg + 0.08 ? 'up' : '', QS_TIP(lgSv)) : '',
      b.bad != null ? tile('Really bad starts', b.bad, 'GSAx −2 or worse', b.bad ? 'down' : '') : (starts?.length ? tile('Really bad starts', summarize(starts).bad, 'GSAx −2 or worse', '') : ''),
      b.so != null ? tile('Shutouts', b.so, '0 goals against') : '',
      b.soft != null && b.n ? tile('Perimeter goals/start', ((b.soft ?? 0) / nStarts).toFixed(2), season && me?.softPer != null ? rb(rankAmong(lg.rows.map((g) => g.softPer), me.softPer, false)) + ' fewest is best' : '') : '',
    ].join('')}</div>
    ${playoffs ? '' : `<h3 class="pc-sub">Every start, quality or not</h3>${fig(qsChart(starts?.slice(n ? -n : 0) ?? null, lgSv))}`}
    <div class="gc-legend"${playoffs ? ' hidden' : ''}><span><i style="background:${BLUE}"></i>Quality start</span><span><i style="background:${DOWN}"></i>Not a quality start</span><span>Bar = save %, dashed line = NHL AVG save % (${sv3(lgSv)})</span></div>
    <p class="pq-note">${QS_TIP(lgSv)} The NHL AVG is about ${fmt.pct(lg.lgQsPct ?? 0.54, 0)} quality starts.</p>`));
  // 5 League rank
  out.push(sec('gc-lg', 'Where he ranks', `among ${lg.rows.length} goalies with 5+ starts, ${playoffs ? 'this playoff run' : n ? 'season totals' : 'this season'}`, `${strips(lg, ctx.id)}<p class="pq-note">One dot per goalie, worse on the left and better on the right (perimeter goals flipped so fewer is right). Cyan = this goalie; the tick is the NHL median.</p>`));
  // 6 Starter quality
  out.push(sec('gc-pick', 'Starter quality', 'what the research says is worth watching', `<div class="gc-cols"><div class="pq-grid pc-grid">${[
    pick?.id ? tile('Pick edge', sg(W.goalie * pick.value, 2), 'goals a game in our pick when he starts vs an average goalie') : '',
    ours.gsaxRank ? tile('GSAx rank', ofN(ours.gsaxRank), `among NHL goalies`) : '',
  ].join('')}</div><div><p class="pq-note" style="margin-top:0"><b>What we tested</b> (6 seasons, 409,000 shots): save streaks, big saves, goalie pulls and last-5-starts form do not swing games or predict the next one, so goalies get no in-game momentum. Season-long skill is real (GSAx per shot repeats, split-half r .36), and the starter's GSAx this season and last (shrunk toward average) adds to our pre-game pick on the Scores page. <b>Pick edge</b> is that adjustment.</p></div></div>`));
  return out.join('');
}

const QS_TIP = (lgSv) => `Quality start: save % at least the NHL average this season${lgSv ? ` (${sv3(lgSv)})` : ''}, or under 20 shots with 2 goals or fewer allowed and a save % of .885+. A pulled starter is judged on the shots he faced; relief appearances don't count.`;

export const lastStartsSection = (starts, playoffs) => sec('gc-last', 'Last 10 starts', 'tap a date for the box score', playoffs ? unavailable('Start-by-start lists are built for the regular season.') : lastStarts(starts));

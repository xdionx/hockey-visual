// Skater card v2: the skater's page grouped by what belongs together (summary and spider, scoring with goal and
// assist clips, driving play, shooting, defense, discipline, faceoffs, NHL rank, last 10 games). Every ranked stat
// shows its NHL rank, is tinted in the top / bottom 10%, and explains itself on hover. Pure numbers: ../src/skaterCard.js.
import { esc, videoButton } from '../game/core.js';
import { fmt } from './store.js';
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
const wait = () => '<p class="pq-note gc-wait">Loading every game…</p>';

export const NAV = [['sk-sum', 'Summary'], ['sk-sco', 'Scoring'], ['sk-drv', 'Driving play'], ['sk-sho', 'Shooting'], ['sk-def', 'Defense'], ['sk-dis', 'Discipline'], ['sk-lg', 'NHL rank'], ['sk-hist', 'History'], ['sk-last', 'Last 10 games']];
export const navHtml = () => `<nav class="gc-nav" aria-label="Sections">${NAV.map(([id, l]) => `<a href="#${id}">${l}</a>`).join('')}</nav>`;

/** A ranked tile: value, label, "15th NHL" line, tinted in the top / bottom 10%, hover explains. */
function rtile(x, value, label, sub = '') {
  if (!x) return `<div class="pq-t pq-ours"><span class="pq-v">${value}</span><span class="pq-k">${label}</span>${sub ? `<span class="pq-s">${sub}</span>` : ''}</div>`;
  const tone = x.ctx ? '' : x.pct >= 0.9 ? ' rk-top' : x.pct <= 0.1 ? ' rk-low' : '';
  return `<div class="pq-t pq-ours${tone}" title="${esc(hoverText(x, fv(x)))}" tabindex="0"><span class="pq-v">${value}</span><span class="pq-k">${label}</span><span class="pq-s">${ofN(x.rank)}${x.teamRank ? ` · ${teamOrd(x.team, x.teamRank)}` : ''}${sub ? ` · ${sub}` : ''}</span></div>`;
}
const plain = (label, value, sub = '', tip = '') => `<div class="pq-t"${tip ? ` title="${esc(tip)}"` : ''}><span class="pq-v">${value}</span><span class="pq-k">${label}</span>${sub ? `<span class="pq-s">${sub}</span>` : ''}</div>`;

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

const chip = (x, good) => `<span class="sk-chip ${good ? 'up' : x.ugly ? 'ugly' : 'down'}" title="${esc(hoverText(x, fv(x)))}">${esc(x.label)} <b>${fv(x)(x.value)}</b> <small>${ofN(x.rank)}</small></span>`;

function summary(card) {
  const { summary: s, m } = card;
  const tierLine = (name, pct, tier, det) => `<div class="sk-row"><b>${name}</b> <span class="sk-tier ${pct == null ? '' : pct >= 0.7 ? 'up' : pct < 0.4 ? 'down' : ''}">${tier ?? 'not enough ice time yet'}</span>${det ? ` <span class="sk-det">${det}</span>` : ''}</div>`;
  const offDet = ['scoring', 'play'].filter((k) => m[k]).map((k) => `${m[k].label.toLowerCase()} ${ofN(m[k].rank)}`).join(', ');
  const defDet = m.def ? `${sg(m.def.value)} goals prevented vs teammates, ${ofN(m.def.rank)} among ${card.group === 'D' ? 'defensemen' : 'forwards'}` : '';
  const flags = card.row ? '' : '';
  return `<div class="gc-verdict ${s.headline.startsWith('Struggling') ? 'bad' : ''}"><b>${esc(s.headline)}.</b>
    ${tierLine('Offense', s.off, s.offTier, offDet)}${tierLine('Defense', s.def, s.defTier, defDet)}
    ${card.strengths.length ? `<div class="sk-sub">Strengths</div><div class="gc-chips">${card.strengths.map((x) => chip(x, true)).join('')}</div>` : ''}
    ${card.weak.length ? `<div class="sk-sub">Weak spots</div><div class="gc-chips">${card.weak.map((x) => chip(x, false)).join('')}</div>` : ''}${flags}</div>`;
}

// ── per-game charts ──
function gameBars(games, get, label, color) {
  if (!games?.length) return wait();
  const Wd = 560, Hh = 170, pad = 30, mid = (Hh - 24) / 2;
  const bw = (Wd - pad - 10) / games.length;
  const mx = Math.max(1, ...games.map((g) => Math.abs(get(g))));
  return `<svg viewBox="0 0 ${Wd} ${Hh}" role="img" aria-label="${esc(label)} by game"><line class="gc-zero" x1="${pad}" x2="${Wd - 6}" y1="${mid}" y2="${mid}"/>${games.map((g, i) => {
    const v = get(g), h = Math.max(1, (Math.abs(v) / mx) * (mid - 8));
    return `<rect x="${pad + i * bw + 1}" y="${v >= 0 ? mid - h : mid}" width="${Math.max(2, bw - 2)}" height="${h}" rx="2" fill="${color(g, v)}"><title>Game ${g.n} ${g.home ? 'vs' : '@'} ${esc(g.opp)}: ${esc(label)} ${sg(v, 1)}</title></rect>`;
  }).join('')}<text x="${pad}" y="${Hh - 4}">first game</text><text x="${Wd - 60}" y="${Hh - 4}">latest</text></svg>`;
}
const pointsBars = (games) => {
  if (!games?.length) return wait();
  const Wd = 560, Hh = 150, pad = 30, bw = (Wd - pad - 10) / games.length;
  const mx = Math.max(2, ...games.map((g) => g.g + g.a));
  return `<svg viewBox="0 0 ${Wd} ${Hh}" role="img" aria-label="Goals and assists by game">${games.map((g, i) => {
    const x = pad + i * bw + 1, u = (Hh - 30) / mx, hg = g.g * u, ha = g.a * u;
    return `<g><title>Game ${g.n} ${g.home ? 'vs' : '@'} ${esc(g.opp)}: ${g.g} G, ${g.a} A</title><rect x="${x}" y="${Hh - 20 - hg}" width="${Math.max(2, bw - 2)}" height="${hg}" fill="${UP}"/><rect x="${x}" y="${Hh - 20 - hg - ha}" width="${Math.max(2, bw - 2)}" height="${ha}" fill="${BLUE}"/></g>`;
  }).join('')}<line class="gc-zero" x1="${pad}" x2="${Wd - 6}" y1="${Hh - 20}" y2="${Hh - 20}"/><text x="${pad}" y="${Hh - 4}">goals green, assists blue</text></svg>`;
};

// ── clips ──
const clipRow = (c) => `<li><span class="sk-clip-d">${day(c.date)}</span> ${c.home ? 'vs' : '@'} ${esc(c.opp)} <span class="sk-tag">${c.kind}</span> <span class="sk-clip-t">${esc(c.period)} ${esc(c.time)}${c.tags?.length ? ` · ${esc(c.tags.join(' '))}` : ''}${c.kind === 'G' ? '' : ` · goal by ${esc(c.scorer)}`}</span> ${c.id ? videoButton(c.id, `${c.kind === 'G' ? 'Goal' : 'Assist'}: ${c.scorer}, ${day(c.date)} ${c.home ? 'vs' : '@'} ${c.opp}`, '▶ Watch') : c.href ? `<a class="sk-watch" href="${esc(c.href)}" target="_blank" rel="noopener">▶ Watch</a>` : ''}</li>`;
export function clipsHtml(clips, tab, all, seasonLabel) {
  if (!clips) return wait();
  const list = clips.filter((c) => (tab === 'all' ? true : tab === 'g' ? c.kind === 'G' : c.kind !== 'G')).slice().reverse();
  const shown = all ? list : list.slice(0, 5);
  return `<div class="sk-clips"><div class="pc-type" role="group" aria-label="Goals or assists">${[['g', 'Goals'], ['a', 'Assists'], ['all', 'All']].map(([k, l]) => `<button type="button" data-sk-tab="${k}" aria-pressed="${k === tab}">${l}</button>`).join('')}</div>
    ${shown.length ? `<ul class="sk-cliplist${all ? ' sk-scroll' : ''}">${shown.map(clipRow).join('')}</ul>` : `<p class="pq-note">No ${tab === 'a' ? 'assists' : tab === 'g' ? 'goals' : 'goals or assists'} yet this ${seasonLabel}.</p>`}
    ${list.length > 5 ? `<button type="button" class="sk-more" data-sk-all="${all ? 0 : 1}">${all ? 'Show fewer' : `Show all ${list.length}`}</button>` : ''}</div>`;
}

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
  await Promise.all(Array.from({ length: 6 }, worker));
  out.sort((a, b) => a.n - b.n);
  return out;
}

/** Goal and assist clips: loads the saved game file of every game he scored or assisted in. */
export async function loadClips(p, games) {
  const out = [];
  let next = 0;
  const list = games.filter((g) => g.g || g.a);
  const worker = async () => {
    while (next < list.length) {
      const g = list[next++];
      const game = await getData(`games/${g.id}.json`).catch(() => null);
      if (!game) continue;
      g.date = game.gameDate;
      for (const s of game.scoring ?? []) {
        const goal = s.scorer?.id === p.id;
        if (!goal && !(s.assists ?? []).some((x) => x.id === p.id)) continue;
        out.push({ ...g, date: game.gameDate, kind: goal ? 'G' : (s.assists[0].id === p.id ? 'A1' : 'A2'), period: s.period, time: s.time, tags: s.tags, scorer: s.scorer?.fullName, id: s.highlightId, href: s.highlight });
      }
    }
  };
  await Promise.all(Array.from({ length: 6 }, worker));
  // Dates for the games without a clip lookup (no scoring) come from the same files where available.
  return out.sort((a, b) => (a.date ?? '').localeCompare(b.date ?? '') || a.n - b.n || a.time.localeCompare(b.time));
}

/** The grouped sections. games / clips are null until loaded. */
export function skaterSections({ card, now, games, clips, tab, all, playoffs }) {
  const { m, row, pg } = card;
  const gl = games ?? [];
  const out = [];
  const spiderHtml = spider(card.spider);
  const defHtml = card.defBars.length ? `<figure class="gc-defbars"><figcaption>Defense: percentile vs NHL ${card.group === 'D' ? 'defensemen' : 'forwards'}, 100 = best</figcaption>${bars(card.defBars)}</figure>` : '<p class="pq-note">Defense numbers need more ice time.</p>';
  out.push(`<div class="gc-top" id="sk-sum">${summary(card)}<div>${spiderHtml}${defHtml}</div></div>`);
  const season = playoffs ? 'playoff run' : 'season';
  out.push(sec('sk-sco', 'Scoring', 'goals, assists and what they are worth', `<div class="pq-grid pc-grid">
    ${plain('G', now?.goals ?? row.g ?? '-')}${plain('A', now?.assists ?? '-')}${plain('P', now?.points ?? '-')}
    ${rtile(m.scoring, sg(pg.scoringVsAvg), 'Scoring vs avg', 'per game rank')}${rtile(m.fin, sg(pg.gaa), 'Goals vs avg', 'finishing')}
    ${plain('Playmaking', sg(pg.playVsAvg), 'assists vs avg', 'Three quarters of the assists above an average player at the position.')}${plain('PIM', now?.pim ?? row.pim ?? '-')}</div>
    ${fig(pointsBars(gl.length ? gl : null))}
    <h3 class="pc-sub">Clips <small>goals and assists, last 5 first</small></h3><div id="sk-clips">${clipsHtml(clips, tab, all, season)}</div>`));
  out.push(sec('sk-drv', 'Driving play', 'shot attempts and momentum', `<div class="pq-grid pc-grid">
    ${rtile(m.sat, fmt.dec(pg.satPerGame), 'SAT/GP')}${rtile(m.play, sg(pg.momPerGame), 'MOM/GP')}
    ${plain('MOM +/GP', sg(pg.momPosPerGame), 'created')}${plain('MOM −/GP', sg(pg.momNegPerGame), 'given up')}
    ${pg.abovePct != null ? plain('Above avg games', fmt.pct(pg.abovePct, 0), `below avg ${fmt.pct(pg.belowPct, 0)}`) : ''}</div>
    ${fig(gameBars(gl.length ? gl : null, (g) => g.mom, 'Momentum', (g) => (g.tier > 0 ? UP : g.tier < 0 ? DOWN : '#8b95a7')))}`));
  out.push(sec('sk-sho', 'Shooting', 'what he does with the puck near the net', `<div class="pq-grid pc-grid">
    ${plain('Shots', pg.sogPerGame != null ? (pg.sogPerGame * pg.gp).toFixed(0) : '-')}${plain('S%', fmt.pct(pg.shPct), `avg shooter ${fmt.pct(pg.xShPct)}`)}
    ${rtile(m.xg, fmt.dec(row.xg ?? 0, 1), 'xG', `${(m.xg?.value ?? 0).toFixed(2)}/game`)}${rtile(m.vol, fmt.pct(card.areas.vol?.share, 0), 'Shot volume', 'attempts on net')}
    ${plain('Attempts', row.sat)}</div>`));
  const att60 = row.oto ? ((row.oca ?? 0) * 3600) / row.oto : null;
  out.push(sec('sk-def', 'Defense', `${card.group === 'D' ? 'defensemen' : 'forwards'} are compared with teammates at the same position`, `<div class="pq-grid pc-grid">
    ${rtile(m.def, m.def ? sg(m.def.value) : '-', 'Goals prevented', 'vs teammates')}
    ${att60 != null ? plain('Attempts against /60', att60.toFixed(1), 'on ice, all strengths') : ''}
    ${row.oto ? plain('On-ice shot share', fmt.pct((row.ocf ?? 0) / Math.max(1, (row.ocf ?? 0) + (row.oca ?? 0)), 0)) : ''}
    ${plain('Blocks', row.bl ?? '-', '', 'Shot blocks (context)')}${plain('Takeaways', row.tk ?? '-', 'context')}${row.toi ? plain('TOI/GP', fmt.toi(row.toi / row.gp)) : ''}</div>
    <p class="pq-note">Goals prevented = how many fewer shot attempts than his teammates at the same position the other team gets while he is on the ice, turned into goals (shrunk, since only part of it carries to the next season). It overlaps with puck possession and a pair partner shares the credit. Goals against and plus/minus are not used: they are too noisy over a season.</p>`));
  out.push(sec('sk-dis', 'Discipline and puck', 'penalties and giveaways', `<div class="pq-grid pc-grid">
    ${rtile(m.pen, m.pen ? sg(m.pen.value, 2) : '-', 'Net penalties /GP', 'drawn − taken')}${plain('Drawn', card.areas.pen?.drawn ?? '-')}${plain('Taken', card.areas.pen?.taken ?? '-')}
    ${rtile(m.give, m.give ? m.give.value.toFixed(1) : '-', 'Giveaways /GP', 'context')}${plain('Takeaways /GP', card.areas.give ? card.areas.give.takePerGame.toFixed(1) : '-', 'context')}
    ${m.fo ? rtile(m.fo, fmt.pct(m.fo.value, 1), 'Faceoff %', `of ${(card.areas.fo?.n ?? 0)}`) : ''}</div>`));
  const dots = Object.values(m).filter((x) => !x.ctx);
  out.push(sec('sk-lg', 'NHL rank', 'where he sits among NHL skaters, left = worst, right = best', dots.map((x) => `<div class="sk-dot" title="${esc(hoverText(x, fv(x)))}"><span>${esc(x.label)}</span><i><b style="left:${(x.pct * 100).toFixed(1)}%;background:${x.pct >= 0.5 ? UP : DOWN}"></b></i><em>${ofN(x.rank)}</em></div>`).join('')));
  return out.join('');
}

/** Last 10 games: his line in each, with tier color. */
export function lastGamesSection(games, playoffs) {
  if (playoffs) return '';
  if (!games) return sec('sk-last', 'Last 10 games', '', wait());
  const last = games.slice(-10).reverse();
  if (!last.length) return '';
  return sec('sk-last', 'Last 10 games', 'newest first', `<div class="pc-scroll"><table class="pc-table"><thead><tr><th class="l">Game</th><th>G</th><th>A</th><th>SOG</th><th>SAT</th><th>MOM</th><th>Impact</th></tr></thead><tbody>${last.map((g) => `<tr><td class="l">${g.home ? 'vs' : '@'} ${esc(g.opp)}</td><td>${g.g}</td><td>${g.a}</td><td>${g.line.sog ?? 0}</td><td>${g.sat}</td><td class="${g.mom >= 0 ? 'up' : 'down'}">${sg(g.mom)}</td><td class="${g.tier > 0 ? 'up' : g.tier < 0 ? 'down' : ''}">${g.tier > 0 ? 'Above avg' : g.tier < 0 ? 'Below avg' : 'Average'}</td></tr>`).join('')}</tbody></table></div>`);
}

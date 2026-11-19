// Design 4 "Analytics": shot map, shot-attempt flow and heat-mapped player stats.
// Inspired by HockeyStats and NHL EDGE style analytics pages.
import { ZONES, esc, logo, teamColors, statusText, prettyDate, allSkaters, allGoalies, pct, signed, rinkMarkup, shotMark, elapsed, headshot } from './core.js';

function header(game, c) {
  const ls = game.linescore;
  return `<section class="a-head">
    <div class="a-side" style="--team:${c.away}">${logo(game.away, 'a-logo', true)}<b>${esc(game.away.abbrev)}</b><span class="a-sc">${ls.totals.away}</span></div>
    <div class="a-mid"><span class="a-st ${game.status.state}">${esc(statusText(game))}</span><span>${esc(prettyDate(game.gameDate))}</span></div>
    <div class="a-side r" style="--team:${c.home}"><span class="a-sc">${ls.totals.home}</span><b>${esc(game.home.abbrev)}</b>${logo(game.home, 'a-logo', true)}</div>
  </section>`;
}

export function shotSummary(game) {
  const by = (side) => {
    const s = game.shots.filter((x) => x.team === side);
    const n = (k) => s.filter((x) => x.kind === k).length;
    const sog = n('sog') + n('goal');
    return { attempts: s.length, sog, goals: n('goal'), miss: n('miss'), block: n('block'), shPct: sog ? (100 * n('goal')) / sog : 0 };
  };
  return { away: by('away'), home: by('home') };
}

export function kpis(game, c) {
  const s = shotSummary(game);
  const tot = s.away.attempts + s.home.attempts || 1;
  const cf = (100 * s.away.attempts) / tot;
  const pp = game.teamStats.find((x) => x.key === 'powerPlay');
  const fo = game.teamStats.find((x) => x.key === 'faceoffWinningPctg');
  const tile = (label, a, h, aw = null) => `<div class="a-kpi"><span class="a-k">${label}</span>
    <div class="a-kv"><b style="color:${c.away}">${a}</b><b style="color:${c.home}">${h}</b></div>
    ${aw != null ? `<div class="a-kbar"><i style="width:${aw}%;background:${c.away}"></i><i style="width:${100 - aw}%;background:${c.home}"></i></div>` : ''}</div>`;
  return `<section class="a-kpis">
    ${tile('Shot attempts (Corsi)', s.away.attempts, s.home.attempts, cf)}
    ${tile('Shots on goal', s.away.sog, s.home.sog, (100 * s.away.sog) / (s.away.sog + s.home.sog || 1))}
    ${tile('Shooting %', `${s.away.shPct.toFixed(1)}%`, `${s.home.shPct.toFixed(1)}%`)}
    ${tile('Missed / blocked', `${s.away.miss}/${s.away.block}`, `${s.home.miss}/${s.home.block}`)}
    ${pp ? tile('Power play', pp.away, pp.home) : ''}
    ${fo ? tile('Faceoffs', fo.away, fo.home, fo.awayNum) : ''}
  </section>`;
}

export function shotMap(game, c) {
  return `<section class="a-card a-map"><div class="a-card-head"><h2>Shot map</h2>
      <div class="a-filters" id="a-filters">
        <div class="a-seg" data-filter="view"><button data-v="dots" aria-pressed="true">Shot map</button><button data-v="zones" aria-pressed="false">Zone map</button></div>
        <div class="a-seg" data-filter="team"><button data-v="all" aria-pressed="true">Both</button><button data-v="away" aria-pressed="false">${esc(game.away.abbrev)}</button><button data-v="home" aria-pressed="false">${esc(game.home.abbrev)}</button></div>
        <div class="a-seg" data-filter="period"><button data-v="all" aria-pressed="true">All</button>${[...new Set(game.shots.map((s) => s.period))].map((p) => `<button data-v="${esc(p)}" aria-pressed="false">${p === 'OT' ? 'OT' : `P${esc(p)}`}</button>`).join('')}</div>
      </div></div>
    <div class="a-rinkwrap"><span class="a-att" style="color:${c.away}">&#9664; ${esc(game.away.abbrev)} attacking</span><span class="a-att r" style="color:${c.home}">${esc(game.home.abbrev)} attacking &#9654;</span>
      <svg class="a-rink" viewBox="-101 -43.5 202 87" role="img" aria-label="Shot locations">${rinkMarkup()}<clipPath id="a-zone-clip"><rect x="-100" y="-42.5" width="200" height="85" rx="28" ry="28"/></clipPath><g id="a-zones" clip-path="url(#a-zone-clip)"></g><g id="a-shots"></g><g id="a-zone-labels"></g></svg></div>
    <div class="a-legend" id="a-dot-legend"><span><svg viewBox="-3 -3 6 6"><circle r="2.6" fill="currentColor"/></svg>Goal</span><span><svg viewBox="-3 -3 6 6"><circle r="2" fill="none" stroke="currentColor" stroke-width=".9"/></svg>On goal</span><span><svg viewBox="-3 -3 6 6"><path d="M-1.6-1.6l3.2 3.2M1.6-1.6l-3.2 3.2" stroke="currentColor" stroke-width=".8"/></svg>Missed</span><span><svg viewBox="-3 -3 6 6"><rect x="-1.4" y="-1.4" width="2.8" height="2.8" fill="currentColor" opacity=".5"/></svg>Blocked</span></div>
    <p class="a-zone-key" id="a-zone-key" hidden>Big number = shot attempts in the zone. <b>S</b> on goal (including goals), <b>M</b> missed, <b>B</b> blocked. Discs are goals, numbered with the scorer's sweater number: hover for the scorer, assists and goalie, click to watch.</p>
    <div id="a-zone-table" hidden></div>
  </section>`;
}

/** Cumulative shot attempts over game time, with goal markers. */
export function flowChart(game, c) {
  const reg = game.linescore.periods.filter((p) => p.label !== 'SO').length;
  const end = reg > 3 ? 3600 + (reg - 3) * 300 : 3600;
  const W = 600; const H = 200; const P = { l: 30, r: 10, t: 10, b: 24 };
  const series = (side) => {
    let n = 0;
    const pts = [[0, 0]];
    for (const s of game.shots.filter((x) => x.team === side).sort((a, b) => a.elapsed - b.elapsed)) {
      const e = s.elapsed > 3600 ? 3600 + (s.elapsed - 3600) : s.elapsed;
      pts.push([e, n]); n++; pts.push([e, n]);
    }
    pts.push([Math.min(end, game.status.state === 'final' ? end : Math.max(...pts.map((p) => p[0]))), n]);
    return pts;
  };
  const a = series('away'); const h = series('home');
  const max = Math.max(a.at(-1)[1], h.at(-1)[1], 10);
  const X = (e) => P.l + ((W - P.l - P.r) * e) / end;
  const Y = (v) => H - P.b - ((H - P.t - P.b) * v) / max;
  const path = (pts) => pts.map(([e, v], i) => `${i ? 'L' : 'M'}${X(e).toFixed(1)} ${Y(v).toFixed(1)}`).join('');
  const goals = game.scoring.filter((g) => g.period !== 'SO').map((g) => {
    const side = g.team === game.away.abbrev ? 'away' : 'home';
    const e = elapsed(g.period, g.time);
    const pts = side === 'away' ? a : h;
    let v = 0; for (const [pe, pv] of pts) if (pe <= e) v = pv;
    return `<circle cx="${X(e)}" cy="${Y(v)}" r="5" fill="${c[side]}" stroke="var(--a-bg)" stroke-width="2"><title>${esc(`${g.team} goal · ${g.scorer.name}`)}</title></circle>`;
  }).join('');
  const grid = [0, 1200, 2400, 3600].filter((x) => x <= end).map((x) => `<line x1="${X(x)}" x2="${X(x)}" y1="${P.t}" y2="${H - P.b}" class="a-grid"/>`).join('');
  const yt = [0, Math.round(max / 2), max].map((v) => `<text x="${P.l - 6}" y="${Y(v) + 4}" text-anchor="end">${v}</text>`).join('');
  const labels = ['1st', '2nd', '3rd', 'OT'].slice(0, Math.max(3, reg > 3 ? 4 : 3)).map((l, i) => `<text x="${X(i * 1200 + (i < 3 ? 600 : 150))}" y="${H - 6}" text-anchor="middle">${l}</text>`).join('');
  return `<section class="a-card"><h2>Shot attempt flow</h2>
    <svg class="a-flow" viewBox="0 0 ${W} ${H}" role="img" aria-label="Cumulative shot attempts">${grid}${yt}${labels}
      <path d="${path(a)}" fill="none" stroke="${c.away}" stroke-width="2.5"/><path d="${path(h)}" fill="none" stroke="${c.home}" stroke-width="2.5"/>${goals}
    </svg>
    <div class="a-legend"><span style="color:${c.away}">&#9632; ${esc(game.away.abbrev)}</span><span style="color:${c.home}">&#9632; ${esc(game.home.abbrev)}</span><span>&#9679; Goal</span></div>
  </section>`;
}

const HEAT_COLS = [
  ['gameScore', 'GS', (p) => p.gameScore.toFixed(2)], ['points', 'P'], ['goals', 'G'], ['assists', 'A'], ['sog', 'SOG'], ['attempts', 'iCF'],
  ['plusMinus', '+/-', (p) => signed(p.plusMinus)], ['hits', 'HIT'], ['blocks', 'BLK'], ['takeaways', 'TK'], ['giveaways', 'GV'], ['toiSeconds', 'TOI', (p) => p.toi],
];

export function heatTable(game, c) {
  const list = allSkaters(game).sort((a, b) => b.gameScore - a.gameScore);
  const range = Object.fromEntries(HEAT_COLS.map(([k]) => [k, [Math.min(...list.map((p) => p[k])), Math.max(...list.map((p) => p[k]))]]));
  const heat = (k, v) => {
    const [lo, hi] = range[k];
    if (hi === lo) return 0;
    const t = (v - lo) / (hi - lo);
    return k === 'giveaways' ? -t : t;
  };
  const cell = ([k, , f]) => (p) => {
    const t = heat(k, p[k]);
    const bg = t >= 0 ? `rgba(56, 189, 248, ${(t * 0.55).toFixed(2)})` : `rgba(248, 113, 113, ${(-t * 0.5).toFixed(2)})`;
    return `<td data-v="${p[k]}" style="background:${bg}">${f ? esc(f(p)) : p[k]}</td>`;
  };
  return `<section class="a-card"><h2>Skaters <small>sorted by game score; click a heading to re-sort</small></h2>
    <div class="a-scroll"><table class="a-table sortable">
      <thead><tr><th class="l" data-sort>Player</th><th data-sort>Tm</th><th data-sort>Pos</th>${HEAT_COLS.map(([, l]) => `<th data-sort>${l}</th>`).join('')}</tr></thead>
      <tbody>${list.map((p) => `<tr><td class="l" data-v="${esc(p.lastName)}">${esc(p.name)}</td><td><span class="a-tm" style="background:${c[p.side]}">${esc(p.team)}</span></td><td>${esc(p.position)}</td>${HEAT_COLS.map((col) => cell(col)(p)).join('')}</tr>`).join('')}</tbody>
    </table></div>
    <p class="a-note">GS = Game Score (goals, primary and secondary assists, shots, blocks, penalties drawn and taken, faceoffs and on-ice +/-). iCF = individual shot attempts.</p>
  </section>`;
}

export function goalies(game, c) {
  const list = allGoalies(game);
  if (!list.length) return '';
  return `<section class="a-card"><h2>Goaltending</h2><div class="a-goalies">${list.map((g) => {
    const sv = g.shotsAgainst ? g.saves / g.shotsAgainst : 0;
    return `<div class="a-g" style="--team:${c[g.side]}">
      <svg viewBox="0 0 36 36" class="a-ring"><circle cx="18" cy="18" r="15.9" class="bgc"/><circle cx="18" cy="18" r="15.9" class="fg" stroke-dasharray="${(sv * 100).toFixed(1)} 100"/></svg>
      <div><strong>${esc(g.fullName)}</strong> <span class="a-muted">${esc(g.team)}${g.decision ? ` · ${esc(g.decision)}` : ''}</span>
        <div class="a-big">${pct(g.savePct)}</div>
        <div class="a-muted">${g.saves}/${g.shotsAgainst} saves · EV ${esc(g.evenStrength)} · PP ${esc(g.powerPlay)} · SH ${esc(g.shorthanded)} · GS ${g.gameScore.toFixed(2)}</div></div>
    </div>`;
  }).join('')}</div></section>`;
}

/** Draws the shot map dots and wires its team/period filters. */
// Kept outside the render so live refreshes don't reset the filters.
const shotFilter = { view: 'dots', team: 'all', period: 'all' };

/** Zone rectangles shaded by attempts, with "attempts · goals" labels, for one team's attacking end. */
function zoneLayer(game, shots, team, color) {
  const flip = team === 'away' ? -1 : 1;
  const counts = {};
  for (const s of shots) {
    const z = (counts[s.zone] ??= { att: 0, goals: 0, sog: 0, miss: 0, block: 0 });
    z.att++;
    if (s.kind === 'goal') z.goals++;
    if (s.kind === 'goal' || s.kind === 'sog') z.sog++;
    else z[s.kind]++;
  }
  const max = Math.max(1, ...ZONES.filter((z) => z[2] != null).map(([k]) => counts[k]?.att ?? 0));
  const out = { rects: '', labels: '', goals: '' };
  for (const [k, label, x1, x2, y1, y2] of ZONES.filter((z) => z[2] != null)) {
    const n = counts[k] ?? { att: 0, goals: 0, sog: 0, miss: 0, block: 0 };
    const xs = [x1 * flip, x2 * flip].sort((a, b) => a - b);
    const ys = [-y2 * flip, -y1 * flip].sort((a, b) => a - b); // svg y is flipped
    const op = n.att ? 0.12 + 0.7 * (n.att / max) : 0.03;
    const cx = (xs[0] + xs[1]) / 2;
    const cy = (ys[0] + ys[1]) / 2;
    out.rects += `<rect class="a-zone" x="${xs[0]}" y="${ys[0]}" width="${xs[1] - xs[0]}" height="${ys[1] - ys[0]}" fill="${color}" fill-opacity="${op.toFixed(2)}" stroke="rgba(255,255,255,.25)" stroke-width=".4"><title>${esc(`${label}: ${n.att} attempts, ${n.goals} goals`)}</title></rect>`;
    // Labels sit above the goal dots so the counts stay readable.
    const tall = ys[1] - ys[0] > 12;
    const goals = shots.filter((x) => x.kind === 'goal' && x.zone === k);
    const ny = n.att && tall ? cy - (goals.length ? 3.6 : 2) : cy;
    out.labels += `<text x="${cx}" y="${ny}" text-anchor="middle" dominant-baseline="middle" class="a-zone-n${n.att ? '' : ' zero'}">${n.att}${n.goals ? `<tspan class="a-zone-g"> · ${n.goals}G</tspan>` : ''}</text>`;
    // Attempt types under the total: S on goal (incl. goals), M missed, B blocked.
    if (n.att && tall) out.labels += `<text x="${cx}" y="${goals.length ? cy + 1.6 : cy + 3.6}" text-anchor="middle" dominant-baseline="middle" class="a-zone-k"><tspan>S</tspan>${n.sog} <tspan>M</tspan>${n.miss} <tspan>B</tspan>${n.block}</text>`;
    // Goals sit in their zone as a row of scorer-number discs.
    goals.forEach((g, i) => { out.goals += goalMark(game, g, color, 1.9, [cx + (i - (goals.length - 1) / 2) * 4.3, tall ? cy + 6 : cy + 4]); });
  }
  return out;
}

function zoneTable(game, shots, c, teams) {
  return `<div class="a-zone-tables">${teams.map((team) => {
    const mine = shots.filter((s) => s.team === team);
    const rows = ZONES.map(([k, label]) => {
      const z = mine.filter((s) => s.zone === k);
      const sog = z.filter((s) => s.kind === 'sog' || s.kind === 'goal').length;
      const g = z.filter((s) => s.kind === 'goal').length;
      return { label, att: z.length, sog, g, miss: z.filter((s) => s.kind === 'miss').length, block: z.filter((s) => s.kind === 'block').length };
    }).sort((a, b) => b.att - a.att);
    return `<table class="a-table a-zt"><caption style="color:${c[team]}">${esc(game[team].abbrev)} shot attempts by zone</caption>
      <thead><tr><th class="l">Zone</th><th>Att</th><th>On goal</th><th>Missed</th><th>Blocked</th><th>Goals</th><th>Sh%</th></tr></thead>
      <tbody>${rows.map((r) => `<tr><td class="l">${esc(r.label)}</td><td>${r.att}</td><td>${r.sog}</td><td>${r.miss}</td><td>${r.block}</td><td>${r.g}</td><td>${r.sog ? `${Math.round((100 * r.g) / r.sog)}%` : '-'}</td></tr>`).join('')}</tbody></table>`;
  }).join('')}</div>`;
}

const players = new WeakMap();
/** Every player in the game by id (skaters and goalies). */
function playerIndex(game) {
  if (!players.has(game)) {
    const m = new Map();
    for (const side of ['away', 'home']) for (const g of ['forwards', 'defense', 'goalies']) for (const p of game.players[side][g]) m.set(p.id, { ...p, side });
    players.set(game, m);
  }
  return players.get(game);
}

const scoringFor = (game, s) => game.scoring.find((g) => g.period === s.period && g.time === s.time && g.team === game[s.team].abbrev);

/** Goal marker: team-color disc with the scorer's sweater number. Click opens the visualizer or highlight. */
function goalMark(game, s, color, r, at = null) {
  const scorer = playerIndex(game).get(s.shooterId);
  const g = scoringFor(game, s);
  const title = `${game[s.team].abbrev} · ${scorer?.name ?? 'Goal'} · ${s.period === 'OT' ? 'OT' : `P${s.period}`} ${s.time}`;
  const open = g?.visualizer ? `data-embed-url="${esc(g.visualizer)}" data-video-title="${esc(`${title} · Goal visualizer`)}"`
    : g?.highlightId ? `data-video-id="${esc(g.highlightId)}" data-video-title="${esc(title)}"` : '';
  const x = at ? at[0] : s.x;
  const y = at ? at[1] : -s.y;
  const num = scorer?.number ?? '';
  return `<g class="shot goal goal-mark" data-goal="${game.shots.indexOf(s)}" tabindex="0" role="button" aria-label="${esc(title)}" ${open}>
    <circle cx="${x}" cy="${y}" r="${r}" fill="${color}" stroke="#fff" stroke-width="0.6"/>
    <text x="${x}" y="${y + 0.1}" text-anchor="middle" dominant-baseline="middle" font-size="${r * (String(num).length > 1 ? 1.05 : 1.25)}">${esc(num)}</text></g>`;
}

/** Hover or focus a goal to see the scorer, assists and the goalie scored on. */
function mountGoalTips(root, game, c) {
  const wrap = root.querySelector('.a-rinkwrap');
  if (!wrap || wrap.querySelector('.a-goal-tip')) return;
  const tip = document.createElement('div');
  tip.className = 'a-goal-tip';
  tip.hidden = true;
  wrap.append(tip);
  const idx = playerIndex(game);
  const person = (p, role, extra = '') => p ? `<div class="gt-p">${headshot(p, 'gt-mug')}<div><span class="gt-role">${role}</span><b>${p.number != null ? `#${p.number} ` : ''}${esc(p.fullName)}</b>${extra ? `<small>${extra}</small>` : ''}</div></div>` : '';
  const show = (el) => {
    const s = game.shots[+el.dataset.goal];
    if (!s) return;
    const g = scoringFor(game, s);
    const scorer = idx.get(s.shooterId);
    const assists = (s.assistIds ?? []).map((id) => idx.get(id)).filter(Boolean);
    const goalie = idx.get(s.goalieId);
    tip.style.setProperty('--team', c[s.team]);
    tip.innerHTML = `<div class="gt-head"><b>${esc(game[s.team].abbrev)} goal</b><span>${s.period === 'OT' ? 'OT' : `P${esc(s.period)}`} ${esc(s.time)}${s.shotType ? ` · ${esc(s.shotType)}` : ''}${g ? ` · ${g.score.away}-${g.score.home}` : ''}</span>${(g?.tags ?? []).map((t) => `<i>${esc(t)}</i>`).join('')}</div>
      ${person(scorer, 'Goal', g?.scorer?.goalsToDate != null ? `${g.scorer.goalsToDate} this season` : '')}
      ${assists.length ? assists.map((a, i) => person(a, i ? 'Secondary assist' : 'Primary assist')).join('') : '<div class="gt-none">Unassisted</div>'}
      ${goalie ? `<div class="gt-sep"></div>${person(goalie, 'Scored on', esc(game[goalie.side].abbrev))}` : g?.tags?.includes('EN') ? '<div class="gt-sep"></div><div class="gt-none">Empty net</div>' : ''}
      ${el.dataset.embedUrl ? '<div class="gt-foot">Click to watch the goal visualizer</div>' : el.dataset.videoId ? '<div class="gt-foot">Click to watch the highlight</div>' : ''}`;
    tip.hidden = false;
    // Fixed to the viewport so the card is never clipped; it goes where there is more room.
    const r = el.getBoundingClientRect();
    const x = r.left + r.width / 2;
    tip.style.left = `${Math.min(Math.max(8, x - tip.offsetWidth / 2), innerWidth - tip.offsetWidth - 8)}px`;
    const above = r.top - tip.offsetHeight - 10;
    tip.style.top = `${above >= 70 || r.top > innerHeight - r.bottom ? Math.max(8, above) : r.bottom + 10}px`;
  };
  const hide = () => { tip.hidden = true; };
  wrap.addEventListener('pointerover', (e) => { const el = e.target.closest('.goal-mark'); if (el) show(el); });
  wrap.addEventListener('pointerout', (e) => { if (e.target.closest('.goal-mark') && !e.relatedTarget?.closest?.('.goal-mark')) hide(); });
  wrap.addEventListener('focusin', (e) => { const el = e.target.closest('.goal-mark'); if (el) show(el); });
  wrap.addEventListener('focusout', hide);
  addEventListener('scroll', hide, { passive: true });
}

export function mountShotMap(root, game, c) {
  const state = shotFilter;
  root.querySelectorAll('#a-filters [data-filter]').forEach((seg) => {
    const want = seg.querySelector(`button[data-v="${state[seg.dataset.filter]}"]`) ? state[seg.dataset.filter] : seg.querySelector('button').dataset.v;
    state[seg.dataset.filter] = want;
    seg.querySelectorAll('button').forEach((x) => x.setAttribute('aria-pressed', String(x.dataset.v === want)));
  });
  const draw = () => {
    const shots = game.shots.filter((s) => (state.team === 'all' || s.team === state.team) && (state.period === 'all' || s.period === state.period));
    const zones = state.view === 'zones';
    const teams = state.team === 'all' ? ['away', 'home'] : [state.team];
    const layers = zones ? teams.map((t) => zoneLayer(game, shots.filter((s) => s.team === t), t, c[t])) : [];
    root.querySelector('#a-zones').innerHTML = layers.map((l) => l.rects).join('');
    root.querySelector('#a-zone-labels').innerHTML = layers.map((l) => l.labels).join('') + `<g pointer-events="all">${layers.map((l) => l.goals).join('')}</g>`;
    // Draw goals last so they sit on top. In zone view only goals stay, to show where scoring came from.
    const order = { block: 0, miss: 1, sog: 2, goal: 3 };
    // In zone view goals are drawn inside their zone; only goals from outside the zone keep their spot.
    const dots = zones ? shots.filter((s) => s.kind === 'goal' && !ZONES.find((z) => z[0] === s.zone && z[2] != null)) : shots;
    root.querySelector('#a-shots').innerHTML = dots.sort((a, b) => order[a.kind] - order[b.kind]).map((s) => (s.kind === 'goal' ? goalMark(game, s, c[s.team], zones ? 2.4 : 2.9) : shotMark(s, c[s.team], 2.2))).join('');
    root.querySelector('#a-dot-legend').hidden = zones;
    root.querySelector('#a-zone-key').hidden = !zones;
    const table = root.querySelector('#a-zone-table');
    table.hidden = !zones;
    table.innerHTML = zones ? zoneTable(game, shots, c, teams) : '';
  };
  mountGoalTips(root, game, c);
  root.querySelector('#a-filters')?.addEventListener('click', (e) => {
    const b = e.target.closest('button[data-v]');
    if (!b) return;
    const seg = b.closest('[data-filter]');
    seg.querySelectorAll('button').forEach((x) => x.setAttribute('aria-pressed', String(x === b)));
    state[seg.dataset.filter] = b.dataset.v;
    draw();
  });
  draw();
}

export default {
  id: 'analytics',
  name: 'Analytics',
  inspiration: 'Shot map, shot-attempt flow and heat-mapped stats, inspired by HockeyStats and NHL EDGE',
  render(game) {
    const c = teamColors(game, { dark: true });
    return `<div class="a-wrap">${header(game, c)}${kpis(game, c)}
      <div class="a-cols">${shotMap(game, c)}${flowChart(game, c)}</div>
      ${goalies(game, c)}${heatTable(game, c)}</div>`;
  },
  mount(root, game) {
    mountShotMap(root, game, teamColors(game, { dark: true }));
  },
};

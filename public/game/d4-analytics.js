// Design 4 "Analytics": shot map, shot-attempt flow and heat-mapped player stats.
// Inspired by HockeyStats and NHL EDGE style analytics pages.
import { esc, logo, teamColors, statusText, prettyDate, allSkaters, allGoalies, pct, signed, rinkMarkup, shotMark, elapsed } from './core.js';

function header(game, c) {
  const ls = game.linescore;
  return `<section class="a-head">
    <div class="a-side" style="--team:${c.away}">${logo(game.away, 'a-logo', true)}<b>${esc(game.away.abbrev)}</b><span class="a-sc">${ls.totals.away}</span></div>
    <div class="a-mid"><span class="a-st ${game.status.state}">${esc(statusText(game))}</span><span>${esc(prettyDate(game.gameDate))}</span></div>
    <div class="a-side r" style="--team:${c.home}"><span class="a-sc">${ls.totals.home}</span><b>${esc(game.home.abbrev)}</b>${logo(game.home, 'a-logo', true)}</div>
  </section>`;
}

function shotSummary(game) {
  const by = (side) => {
    const s = game.shots.filter((x) => x.team === side);
    const n = (k) => s.filter((x) => x.kind === k).length;
    const sog = n('sog') + n('goal');
    return { attempts: s.length, sog, goals: n('goal'), miss: n('miss'), block: n('block'), shPct: sog ? (100 * n('goal')) / sog : 0 };
  };
  return { away: by('away'), home: by('home') };
}

function kpis(game, c) {
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

function shotMap(game, c) {
  return `<section class="a-card a-map"><div class="a-card-head"><h2>Shot map</h2>
      <div class="a-filters" id="a-filters">
        <div class="a-seg" data-filter="team"><button data-v="all" aria-pressed="true">Both</button><button data-v="away" aria-pressed="false">${esc(game.away.abbrev)}</button><button data-v="home" aria-pressed="false">${esc(game.home.abbrev)}</button></div>
        <div class="a-seg" data-filter="period"><button data-v="all" aria-pressed="true">All</button>${[...new Set(game.shots.map((s) => s.period))].map((p) => `<button data-v="${esc(p)}" aria-pressed="false">${p === 'OT' ? 'OT' : `P${esc(p)}`}</button>`).join('')}</div>
      </div></div>
    <div class="a-rinkwrap"><span class="a-att" style="color:${c.away}">&#9664; ${esc(game.away.abbrev)} attacking</span><span class="a-att r" style="color:${c.home}">${esc(game.home.abbrev)} attacking &#9654;</span>
      <svg class="a-rink" viewBox="-101 -43.5 202 87" role="img" aria-label="Shot locations">${rinkMarkup()}<g id="a-shots"></g></svg></div>
    <div class="a-legend"><span><svg viewBox="-3 -3 6 6"><circle r="2.6" fill="currentColor"/></svg>Goal</span><span><svg viewBox="-3 -3 6 6"><circle r="2" fill="none" stroke="currentColor" stroke-width=".9"/></svg>On goal</span><span><svg viewBox="-3 -3 6 6"><path d="M-1.6-1.6l3.2 3.2M1.6-1.6l-3.2 3.2" stroke="currentColor" stroke-width=".8"/></svg>Missed</span><span><svg viewBox="-3 -3 6 6"><rect x="-1.4" y="-1.4" width="2.8" height="2.8" fill="currentColor" opacity=".5"/></svg>Blocked</span></div>
  </section>`;
}

/** Cumulative shot attempts over game time, with goal markers. */
function flowChart(game, c) {
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

function heatTable(game, c) {
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

function goalies(game, c) {
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
    const c = teamColors(game, { dark: true });
    const state = { team: 'all', period: 'all' };
    const draw = () => {
      const shots = game.shots.filter((s) => (state.team === 'all' || s.team === state.team) && (state.period === 'all' || s.period === state.period));
      // Draw goals last so they sit on top.
      const order = { block: 0, miss: 1, sog: 2, goal: 3 };
      root.querySelector('#a-shots').innerHTML = shots.sort((a, b) => order[a.kind] - order[b.kind]).map((s) => shotMark(s, c[s.team])).join('');
    };
    root.querySelector('#a-filters')?.addEventListener('click', (e) => {
      const b = e.target.closest('button[data-v]');
      if (!b) return;
      const seg = b.closest('[data-filter]');
      seg.querySelectorAll('button').forEach((x) => x.setAttribute('aria-pressed', String(x === b)));
      state[seg.dataset.filter] = b.dataset.v;
      draw();
    });
    draw();
  },
};

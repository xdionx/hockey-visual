// Design "Game Story": the Broadcast look with the Analytics and Scorecards data,
// ordered to tell the game's story: what happened, how momentum swung, where the
// shots came from, who drove it, then the full box score.
import { esc, teamColors, allSkaters, allGoalies, elapsed, logo, statusText, strengthBadge, headshot, on, panelColor, fold } from './core.js';
import { hero, scoringCards, stars, statBars, shotLine } from './d2-broadcast.js';
import { kpis, shotMap, heatTable, goalieTable, shotSummary, mountShotMap } from './d4-analytics.js';
import { spotlight, scorecardControls, scorecardKey, mountScorecards, starsRow, mountStars } from './d5-scorecards.js';
import { storyChapters, momentumTimeline } from './d6-chapters.js';
import { storyBeats } from './d6-narrative.js';

/** One Story beat: a label and short points; "How it unfolded" adds the period-by-period goal list. */
function beatHtml(d, c) {
  if (typeof d === 'string') return `<p>${esc(d)}</p>`;
  const list = (items) => `<ul class="st-points">${items.map((t) => `<li>${esc(t)}</li>`).join('')}</ul>`;
  const body = d.items.length === 1 ? `<p>${esc(d.items[0])}</p>` : list(d.items);
  const pens = d.penalty?.length ? `<div class="st-sub"><b>Penalties that led to goals</b>${list(d.penalty)}</div>` : '';
  const tl = d.periods?.length ? `<div class="st-tl">${d.periods.map((p) => `
    <div class="st-tl-p">
      <div class="st-tl-h"><b>${esc(p.title)}</b><span>${esc(p.score)}</span>${p.note ? `<em>${esc(p.note)}</em>` : ''}</div>
      ${p.quiet ? `<div class="st-tl-q">${esc(p.quiet)}</div>` : ''}${p.items.length ? p.items.map((e) => `<div class="st-tl-e ${e.flag}" style="--tc:${c[e.side] ?? '#94a3b8'}"><time>${esc(e.time)}</time><span class="st-tl-t">${esc(e.text)}</span>${e.score ? `<small>${esc(e.score)}</small>` : ''}</div>`).join('') : ''}
    </div>`).join('')}</div>` : '';
  return `<div class="st-beat-box"><b class="st-beat">${esc(d.label)}</b>${body}${pens}${tl}</div>`;
}


const SECTIONS = [
  ['story', 'Story'], ['momentum', 'Momentum'], ['shots', 'Shots'], ['players', 'Players'], ['box', 'Box score'],
];

function colors(game) {
  const c = teamColors(game, { dark: true });
  c.panelAway = panelColor(c.awayBase);
  c.panelHome = panelColor(c.homeBase);
  return c;
}

const statLine = (p) => (p.position === 'G'
  ? `${p.saves} saves on ${p.shotsAgainst} shots${p.gsax != null ? `, ${p.gsax > 0 ? '+' : ''}${p.gsax.toFixed(1)} goals saved above expected, ${p.savePctAboveExpected > 0 ? '+' : ''}${(p.savePctAboveExpected * 100).toFixed(1)}% save % above expected` : ''}`
  : [p.goals && `${p.goals} G`, p.assists && `${p.assists} A`, `${p.sog} SOG`].filter(Boolean).join(', '));

/** A headline and a few sentences, worked out from the score sequence and stats. */
export function storyline(game) {
  const ls = game.linescore;
  const { away, home } = game;
  const state = game.status.state;
  if (state === 'pre' || state === 'postponed') {
    return { headline: `${away.commonName} at ${home.commonName}`, dek: [state === 'pre' ? 'The game hasn’t started yet. The story fills in once the puck drops.' : game.status.label] };
  }
  const t = ls.totals;
  const lead = t.away === t.home ? null : t.away > t.home ? 'away' : 'home';
  const other = (s) => (s === 'away' ? 'home' : 'away');

  // Walk the goals in order: biggest deficit each team faced, lead changes, the deciding goal.
  let a = 0; let h = 0; let leader = null; let changes = 0;
  const deficit = { away: 0, home: 0 };
  const goals = game.scoring.filter((g) => g.period !== 'SO');
  for (const g of goals) {
    if (g.team === away.abbrev) a++; else h++;
    deficit.away = Math.max(deficit.away, h - a);
    deficit.home = Math.max(deficit.home, a - h);
    const now = a === h ? leader : a > h ? 'away' : 'home';
    if (a !== h && leader && now !== leader) changes++;
    if (a !== h) leader = now;
  }

  const dek = [];
  const shots = shotSummary(game);
  const att = shots.away.attempts + shots.home.attempts;
  const players = [...allSkaters(game), ...allGoalies(game)].sort((x, y) => y.rating - x.rating || y.gameScore - x.gameScore);
  const best = players[0];

  if (state === 'live') {
    const headline = lead ? `${game[lead].commonName} lead ${Math.max(t.away, t.home)}-${Math.min(t.away, t.home)}` : `Tied ${t.away}-${t.home}`;
    const live = storyBeats(game);
    if (live.length) return { headline, dek: live.map((b, i) => (i ? b : { ...b, label: `${b.label} · ${game.status.label}` })) };
    dek.push(`${game.status.label}.`);
    if (att) dek.push(`${away.abbrev} has ${Math.round((100 * shots.away.attempts) / att)}% of the shot attempts so far (${shots.away.attempts}-${shots.home.attempts} SAT).`);
    if (best) dek.push(`${best.fullName} (${best.team}) has been the best player on the ice so far: ${statLine(best)}.`);
    return { headline, dek };
  }

  const w = lead ?? 'home';
  const l = other(w);
  const beats = storyBeats(game);
  const W = game[w].commonName;
  const L = game[l].commonName;
  const last = game.status.label.split('/')[1];
  const suffix = last === 'SO' ? ' in a shootout' : last ? ' in overtime' : '';
  const score = `${t[w]}-${t[l]}`;
  const margin = t[w] - t[l];
  let headline;
  if (deficit[w] >= 2) headline = `${W} storm back from ${deficit[w]} down to beat the ${L}${suffix}`;
  else if (t[l] === 0) headline = `${W} shut out the ${L} ${score}`;
  else if (changes >= 2) headline = `${W} outlast the ${L} ${score}${suffix} in a back-and-forth game`;
  else if (margin >= 3 && !suffix) headline = `${W} roll past the ${L} ${score}`;
  else if (suffix) headline = `${W} edge the ${L}${suffix}`;
  else headline = `${W} beat the ${L} ${score}`;

  if (beats.length) return { headline, dek: beats };
  // The deciding goal: the winner's goal that put them ahead for good.
  if (last === 'SO') {
    const decider = game.scoring.find((g) => g.period === 'SO');
    if (decider) dek.push(`${decider.scorer.fullName} scored the shootout winner.`);
  } else {
    const n = t[l] + 1;
    let k = 0;
    const gwg = goals.find((g) => g.team === game[w].abbrev && ++k === n);
    if (gwg) dek.push(/OT$/.test(String(gwg.period)) ? `${gwg.scorer.fullName} scored and won the game in overtime at ${gwg.time}.` : `${gwg.scorer.fullName} scored the winner at ${gwg.time} of the ${gwg.periodName.toLowerCase()}.`);
  }
  if (att) {
    const top = shots.away.attempts >= shots.home.attempts ? 'away' : 'home';
    const pctAtt = Math.round((100 * shots[top].attempts) / att);
    dek.push(`${game[top].abbrev} drove play with ${pctAtt}% of shot attempts (${shots[top].attempts}-${shots[other(top)].attempts} SAT) and ${shots[top].sog}-${shots[other(top)].sog} on goal.`);
  }
  if (best) dek.push(`Player of the game: ${best.fullName} (${best.team}), ${statLine(best)}, rated ${best.rating.toFixed(1)}.`);
  return { headline, dek };
}

function header(n, id, title, sub = '') {
  return `<header class="st-h"><span class="st-n">${String(n).padStart(2, '0')}</span><h2>${esc(title)}</h2>${sub ? `<p>${esc(sub)}</p>` : ''}</header>`;
}

/** Compact score and clock that slides into the sticky bar once the big scoreboard scrolls away. */
function miniScore(game, c) {
  const pre = game.status.state === 'pre';
  const team = (side) => `<span class="st-mini-t" style="--team:${c[side]}">${logo(game[side], 'st-mini-logo', true)}<b>${esc(game[side].abbrev)}</b><strong data-sog="${pre ? '' : `${game.linescore.shots?.[side] ?? 0} SOG`}">${pre ? '' : game.linescore.totals[side]}</strong>${shotLine(game, side)}</span>`;
  return `<div class="st-mini" aria-hidden="true">${team('away')}<span class="st-mini-s ${game.status.state}">${esc(statusText(game))}${strengthBadge(game, c)}</span>${team('home')}</div>`;
}

const KIND_LABEL = {
  goal: 'goal', sog: 'shot on goal', miss: 'missed shot', 'block-attempt': 'shot attempt', block: 'blocked shot',
  faceoff: 'faceoff win', takeaway: 'takeaway', giveaway: 'giveaway', hit: 'hit', penalty: 'drew a penalty',
  'power-play': 'power play pressure', 'penalty-kill': 'penalty kill',
};

/** "P2 14:05" from seconds since puck drop. */
function clock(t) {
  const n = Math.floor(t / 1200);
  const s = t - n * 1200;
  const label = n >= 3 ? (n === 3 ? 'OT' : `${n - 2}OT`) : `P${n + 1}`;
  return `${label} ${Math.floor(s / 60)}:${String(Math.round(s % 60)).padStart(2, '0')}`;
}

function causeText(game, cause) {
  if (!cause) return 'a run of pressure';
  if (cause.kind === 'penalty-kill') return 'killing off a penalty';
  if (cause.kind === 'fight-spark') return 'a fight that woke the team up';
  if (cause.kind === 'power-play') return 'power play pressure';
  if (cause.kind === 'giveaway') return `${cause.player ?? 'an opponent'}'s giveaway`;
  if (cause.kind === 'penalty') return `${cause.player ?? 'a player'} drawing a penalty`;
  return `${cause.player ? `${cause.player}'s ` : 'a '}${KIND_LABEL[cause.kind] ?? cause.kind}`;
}

/** Hover or focus anything on the momentum chart to see what it is; elsewhere, read the momentum at that moment. */
function mountMomentumTips(root, game, c) {
  const svg = root.querySelector('.st-mc-svg');
  const tip = root.querySelector('.st-mc .st-tip');
  const series = game.momentum?.series;
  if (!svg || !tip || !series?.length) return;
  const cross = svg.querySelector('.st-mc-cross');
  const dot = svg.querySelector('.st-mc-dot');
  const { end, pl, pr, w } = Object.fromEntries(Object.entries(svg.dataset).map(([k, v]) => [k, +v]));
  const vb = svg.viewBox.baseVal;
  const place = (x, y) => {
    tip.hidden = false;
    tip.style.left = `${Math.min(Math.max(8, x - tip.offsetWidth / 2), innerWidth - tip.offsetWidth - 8)}px`;
    const above = y - tip.offsetHeight - 14;
    tip.style.top = `${above > 60 ? above : y + 18}px`;
  };
  const hide = () => { tip.hidden = true; cross.setAttribute('visibility', 'hidden'); dot.setAttribute('visibility', 'hidden'); };
  const showItem = (el) => {
    tip.innerHTML = el.dataset.tip;
    const r = el.getBoundingClientRect();
    cross.setAttribute('visibility', 'hidden'); dot.setAttribute('visibility', 'hidden');
    place(r.left + r.width / 2, r.top);
  };
  on(svg, 'pointermove', (e) => {
    const item = e.target.closest('.st-mc-item');
    if (item) { showItem(item); return; }
    const box = svg.getBoundingClientRect();
    const vx = ((e.clientX - box.left) / box.width) * vb.width;
    const t = Math.max(0, Math.min(end, ((vx - pl) / (w - pl - pr)) * end));
    const i = Math.min(series.length - 1, Math.round(t / (series[1]?.[0] - series[0][0] || 10)));
    const [st, v] = series[i];
    const x = pl + ((w - pl - pr) * st) / end;
    const mid = +cross.getAttribute('y1') + (+cross.getAttribute('y2') - +cross.getAttribute('y1')) / 2;
    const half = (+cross.getAttribute('y2') - +cross.getAttribute('y1')) / 2;
    const y = mid - (half * v) / game.momentum.max;
    cross.setAttribute('x1', x); cross.setAttribute('x2', x); cross.setAttribute('visibility', 'visible');
    dot.setAttribute('cx', x); dot.setAttribute('cy', y); dot.setAttribute('visibility', 'visible');
    const side = Math.abs(v) < 0.5 ? null : v > 0 ? 'home' : 'away';
    dot.setAttribute('fill', side ? c[side] : '#94a3b8');
    tip.innerHTML = `<b${side ? ` style="color:${c[side]}"` : ''}>${side ? `${esc(game[side].commonName)} pushing` : 'Even'}</b><span>${esc(clock(st))} · momentum ${Math.abs(v).toFixed(1)}</span>`;
    place(box.left + (x / vb.width) * box.width, box.top + (y / vb.height) * box.height);
  });
  on(svg, 'pointerleave', hide);
  on(svg, 'focusin', (e) => { const item = e.target.closest('.st-mc-item'); if (item) showItem(item); });
  on(svg, 'focusout', hide);
  on(window, 'scroll', hide, { passive: true });
}

/** Diverging momentum chart: home pushes up, away pushes down. */
function momentumChart(game, c) {
  const m = game.momentum;
  if (!m?.series?.length) return '';
  const W = 1000; const H = 330; const P = { l: 8, r: 8, t: 56, b: 26 };
  const end = Math.max(3600, m.series.at(-1)[0]);
  const X = (t) => P.l + ((W - P.l - P.r) * t) / end;
  const mid = (H - P.b + P.t) / 2;
  const half = (H - P.t - P.b) / 2;
  const Y = (v) => mid - (half * v) / m.max;
  const line = m.series.map(([t, v], i) => `${i ? 'L' : 'M'}${X(t).toFixed(1)} ${Y(v).toFixed(1)}`).join('');
  const area = `${line}L${X(m.series.at(-1)[0]).toFixed(1)} ${mid}L${X(0)} ${mid}Z`;
  const per = (t) => clock(t);
  const tipAttr = (html) => `data-tip="${esc(html)}" tabindex="0"`;
  const pp = m.powerPlays.map((p) => {
    const x1 = X(p.start); const x2 = X(p.end ?? m.series.at(-1)[0]);
    const top = p.team === 'home';
    const shorthanded = p.team === 'away' ? 'home' : 'away';
    // The penalty that started it: same moment, taken by the shorthanded team.
    const pen = (game.penalties ?? []).filter((x) => x.team === game[shorthanded].abbrev && Math.abs(elapsed(x.period, x.time) - p.start) <= 2);
    const goal = p.result === 'goal' ? game.scoring.find((g) => g.team === game[p.team].abbrev && Math.abs(elapsed(g.period, g.time) - (p.end ?? 0)) <= 2) : null;
    const result = p.result === 'goal' ? `Power play goal${goal ? ` by ${esc(goal.scorer.fullName)}` : ''}` : p.result === 'killed' ? `Killed off: ${esc(game[shorthanded].commonName)} get a momentum boost` : p.result === 'shorthanded-goal' ? 'Shorthanded goal against' : 'Still going';
    const tip = `<b style="color:${c[p.team]}">${esc(game[p.team].abbrev)} power play</b><span>${esc(per(p.start))}${p.end ? ` to ${esc(per(p.end))}` : ''}</span>
      ${pen.map((x) => `<p>${esc(x.player)} (${esc(x.team)}) · ${esc(x.infraction)}, ${x.minutes} min${x.drawnBy ? ` · drawn by ${esc(x.drawnBy)}` : ''}</p>`).join('')}
      <p>${result}</p><small>Power play pressure adds momentum every 10 seconds.</small>`;
    return `<g class="st-mc-item" ${tipAttr(tip)}><rect x="${x1}" y="${top ? P.t : mid}" width="${Math.max(2, x2 - x1)}" height="${half}" fill="${c[p.team]}" opacity=".12"/><text x="${(x1 + x2) / 2}" y="${top ? P.t + 12 : H - P.b + 16}" text-anchor="middle" class="st-mc-pp" fill="${c[p.team]}">PP${p.result === 'goal' ? ' ✓' : ''}</text></g>`;
  }).join('');
  const goals = game.scoring.filter((g) => g.period !== 'SO').map((g) => {
    const side = g.team === game.away.abbrev ? 'away' : 'home';
    const t = elapsed(g.period, g.time);
    const cy = side === 'home' ? P.t + 8 : H - P.b - 8;
    const tip = `<b style="color:${c[side]}">${esc(g.team)} goal</b><span>${esc(per(t))} · ${g.score.away}-${g.score.home}${g.tags.length ? ` · ${esc(g.tags.join(', '))}` : ''}</span>
      <div class="st-tip-p">${headshot(g.scorer, 'st-tip-mug')}<div><strong>${esc(g.scorer.fullName)}</strong>${g.scorer.goalsToDate != null ? ` (${g.scorer.goalsToDate})` : ''}<br><small>${g.assists.length ? `Assists: ${g.assists.map((a) => `${esc(a.name)}${a.assistsToDate != null ? ` (${a.assistsToDate})` : ''}`).join(', ')}` : 'Unassisted'}${g.shotType ? ` · ${esc(g.shotType)}` : ''}</small></div></div>
      <small>A goal is the biggest single push: 3 points of momentum.</small>`;
    return `<g class="st-mc-item" ${tipAttr(tip)}><line x1="${X(t)}" x2="${X(t)}" y1="${P.t}" y2="${H - P.b}" stroke="${c[side]}" stroke-width="1.5" stroke-dasharray="3 3" opacity=".8"/><line x1="${X(t)}" x2="${X(t)}" y1="${P.t}" y2="${H - P.b}" stroke="transparent" stroke-width="10"/><circle cx="${X(t)}" cy="${cy}" r="9" fill="${c[side]}" stroke="#fff" stroke-width="1.5"/><text x="${X(t)}" y="${cy + 4}" text-anchor="middle" class="st-mc-g">G</text></g>`;
  }).join('');
  const swings = m.swings.map((sw, i) => {
    const held = sw.until - sw.t;
    const tip = `<b style="color:${c[sw.team]}">Momentum swing ${i + 1}</b><span>${esc(per(sw.t))} · held ${Math.floor(held / 60)}:${String(Math.round(held % 60)).padStart(2, '0')}</span>
      <p>The ${esc(game[sw.team].commonName)} take over, sparked by ${esc(causeText(game, sw.cause))}.</p>`;
    return `<g class="st-mc-item" ${tipAttr(tip)}><circle cx="${X(sw.t)}" cy="${mid}" r="8" fill="#0b1220" stroke="${c[sw.team]}" stroke-width="2"/><text x="${X(sw.t)}" y="${mid + 4}" text-anchor="middle" class="st-mc-s">${i + 1}</text></g>`;
  }).join('');
  // Periods: alternating bands, solid dividers and a header with each period's score and momentum share.
  const spans = [[0, 1200, '1st period'], [1200, 2400, '2nd period'], [2400, 3600, '3rd period']];
  if (end > 3600) spans.push([3600, end, 'OT']);
  const lines = game.linescore.periods.filter((p) => p.label !== 'SO');
  const periods = spans.map(([a, b], i) => `<rect x="${X(a)}" y="${P.t - 30}" width="${X(b) - X(a)}" height="${H - P.b - P.t + 30}" class="st-mc-band${i % 2 ? ' alt' : ''}"/>`).join('')
    + spans.slice(1).map(([a]) => `<line x1="${X(a)}" x2="${X(a)}" y1="${P.t - 30}" y2="${H - P.b}" class="st-mc-div"/>`).join('');
  const labels = spans.map(([a, b, name], i) => {
    const ls = lines[i];
    const share = m.periods?.[i];
    const wide = X(b) - X(a) > 200;
    const lead = share && wide ? (share.home > share.away ? 'home' : share.away > share.home ? 'away' : null) : null;
    return `<text x="${X(a) + 10}" y="${P.t - 34}" class="st-mc-ph">${name.toUpperCase()}</text>
      ${ls && wide ? `<text x="${X(a) + 10}" y="${P.t - 14}" class="st-mc-ps"><tspan fill="${c.away}">${esc(game.away.abbrev)} ${ls.away ?? 0}</tspan><tspan fill="#64748b"> – </tspan><tspan fill="${c.home}">${ls.home ?? 0} ${esc(game.home.abbrev)}</tspan></text>` : ''}
      ${lead ? `<text x="${X(b) - 10}" y="${P.t - 14}" text-anchor="end" class="st-mc-pm" fill="${c[lead]}">${esc(game[lead].abbrev)} ${share[lead]}% of momentum created</text>` : ''}`;
  }).join('');
  return `<div class="b-card st-mc"><div class="st-mc-key"><span style="color:${c.home}">&#9650; ${esc(game.home.commonName)}</span><span style="color:${c.away}">&#9660; ${esc(game.away.commonName)}</span></div>
    <svg viewBox="0 0 ${W} ${H}" class="st-mc-svg" role="img" aria-label="Momentum over the game" data-end="${end}" data-pl="${P.l}" data-pr="${P.r}" data-w="${W}">
      <defs><clipPath id="st-top"><rect x="0" y="0" width="${W}" height="${mid}"/></clipPath><clipPath id="st-bot"><rect x="0" y="${mid}" width="${W}" height="${H}"/></clipPath>
        <linearGradient id="st-gh" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${c.home}" stop-opacity=".9"/><stop offset="1" stop-color="${c.home}" stop-opacity=".25"/></linearGradient>
        <linearGradient id="st-ga" x1="0" y1="1" x2="0" y2="0"><stop offset="0" stop-color="${c.away}" stop-opacity=".9"/><stop offset="1" stop-color="${c.away}" stop-opacity=".25"/></linearGradient></defs>
      ${periods}${pp}
      <path d="${area}" fill="url(#st-gh)" clip-path="url(#st-top)"/><path d="${area}" fill="url(#st-ga)" clip-path="url(#st-bot)"/>
      <line x1="${P.l}" x2="${W - P.r}" y1="${mid}" y2="${mid}" class="st-mc-zero"/>
      <line class="st-mc-cross" x1="0" x2="0" y1="${P.t}" y2="${H - P.b}" visibility="hidden"/><circle class="st-mc-dot" r="4" visibility="hidden"/>
      ${goals}${swings}${labels}
    </svg><div class="st-tip" hidden></div>
    ${fold('How momentum is calculated', `Momentum weighs every play: goals 3, shots on goal 1, missed shots 0.35, blocked attempts 0.2, faceoff wins 0.25 to 0.6 (more in the offensive zone), takeaways and opponents' giveaways 0.15 (kept low because rinks score them inconsistently), hits 0.2, drawing a penalty 1 plus steady pressure through the power play, and 1.5 for killing a penalty. The player who took the penalty is charged for all of it, plus 1.5 more if the power play scores; the player who drew it is credited with it, plus 0.75 if it scores. Each push fades with a 75-second half-life. Shaded bands are power plays; numbered circles are momentum swings.`, { cls: 'st-note' })}
  </div>`;
}

/** A slim, label-free momentum strip that rides in the sticky bar under the score. */
function momentumStrip(game, c) {
  const m = game.momentum;
  if (!m?.series?.length) return '';
  const W = 1000; const H = 40; const mid = H / 2;
  const end = Math.max(3600, m.series.at(-1)[0]);
  const X = (t) => (W * t) / end;
  // Scale to the bigger pushes (not the single peak) so the strip reads at a small height.
  const mags = m.series.map(([, v]) => Math.abs(v)).sort((a, b) => a - b);
  const scale = Math.max(0.5, mags[Math.floor(mags.length * 0.97)] ?? m.max);
  const Y = (v) => mid - ((mid - 1) * Math.max(-1, Math.min(1, v / scale)));
  const line = m.series.map(([t, v], i) => `${i ? 'L' : 'M'}${X(t).toFixed(1)} ${Y(v).toFixed(1)}`).join('');
  const area = `${line}L${X(m.series.at(-1)[0]).toFixed(1)} ${mid}L0 ${mid}Z`;
  const divs = [1200, 2400, 3600].filter((t) => t < end).map((t) => `<line x1="${X(t)}" x2="${X(t)}" y1="0" y2="${H}" class="st-ms-div"/>`).join('');
  return `<div class="st-ms" title="Momentum: ${esc(game.home.abbrev)} above the line, ${esc(game.away.abbrev)} below">
    <svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" aria-hidden="true">
      <defs><clipPath id="st-ms-top"><rect x="0" y="0" width="${W}" height="${mid}"/></clipPath><clipPath id="st-ms-bot"><rect x="0" y="${mid}" width="${W}" height="${mid}"/></clipPath></defs>
      ${divs}
      <path d="${area}" fill="${c.home}" clip-path="url(#st-ms-top)"/><path d="${area}" fill="${c.away}" clip-path="url(#st-ms-bot)"/>
      <line x1="0" x2="${W}" y1="${mid}" y2="${mid}" class="st-ms-zero"/>
    </svg></div>`;
}

function drivers(game, c) {
  const list = allSkaters(game).filter((p) => p.momentum != null).sort((a, b) => b.momentum - a.momentum).slice(0, 6);
  if (!list.length) return '';
  const max = Math.max(...list.map((p) => p.momentum), 1);
  return `<div class="b-card"><h2>Momentum drivers</h2>${list.map((p) => `<div class="st-drv" style="--team:${c[p.side]}">
    <span class="st-drv-n">${esc(p.fullName)} <small>${esc(p.team)}</small></span>
    <div class="st-drv-bar"><i style="width:${(100 * Math.max(0, p.momentum)) / max}%"></i></div>
    <b>+${p.momentum.toFixed(1)}</b><span class="st-drv-s">${p.swingPlays ? `&#8635; ${p.swingPlays}` : ''}</span>
  </div>`).join('')}${killers(game, c)}${fold('What &#8635; means', '&#8635; = swing plays: pushes made while their team was behind on momentum.', { cls: 'st-note' })}</div>`;
}

/** Players who cost their team momentum, mostly through penalties and giveaways. */
function killers(game, c) {
  const list = allSkaters(game).filter((p) => p.momentum < 0).sort((a, b) => a.momentum - b.momentum).slice(0, 3);
  if (!list.length) return '';
  const max = Math.max(...list.map((p) => -p.momentum), 1);
  return `<h3 class="st-drv-h">Momentum killers</h3>${list.map((p) => `<div class="st-drv neg" style="--team:${c[p.side]}">
    <span class="st-drv-n">${esc(p.fullName)} <small>${esc(p.team)}</small></span>
    <div class="st-drv-bar"><i style="width:${(100 * -p.momentum) / max}%"></i></div>
    <b>${p.momentum.toFixed(1)}</b><span class="st-drv-s">${p.penaltiesTaken ? `${p.penaltiesTaken} pen` : ''}</span>
  </div>`).join('')}`;
}

/** Goals per period as a small strip under the momentum chart: who won each period. */
function periodWins(game, c) {
  const mmss = (sec) => `${Math.floor(sec / 60)}:${String(Math.round(sec % 60)).padStart(2, '0')}`;
  return `<div class="st-periods">${game.linescore.periods.filter((p) => p.label !== 'SO').map((p, i) => {
    const m = game.momentum?.periods?.[i];
    const win = p.away === p.home ? null : p.away > p.home ? 'away' : 'home';
    const ctl = m?.control;
    const ctlTot = ctl ? ctl.away + ctl.home + ctl.even || 1 : 1;
    const top = m ? (m.away >= m.home ? 'away' : 'home') : null;
    return `<div class="st-pd"><div class="st-pd-h"><span class="st-pd-l">${p.label === 'OT' ? 'Overtime' : `Period ${esc(p.label)}`}</span>
      <b>${esc(game.away.abbrev)} <span style="color:${c.away}">${p.away ?? 0}</span>-<span style="color:${c.home}">${p.home ?? 0}</span> ${esc(game.home.abbrev)}</b></div>
      ${m ? `<div class="st-pd-row"><span class="st-pd-k">Momentum created</span><span class="st-pd-v" style="color:${c[top]}">${esc(game[top].abbrev)} ${m[top]}%</span></div>
      <div class="b-bar st-pd-bar" title="Share of all momentum pushes made in the period"><i style="width:${m.away}%;background:${c.away}"></i><i style="width:${m.home}%;background:${c.home}"></i></div>
      <div class="st-pd-row"><span class="st-pd-k">Time in control</span><span class="st-pd-v">${esc(game.away.abbrev)} ${mmss(ctl.away)} · even ${mmss(ctl.even)} · ${esc(game.home.abbrev)} ${mmss(ctl.home)}</span></div>
      <div class="b-bar st-pd-bar thin" title="How long the momentum line was on each team's side"><i style="width:${(100 * ctl.away) / ctlTot}%;background:${c.away}"></i><i style="width:${(100 * ctl.even) / ctlTot}%;background:#334155"></i><i style="width:${(100 * ctl.home) / ctlTot}%;background:${c.home}"></i></div>` : ''}
      <span class="st-pd-s">Shots on goal ${p.shotsAway ?? 0}-${p.shotsHome ?? 0}${win ? ` · ${esc(game[win].abbrev)} won the period` : ''}</span></div>`;
  }).join('')}</div>`;
}

/** Goals by period plus shots on goal and attempts, one row per team. */
function lineScore(game, c) {
  const ls = game.linescore;
  const s = shotSummary(game);
  const row = (side) => `<tr style="--team:${c[side]}"><td class="l"><span class="st-ls-t">${logo(game[side], 'st-ls-logo', true)}${esc(game[side].abbrev)}</span></td>
    ${ls.periods.map((p) => `<td>${p[side] ?? '-'}</td>`).join('')}<td class="tot">${ls.totals[side]}</td><td>${ls.shots?.[side] ?? '-'}</td><td>${s[side].attempts}</td></tr>`;
  return `<div class="b-card st-ls"><h2>Line score</h2><div class="a-scroll"><table class="a-table st-ls-t-table">
    <thead><tr><th class="l">Team</th>${ls.periods.map((p) => `<th>${esc(p.label)}</th>`).join('')}<th class="tot">T</th><th>SOG</th><th title="Shot attempts">SAT</th></tr></thead>
    <tbody>${row('away')}${row('home')}</tbody></table></div></div>`;
}

export default {
  id: 'story',
  name: 'Game Story',
  inspiration: 'Broadcast styling with the Analytics and Scorecards data, told in order: story, momentum, shots, players, box score',
  classes: 'd-broadcast d-analytics d-scorecards',
  render(game) {
    const c = colors(game);
    const story = storyline(game);
    const sk = allSkaters(game);
    const all = [...sk, ...allGoalies(game)].sort((a, b) => b.rating - a.rating || b.gameScore - a.gameScore);
    const scale = Math.max(1.5, ...sk.map((p) => Object.values(p.gameScoreParts).reduce((s, v) => s + Math.max(0, v), 0))) * 1.05;
    const started = game.status.state === 'live' || game.status.state === 'final';
    return `<div class="b-wrap st-wrap">
      ${hero(game, c, { strip: false, shots: true })}
      <div class="st-bar">
        ${miniScore(game, c)}
        <div class="st-bar-body">
        ${started ? momentumStrip(game, c) : ''}
        <nav class="st-nav" aria-label="Sections">${SECTIONS.map(([id, label], i) => `<a href="#st-${id}" data-sec="${id}"><span>${String(i + 1).padStart(2, '0')}</span>${esc(label)}</a>`).join('')}</nav>
        </div>
      </div>

      ${game.status.state === 'final' ? starsRow(game, c, all) : ''}

      <section class="st-sec" id="st-story">
        ${header(1, 'story', 'The story')}
        <div class="st-lede"><h1>${esc(story.headline)}</h1>${story.dek.map((d) => beatHtml(d, c)).join('')}</div>
        ${storyChapters(game, c)}
        ${started ? `<div class="b-cols st-cols"><div>${scoringCards(game, c)}</div><div>${stars(game)}${statBars(game, c)}</div></div>` : ''}
      </section>

      ${started ? `
      <section class="st-sec" id="st-momentum">
        ${header(2, 'momentum', 'Momentum', 'Who was pushing the play, minute by minute. Above the line is the home team, below is the away team.')}
        ${momentumChart(game, c)}
        ${periodWins(game, c)}
        <div class="b-cols st-cols"><div>${momentumTimeline(game, c)}</div><div>${drivers(game, c)}</div></div>
        ${kpis(game, c)}
      </section>

      <section class="st-sec" id="st-shots">
        ${header(3, 'shots', 'Where the shots came from', 'Switch between every attempt and the zone map, which counts attempts and goals by area of the offensive zone.')}
        ${shotMap(game, c)}
      </section>

      <section class="st-sec" id="st-players">
        ${header(4, 'players', 'Player scorecards', 'Each player’s rating and what drove it.')}
        ${game.status.state === 'final' ? '' : spotlight(game, c, all, scale)}
        ${scorecardControls(game)}
        <div class="s-grid" id="s-grid" data-js></div>
        ${scorecardKey()}
      </section>

      <section class="st-sec" id="st-box">
        ${header(5, 'box', 'Box score')}
        ${lineScore(game, c)}
        ${heatTable(game, c)}
        ${goalieTable(game, c)}
      </section>` : ''}
    </div>`;
  },
  mount(root, game) {
    const c = colors(game);
    mountMomentumTips(root, game, c);
    if (root.querySelector('#a-shots')) mountShotMap(root, game, c);
    if (root.querySelector('#s-grid')) mountScorecards(root, game, c);
    mountStars(root);

    // Highlight the section in view.
    const links = new Map([...root.querySelectorAll('.st-nav a')].map((a) => [a.dataset.sec, a]));
    const io = new IntersectionObserver((entries) => {
      for (const e of entries) {
        if (!e.isIntersecting) continue;
        links.forEach((a) => a.removeAttribute('aria-current'));
        links.get(e.target.id.slice(3))?.setAttribute('aria-current', 'true');
      }
    }, { rootMargin: '-45% 0px -50% 0px' });
    root.storyObserver?.disconnect();
    root.storyObserver = io;

    // Show the compact score once the big scoreboard has scrolled under the sticky header.
    const bar = root.querySelector('.st-bar');
    const heroEl = root.querySelector('.b-hero');
    root.heroObserver?.disconnect();
    if (bar && heroEl) {
      // Set it now too, so a live refresh never collapses the bar for a frame.
      bar.classList.toggle('stuck', heroEl.getBoundingClientRect().bottom < 60);
      root.heroObserver = new IntersectionObserver(([e]) => bar.classList.toggle('stuck', !e.isIntersecting && e.boundingClientRect.top < 0), { rootMargin: '-60px 0px 0px 0px' });
      root.heroObserver.observe(heroEl);
    }
    root.querySelectorAll('.st-sec').forEach((s) => io.observe(s));
  },
};

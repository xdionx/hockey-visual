// Design 5 "Scorecards": one card per player with a game rating and what drove it.
// A modern take on HockeyStats-style player game cards; the start of the per-player scorecard.
import { esc, logo, teamColors, statusText, prettyDate, allSkaters, allGoalies, pct, signed, rinkMarkup, shotMark, headshot, ratingColor, GS_PARTS, on, morphInner, goalieXg, fold, penKind, elapsed } from './core.js';

export const PART_COLORS = { scoring: '#6366f1', momentum: '#22c55e', shooting: '#0ea5e9', onIce: '#14b8a6', defense: '#a3a3a3', discipline: '#f59e0b', faceoffs: '#ec4899' };

function header(game, c) {
  const ls = game.linescore;
  return `<section class="s-head">
    <div class="s-t" style="--team:${c.away}">${logo(game.away, 's-logo')}<div><b>${esc(game.away.commonName)}</b><span>${esc(game.away.abbrev)}</span></div><em>${ls.totals.away}</em></div>
    <div class="s-mid"><span class="s-st ${game.status.state}">${esc(statusText(game))}</span><span>${esc(prettyDate(game.gameDate))}</span></div>
    <div class="s-t r" style="--team:${c.home}"><em>${ls.totals.home}</em><div><b>${esc(game.home.commonName)}</b><span>${esc(game.home.abbrev)}</span></div>${logo(game.home, 's-logo')}</div>
  </section>`;
}

/** Diverging bar: negative parts grow left of the zero line, positive parts right. */
export function breakdownBar(p, scale) {
  const pos = GS_PARTS.filter(([k]) => p.gameScoreParts[k] > 0);
  const neg = GS_PARTS.filter(([k]) => p.gameScoreParts[k] < 0);
  const seg = ([k, label]) => {
    const v = p.gameScoreParts[k];
    return `<i style="width:${((100 * Math.abs(v)) / scale).toFixed(1)}%;background:${PART_COLORS[k]}" title="${esc(`${label}: ${v > 0 ? '+' : ''}${v.toFixed(2)}`)}"></i>`;
  };
  return `<div class="s-div"><div class="s-neg">${neg.map(seg).join('')}</div><div class="s-zero"></div><div class="s-pos">${pos.map(seg).join('')}</div></div>`;
}

export function miniRink(game, p, c) {
  const shots = game.shots.filter((s) => s.shooterId === p.id);
  const vb = p.side === 'away' ? '-101 -43.5 102 87' : '-1 -43.5 102 87';
  return `<svg class="s-rink" viewBox="${vb}" role="img" aria-label="${esc(`${p.fullName} shot locations`)}">${rinkMarkup()}${shots.map((s) => shotMark(s, c[p.side], 3.2)).join('')}</svg>`;
}

export function ratingBadge(r, big = false) {
  return `<span class="s-rate ${big ? 'big' : ''}" style="--r:${ratingColor(r)}">${r.toFixed(1)}</span>`;
}

const MOM_KIND = {
  goal: 'Goals', sog: 'Shots', miss: 'Missed shots', 'block-attempt': 'Blocked attempts', block: 'Blocks', faceoff: 'Faceoff wins',
  'faceoff-loss': 'Faceoff losses', takeaway: 'Takeaways', giveaway: 'Giveaways', hit: 'Hits', 'penalty-drawn': 'Penalties drawn',
  'penalty-taken': 'Penalties taken', misconduct: 'Misconducts', 'game-misconduct': 'Game misconducts', fight: 'Fighting', 'penalty-kill': 'Penalty kill',
};

/** Momentum the player created (green, right) and gave away (red, left), with the biggest reasons. */
export function momentumBar(p, scale = 15) {
  const m = p.momentumParts;
  if (!m || (!m.pos && !m.neg)) return '';
  const w = (v) => Math.min(100, (100 * Math.abs(v)) / scale);
  const kinds = Object.entries(m.kinds ?? {});
  const top = (sign) => kinds.filter(([, v]) => Math.sign(v) === sign).sort((a, b) => Math.abs(b[1]) - Math.abs(a[1])).slice(0, 2)
    .map(([k]) => esc(MOM_KIND[k] ?? k)).join(', ');
  const title = kinds.sort((a, b) => b[1] - a[1]).map(([k, v]) => `${MOM_KIND[k] ?? k}: ${v > 0 ? '+' : ''}${v.toFixed(1)}`).join('\n');
  return `<div class="s-mom" title="${esc(`Momentum created and given away\n${title}`)}">
    <div class="s-bd-h"><span>Momentum</span><b>${p.momentum > 0 ? '+' : ''}${(p.momentum ?? 0).toFixed(1)}</b></div>
    <div class="s-mom-bar"><div class="l"><i style="width:${w(m.neg)}%"></i></div><div class="r"><i style="width:${w(m.pos)}%"></i></div></div>
    <div class="s-mom-why"><span class="neg"><b>${m.neg.toFixed(1)}</b> lost${top(-1) ? `<small>${top(-1)}</small>` : ''}</span><span class="pos"><b>+${m.pos.toFixed(1)}</b> gained${top(1) ? `<small>${top(1)}</small>` : ''}</span></div>
  </div>`;
}

/** Fights, majors and misconducts, only for players who had one. Shows what each did to momentum and score. */
export function disciplineChips(game, p) {
  // Games stored before discipline was tracked: rebuild it from the penalty list by player name.
  const list = p.discipline ?? (game.penalties ?? []).filter((x) => x.player === p.fullName && x.team === p.team && !['minor', 'bench', 'penalty-shot'].includes(penKind(x)))
    .map((x) => ({ kind: penKind(x), infraction: x.infraction, minutes: x.minutes, period: x.period, time: x.time }));
  if (!list.length) return '';
  const k = p.momentumParts?.kinds ?? {};
  const sgn = (n) => `${n > 0 ? '+' : ''}${n.toFixed(1)}`;
  const chip = (d) => {
    const when = `P${String(d.period).replace('P', '')} ${d.time}`;
    if (d.kind === 'fight') {
      // What the fight did for the team: momentum two minutes later, from that team's side.
      const series = game.momentum?.series;
      let team = '';
      if (series?.length) {
        const t = elapsed(String(d.period).replace('P', ''), d.time);
        const at = (x) => { let b = series[0]; for (const pt of series) { if (pt[0] <= x) b = pt; else break; } return b[1]; };
        const dir = p.side === 'home' ? 1 : -1;
        const gain = (at(t + 120) - at(t)) * dir;
        team = ` · team ${sgn(gain)} over the next 2 min`;
      }
      return `<span class="s-disc fight" title="Fighting is a 5 minute major but not a penalty against the player. It earns a small credit and can spark a team that is behind."><b>Fight</b> ${esc(when)}${k.fight ? ` · credit ${sgn(k.fight)}` : ''}${team}</span>`;
    }
    if (d.kind === 'major' || d.kind === 'match') return `<span class="s-disc major" title="A 5 minute major: the team plays short for the full time."><b>${d.kind === 'match' ? 'Match penalty' : 'Major'}</b> ${esc(d.infraction)} · ${esc(when)}</span>`;
    if (d.kind === 'game-misconduct') return `<span class="s-disc major" title="Ejected from the game."><b>Game misconduct</b> ${esc(when)}${k['game-misconduct'] ? ` · ${sgn(k['game-misconduct'])} momentum` : ''}</span>`;
    if (d.kind === 'misconduct') return `<span class="s-disc misc" title="10 minutes in the box, but the team does not play short."><b>Misconduct</b> ${esc(when)}${k.misconduct ? ` · ${sgn(k.misconduct)} momentum` : ''}</span>`;
    return '';
  };
  return `<div class="s-discs">${list.map(chip).join('')}</div>`;
}

export function skaterCard(game, p, c, scale) {
  return `<article class="s-card" style="--team:${c[p.side]}">
    <div class="s-top">${headshot(p, 's-mug')}
      <div class="s-who"><strong>${esc(p.fullName)}</strong><span>#${p.number ?? ''} · ${esc(p.position)} · ${esc(p.team)}</span></div>
      ${ratingBadge(p.rating)}
    </div>
    <div class="s-line"><span><b>${p.goals}</b>G</span><span><b>${p.assists}</b>A</span><span><b>${p.sog}</b>SOG</span><span><b>${signed(p.plusMinus)}</b>+/-</span><span title="Momentum impact: weighted plays that pushed momentum toward the player's team (swing plays count 1.5x)"><b>${p.momentum != null ? (p.momentum > 0 ? '+' : '') + p.momentum.toFixed(1) : '-'}</b>MOM</span><span><b>${esc(p.toi)}</b>TOI</span></div>
    ${p.onIce ? `<div class="s-onice" title="Shot attempts while on the ice, weighted: on goal 1, missed 0.5, blocked 0.35"><span>On-ice shots</span><b>${p.onIce.cf.toFixed(1)}</b><div class="s-oi-bar"><i style="width:${p.onIce.pct ?? 50}%"></i></div><b>${p.onIce.ca.toFixed(1)}</b><em>${p.onIce.pct != null ? `${Math.round(p.onIce.pct)}%` : ''}</em></div>` : ''}
    ${disciplineChips(game, p)}
    ${p.swingPlays ? `<div class="s-swing">&#8635; ${p.swingPlays} swing play${p.swingPlays > 1 ? 's' : ''}</div>` : ''}
    <div class="s-body">
      <div class="s-bd"><div class="s-bd-h"><span>Game score</span><b>${p.gameScore > 0 ? '+' : ''}${p.gameScore.toFixed(2)}</b></div>${breakdownBar(p, scale)}${momentumBar(p)}</div>
      ${miniRink(game, p, c)}
    </div>
  </article>`;
}

export function goalieCard(g, c) {
  const sv = g.shotsAgainst ? g.saves / g.shotsAgainst : 0;
  return `<article class="s-card goalie" style="--team:${c[g.side]}">
    <div class="s-top">${headshot(g, 's-mug')}
      <div class="s-who"><strong>${esc(g.fullName)}</strong><span>#${g.number ?? ''} · G · ${esc(g.team)}${g.decision ? ` · ${esc(g.decision)}` : ''}</span></div>
      ${ratingBadge(g.rating)}
    </div>
    <div class="s-line"><span><b>${g.saves}</b>SV</span><span><b>${g.goalsAgainst}</b>GA</span><span><b>${pct(g.savePct)}</b>SV%</span><span><b>${esc(g.toi)}</b>TOI</span></div>
    ${goalieXg(g)}
    <div class="s-gbody">
      <svg viewBox="0 0 36 36" class="s-ring"><circle cx="18" cy="18" r="15.9" class="bgc"/><circle cx="18" cy="18" r="15.9" class="fg" stroke-dasharray="${(sv * 100).toFixed(1)} 100"/><text x="18" y="21" text-anchor="middle">${Math.round(sv * 100)}%</text></svg>
      <dl><dt>Even strength</dt><dd>${esc(g.evenStrength)}</dd><dt>Power play</dt><dd>${esc(g.powerPlay)}</dd><dt>Shorthanded</dt><dd>${esc(g.shorthanded)}</dd><dt>Game score</dt><dd>${g.gameScore > 0 ? '+' : ''}${g.gameScore.toFixed(2)}</dd></dl>
    </div>
  </article>`;
}

function spot(game, c, best, scale, rank) {
  const parts = GS_PARTS.map(([k, label]) => {
    const v = best.gameScoreParts?.[k];
    if (v == null) return '';
    return `<div class="s-part"><span><i style="background:${PART_COLORS[k]}"></i>${esc(label)}</span><b>${v > 0 ? '+' : ''}${v.toFixed(2)}</b></div>`;
  }).join('');
  return `<section class="s-spot${rank > 1 ? ' s-spot-sub' : ''}" style="--team:${c[best.side]}">
    <div class="s-spot-l">${headshot(best, 's-spot-mug')}<div><span class="s-kicker">${rank === 1 ? 'Player of the game' : rank === 2 ? 'Second best player' : 'Third best player'}</span><h2>${esc(best.fullName)}</h2><span class="s-muted">#${best.number ?? ''} · ${esc(best.position)} · ${esc(game[best.side].name)}</span></div></div>
    <div class="s-spot-r">${ratingBadge(best.rating, true)}
      ${best.position === 'G' ? `<div class="s-parts"><div class="s-part"><span>Saves</span><b>${best.saves}/${best.shotsAgainst}</b></div><div class="s-part"><span>SV%</span><b>${pct(best.savePct)}</b></div>${best.gsax != null ? `<div class="s-part" title="Our own estimate from shot distance, angle and type"><span>GSAx</span><b>${best.gsax > 0 ? '+' : ''}${best.gsax.toFixed(1)}</b></div><div class="s-part" title="Actual save % minus expected save %"><span>SV% vs exp</span><b>${best.savePctAboveExpected > 0 ? '+' : ''}${(best.savePctAboveExpected * 100).toFixed(1)}%</b></div>` : ''}</div>` : `<div class="s-parts">${parts}</div>`}
    </div>
    ${best.position === 'G' ? '' : `<div class="s-spot-bar">${breakdownBar(best, scale)}</div>`}
  </section>`;
}

/** The top three players of the game, best first. */
export function spotlight(game, c, players, scale) {
  return players.slice(0, 3).map((p, i) => spot(game, c, p, scale, i + 1)).join('');
}

export function grid(game, c, state) {
  const sk = allSkaters(game);
  const gs = allGoalies(game);
  let list = [...sk, ...gs];
  if (state.team !== 'all') list = list.filter((p) => p.side === state.team);
  if (state.pos === 'F') list = list.filter((p) => ['C', 'L', 'R'].includes(p.position));
  if (state.pos === 'D') list = list.filter((p) => p.position === 'D');
  if (state.pos === 'G') list = list.filter((p) => p.position === 'G');
  const key = { rating: (p) => p.rating, points: (p) => (p.points ?? -1) * 100 + p.rating, toi: (p) => p.toiSeconds }[state.sort];
  list.sort((a, b) => key(b) - key(a));
  const scale = Math.max(1.5, ...sk.map((p) => Object.values(p.gameScoreParts).reduce((a, v) => a + Math.max(0, v), 0)), ...sk.map((p) => -Object.values(p.gameScoreParts).reduce((a, v) => a + Math.min(0, v), 0))) * 1.05;
  return list.map((p) => (p.position === 'G' ? goalieCard(p, c) : skaterCard(game, p, c, scale))).join('') || '<p class="s-muted">No players match.</p>';
}

export function scorecardControls(game) {
  return `<section class="s-controls" id="s-controls">
        <div class="s-seg" data-k="team"><button data-v="all" aria-pressed="true">Both teams</button><button data-v="away" aria-pressed="false">${esc(game.away.abbrev)}</button><button data-v="home" aria-pressed="false">${esc(game.home.abbrev)}</button></div>
        <div class="s-seg" data-k="pos"><button data-v="all" aria-pressed="true">All</button><button data-v="F" aria-pressed="false">Forwards</button><button data-v="D" aria-pressed="false">Defense</button><button data-v="G" aria-pressed="false">Goalies</button></div>
        <div class="s-seg" data-k="sort"><button data-v="rating" aria-pressed="true">By rating</button><button data-v="points" aria-pressed="false">By points</button><button data-v="toi" aria-pressed="false">By ice time</button></div>
      </section>`;
}

export function scorecardKey() {
  return fold('How ratings and scores are calculated', `<section class="s-key">
        <div><b>Rating</b> starts at 6.0 for a quiet game and moves 1.5 per point of game score. It is not capped: past 9.0 (or below 4.0) each extra point counts only 0.4, so a great night can read over 10 and a terrible one under 3, but it takes a lot to get there. ${['#dc2626', '#ea580c', '#ca8a04', '#65a30d', '#16a34a', '#2563eb'].map((x) => `<i style="background:${x}"></i>`).join('')}</div>
        <div><b>Game score</b> adds up what a player did: ${GS_PARTS.map(([k, l]) => `<span><i style="background:${PART_COLORS[k]}"></i>${esc(l)}</span>`).join('')}. Goalies: +0.1 per save, -0.75 per goal against.</div>
        <div><b>Goals that matter</b> earn a bonus on top of their normal value: +0.25 for a goal that ties the game or puts the team ahead, and +0.35 for the go-ahead goal that turns out to be the game winner (that one counts once, not twice). Assists get 40% (primary) or 20% (secondary) of it. A player who scores several tying or go-ahead goals gets the bonus every time. These goals also count 1.25x in momentum, and the opening goal 1.5x.</div>
        <div><b>Momentum (MOM)</b> credits each player for the plays that pushed momentum their team's way: shots on goal, goals and assists, faceoff wins, takeaways, hits, blocks and drawn penalties, minus giveaways and penalties taken. A penalty taken costs the player the momentum the other team gained from it, including the whole power play and 1.5 more if it scored. A penalty drawn earns the player that momentum: 1.0, the power play pressure, and 0.75 more if it scored. Penalties also move game score by a flat amount, +0.15 drawn and -0.15 taken, whether or not the power play scores (that part is mostly luck; momentum covers it). A <b>swing play</b> came while the team was behind on momentum and counts 1.5x. <b>Goalies</b> get expected save % (xSV%) from where, and how, each shot came: close, central and tipped shots are likelier goals. <b>GSAx</b> is goals saved above expected (positive means the goalie stopped more than an average goalie would have) and feeds the goalie's game score. These expected-goals numbers are our own estimate from shot distance, angle and type, not an official NHL stat. The <b>momentum bar</b> under game score splits MOM into what the player gained (green) and lost (red), with the biggest reasons for each.</div>
        <div class="s-muted">Weights follow the public Game Score model. <b>On-ice</b> uses shot attempts for and against while the player was on the ice (on goal 1, missed 0.5, blocked 0.35, and 1.5x from the home plate area in front of the net) plus goals for and against; <b>Shooting</b> adds a bonus for every attempt from home plate; if the NHL's shift data isn't available yet, it falls back to plus/minus.</div>
      </section>`, { cls: 's-fold' });
}

/** Fills #s-grid with player cards and wires the team/position/sort controls. */
// Kept outside the render so live refreshes don't reset the filters.
const cardFilter = { team: 'all', pos: 'all', sort: 'rating' };

export function mountScorecards(root, game, c) {
  const state = cardFilter;
  root.querySelectorAll('#s-controls [data-k]').forEach((seg) => {
    seg.querySelectorAll('button').forEach((x) => x.setAttribute('aria-pressed', String(x.dataset.v === state[seg.dataset.k])));
  });
  const el = root.querySelector('#s-grid');
  const draw = () => morphInner(el, grid(game, c, state));
  on(root.querySelector('#s-controls'), 'click', (e) => {
    const b = e.target.closest('button[data-v]');
    if (!b) return;
    const seg = b.closest('[data-k]');
    seg.querySelectorAll('button').forEach((x) => x.setAttribute('aria-pressed', String(x === b)));
    state[seg.dataset.k] = b.dataset.v;
    draw();
  });
  draw();
}

export default {
  id: 'scorecards',
  name: 'Scorecards',
  inspiration: 'Per-player game cards with a rating and what drove it: a modern take on HockeyStats player cards',
  render(game) {
    const c = teamColors(game);
    const sk = allSkaters(game);
    const all = [...sk, ...allGoalies(game)].sort((a, b) => b.rating - a.rating || b.gameScore - a.gameScore);
    const scale = Math.max(1.5, ...sk.map((p) => Object.values(p.gameScoreParts).reduce((a, v) => a + Math.max(0, v), 0))) * 1.05;
    return `<div class="s-wrap">
      ${header(game, c)}
      ${spotlight(game, c, all, scale)}
      ${scorecardControls(game)}
      <section class="s-grid" id="s-grid" data-js></section>
      ${scorecardKey()}
    </div>`;
  },
  mount(root, game) {
    mountScorecards(root, game, teamColors(game));
  },
};

// ---- Three stars: gold, silver and bronze cards with an expandable full scorecard ----
const MEDAL = [['gold', '★ 1st star'], ['silver', '2nd star'], ['bronze', '3rd star']];
// Until the NHL names its three stars, our own top performers show unlabeled by star.
const TOP = [['gold', '★ Top performer'], ['silver', '2nd best'], ['bronze', '3rd best']];
const sgn = (v, d = 2) => `${v > 0 ? '+' : v < 0 ? '−' : ''}${Math.abs(v).toFixed(d)}`;
const tile = (v, l) => `<div><b>${v}</b><small>${esc(l)}</small></div>`;
const bars = (l, a, b, ca, cb, fa = a, fb = b) => `<div class="ss-cmp"><div><span>${esc(l)}</span><b>${esc(fa)} <em>vs</em> ${esc(fb)}</b></div><div class="ss-bar"><i style="flex:${Math.max(Math.abs(a), 0.01)};background:${ca}"></i><i style="flex:${Math.max(Math.abs(b), 0.01)};background:${cb}"></i></div></div>`;
const grp = (t, items) => `<div class="ss-grp"><h5>${esc(t)}</h5><div class="ss-tiles3">${items.map(([v, l]) => tile(v, l)).join('')}</div></div>`;

function goalieParts(g) {
  const saves = 0.1 * g.saves;
  const above = 0.35 * (g.gsax ?? 0);
  const against = -0.75 * g.goalsAgainst;
  return { saves, above, against };
}

function starTiles(p) {
  if (p.position === 'G') {
    return [[p.saves, 'SV'], [p.shotsAgainst, 'SA'], [pct(p.savePct), 'SV%'], [p.goalsAgainst, 'GA'], [p.gsax != null ? sgn(p.gsax, 1) : '—', 'GSAx'], [p.xga != null ? p.xga.toFixed(1) : '—', 'EXP GA'], [esc(p.toi), 'TOI']];
  }
  return [[p.goals, 'G'], [p.assists, 'A'], [p.points, 'P'], [p.sog, 'SOG'], [p.attempts ?? '—', 'SAT'], [sgn(p.momentum ?? 0, 1), 'MOM'], [esc(p.toi), 'TOI']];
}

function starBar(p, scale) {
  if (p.position === 'G') {
    const gp = goalieParts(p);
    const sc = Math.max(gp.saves + Math.max(0, gp.above), 0.5);
    return `<div class="ss-bar solo"><i style="flex:${gp.saves};background:#22c55e" title="Saves"></i>${gp.above > 0 ? `<i style="flex:${gp.above};background:#14b8a6" title="Saves above expected"></i>` : ''}<span style="flex:0"></span></div>
      <div class="ss-leg"><span><i style="background:#22c55e"></i>Saves<b>${sgn(gp.saves, 1)}</b></span>${gp.above ? `<span><i style="background:${gp.above > 0 ? '#14b8a6' : '#f59e0b'}"></i>Saves vs expected<b>${sgn(gp.above, 1)}</b></span>` : ''}<span><i style="background:#f43f5e"></i>Goals against<b>${sgn(gp.against, 1)}</b></span></div>`;
  }
  const parts = GS_PARTS.filter(([k]) => p.gameScoreParts[k] > 0);
  const neg = GS_PARTS.filter(([k]) => p.gameScoreParts[k] < 0);
  return `<div class="ss-bar solo">${parts.map(([k, l]) => `<i style="flex:${p.gameScoreParts[k]};background:${PART_COLORS[k]}" title="${esc(l)}"></i>`).join('')}</div>
    <div class="ss-leg">${parts.concat(neg).map(([k, l]) => `<span><i style="background:${PART_COLORS[k]}"></i>${esc(l)}<b>${sgn(p.gameScoreParts[k], 1)}</b></span>`).join('')}</div>`;
}

function starCard(game, c, p, i, medals = MEDAL) {
  const [tier, kicker] = medals[i];
  return `<article class="ss-card ${tier}" style="--team:${c[p.side]}"><span class="ss-medal">${kicker}</span>
    <div class="ss-top">${headshot(p, 'ss-mug')}<div class="ss-who"><strong>${esc(p.fullName)}</strong><span>#${p.number ?? ''} · ${esc(p.position)} · ${esc(game[p.side].name)}</span></div>
      <div class="ss-rate" style="--r:${ratingColor(p.rating)}">${p.rating.toFixed(1)}<small>GAME SCORE ${sgn(p.gameScore, 1)}</small></div></div>
    <div class="ss-tiles">${starTiles(p).map(([v, l]) => tile(v, l)).join('')}</div>
    ${starBar(p)}
    <button type="button" class="ss-more" data-star="${i}" aria-expanded="false">▾ Full scorecard</button>
  </article>`;
}

function starPanel(game, c, p, i) {
  const total = `<div class="ss-total"><span>Game score</span><b>${sgn(p.gameScore)} = rating ${p.rating.toFixed(1)}</b></div>`;
  if (p.position === 'G') {
    const gp = goalieParts(p);
    const xsv = p.expectedSavePct;
    return `<div class="ss-panel" data-panel="${i}" hidden><div class="ss-col"><h4>How the score adds up</h4>
        <div class="ss-line"><i style="background:#22c55e"></i><span>${p.saves} saves × 0.1</span><b style="color:#22c55e">${sgn(gp.saves)}</b></div>
        ${p.gsax != null ? `<div class="ss-line"><i style="background:#14b8a6"></i><span>Saves vs expected</span><b style="color:#14b8a6">${sgn(gp.above)}</b></div>` : ''}
        <div class="ss-line"><i style="background:#f43f5e"></i><span>${p.goalsAgainst} goal${p.goalsAgainst === 1 ? '' : 's'} against × 0.75</span><b style="color:#f43f5e">${sgn(gp.against)}</b></div>${total}</div>
      <div class="ss-col"><h4>The night in plain terms</h4>
        <p>Faced <b>${p.shotsAgainst} shots</b> and stopped <b>${p.saves}</b> (${pct(p.savePct)}).${p.xga != null ? ` Those shots were worth <b>${p.xga.toFixed(1)} goals</b> on average, so allowing ${p.goalsAgainst} is <b>${Math.abs(p.gsax).toFixed(1)} ${p.gsax >= 0 ? 'better' : 'worse'} than expected</b>.` : ''}</p>
        <div class="ss-kv"><span>Even strength</span><b>${esc(p.evenStrength ?? '—')}</b><span>Power play</span><b>${esc(p.powerPlay ?? '—')}</b><span>Shorthanded</span><b>${esc(p.shorthanded ?? '—')}</b>${p.decision ? `<span>Decision</span><b>${esc(p.decision)}</b>` : ''}</div></div>
      <div class="ss-col"><h4>Against expectation</h4>
        ${p.xga != null ? bars('Goals against vs expected', p.goalsAgainst, p.xga, '#f43f5e', '#64748b', String(p.goalsAgainst), p.xga.toFixed(1)) : ''}
        ${xsv != null && p.shotsAgainst ? bars('Save % vs expected', p.saves / p.shotsAgainst, xsv, '#22c55e', '#64748b', pct(p.saves / p.shotsAgainst), pct(xsv)) : ''}
        <p class="ss-note">Expected goals are our own estimate from shot distance, angle and type.</p></div></div>`;
  }
  const rows = GS_PARTS.map(([k, l]) => { const v = p.gameScoreParts[k]; return `<div class="ss-line"><i style="background:${PART_COLORS[k]}"></i><span>${esc(l)}</span><span class="ss-track"><u style="width:${Math.min(100, (Math.abs(v) / 3.5) * 100)}%;background:${v < 0 ? '#f43f5e' : PART_COLORS[k]}"></u></span><b>${sgn(v)}</b></div>`; }).join('');
  const m = p.momentumParts;
  const mpos = m?.pos ?? 0, mneg = Math.abs(m?.neg ?? 0);
  return `<div class="ss-panel" data-panel="${i}" hidden><div class="ss-col"><h4>How the score adds up</h4>${rows}${total}</div>
    <div class="ss-col">${grp('Shooting and playmaking', [[p.attempts ?? '—', 'ATTEMPTS'], [p.sog, 'ON GOAL'], [p.homePlate ?? 0, 'FROM HOME PLATE']])}
      ${grp('Defense and puck care', [[p.blocks, 'BLOCKS'], [`${p.takeaways}/${p.giveaways}`, 'TAKE / GIVE'], [p.hits, 'HITS']])}
      ${grp('Game flow', [[signed(p.plusMinus), '+/-'], [p.shifts, 'SHIFTS'], [`${p.penaltiesDrawn}/${p.penaltiesTaken}`, 'PEN DRAWN / TAKEN']])}</div>
    <div class="ss-col"><h4>Attempts and momentum</h4>
      ${p.onIce ? bars('Shot attempts while on ice', p.onIce.cf, p.onIce.ca, '#6366f1', '#64748b') : ''}
      ${bars('Momentum earned vs given up', mpos, mneg, '#22c55e', '#f43f5e', sgn(mpos, 1), sgn(-mneg, 1))}
      <p class="ss-note">${p.swingPlays ? `<b>${p.swingPlays}</b> swing play${p.swingPlays === 1 ? '' : 's'}` : 'No swing plays'}${p.keyGoalBonus > 0 ? `, including goals that tied the game or took the lead (+${p.keyGoalBonus.toFixed(2)})` : ''}.</p></div></div>`;
}

/** The three stars of a finished game, under the scoreboard. */
export function starsRow(game, c, players) {
  // The 1st/2nd/3rd star labels are the NHL's official stars, in the NHL's order.
  const official = [...(game.threeStars ?? [])].sort((x, y) => x.star - y.star)
    .map((st) => players.find((p) => p.id === st.id)).filter(Boolean);
  const isOfficial = official.length === 3;
  const top = isOfficial ? official : players.slice(0, 3);
  if (top.length < 3) return '';
  const medals = isOfficial ? MEDAL : TOP;
  return `<section class="ss-row" id="st-stars" aria-label="${isOfficial ? 'Three stars of the game' : 'Top performers'}"><div class="ss-cards">${top.map((p, i) => starCard(game, c, p, i, medals)).join('')}</div>${top.map((p, i) => starPanel(game, c, p, i)).join('')}</section>`;
}

export function mountStars(root) {
  const row = root.querySelector('.ss-row');
  if (!row) return;
  on(row, 'click', (e) => {
    const b = e.target.closest('.ss-more');
    if (!b) return;
    const open = b.getAttribute('aria-expanded') === 'true';
    row.querySelectorAll('.ss-more').forEach((x) => { x.setAttribute('aria-expanded', 'false'); x.textContent = '▾ Full scorecard'; });
    row.querySelectorAll('.ss-panel').forEach((x) => { x.hidden = true; });
    if (!open) {
      b.setAttribute('aria-expanded', 'true');
      b.textContent = '▴ Hide scorecard';
      row.querySelector(`.ss-panel[data-panel="${b.dataset.star}"]`).hidden = false;
    }
  });
}

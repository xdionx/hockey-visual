// Design "Game Story": the Broadcast look with the Analytics and Scorecards data,
// ordered to tell the game's story: what happened, how momentum swung, where the
// shots came from, who drove it, then the full box score.
import { esc, teamColors, allSkaters, allGoalies, elapsed, logo, statusText, strengthBadge } from './core.js';
import { hero, scoringCards, stars, statBars } from './d2-broadcast.js';
import { kpis, shotMap, heatTable, goalies, shotSummary, mountShotMap } from './d4-analytics.js';
import { spotlight, scorecardControls, scorecardKey, mountScorecards } from './d5-scorecards.js';

const SECTIONS = [
  ['story', 'Story'], ['momentum', 'Momentum'], ['shots', 'Shots'], ['players', 'Players'], ['box', 'Box score'],
];

function colors(game) {
  const c = teamColors(game, { dark: true });
  c.panelAway = c.awayBase;
  c.panelHome = c.homeBase;
  return c;
}

const statLine = (p) => (p.position === 'G'
  ? `${p.saves} saves on ${p.shotsAgainst} shots`
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
    dek.push(`${game.status.label}.`);
    if (att) dek.push(`${away.abbrev} has ${Math.round((100 * shots.away.attempts) / att)}% of shot attempts so far (${shots.away.attempts}-${shots.home.attempts}).`);
    if (best) dek.push(`${best.fullName} (${best.team}) has been the best player on the ice so far: ${statLine(best)}.`);
    return { headline, dek };
  }

  const w = lead ?? 'home';
  const l = other(w);
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

  // The deciding goal: the winner's goal that put them ahead for good.
  if (last === 'SO') {
    const decider = game.scoring.find((g) => g.period === 'SO');
    if (decider) dek.push(`${decider.scorer.fullName} scored the shootout winner.`);
  } else {
    const n = t[l] + 1;
    let k = 0;
    const gwg = goals.find((g) => g.team === game[w].abbrev && ++k === n);
    if (gwg) dek.push(`${gwg.scorer.fullName} scored the winner at ${gwg.time} of the ${gwg.periodName.toLowerCase()}.`);
  }
  if (att) {
    const top = shots.away.attempts >= shots.home.attempts ? 'away' : 'home';
    const pctAtt = Math.round((100 * shots[top].attempts) / att);
    dek.push(`${game[top].abbrev} drove play with ${pctAtt}% of shot attempts (${shots[top].attempts}-${shots[other(top)].attempts}) and ${shots[top].sog}-${shots[other(top)].sog} on goal.`);
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
  const team = (side) => `<span class="st-mini-t" style="--team:${c[side]}">${logo(game[side], 'st-mini-logo', true)}<b>${esc(game[side].abbrev)}</b><strong>${pre ? '' : game.linescore.totals[side]}</strong></span>`;
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
  if (cause.kind === 'power-play') return 'power play pressure';
  if (cause.kind === 'giveaway') return `${cause.player ?? 'an opponent'}'s giveaway`;
  if (cause.kind === 'penalty') return `${cause.player ?? 'a player'} drawing a penalty`;
  return `${cause.player ? `${cause.player}'s ` : 'a '}${KIND_LABEL[cause.kind] ?? cause.kind}`;
}

/** Diverging momentum chart: home pushes up, away pushes down. */
function momentumChart(game, c) {
  const m = game.momentum;
  if (!m?.series?.length) return '';
  const W = 1000; const H = 300; const P = { l: 8, r: 8, t: 26, b: 26 };
  const end = Math.max(3600, m.series.at(-1)[0]);
  const X = (t) => P.l + ((W - P.l - P.r) * t) / end;
  const mid = (H - P.b + P.t) / 2;
  const half = (H - P.t - P.b) / 2;
  const Y = (v) => mid - (half * v) / m.max;
  const line = m.series.map(([t, v], i) => `${i ? 'L' : 'M'}${X(t).toFixed(1)} ${Y(v).toFixed(1)}`).join('');
  const area = `${line}L${X(m.series.at(-1)[0]).toFixed(1)} ${mid}L${X(0)} ${mid}Z`;
  const pp = m.powerPlays.map((p) => {
    const x1 = X(p.start); const x2 = X(p.end ?? m.series.at(-1)[0]);
    const top = p.team === 'home';
    return `<rect x="${x1}" y="${top ? P.t : mid}" width="${Math.max(2, x2 - x1)}" height="${half}" fill="${c[p.team]}" opacity=".12"/><text x="${(x1 + x2) / 2}" y="${top ? P.t - 6 : H - P.b + 16}" text-anchor="middle" class="st-mc-pp" fill="${c[p.team]}">PP${p.result === 'goal' ? ' ✓' : ''}</text>`;
  }).join('');
  const goals = game.scoring.filter((g) => g.period !== 'SO').map((g) => {
    const side = g.team === game.away.abbrev ? 'away' : 'home';
    const t = elapsed(g.period, g.time);
    return `<g><line x1="${X(t)}" x2="${X(t)}" y1="${P.t}" y2="${H - P.b}" stroke="${c[side]}" stroke-width="1.5" stroke-dasharray="3 3" opacity=".8"/><circle cx="${X(t)}" cy="${side === 'home' ? P.t + 8 : H - P.b - 8}" r="9" fill="${c[side]}" stroke="#fff" stroke-width="1.5"/><text x="${X(t)}" y="${(side === 'home' ? P.t + 8 : H - P.b - 8) + 4}" text-anchor="middle" class="st-mc-g">G</text><title>${esc(`${g.team} goal: ${g.scorer.fullName} (${g.period === 'OT' ? 'OT' : `P${g.period}`} ${g.time})`)}</title></g>`;
  }).join('');
  const swings = m.swings.map((sw, i) => `<g><circle cx="${X(sw.t)}" cy="${mid}" r="8" fill="#0b1220" stroke="${c[sw.team]}" stroke-width="2"/><text x="${X(sw.t)}" y="${mid + 4}" text-anchor="middle" class="st-mc-s">${i + 1}</text></g>`).join('');
  const periods = [1200, 2400, 3600].filter((t) => t < end).map((t) => `<line x1="${X(t)}" x2="${X(t)}" y1="${P.t}" y2="${H - P.b}" class="st-mc-grid"/>`).join('');
  const labels = ['1st', '2nd', '3rd', 'OT'].map((l, i) => (i * 1200 < end ? `<text x="${X(Math.min(i * 1200 + (i < 3 ? 600 : (end - 3600) / 2), end))}" y="${H - 6}" text-anchor="middle" class="st-mc-lbl">${l}</text>` : '')).join('');
  return `<div class="b-card st-mc"><div class="st-mc-key"><span style="color:${c.home}">&#9650; ${esc(game.home.commonName)}</span><span style="color:${c.away}">&#9660; ${esc(game.away.commonName)}</span></div>
    <svg viewBox="0 0 ${W} ${H}" class="st-mc-svg" role="img" aria-label="Momentum over the game">
      <defs><clipPath id="st-top"><rect x="0" y="0" width="${W}" height="${mid}"/></clipPath><clipPath id="st-bot"><rect x="0" y="${mid}" width="${W}" height="${H}"/></clipPath>
        <linearGradient id="st-gh" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${c.home}" stop-opacity=".9"/><stop offset="1" stop-color="${c.home}" stop-opacity=".25"/></linearGradient>
        <linearGradient id="st-ga" x1="0" y1="1" x2="0" y2="0"><stop offset="0" stop-color="${c.away}" stop-opacity=".9"/><stop offset="1" stop-color="${c.away}" stop-opacity=".25"/></linearGradient></defs>
      ${pp}${periods}
      <path d="${area}" fill="url(#st-gh)" clip-path="url(#st-top)"/><path d="${area}" fill="url(#st-ga)" clip-path="url(#st-bot)"/>
      <line x1="${P.l}" x2="${W - P.r}" y1="${mid}" y2="${mid}" class="st-mc-zero"/>
      ${goals}${swings}${labels}
    </svg>
    <p class="st-note">Momentum weighs every play: goals 3, shots on goal 1, missed shots 0.35, blocked attempts 0.2, faceoff wins 0.25 to 0.6 (more in the offensive zone), takeaways and opponents' giveaways 0.5, hits 0.2, drawing a penalty 1 plus steady pressure through the power play, and 1.5 for killing a penalty. The player who took the penalty is charged for all of it, plus 1.5 more if the power play scores. Each push fades with a 75-second half-life. Shaded bands are power plays; numbered circles are momentum swings.</p>
  </div>`;
}

function swingList(game, c) {
  const m = game.momentum;
  if (!m?.swings?.length) return '';
  return `<div class="b-card"><h2>Momentum swings</h2><ol class="st-swings">${m.swings.map((sw, i) => `<li style="--team:${c[sw.team]}">
    <span class="st-sw-n">${i + 1}</span>
    <div><b>${esc(game[sw.team].commonName)}</b> take over at ${esc(clock(sw.t))}<span class="st-sw-c">sparked by ${esc(causeText(game, sw.cause))}</span></div>
    <span class="st-sw-d">held ${Math.round((sw.until - sw.t) / 60)}:${String(Math.round((sw.until - sw.t) % 60)).padStart(2, '0')}</span>
  </li>`).join('')}</ol></div>`;
}

function drivers(game, c) {
  const list = allSkaters(game).filter((p) => p.momentum != null).sort((a, b) => b.momentum - a.momentum).slice(0, 6);
  if (!list.length) return '';
  const max = Math.max(...list.map((p) => p.momentum), 1);
  return `<div class="b-card"><h2>Momentum drivers</h2>${list.map((p) => `<div class="st-drv" style="--team:${c[p.side]}">
    <span class="st-drv-n">${esc(p.fullName)} <small>${esc(p.team)}</small></span>
    <div class="st-drv-bar"><i style="width:${(100 * Math.max(0, p.momentum)) / max}%"></i></div>
    <b>+${p.momentum.toFixed(1)}</b><span class="st-drv-s">${p.swingPlays ? `&#8635; ${p.swingPlays}` : ''}</span>
  </div>`).join('')}${killers(game, c)}<p class="st-note">&#8635; = swing plays: pushes made while their team was behind on momentum.</p></div>`;
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
  return `<div class="st-periods">${game.linescore.periods.filter((p) => p.label !== 'SO').map((p, i) => {
    const mshare = game.momentum?.periods?.[i];
    const win = p.away === p.home ? null : p.away > p.home ? 'away' : 'home';
    const sa = p.shotsAway ?? 0;
    const sh = p.shotsHome ?? 0;
    const tot = sa + sh || 1;
    return `<div class="st-pd"><span class="st-pd-l">${p.label === 'OT' ? 'OT' : `Period ${esc(p.label)}`}</span>
      <b style="${win ? `color:${c[win]}` : ''}">${p.away ?? 0}-${p.home ?? 0}</b>
      <div class="b-bar"><i style="width:${(100 * sa) / tot}%;background:${c.away}"></i><i style="width:${(100 * sh) / tot}%;background:${c.home}"></i></div>
      <span class="st-pd-s">Shots ${sa}-${sh}${mshare ? ` · Momentum ${mshare.away}%-${mshare.home}%` : ''}</span></div>`;
  }).join('')}</div>`;
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
      ${hero(game, c)}
      <div class="st-bar">
        ${miniScore(game, c)}
        <nav class="st-nav" aria-label="Sections">${SECTIONS.map(([id, label], i) => `<a href="#st-${id}" data-sec="${id}"><span>${String(i + 1).padStart(2, '0')}</span>${esc(label)}</a>`).join('')}</nav>
      </div>

      <section class="st-sec" id="st-story">
        ${header(1, 'story', 'The story')}
        <div class="st-lede"><h1>${esc(story.headline)}</h1>${story.dek.map((d) => `<p>${esc(d)}</p>`).join('')}</div>
        ${started ? `<div class="b-cols st-cols"><div>${scoringCards(game, c)}</div><div>${stars(game)}${statBars(game, c)}</div></div>` : ''}
      </section>

      ${started ? `
      <section class="st-sec" id="st-momentum">
        ${header(2, 'momentum', 'Momentum', 'Who was pushing the play, minute by minute. Above the line is the home team, below is the away team.')}
        ${momentumChart(game, c)}
        ${periodWins(game, c)}
        <div class="b-cols st-cols"><div>${swingList(game, c)}</div><div>${drivers(game, c)}</div></div>
        ${kpis(game, c)}
      </section>

      <section class="st-sec" id="st-shots">
        ${header(3, 'shots', 'Where the shots came from', 'Switch between every attempt and the zone map, which counts attempts and goals by area of the offensive zone.')}
        ${shotMap(game, c)}
      </section>

      <section class="st-sec" id="st-players">
        ${header(4, 'players', 'Player scorecards', 'Each player’s rating and what drove it.')}
        ${spotlight(game, c, all, scale)}
        ${scorecardControls(game)}
        <div class="s-grid" id="s-grid"></div>
        ${scorecardKey()}
      </section>

      <section class="st-sec" id="st-box">
        ${header(5, 'box', 'Box score')}
        ${goalies(game, c)}
        ${heatTable(game, c)}
      </section>` : ''}
    </div>`;
  },
  mount(root, game) {
    const c = colors(game);
    if (root.querySelector('#a-shots')) mountShotMap(root, game, c);
    if (root.querySelector('#s-grid')) mountScorecards(root, game, c);

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
      root.heroObserver = new IntersectionObserver(([e]) => bar.classList.toggle('stuck', !e.isIntersecting && e.boundingClientRect.top < 0), { rootMargin: '-60px 0px 0px 0px' });
      root.heroObserver.observe(heroEl);
    }
    root.querySelectorAll('.st-sec').forEach((s) => io.observe(s));
  },
};

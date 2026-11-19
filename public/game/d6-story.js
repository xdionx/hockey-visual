// Design "Game Story": the Broadcast look with the Analytics and Scorecards data,
// ordered to tell the game's story: what happened, how momentum swung, where the
// shots came from, who drove it, then the full box score.
import { esc, teamColors, allSkaters, allGoalies } from './core.js';
import { hero, scoringCards, stars, statBars } from './d2-broadcast.js';
import { kpis, shotMap, flowChart, heatTable, goalies, shotSummary, mountShotMap } from './d4-analytics.js';
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

/** Goals per period as a small strip under the momentum chart: who won each period. */
function periodWins(game, c) {
  return `<div class="st-periods">${game.linescore.periods.filter((p) => p.label !== 'SO').map((p) => {
    const win = p.away === p.home ? null : p.away > p.home ? 'away' : 'home';
    const sa = p.shotsAway ?? 0;
    const sh = p.shotsHome ?? 0;
    const tot = sa + sh || 1;
    return `<div class="st-pd"><span class="st-pd-l">${p.label === 'OT' ? 'OT' : `Period ${esc(p.label)}`}</span>
      <b style="${win ? `color:${c[win]}` : ''}">${p.away ?? 0}-${p.home ?? 0}</b>
      <div class="b-bar"><i style="width:${(100 * sa) / tot}%;background:${c.away}"></i><i style="width:${(100 * sh) / tot}%;background:${c.home}"></i></div>
      <span class="st-pd-s">Shots ${sa}-${sh}</span></div>`;
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
      <nav class="st-nav" aria-label="Sections">${SECTIONS.map(([id, label], i) => `<a href="#st-${id}" data-sec="${id}"><span>${String(i + 1).padStart(2, '0')}</span>${esc(label)}</a>`).join('')}</nav>

      <section class="st-sec" id="st-story">
        ${header(1, 'story', 'The story')}
        <div class="st-lede"><h1>${esc(story.headline)}</h1>${story.dek.map((d) => `<p>${esc(d)}</p>`).join('')}</div>
        ${started ? `<div class="b-cols st-cols"><div>${scoringCards(game, c)}</div><div>${stars(game)}${statBars(game, c)}</div></div>` : ''}
      </section>

      ${started ? `
      <section class="st-sec" id="st-momentum">
        ${header(2, 'momentum', 'Momentum', 'Running total of shot attempts. Dots are goals; a steeper line means more pressure.')}
        ${kpis(game, c)}
        ${flowChart(game, c)}
        ${periodWins(game, c)}
      </section>

      <section class="st-sec" id="st-shots">
        ${header(3, 'shots', 'Where the shots came from', 'Every shot attempt. Filter by team or period; hover a mark for details.')}
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
    root.querySelectorAll('.st-sec').forEach((s) => io.observe(s));
  },
};

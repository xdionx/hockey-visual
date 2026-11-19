// "The story" in more depth: a chapter per period, the turning points in order, and the
// numbers that explain the result. Everything is worked out from the box score data.
import { esc, allSkaters, elapsed, headshot } from './core.js';
import { shotSummary } from './d4-analytics.js';

const sideOf = (game, abbrev) => (abbrev === game.away.abbrev ? 'away' : 'home');
const other = (s) => (s === 'away' ? 'home' : 'away');
const last = (name) => String(name ?? '').replace(/^.*\s/, '');
const list = (xs) => (xs.length < 2 ? xs.join('') : `${xs.slice(0, -1).join(', ')} and ${xs.at(-1)}`);
const ordinal = ['first', 'second', 'third'];
const fmtClock = (t) => {
  const n = Math.floor(t / 1200);
  const s = t - n * 1200;
  return `${n >= 3 ? 'OT' : `P${n + 1}`} ${Math.floor(s / 60)}:${String(Math.round(s % 60)).padStart(2, '0')}`;
};

/** Goals in order with the score after each and what the goal did to the game. */
function goalEvents(game) {
  let a = 0;
  let h = 0;
  return game.scoring.filter((g) => g.period !== 'SO').map((g) => {
    const side = sideOf(game, g.team);
    const before = { away: a, home: h };
    if (side === 'away') a++; else h++;
    const after = { away: a, home: h };
    const diffBefore = before[side] - before[other(side)];
    let effect = 'extend';
    if (a + h === 1) effect = 'first';
    else if (diffBefore === -1) effect = 'tie';
    else if (diffBefore === 0) effect = 'lead';
    else if (diffBefore < -1) effect = 'cut';
    return { ...g, side, t: elapsed(g.period, g.time), before, after, effect, pp: g.tags.includes('PPG'), sh: g.tags.includes('SHG'), en: g.tags.includes('EN') };
  });
}

/** When a team changed goalies: the starter's time on ice is when the backup came in. */
function goalieChanges(game) {
  const out = [];
  for (const side of ['away', 'home']) {
    const played = game.players[side].goalies.filter((g) => g.played && g.toiSeconds > 0).sort((x, y) => y.starter - x.starter);
    if (played.length < 2) continue;
    const [starter, relief] = played;
    out.push({ side, t: starter.toiSeconds, starter, relief });
  }
  return out;
}

/** One paragraph per period. */
function chapters(game, c, events, changes) {
  const periods = game.linescore.periods.filter((p) => p.label !== 'SO');
  const shareOf = game.momentum?.periods ?? [];
  const pps = game.momentum?.powerPlays ?? [];
  return periods.map((p, i) => {
    const start = i * 1200;
    const end = i < 3 ? start + 1200 : Infinity;
    const goals = events.filter((g) => g.t >= start && g.t < end || (i === 3 && g.period === 'OT'));
    const sentences = [];
    const name = i < 3 ? `${ordinal[i]} period` : 'overtime';
    if (!goals.length) sentences.push(`No goals in the ${name}.`);
    for (const [j, g] of goals.entries()) {
      const who = `${g.scorer.fullName}${g.pp ? ' on the power play' : g.sh ? ' shorthanded' : g.en ? ' into an empty net' : ''}`;
      const score = `${g.after.away}-${g.after.home}`;
      const team = game[g.side].commonName;
      const assist = g.assists.length ? ` from ${list(g.assists.map((x) => last(x.name)))}` : '';
      if (g.effect === 'first') sentences.push(`${who} opened the scoring for the ${team} at ${g.time}${assist}.`);
      else if (g.effect === 'tie') sentences.push(`${who} tied it ${score} at ${g.time}${assist}.`);
      else if (g.effect === 'lead') sentences.push(`${who} put the ${team} ahead ${score} at ${g.time}${assist}.`);
      else if (g.effect === 'cut') sentences.push(`${who} cut the lead to ${Math.abs(g.after.away - g.after.home)} at ${g.time} (${score})${assist}.`);
      else sentences.push(`${j && goals[j - 1].side === g.side ? 'Then ' : ''}${who} made it ${score} at ${g.time}${assist}.`);
      if (i === 3 && g.period === 'OT') sentences.push('That ended it.');
    }
    // A change right at an intermission (starter's time is a whole number of periods) belongs to the period before.
    for (const ch of changes.filter((x) => (x.t % 1200 === 0 ? x.t - 1 : x.t) >= start && (x.t % 1200 === 0 ? x.t - 1 : x.t) < end)) {
      const when = ch.t % 1200 === 0 ? ` after the ${ordinal[ch.t / 1200 - 1] ?? 'third'} period` : '';
      sentences.push(`The ${game[ch.side].commonName} pulled ${ch.starter.fullName}${when} (${ch.starter.goalsAgainst} goals on ${ch.starter.shotsAgainst} shots); ${ch.relief.fullName} stopped ${ch.relief.saves} of ${ch.relief.shotsAgainst} the rest of the way.`);
    }
    const myPP = pps.filter((pp) => pp.start >= start && pp.start < end);
    for (const side of ['away', 'home']) {
      const mine = myPP.filter((pp) => pp.team === side);
      if (!mine.length) continue;
      const scored = mine.filter((pp) => pp.result === 'goal').length;
      sentences.push(`${game[side].abbrev} went ${scored} for ${mine.length} on the power play.`);
    }
    const share = shareOf[i];
    if (share) {
      const top = share.away >= share.home ? 'away' : 'home';
      const shots = `${p.shotsAway ?? 0}-${p.shotsHome ?? 0}`;
      const ctl = share.control;
      const held = ctl ? (ctl.away >= ctl.home ? 'away' : 'home') : top;
      const mins = ctl ? Math.round(ctl[held] / 60) : null;
      const hold = ctl && mins ? ` and had control for about ${mins} minute${mins === 1 ? '' : 's'}` : '';
      if (share[top] >= 60) sentences.push(`The ${game[top].commonName} drove it, creating ${share[top]}% of the momentum${held === top ? hold : ''} (shots ${shots}).`);
      else if (share[top] >= 54) sentences.push(`The ${game[top].commonName} had the edge, ${share[top]}% of the momentum created (shots ${shots}).`);
      else sentences.push(`Momentum was even, ${share.away}%-${share.home}% (shots ${shots}).`);
    }
    const won = p.away === p.home ? null : p.away > p.home ? 'away' : 'home';
    return `<article class="st-ch" style="--team:${won ? c[won] : '#475569'}">
      <header><span class="st-ch-p">${i < 3 ? `${['1st', '2nd', '3rd'][i]} period` : 'Overtime'}</span>
        <span class="st-ch-s"><b style="color:${c.away}">${esc(game.away.abbrev)} ${p.away ?? 0}</b> – <b style="color:${c.home}">${p.home ?? 0} ${esc(game.home.abbrev)}</b></span></header>
      <p>${sentences.map(esc).join(' ')}</p>
    </article>`;
  }).join('');
}

/** Key moments in time order: goals that changed the game, goalie changes, swings and the decider. */
function turningPoints(game, c, events, changes) {
  const pts = [];
  const t = game.linescore.totals;
  const winner = t.away === t.home ? null : t.away > t.home ? 'away' : 'home';
  // The game-winner: the winner's goal that gave them one more than the loser's final total.
  let gwg = null;
  if (winner && !game.status.label.includes('SO')) {
    let k = 0;
    gwg = events.find((g) => g.side === winner && ++k === t[other(winner)] + 1) ?? null;
  }
  const comeback = new Set();
  for (const g of events) {
    const deficit = g.before[other(g.side)] - g.before[g.side];
    let tag = null;
    if (g === gwg) tag = 'Winner';
    else if (g.effect === 'first') tag = 'First goal';
    else if (g.effect === 'tie') tag = 'Tying goal';
    else if (g.effect === 'lead' && g.after.away + g.after.home > 1) tag = 'Go-ahead';
    else if (g.effect === 'cut' && deficit >= 3 && !comeback.has(g.side)) { tag = 'Comeback starts'; comeback.add(g.side); }
    if (!tag) continue;
    pts.push({ t: g.t, side: g.side, tag, person: g.scorer, text: `${g.scorer.fullName} scores${g.pp ? ' on the power play' : ''}. ${game.away.abbrev} ${g.after.away}, ${game.home.abbrev} ${g.after.home}.` });
  }
  for (const ch of changes) {
    pts.push({ t: ch.t, label: ch.t % 1200 === 0 ? `After P${ch.t / 1200}` : null, side: ch.side, tag: 'Goalie change', person: ch.relief, text: `${ch.relief.fullName} replaces ${ch.starter.fullName} in the ${game[ch.side].commonName} net.` });
  }
  // The longest momentum runs, with what sparked them.
  const swings = [...(game.momentum?.swings ?? [])].sort((x, y) => (y.until - y.t) - (x.until - x.t)).slice(0, 2);
  for (const sw of swings) {
    const mins = Math.round((sw.until - sw.t) / 60);
    if (mins < 3) continue;
    const by = sw.cause?.player ? ` sparked by ${sw.cause.player}` : '';
    pts.push({ t: sw.t, side: sw.team, tag: 'Momentum run', text: `The ${game[sw.team].commonName} take over for ${mins} minutes${by}.` });
  }
  if (game.status.label.includes('SO')) {
    const so = game.scoring.find((g) => g.period === 'SO');
    if (so) pts.push({ t: 99999, side: sideOf(game, so.team), tag: 'Shootout', person: so.scorer, text: `${so.scorer.fullName} scores the shootout winner.` });
  }
  pts.sort((x, y) => x.t - y.t);
  if (!pts.length) return '';
  return `<div class="b-card st-tp"><h2>Turning points</h2><ol>${pts.map((p) => `<li style="--team:${c[p.side]}">
    <span class="st-tp-t">${p.t === 99999 ? 'SO' : esc(p.label ?? fmtClock(p.t))}</span>
    ${p.person ? headshot(p.person, 'st-tp-mug') : '<span class="st-tp-mug st-tp-icon">&#8635;</span>'}
    <div><span class="st-tp-tag">${esc(p.tag)}</span>${esc(p.text)}</div>
  </li>`).join('')}</ol></div>`;
}

/** A handful of numbers that explain the result. */
function byTheNumbers(game, c, events) {
  const shots = shotSummary(game);
  const stat = (k) => game.teamStats.find((s) => s.key === k);
  let a = 0; let h = 0; let leader = null; let changes = 0; let biggest = 0;
  for (const g of events) {
    if (g.side === 'away') a++; else h++;
    biggest = Math.max(biggest, Math.abs(a - h));
    const now = a === h ? leader : a > h ? 'away' : 'home';
    if (a !== h && leader && now !== leader) changes++;
    if (a !== h) leader = now;
  }
  const deficits = { away: 0, home: 0 };
  for (const g of events) {
    deficits.away = Math.max(deficits.away, g.after.home - g.after.away);
    deficits.home = Math.max(deficits.home, g.after.away - g.after.home);
  }
  const t = game.linescore.totals;
  const winner = t.away === t.home ? null : t.away > t.home ? 'away' : 'home';
  const tiles = [];
  if (winner && deficits[winner] >= 2) tiles.push([`${deficits[winner]}`, 'goal comeback', `${game[winner].abbrev} trailed by ${deficits[winner]}`, winner]);
  tiles.push([`${changes}`, changes === 1 ? 'lead change' : 'lead changes', `Biggest lead: ${biggest}`, null]);
  const plate = shots.away.plate + shots.home.plate;
  if (plate) {
    const top = shots.away.plate >= shots.home.plate ? 'away' : 'home';
    tiles.push([`${shots[top].plate}-${shots[other(top)].plate}`, 'home plate attempts', `${game[top].abbrev} · ${shots.away.plateGoals + shots.home.plateGoals} of ${shots.away.goals + shots.home.goals} goals came from there`, top]);
  }
  const pp = stat('powerPlay');
  if (pp) tiles.push([`${pp.away} · ${pp.home}`, 'power play', `${game.away.abbrev} · ${game.home.abbrev}`, null]);
  const fo = stat('faceoffWinningPctg');
  if (fo) { const top = fo.awayNum >= fo.homeNum ? 'away' : 'home'; tiles.push([fo[top], 'faceoffs won', game[top].abbrev, top]); }
  const hits = stat('hits');
  if (hits) { const top = hits.awayNum >= hits.homeNum ? 'away' : 'home'; tiles.push([`${hits[top]}-${hits[other(top)]}`, 'hits', `${game[top].abbrev} more physical`, top]); }
  const gvs = stat('giveaways');
  if (gvs) { const top = gvs.awayNum >= gvs.homeNum ? 'away' : 'home'; tiles.push([gvs[top], 'giveaways', `${game[top].abbrev} gave it away more`, other(top)]); }
  // Best skater not already the star of the lede: the top momentum driver.
  const driver = allSkaters(game).filter((p) => p.momentum != null).sort((x, y) => y.momentum - x.momentum)[0];
  if (driver) tiles.push([`+${driver.momentum.toFixed(1)}`, 'top momentum driver', driver.fullName, driver.side]);
  return `<div class="st-nums">${tiles.map(([big, label, sub, side]) => `<div class="st-num"${side ? ` style="--team:${c[side]}"` : ''}><b>${esc(big)}</b><span>${esc(label)}</span><small>${esc(sub)}</small></div>`).join('')}</div>`;
}

export function storyChapters(game, c) {
  if (game.status.state !== 'live' && game.status.state !== 'final') return '';
  const events = goalEvents(game);
  const changes = goalieChanges(game);
  return `${byTheNumbers(game, c, events)}
    <div class="b-cols st-cols st-story-cols"><div class="b-card"><h2>How it unfolded</h2><div class="st-chs">${chapters(game, c, events, changes)}</div></div>
    <div>${turningPoints(game, c, events, changes)}</div></div>`;
}

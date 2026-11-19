// "The story" in more depth: a chapter per period, the turning points in order, and the
// numbers that explain the result. Everything is worked out from the box score data.
import { esc, allSkaters, elapsed, headshot, logo } from './core.js';
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

const EFFECT = { first: 'Opens scoring', tie: 'Ties it', lead: 'Go-ahead', cut: 'Cuts the lead', extend: 'Extends lead' };

/** One chapter per period: a headline, quick stats, then each goal and goalie change on its own line. */
function chapters(game, c, events, changes) {
  const periods = game.linescore.periods.filter((p) => p.label !== 'SO');
  const shareOf = game.momentum?.periods ?? [];
  const pps = game.momentum?.powerPlays ?? [];
  const tag = (side) => `<span class="st-ch-tm" style="--team:${c[side]}">${esc(game[side].abbrev)}</span>`;
  return periods.map((p, i) => {
    const start = i * 1200;
    const end = i < 3 ? start + 1200 : Infinity;
    const goals = events.filter((g) => g.t >= start && g.t < end || (i === 3 && g.period === 'OT'));
    const rows = goals.map((g) => {
      const kind = g.pp ? '<em class="st-ch-k">PP</em>' : g.sh ? '<em class="st-ch-k">SH</em>' : g.en ? '<em class="st-ch-k">EN</em>' : '';
      const effect = i === 3 && g.period === 'OT' ? 'Wins it' : EFFECT[g.effect];
      const assists = g.assists.length ? `<small>from ${esc(list(g.assists.map((x) => last(x.name))))}</small>` : '<small>unassisted</small>';
      return `<li><span class="st-ch-t">${esc(g.time)}</span>${tag(g.side)}<span class="st-ch-who"><b>${esc(g.scorer.fullName)}</b>${kind}${assists}</span>
        <span class="st-ch-fx ${g.effect}">${effect}<b>${g.after.away}-${g.after.home}</b></span></li>`;
    });
    // A change right at an intermission (starter's time is a whole number of periods) belongs to the period before.
    for (const ch of changes.filter((x) => (x.t % 1200 === 0 ? x.t - 1 : x.t) >= start && (x.t % 1200 === 0 ? x.t - 1 : x.t) < end)) {
      const when = ch.t % 1200 === 0 ? 'Int.' : `${Math.floor((ch.t % 1200) / 60)}:${String(ch.t % 60).padStart(2, '0')}`;
      rows.push(`<li class="st-ch-g"><span class="st-ch-t">${when}</span>${tag(ch.side)}<span class="st-ch-who"><b>Goalie change</b><small>${esc(last(ch.starter.fullName))} out (${ch.starter.goalsAgainst} GA on ${ch.starter.shotsAgainst}) · ${esc(last(ch.relief.fullName))} in, ${ch.relief.saves}/${ch.relief.shotsAgainst} after</small></span></li>`);
    }
    if (!goals.length) rows.unshift('<li class="st-ch-none">No goals</li>');
    // Headline: who drove the period, in plain words.
    const share = shareOf[i];
    let head = '';
    if (share) {
      const top = share.away >= share.home ? 'away' : 'home';
      const ctl = share.control;
      const mins = ctl ? Math.round(ctl[top] / 60) : null;
      if (share[top] >= 60) head = `${tag(top)} drove the period${mins ? `, in control for about ${mins} min` : ''}`;
      else if (share[top] >= 54) head = `${tag(top)} had a slight edge`;
      else head = 'Momentum was even';
    }
    const chips = [];
    chips.push(`<span>Shots <b>${p.shotsAway ?? 0}-${p.shotsHome ?? 0}</b></span>`);
    if (share) chips.push(`<span>Momentum <b>${share.away}-${share.home}%</b></span>`);
    const myPP = pps.filter((pp) => pp.start >= start && pp.start < end);
    for (const side of ['away', 'home']) {
      const mine = myPP.filter((pp) => pp.team === side);
      if (mine.length) chips.push(`<span>${esc(game[side].abbrev)} PP <b>${mine.filter((pp) => pp.result === 'goal').length}/${mine.length}</b></span>`);
    }
    const won = p.away === p.home ? null : p.away > p.home ? 'away' : 'home';
    return `<article class="st-ch" style="--team:${won ? c[won] : '#475569'}">
      <header><span class="st-ch-p">${i < 3 ? `${['1st', '2nd', '3rd'][i]} period` : 'Overtime'}</span>
        <span class="st-ch-s"><b style="color:${c.away}">${esc(game.away.abbrev)} ${p.away ?? 0}</b> – <b style="color:${c.home}">${p.home ?? 0} ${esc(game.home.abbrev)}</b></span></header>
      ${head ? `<div class="st-ch-head">${head}</div>` : ''}
      <div class="st-ch-chips">${chips.join('')}</div>
      <ul class="st-ch-list">${rows.join('')}</ul>
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

/** True when two numbers are close enough that calling a "winner" would mislead. */
export function isClose(a, b, { pct = false } = {}) {
  if (pct) return Math.abs(a - b) < 6;
  const hi = Math.max(a, b);
  return Math.abs(a - b) <= 2 || (hi > 0 && Math.abs(a - b) / hi < 0.15);
}

const teamTag = (game, side) => `<span class="st-tm">${logo(game[side], 'st-tm-logo', true)}<em>${esc(game[side].abbrev)}</em></span>`;

/** A head-to-head tile: both teams' numbers, a split bar, and a line on what it means. */
function compareTile(game, c, label, away, home, awayNum, homeNum, note, better = 'more') {
  const tot = awayNum + homeNum;
  const aw = tot ? (100 * awayNum) / tot : 50;
  const lead = awayNum === homeNum ? null : (awayNum > homeNum) === (better === 'more') ? 'away' : 'home';
  const close = note.close;
  return `<div class="st-num st-cmp${close ? ' close' : ''}">
    <span class="st-lbl">${esc(label)}</span>
    <div class="st-cmp-row">${teamTag(game, 'away')}<b class="${!close && lead === 'away' ? 'lead' : ''}">${esc(away)}</b><b class="${!close && lead === 'home' ? 'lead' : ''}">${esc(home)}</b>${teamTag(game, 'home')}</div>
    <div class="st-cmp-bar"><i style="width:${aw}%;background:${c.away}"></i><i style="width:${100 - aw}%;background:${c.home}"></i></div>
    <small>${close ? '<span class="st-even">Close</span> ' : ''}${esc(note.text)}</small>
  </div>`;
}

/** Top three momentum drivers for each team, side by side. */
function topDrivers(game, c) {
  const sk = allSkaters(game).filter((p) => p.momentum != null);
  if (!sk.length) return '';
  const col = (side) => {
    const top = sk.filter((p) => p.side === side).sort((x, y) => y.momentum - x.momentum).slice(0, 3);
    return `<div class="st-td" style="--team:${c[side]}"><div class="st-td-h">${teamTag(game, side)}</div>${top.map((p, i) => `<div class="st-td-p">
      <span class="st-td-n">${i + 1}</span>${headshot(p, 'st-td-mug')}<span class="st-td-name">${esc(p.fullName)}</span><b>${p.momentum > 0 ? '+' : ''}${p.momentum.toFixed(1)}</b></div>`).join('')}</div>`;
  };
  return `<div class="st-num st-drivers"><span class="st-lbl">Top momentum drivers</span><div class="st-td-cols">${col('away')}${col('home')}</div></div>`;
}

/** A handful of numbers that explain the result. */
function byTheNumbers(game, c, events) {
  const shots = shotSummary(game);
  const stat = (k) => game.teamStats.find((s) => s.key === k);
  const ab = (side) => game[side].abbrev;
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
  const single = (big, label, sub, side) => `<div class="st-num"${side ? ` style="--team:${c[side]}"` : ''}><span class="st-lbl">${esc(label)}</span><b>${esc(big)}</b><small>${side ? `${teamTag(game, side)} ` : ''}${esc(sub)}</small></div>`;
  if (winner && deficits[winner] >= 2) tiles.push(single(`${deficits[winner]}`, 'goal comeback', `trailed by ${deficits[winner]} and won`, winner));
  tiles.push(single(`${changes}`, changes === 1 ? 'lead change' : 'lead changes', `Biggest lead: ${biggest} goal${biggest === 1 ? '' : 's'}`, null));
  // Hockey stat tiles: name the leader only when the gap is real, otherwise call it close.
  const cmp = (label, s, better, words) => {
    if (!s) return;
    const close = isClose(s.awayNum, s.homeNum, { pct: s.key === 'faceoffWinningPctg' });
    const top = (s.awayNum >= s.homeNum) === (better === 'more') ? 'away' : 'home';
    const raw = s.awayNum >= s.homeNum ? 'away' : 'home';
    tiles.push(compareTile(game, c, label, s.away, s.home, s.awayNum, s.homeNum, { close, text: close ? words.close : words.win(top, raw) }, better));
  };
  const plateGoals = shots.away.plateGoals + shots.home.plateGoals;
  const allGoals = shots.away.goals + shots.home.goals;
  if (shots.away.plate + shots.home.plate) {
    cmp('Home plate attempts', { key: 'plate', away: String(shots.away.plate), home: String(shots.home.plate), awayNum: shots.away.plate, homeNum: shots.home.plate }, 'more', {
      close: `Even in the danger area · ${plateGoals} of ${allGoals} goals came from there`,
      win: (s) => `${ab(s)} got to the net more · ${plateGoals} of ${allGoals} goals came from there`,
    });
  }
  const pp = stat('powerPlay');
  if (pp) {
    const ppText = pp.awayNum === pp.homeNum ? (pp.awayNum ? 'Both power plays scored the same' : 'No power play goals') : `${ab(pp.awayNum > pp.homeNum ? 'away' : 'home')} won the special teams battle`;
    tiles.push(compareTile(game, c, 'Power play', pp.away, pp.home, pp.awayNum, pp.homeNum, { close: false, text: ppText }));
  }
  cmp('Faceoffs won', stat('faceoffWinningPctg'), 'more', { close: 'Neither team owned the dot', win: (s) => `${ab(s)} won the dot` });
  cmp('Hits', stat('hits'), 'more', { close: 'Both teams played about as physical', win: (s) => `${ab(s)} out-hit ${ab(other(s))}` });
  cmp('Giveaways', stat('giveaways'), 'fewer', { close: 'Both teams gave it away about as often', win: (s, raw) => `${ab(raw)} coughed it up more` });
  return `<div class="st-nums">${tiles.join('')}${topDrivers(game, c)}</div>`;
}

export function storyChapters(game, c) {
  if (game.status.state !== 'live' && game.status.state !== 'final') return '';
  const events = goalEvents(game);
  const changes = goalieChanges(game);
  return `${byTheNumbers(game, c, events)}
    <div class="b-cols st-cols st-story-cols"><div class="b-card"><h2>How it unfolded</h2><div class="st-chs">${chapters(game, c, events, changes)}</div></div>
    <div>${turningPoints(game, c, events, changes)}</div></div>`;
}

// Game Story before puck drop: when it starts, our pick and the books, probable goalies, rest,
// and who's dressed or scratched. game.pregame is filled in by game.js (see pregameInfo there).
import { esc, logo } from './core.js';

const time = (iso) => new Date(iso).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit', timeZoneName: 'short' });
const lastName = (n) => String(n ?? '').split(' ').slice(1).join(' ') || n;
const signed = (v) => `${v > 0 ? '+' : v < 0 ? '−' : ''}${Math.abs(v).toFixed(1)}`;

/** "Puck drops at 3:00 PM MST." or, once the start time has passed, that it's about to. */
export function pregameDek(game, now = Date.now()) {
  const start = Date.parse(game.startTimeUTC);
  const at = Number.isFinite(start) ? time(game.startTimeUTC) : null;
  if (game.status.imminent || (Number.isFinite(start) && now >= start)) {
    return [`Puck drop is any minute now${at ? ` (scheduled for ${at})` : ''}. The story, momentum and player scorecards fill in once the game starts.`];
  }
  const out = [at ? `Puck drops at ${at}.` : 'The game hasn’t started yet.'];
  if (game.broadcasts?.length) out.push(`On ${game.broadcasts.join(', ')}.`);
  out.push('The story, momentum and player scorecards fill in once the game starts.');
  return out;
}

/** The pregame cards: win chance and why, then the lineups. */
export function pregameCards(game, c) {
  const pg = game.pregame ?? {};
  const chip = (side) => `<span class="pg-chip" style="background:${c[side]}">${esc(game[side].abbrev)}</span>`;
  const bar = (label, pAway, title) => {
    const a = Math.round(pAway * 100);
    return `<div class="pg-bar" title="${esc(title)}"><b>${a}%</b><span class="pg-track"><i style="width:${a}%;background:${c.away}"></i><i style="flex:1;background:${c.home}"></i></span><b>${100 - a}%</b><em>${esc(label)}</em></div>`;
  };
  const p = pg.pick;
  let pick = '';
  if (p) {
    const { share, goalie, b2b } = p.parts;
    const fav = p.away >= p.home ? 'away' : 'home';
    const lines = (fn) => ['away', 'home'].map((side) => `<span class="pg-tl">${chip(side)}${fn(side)}</span>`).join('');
    const row = (k, v) => `<dt>${k}</dt><dd>${v}</dd>`;
    const gname = (side) => (goalie[side].name ? esc(goalie[side].name) : 'Not known yet');
    pick = `<div class="b-card pg-card"><h2>Our pick</h2>
      <p class="pg-lead">We make the <b>${esc(game[fav].commonName)}</b> a ${Math.round(Math.max(p.away, p.home) * 100)}% pick.</p>
      <div class="pg-bars">${bar('US', p.away, 'Our pre-game pick. Right about 57% of the time on past seasons.')}${(pg.books ?? []).map((b) => bar(b.short, b.p, `${b.name}'s line with its margin removed`)).join('')}</div>
      <dl class="pg-why">
        ${row('Momentum<small>share of play this season</small>', lines((side) => `<b>${Math.round(share[side] * 100)}%</b>`))}
        ${row('Goalies<small>probable starter, goals saved above expected</small>', lines((side) => `${gname(side)}${goalie[side].name ? ` <b>${signed(goalie[side].gsax)}</b>` : ''}${game[side].scratchIds?.includes(goalie[side].id) ? ' <span class="muted">(scratched tonight)</span>' : ''}`))}
        ${row('Rest', lines((side) => (b2b[side] ? 'Played yesterday' : 'Rested')))}
      </dl>
      ${pg.books?.length ? '<p class="pg-note">Book chances have the margin removed.</p>' : ''}
    </div>`;
  }

  const team = (side) => {
    const t = game[side];
    const pl = game.players?.[side] ?? {};
    const lu = pg.lineup?.[side];
    const posted = (t.scratches?.length ?? 0) > 0;
    const out = lu?.out ?? [];
    const names = (list) => list.map((x) => esc(x.fullName ?? x.name ?? x)).join(', ');
    return `<div class="pg-team" style="--team:${c[side]}">
      <h3>${logo(t, 'pg-logo', true)}${esc(t.name)}</h3>
      ${out.length ? `<p class="pg-alert">⚠ Without ${out.map((x) => `<b>${esc(lastName(x.name))}</b> (their #${x.rank} skater by momentum)`).join(' and ')}</p>` : ''}
      <dl>
        <dt>Scratched</dt><dd class="pg-list">${posted ? esc(t.scratches.join(', ')) : '<span class="muted">Posts about 10 minutes before puck drop</span>'}</dd>
        ${pl.goalies?.length ? `<dt>Goalies<small>dressed</small></dt><dd class="pg-list">${names(pl.goalies)}</dd>` : ''}
        ${lu?.top?.length ? `<dt>Top 3<small>by momentum</small></dt><dd class="pg-list">${lu.top.map((x) => esc(x.name)).join(', ')}</dd>` : ''}
      </dl>
    </div>`;
  };
  const lineups = `<div class="b-card pg-card"><h2>Lineups</h2><div class="pg-teams">${team('away')}${team('home')}</div></div>`;
  return `<div class="pg">${pick}${lineups}</div>`;
}

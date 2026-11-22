// Game Story before puck drop: when it starts, our pick against the books, a tale of the tape
// (season-to-date team numbers, bars = league rank) and a scouting card per team (strengths and
// weak spots, probable starter, lineup news, top skaters). game.pregame is filled in by game.js;
// game.preview (records, special teams, last 10) comes from the NHL right rail via src/gameDetail.js.
import { esc, logo } from './core.js';

const time = (iso) => new Date(iso).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit', timeZoneName: 'short' });
const lastName = (n) => String(n ?? '').split(' ').slice(1).join(' ') || n;
const signed = (v, d = 1) => `${v > 0 ? '+' : v < 0 ? '−' : ''}${Math.abs(v).toFixed(d)}`;
const pct = (v, d = 0) => `${(v * 100).toFixed(d)}%`;
const ord = (n) => `${n}${['th', 'st', 'nd', 'rd'][((n % 100) - 20) % 10] || ['th', 'st', 'nd', 'rd'][n % 100] || 'th'}`;
const SIDES = ['away', 'home'];

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

const rankTag = (r, of = 32) => (r ? `<span class="pg-rk${r <= 8 ? ' hi' : r > of - 8 ? ' lo' : ''}">${ord(r)}</span>` : '');
const form = (results = []) => `<span class="pg-form" aria-label="Last ${results.length}, newest first">${results.slice(0, 10).map((r) => {
  const k = /W$/.test(r) ? 'w' : r === 'L' ? 'l' : 'o';
  return `<i class="${k}" title="${esc(r)}">${esc(r.replace(/^OT/, 'O').replace(/^SO/, 'S'))}</i>`;
}).join('')}</span>`;

function winCard(game, pg, c) {
  const p = pg.pick;
  if (!p) return '';
  const bar = (label, pAway, title) => {
    const a = Math.round(pAway * 100);
    return `<div class="pg-bar" title="${esc(title)}"><b>${a}%</b><span class="pg-track"><i style="width:${a}%;background:${c.away}"></i><i style="flex:1;background:${c.home}"></i></span><b>${100 - a}%</b><em>${esc(label)}</em></div>`;
  };
  const fav = p.away >= p.home ? 'away' : 'home';
  const b2b = SIDES.filter((s) => p.parts.b2b[s]);
  const rest = b2b.length === 2 ? 'Both teams played yesterday.' : b2b.length ? `The ${esc(game[b2b[0]].commonName)} played yesterday.` : 'Neither team played yesterday.';
  return `<div class="b-card pg-card"><h2>Win chance</h2>
    <div class="pg-bars">${bar('US', p.away, 'Our pre-game pick: season momentum share, probable starting goalies and back-to-backs. Right about 57% of the time on past seasons.')}${(pg.books ?? []).map((b) => bar(b.short, b.p, `${b.name}'s line with its margin removed`)).join('')}</div>
    <p class="pg-lead">We make the <b>${esc(game[fav].commonName)}</b> a ${pct(Math.max(p.away, p.home))} pick. ${rest}${pg.books?.length ? ' Book chances have the margin removed.' : ''}</p>
  </div>`;
}

/** The rows of the tale of the tape: [group, [label, sub, value(side), format, rank(side), lowerIsBetter]]. */
function tapeRows(game, pg) {
  const T = pg.teams;
  const pv = game.preview ?? {};
  const m = (k) => [(s) => T?.[s]?.m?.[k]?.v, (s) => T?.[s]?.m?.[k]?.rank];
  const nhl = (k) => [(s) => pv[s]?.[k], (s) => pv[s]?.[`${k}Rank`]];
  const st = (s) => T?.[s]?.starter;
  return [
    ['Play driving', [
      ['Momentum share', 'share of the push, goals left out', ...m('momShare'), (v) => pct(v, 1)],
      ['Shot attempt share', 'attempts for out of all attempts', ...m('satShare'), (v) => pct(v, 1)],
      ['Shot attempts a game', '', ...m('satPg'), (v) => v.toFixed(1)],
      ['Attempts allowed a game', 'fewer is better', ...m('satAgPg'), (v) => v.toFixed(1), true],
    ]],
    ['Chances and finishing', [
      ['Expected goals a game', 'what an average shooter scores on these shots', ...m('xgPg'), (v) => v.toFixed(2)],
      ['Finishing', 'goals a game above an average shooter', ...m('finish'), (v) => signed(v, 2)],
      ['Goals a game', '', ...nhl('gf'), (v) => v.toFixed(2)],
    ]],
    ['Goaltending and defense', [
      ['Probable starter', 'goals saved above expected this season', (s) => st(s)?.gsax, (s) => st(s)?.rank, (v) => signed(v), false, (s) => st(s)?.of],
      ['Team saves above expected', 'goals a game, all goalies', ...m('saveAbove'), (v) => signed(v, 2)],
      ['Goals against a game', 'fewer is better', ...nhl('ga'), (v) => v.toFixed(2), true],
    ]],
    ['Special teams', [
      ['Power play', '', ...nhl('pp'), (v) => pct(v, 1)],
      ['Penalty kill', '', ...nhl('pk'), (v) => pct(v, 1)],
      ['Faceoffs', '', ...nhl('fo'), (v) => pct(v, 1)],
    ]],
  ];
}

function tape(game, pg, c) {
  const of = pg.teams?.of ?? 32;
  const row = ([label, sub, val, rank, fmt, lower, ofFn]) => {
    const a = val('away');
    const h = val('home');
    if (a == null || h == null) return '';
    const edge = a === h ? null : (lower ? a < h : a > h) ? 'away' : 'home';
    const n = (s) => ofFn?.(s) ?? of;
    // Bar length is league standing (1st = full), so every row reads the same way.
    const w = (s) => { const r = rank(s); return r ? 6 + (94 * (n(s) - r)) / Math.max(1, n(s) - 1) : 0; };
    const rk = (s) => (rank(s) ? (ofFn ? `<span class="pg-rk">${ord(rank(s))} of ${n(s)}</span>` : rankTag(rank(s), of)) : '');
    return `<div class="pg-tr">
      <div class="pg-v">${fmt(a)}<small>${rk('away')}</small></div>
      <div class="pg-tb a${edge === 'away' ? ' edge' : ''}"><i style="width:${w('away')}%;background:${c.away}"></i></div>
      <div class="pg-lab">${esc(label)}${sub ? `<small>${esc(sub)}</small>` : ''}</div>
      <div class="pg-tb${edge === 'home' ? ' edge' : ''}"><i style="width:${w('home')}%;background:${c.home}"></i></div>
      <div class="pg-v h">${fmt(h)}<small>${rk('home')}</small></div>
    </div>`;
  };
  const groups = tapeRows(game, pg).map(([g, rows]) => {
    const html = rows.map(row).join('');
    return html ? `<div class="pg-tg">${esc(g)}</div>${html}` : '';
  }).join('');
  const pv = game.preview ?? {};
  const formRow = pv.away?.results?.length && pv.home?.results?.length ? `<div class="pg-tg">Form</div>
    <div class="pg-tr pg-formrow"><div class="pg-v">${esc(pv.away.last10 ?? '')}</div><div class="pg-fa">${form(pv.away.results)}</div>
      <div class="pg-lab">Last 10<small>newest first${pv.away.streak ? ` · ${esc(game.away.abbrev)} ${esc(pv.away.streak)}, ${esc(game.home.abbrev)} ${esc(pv.home.streak)}` : ''}</small></div>
      <div class="pg-fh">${form(pv.home.results)}</div><div class="pg-v h">${esc(pv.home.last10 ?? '')}</div></div>` : '';
  if (!groups && !formRow) return '';
  const chip = (s) => `<span class="pg-chip" style="background:${c[s]}">${esc(game[s].abbrev)}</span>`;
  return `<div class="b-card pg-card"><h2>Tale of the tape</h2>
    <div class="pg-tr pg-thead"><div>${chip('away')}</div><div></div><div class="pg-lab"><small>Season to date. Bars show league rank.</small></div><div></div><div class="h">${chip('home')}</div></div>
    ${groups}${formRow}
  </div>`;
}

/** Strengths (top 8 in the league) and weak spots (bottom 8) from the tape. */
function strengths(game, pg, side) {
  const of = pg.teams?.of ?? 32;
  const good = [];
  const bad = [];
  const label = { 'Shot attempts a game': 'Shot volume', 'Attempts allowed a game': 'Limiting attempts', 'Expected goals a game': 'Creating chances', 'Goals a game': 'Scoring', 'Team saves above expected': 'Goaltending', 'Goals against a game': 'Keeping it out' };
  for (const [, rows] of tapeRows(game, pg)) {
    for (const [name, , , rank, , , ofFn] of rows) {
      if (ofFn) continue; // the starter's rank is among goalies, not teams
      const r = rank(side);
      if (!r) continue;
      const item = `<li>${esc(label[name] ?? name)} ${rankTag(r, of)}</li>`;
      if (r <= 8) good.push([r, item]); else if (r > of - 8) bad.push([r, item]);
    }
  }
  if (!good.length && !bad.length) return '';
  const list = (xs, empty) => (xs.length ? xs.sort((a, b) => (a[0] - b[0])).map((x) => x[1]).join('') : `<li class="muted">${empty}</li>`);
  return `<div class="pg-sw"><div class="s"><h4>Strengths</h4><ul>${list(good, 'Nothing in the top 8')}</ul></div>
    <div class="w"><h4>Weak spots</h4><ul>${list(bad.sort((a, b) => b[0] - a[0]), 'Nothing in the bottom 8')}</ul></div></div>`;
}

function scoutCard(game, pg, c, side) {
  const t = game[side];
  const pv = game.preview?.[side] ?? {};
  const T = pg.teams?.[side];
  const m = T?.m;
  const lu = pg.lineup?.[side];
  const posted = (t.scratches?.length ?? 0) > 0;
  const kv = (v, label) => (v == null ? '' : `<div><b>${v}</b><span>${label}</span></div>`);
  const kvs = [
    kv(m?.momShare && pct(m.momShare.v, 1), 'Momentum share'),
    kv(m?.satShare && pct(m.satShare.v, 1), 'Shot attempt share'),
    kv(pv.pp != null ? pct(pv.pp, 1) : null, 'Power play'),
    kv(pv.pk != null ? pct(pv.pk, 1) : null, 'Penalty kill'),
  ].join('');

  // Probable starter: from our pick's goalie (most starts in the last 5 games).
  const st = T?.starter;
  const scratched = st && t.scratchIds?.includes(st.id);
  const replaced = st?.replaced;
  const backup = (T?.goalies ?? []).find((g) => g.id !== st?.id);
  const goalie = st ? `<div class="pg-g"><div><small>Probable starter</small><b>${esc(st.name)}</b>
      <small>${st.gs} starts${st.rank ? ` · ${ord(st.rank)} of ${st.of} goalies` : ''}${backup ? ` · next: ${esc(backup.name)}` : ''}</small>
      ${scratched ? '<small class="pg-warn">Scratched tonight, so expect someone else</small>' : ''}
      ${replaced ? `<small class="pg-warn">${esc(replaced.name)}, who started most of the last 5, is scratched. Our pick still counts him.</small>` : ''}</div>
      <div class="pg-big">${st.gsax == null ? '-' : signed(st.gsax)}<small>GSAx</small></div></div>` : '';

  const out = lu?.out ?? [];
  const lineup = `<dl class="pg-dl">
      <dt>Scratched</dt><dd>${posted ? esc(t.scratches.join(', ')) : '<span class="muted">Posts about 10 minutes before puck drop</span>'}</dd>
      ${game.players?.[side]?.goalies?.length ? `<dt>Goalies dressed</dt><dd>${game.players[side].goalies.map((g) => esc(g.fullName ?? g.name)).join(', ')}</dd>` : ''}
    </dl>
    ${out.length ? `<p class="pg-alert">⚠ Without ${out.map((x) => `<b>${esc(lastName(x.name))}</b> (their #${x.rank} skater by momentum)`).join(' and ')}</p>` : ''}`;

  const sk = T?.skaters ?? [];
  const table = sk.length ? `<div class="a-scroll"><table class="pg-sk">
      <thead><tr><th class="l">Top skaters</th><th title="Momentum per game">MOM/g</th><th title="Shot attempts per game">SAT/g</th><th title="Goals above an average shooter this season">Fin.</th><th title="Share of games above (green) and below (red) a typical game for the position">Games +/−</th></tr></thead>
      <tbody>${sk.map((p) => `<tr><td class="l">${esc(p.name)} <span class="muted">${esc(p.pos)}</span></td><td>${p.momPg.toFixed(1)}</td><td>${p.satPg.toFixed(1)}</td><td>${p.gax == null ? '-' : signed(p.gax)}</td>
        <td>${p.above == null ? '-' : `<span class="pg-tier" title="${pct(p.above)} above, ${pct(p.below)} below"><i style="width:${p.above * 100}%"></i><i style="width:${p.below * 100}%"></i></span>`}</td></tr>`).join('')}</tbody>
    </table></div>` : '';

  const sub = [side === 'away' ? 'Away' : 'Home', pv.record, t.coach && `Coach ${esc(t.coach)}`].filter(Boolean).join(' · ');
  return `<div class="b-card pg-card pg-scout" style="--team:${c[side]}">
    <div class="pg-top">${logo(t, 'pg-logo', true)}<div><b>${esc(t.name)}</b><span class="muted">${sub}</span></div></div>
    ${kvs ? `<div class="pg-kv">${kvs}</div>` : ''}
    ${pv.results?.length ? `<div class="pg-l10"><span class="muted">Last 10 · ${esc(pv.last10 ?? '')}</span>${form(pv.results)}</div>` : ''}
    ${strengths(game, pg, side)}
    ${goalie}
    ${lineup}
    ${table}
  </div>`;
}

/** The pregame cards: win chance, tale of the tape, then a scouting card per team. */
export function pregameCards(game, c) {
  const pg = game.pregame ?? {};
  return `<div class="pg">
    ${winCard(game, pg, c)}
    ${tape(game, pg, c)}
    <div class="pg-duo">${scoutCard(game, pg, c, 'away')}${scoutCard(game, pg, c, 'home')}</div>
  </div>`;
}

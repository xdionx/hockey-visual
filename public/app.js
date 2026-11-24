import { getData, getStatic, LIVE_REFRESH_MS, live, later, cancelLater } from './data.js';
import { teamColors, strengthBadge, onColor, lineCompareHtml } from './game/core.js';
import { teamAudio, radioOpen } from './horn.js'; // horn.js also watches for goals in games with a horn on, on every page
import { getDelay, delayScores, delayButton, onDelayChange, delayable } from './delay.js';
import { clockSpan, startClocks } from './clock.js';
import { pushSnapshot, trimSnapshots, pickSnapshot, delayLabel } from './src/delayBuffer.js';
import { playerIndex, linkPlayers, installPlayerLinks } from './player/link.js';
import { loadSeason } from './player/store.js';
import { seasonOf } from './src/seasonStats.js';
import { predictGame } from './src/predict.js';
import { notablePlayers, notableRole, missingTop } from './src/lineupAlert.js';
import { noVigAway, edge, BOOK_NAMES } from './src/odds.js';
import { lineView } from './src/spread.js';

const $ = (s) => document.querySelector(s);
const dateInput = $('#date');
const gamesEl = $('#games');
let refreshTimer = null;
let current = null; // the scoreboard on screen (games with a data delay are held back to an older refresh)
let latest = null; // the newest scoreboard fetched

// Cards: goals are a scrolling strip; the button opens the full list (remembered per game).
const store = (k, v) => { try { return v === undefined ? localStorage.getItem(k) : localStorage.setItem(k, v); } catch { return null; } };
const openGames = new Set(); // cards the user expanded

// Favorite teams (any number), saved only in this browser. Their games always sit at the top.
const FAV_KEY = 'favTeams';
const favorites = new Set((() => { try { return JSON.parse(store(FAV_KEY) || '[]'); } catch { return []; } })());
const isFav = (game) => favorites.has(game.away.abbrev) || favorites.has(game.home.abbrev);
function toggleFavorite(abbrev) {
  if (favorites.has(abbrev)) favorites.delete(abbrev); else favorites.add(abbrev);
  store(FAV_KEY, JSON.stringify([...favorites]));
}
/** Live games first, then upcoming, finished last; favorite teams' games above all of them. Ties keep the schedule order. */
const STATE_ORDER = { live: 0, pre: 1, postponed: 2, final: 3 };
function ordered(games) {
  return games.map((g, i) => ({ g, i })).sort((a, b) => (isFav(b.g) - isFav(a.g))
    || ((STATE_ORDER[a.g.status.state] ?? 1) - (STATE_ORDER[b.g.status.state] ?? 1)) || a.i - b.i).map((x) => x.g);
}

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

function shiftDate(iso, days) {
  const d = new Date(`${iso}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/** The browser tab title carries the date being shown. */
function setTitle(iso) {
  const short = new Date(`${iso}T12:00:00Z`).toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric', timeZone: 'UTC' });
  document.title = `NHL Scores · ${short}`;
}

function prettyDate(iso) {
  return new Date(`${iso}T12:00:00Z`).toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric', timeZone: 'UTC' });
}

function statusText(game) {
  if (game.status.state === 'pre') {
    return new Date(game.startTimeUTC).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit', timeZoneName: 'short' });
  }
  return game.status.label;
}

/** Bar color by game state: grey = not live, blue = live, orange = last 5 min of the 3rd or any OT/SO, red = final. */
function phase(game) {
  const st = game.status.state;
  if (st === 'final') return 'final';
  if (st !== 'live') return 'idle';
  const label = game.status.label || '';
  if (/OT|Shootout|SO\b/i.test(label)) return 'late';
  if (/^3rd Intermission/i.test(label)) return 'late'; // a live game after the 3rd is heading to OT
  const m = label.match(/^3rd\s+(\d+):(\d+)$/);
  if (m && Number(m[1]) * 60 + Number(m[2]) <= 300) return 'late';
  return 'live';
}

const started = (game) => game.status.state !== 'pre' && game.status.state !== 'postponed';
const sideOf = (game, abbrev) => (abbrev === game.away.abbrev ? 'away' : 'home');
/** Text color that reads on a team color. */
const initials = (g) => `${(g.scorer.firstName || g.scorer.name || '?')[0]}${(g.scorer.lastName || '')[0] ?? ''}`.toUpperCase();

// Shot attempts per game come from a small separate feed (the scoreboard doesn't have them).
const satById = new Map();
const satHist = new Map(); // gameId -> timestamped SAT refreshes, for the data delay
/** SAT as of this game's data delay. */
const satAt = (id) => (getDelay(id) ? pickSnapshot(satHist.get(id) ?? [], getDelay(id) * 1000, Date.now())?.data : null) ?? satById.get(id);
async function loadSat(games) {
  let changed = false;
  await Promise.all(games.filter((g) => started(g) && (g.status.state === 'live' || !satById.has(g.id))).map(async (g) => {
    try {
      const sat = await getData(`sat/${g.id}.json`);
      if (sat && JSON.stringify(sat) !== JSON.stringify(satById.get(g.id))) {
        satById.set(g.id, sat); changed = true;
        const h = satHist.get(g.id) ?? [];
        satHist.set(g.id, trimSnapshots(pushSnapshot(h, sat, Date.now()), Date.now(), (getDelay(g.id) + 75) * 1000));
      }
    } catch { /* SAT is a bonus: the scores still show without it */ }
  }));
  return changed;
}

/** SOG and SAT as two thin split bars, one above the other. */
function statLines(game, tc) {
  if (!started(game)) return '';
  const row = (label, a, b) => {
    if (a == null || b == null) return '';
    const pa = a + b ? Math.round((100 * a) / (a + b)) : 50;
    return `<div class="sx"><b>${a}</b><span class="bar"><i style="width:${pa}%;background:${tc.away}"></i><i style="flex:1;background:${tc.home}"></i></span><b>${b}</b><em>${label}</em></div>`;
  };
  const sat = satAt(game.id);
  const ls = game.linescore.shots;
  return `<div class="sxs">${row('SOG', ls.away, ls.home)}${row('SAT', sat?.away, sat?.home)}</div>`;
}

// Pre-game predictions from our model: season-to-date momentum share, probable starting goalies
// (goals saved above expected) and back-to-backs. Regular season only, before and during the game.
const predictions = new Map(); // date -> Map(gameId -> prediction)
async function loadPredictions(data) {
  if (predictions.has(data.date)) return false;
  const games = data.games.filter((g) => String(g.id).slice(4, 6) === '02' && g.status.state !== 'final' && g.status.state !== 'postponed');
  if (!games.length) { predictions.set(data.date, new Map()); return false; }
  const season = seasonOf(data.date);
  const [total, prev, yesterday] = await Promise.all([
    loadSeason(season), loadSeason(season - 10001),
    getData(`scores/${shiftDate(data.date, -1)}.json`).catch(() => null),
  ]);
  const played = new Set((yesterday?.games ?? []).filter((g) => g.status.state !== 'postponed').flatMap((g) => [g.away.abbrev, g.home.abbrev]));
  const out = new Map();
  for (const g of games) {
    const p = total && predictGame({ total, prev, away: g.away.abbrev, home: g.home.abbrev, n: Number(String(g.id).slice(-4)), b2b: { away: played.has(g.away.abbrev), home: played.has(g.home.abbrev) } });
    if (p) out.set(g.id, p);
  }
  predictions.set(data.date, out);
  seasonsFor.set(data.date, { total, prev });
  return out.size > 0;
}

// Notable scratches: once a team posts its scratches (5-10 minutes before puck drop), flag any of its top 3
// forwards or top 2 defensemen by momentum who aren't dressed. The pick stays the same; see src/lineupAlert.js.
const seasonsFor = new Map(); // date -> { total, prev }
const lineups = new Map(); // gameId -> { away: { posted, out }, home: {...}, at }
const LINEUP_WINDOW_MS = 90 * 60_000; // start checking this long before puck drop
const LINEUP_EVERY_MS = 2 * 60_000;
async function loadLineups(data) {
  const s = seasonsFor.get(data.date);
  if (!s?.total) return false;
  const now = Date.now();
  const due = data.games.filter((g) => {
    const p = predictions.get(data.date)?.get(g.id);
    if (!p || (g.status.state !== 'pre' && g.status.state !== 'live')) return false;
    if (Date.parse(g.startTimeUTC) - now > LINEUP_WINDOW_MS) return false;
    const l = lineups.get(g.id);
    if (l?.away.posted && l?.home.posted) return false; // both lineups in: done
    return !l || now - l.at >= LINEUP_EVERY_MS;
  });
  let changed = false;
  await Promise.all(due.map(async (g) => {
    try {
      const d = await getData(`games/${g.id}.json`);
      if (!d) return;
      const side = (k) => {
        const t = d[k] ?? {};
        const posted = (t.scratches?.length ?? 0) > 0 || g.status.state === 'live';
        const top = notablePlayers(s.total, s.prev, g[k].abbrev);
        return { posted, top, out: posted ? missingTop(top, t.scratches, t.scratchIds) : [] };
      };
      const l = { away: side('away'), home: side('home'), at: Date.now() };
      if (JSON.stringify([l.away, l.home]) !== JSON.stringify([lineups.get(g.id)?.away, lineups.get(g.id)?.home])) changed = true;
      lineups.set(g.id, l);
    } catch { /* the alert is a bonus */ }
  }));
  return changed;
}

// Sportsbook lines the data script saved before puck drop (DraftKings, FanDuel), shown next to our pick.
let odds = null;
getStatic('odds.json').then((o) => { odds = o; if (current?.games) render(current); }).catch(() => {});
/** Each book's chance for one side of a game, margin removed: [{ name, pct }] (pct for the away team). */
function bookChances(game) {
  const books = odds?.games?.[game.id]?.books ?? {};
  return Object.entries(books).map(([k, b]) => ({ name: BOOK_NAMES[k], p: noVigAway(b.a, b.h) })).filter((x) => x.p != null);
}

/** The edge on one game (we like a side 7+ points more than the books), or null. */
function edgeOf(game) {
  const p = predictions.get(current?.date)?.get(game.id);
  const e = p && game.status.state !== 'final' ? edge(p.away, odds?.games?.[game.id]?.books) : null;
  return e && { ...e, team: game[e.side].abbrev };
}
const edgeTag = (e) => `<span class="edge" title="We give ${esc(e.team)} a ${Math.round(e.ours * 100)}% chance; the books (margin removed) give ${Math.round(e.market * 100)}%. Markets are usually sharp, so treat this as a point to look at, not a bet.">Edge: ${esc(e.team)} +${e.pts}</span>`;

const lastName = (n) => String(n ?? '').split(' ').slice(1).join(' ') || n;
/** Last names, or full names where two share one (Elias and Marcus Pettersson). */
const shortNames = (list) => list.map((p) => esc(list.filter((q) => lastName(q.name) === lastName(p.name)).length > 1 ? p.name : lastName(p.name)));
/** "Our pick" bar: each team's win chance, with what went into it underneath. */
function predictionLine(game, tc) {
  if (game.status.state === 'final') return '';
  const p = predictions.get(current?.date)?.get(game.id);
  const books = bookChances(game);
  if (!p) return '';
  const e = edgeOf(game);
  const { share, goalie, b2b } = p.parts;
  // One bar per source, away on the left like the shot bars above: us first, then each book (margin removed).
  const bar = (label, pAway, title) => {
    const a = Math.round(pAway * 100);
    return `<div class="sx pr-src" title="${esc(title)}"><b>${a}%</b><span class="bar"><i style="width:${a}%;background:${tc.away}"></i><i style="flex:1;background:${tc.home}"></i></span><b>${100 - a}%</b><em>${esc(label)}</em></div>`;
  };
  const ourTitle = 'Our pre-game pick: each team\'s momentum share so far this season (goals left out), its probable starting goalie\'s goals saved above expected, and back-to-backs. Right about 57% of the time on past seasons.';
  const bars = bar('US', p.away, ourTitle) + books.map((b) => bar(b.name === 'DraftKings' ? 'DK' : b.name === 'FanDuel' ? 'FD' : b.name, b.p, `${b.name}'s line with its margin removed`)).join('');
  const row = (k, v) => `<dt>${k}</dt><dd>${v}</dd>`;
  // One line per team (away first, like the bars), each led by a chip in the team's color.
  const chip = (side) => `<span class="tchip" style="background:${tc[side]};color:${onColor(tc[side])}">${esc(game[side].abbrev)}</span>`;
  const lines = (fn) => ['away', 'home'].map((side) => `<span class="tl">${chip(side)}${fn(side)}</span>`).join('');
  const gname = (side) => (goalie[side].name ? esc(lastName(goalie[side].name)) : 'Unknown goalie');
  const lu = lineups.get(game.id);
  const lineupText = (side) => {
    const x = lu?.[side];
    if (!x?.posted) return '<span class="muted">Posts ~10 min before puck drop</span>';
    return `<span class="lu-row">${x.out.length ? x.out.map((p) => `<b title="${esc(p.name)}">${shortNames(x.out)[x.out.indexOf(p)]}</b> ${esc(notableRole(p))}`).join(', ') : 'None'}</span>`;
  };
  const outs = ['away', 'home'].filter((side) => lu?.[side]?.out.length);
  const alert = outs.length ? `<p class="lu-alert" title="Out of the lineup: one of the team's top 3 forwards or top 2 defensemen by momentum. Our pick above doesn't account for who's out.">⚠ ${outs.map((side) => `${esc(game[side].abbrev)} without ${shortNames(lu[side].out).join(' and ')}`).join(' · ')}</p>` : '';
  const why = [
    row('Notable scratches<small>top 3 forwards, top 2 defense by momentum</small>', lines(lineupText)),
    row('Momentum<small>share of play this season</small>', lines((side) => `<b>${Math.round(share[side] * 100)}%</b>`)),
    goalie.away.name && goalie.home.name ? row('Goalies<small>probable starter, goals saved above expected</small>', lines((side) => `${gname(side)} <b>${fmtGsax(goalie[side].gsax).replace(/[()]/g, '')}</b>`)) : '',
    row('Rest', lines((side) => (b2b[side] ? 'Played yesterday' : 'Rested'))),
  ].join('');
  return `<div class="pred">
    <div class="pr-head"><span>Win chance</span>${e ? edgeTag(e) : ''}</div>
    <div class="pr-bars">${bars}</div>
    ${lineCompareHtml(lineView(odds?.games?.[game.id]?.books, { a: p.away, gap: p.gap }), game)}
    ${alert}
    <details class="pred-why" data-pid="${game.id}"${openWhy.has(game.id) ? ' open' : ''}><summary>Why we pick it</summary><dl>${why}</dl>${books.length ? '<p>Book chances have the margin removed.</p>' : ''}</details>
  </div>`;
}
const openWhy = new Set(); // "Why" sections the viewer opened, kept across refreshes
const fmtGsax = (v) => (v == null ? '' : `(${v > 0 ? '+' : v < 0 ? '−' : ''}${Math.abs(v).toFixed(1)})`);

const playIcon = '<svg width="12" height="12" viewBox="0 0 12 12" aria-hidden="true"><path d="M2.5 1.5v9l8-4.5z" fill="currentColor"/></svg>';

/** Link attributes that open a goal in the video lightbox (same as the other video links). */
function goalAttrs(game, g) {
  const title = `${g.team} · ${g.scorer.name} (${g.period === 'SO' ? 'SO' : `${g.time} ${g.periodName}`})`;
  return g.highlight
    ? `href="${esc(g.highlight)}"${g.highlightId ? ` data-video-id="${esc(g.highlightId)}" data-video-title="${esc(title)}"` : ' target="_blank" rel="noopener"'} aria-label="Watch ${esc(g.scorer.name)}'s goal"`
    : '';
}

/** Period as 1st / 2nd / 3rd (OT and SO stay as they are). */
const ordPeriod = (p) => ({ 1: '1st', 2: '2nd', 3: '3rd' })[p] ?? p;

/** An assist with the player's season assist total, e.g. "W. Nylander (12)". */
const assistText = (a) => `${esc(a.name)}${a.assistsToDate != null ? ` (${a.assistsToDate})` : ''}`;

/** Which goal of the game this is for its scorer (2 = second goal), or 0 for a first goal or a shootout goal. */
function nthInGame(game, g) {
  if (g.period === 'SO') return 0;
  const n = game.goals.filter((x) => x.period !== 'SO' && x.scorer.id === g.scorer.id && game.goals.indexOf(x) <= game.goals.indexOf(g)).length;
  return n >= 2 ? n : 0;
}
const nthLabel = (n) => (n === 3 ? 'Hat trick' : `${n}${{ 2: 'nd', 4: 'th', 5: 'th' }[n] ?? 'th'} goal`);

/** Strength tags as PP / SH / EN (even-strength goals get none). */
const STRENGTH = { PPG: 'PP', SHG: 'SH', EN: 'EN' };
const strengthTags = (g) => g.tags.map((t) => STRENGTH[t]).filter(Boolean);

/** The game's score right after this goal, "BUF 1-0 TBL", with the scoring team in bold. */
function runningScore(game, g) {
  if (g.period === 'SO' || !g.score) return '';
  const side = sideOf(game, g.team);
  const ab = (s) => (s === side ? `<strong>${esc(game[s].abbrev)}</strong>` : esc(game[s].abbrev));
  return `<span class="g-run">${ab('away')} ${g.score.away}-${g.score.home} ${ab('home')}</span>`;
}

/** A goal chip for the scrolling strip: scorer, when, assists; opens the clip. */
function goalChip(game, g, tc) {
  const attrs = goalAttrs(game, g);
  const color = tc[sideOf(game, g.team)];
  const so = g.period === 'SO';
  const nth = nthInGame(game, g);
  const when = so ? 'SO' : `${ordPeriod(g.period)} ${g.time}`;
  const assists = so ? 'Shootout' : g.assists.length ? g.assists.map(assistText).join(', ') : 'Unassisted';
  const tag = attrs ? 'a' : 'div';
  return `<${tag} class="gc${attrs ? ' has-play' : ''}"${attrs ? ` ${attrs}` : ''} style="--team:${color}"><span class="gc-txt"><b>${esc(g.scorer.lastName || g.scorer.name)}${g.scorer.goalsToDate != null ? ` <span class="cnt">(${g.scorer.goalsToDate})</span>` : ''}</b>${runningScore(game, g) ? `<small class="gc-run">${runningScore(game, g)}</small>` : ''}<small>${esc(when)}${strengthTags(g).map((t) => ` <em class="st">${t}</em>`).join('')}${nth ? ` <em class="nth">${nthLabel(nth)}</em>` : ''}</small><small>${assists}</small></span>${attrs ? `<span class="gc-play">${playIcon}</span>` : ''}</${tag}>`;
}

/** A goal tile: who, assists, the running score and a play button. */
function goalTile(game, g, tc) {
  const side = sideOf(game, g.team);
  const attrs = goalAttrs(game, g);
  const so = g.period === 'SO';
  const assists = so ? '' : g.assists.length ? g.assists.map(assistText).join(', ') : 'Unassisted';
  const count = g.scorer.goalsToDate != null ? ` <small>(${g.scorer.goalsToDate})</small>` : '';
  const nth = nthInGame(game, g);
  const tags = (nth ? [nthLabel(nth)] : []).concat(strengthTags(g), g.tags.filter((t) => !STRENGTH[t])).map((t) => `<i class="tag">${esc(t)}</i>`).join('');
  const meta = so ? 'Deciding shootout goal' : `${runningScore(game, g)} · ${esc(ordPeriod(g.period))} ${esc(g.time)}`;
  const mug = g.scorer.mugshot ? `<img src="${esc(g.scorer.mugshot)}" alt="" loading="lazy" onerror="this.remove()">` : '';
  return `<${attrs ? 'a' : 'div'} class="gt"${attrs ? ` ${attrs}` : ''} style="--team:${tc[side]};--on:${onColor(tc[side])}">
    <span class="gt-mug">${mug}<b>${esc(initials(g))}</b></span>
    <span class="gt-who"><strong>${esc(g.scorer.name)}${count}${tags}</strong>${assists ? `<em>${assists}</em>` : ''}<small>${meta}</small></span>
    ${attrs ? `<span class="gt-play">${playIcon}</span>` : ''}
  </${attrs ? 'a' : 'div'}>`;
}

// Videos play in a lightbox using NHL's public Brightcove embed player.
// The href stays the NHL.com page, so a middle-click or a missing id still works.
const BRIGHTCOVE_PLAYER = 'https://players.brightcove.net/6415718365001/EXtG1xJ7H_default/index.html';

function videoLink(href, id, title, text, cls = '', label = title) {
  const data = id ? ` data-video-id="${esc(id)}" data-video-title="${esc(title)}"` : ' target="_blank" rel="noopener"';
  return `<a${cls ? ` class="${cls}"` : ''} href="${esc(href)}"${data} title="${esc(label)}" aria-label="${esc(label)}">${esc(text)}</a>`;
}

const lightbox = $('#lightbox');
const lightboxFrame = $('#lightbox-frame');

function openVideo(link) {
  lightboxFrame.innerHTML = `<iframe src="${BRIGHTCOVE_PLAYER}?videoId=${encodeURIComponent(link.dataset.videoId)}&autoplay=true"
    title="${esc(link.dataset.videoTitle)}" allow="autoplay; fullscreen; encrypted-media; picture-in-picture" allowfullscreen></iframe>`;
  $('#lightbox-title').textContent = link.dataset.videoTitle;
  $('#lightbox-nhl').href = link.href;
  lightbox.showModal();
}

gamesEl.addEventListener('click', (e) => {
  const link = e.target.closest('a[data-video-id]');
  if (!link || e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return;
  e.preventDefault();
  openVideo(link);
});
$('#lightbox-close').addEventListener('click', () => lightbox.close());
lightbox.addEventListener('click', (e) => e.target === lightbox && lightbox.close()); // backdrop
lightbox.addEventListener('close', () => { lightboxFrame.innerHTML = ''; }); // stops playback

function teamBlock(game, side, tc, big) {
  const team = game[side];
  const ls = game.linescore;
  const other = side === 'away' ? 'home' : 'away';
  const loser = game.status.state === 'final' && ls.totals[side] < ls.totals[other];
  return `<div class="tb ${side}${loser ? ' loser' : ''}${big ? ' big' : ''}" style="--team:${tc[side]}">
    ${big ? teamAudio(game, team.abbrev, { horn: game.status.state !== 'final' }) : ''}
    <img src="${esc(team.logo.replace('_light.', '_dark.'))}" alt="" loading="lazy" onerror="this.style.visibility='hidden'">
    <span class="nm">${esc(team.name || team.abbrev)}${team.record && big ? `<small>${esc(team.record)}</small>` : ''}</span>
    <button type="button" class="fav${favorites.has(team.abbrev) ? ' on' : ''}" data-fav="${esc(team.abbrev)}" aria-pressed="${favorites.has(team.abbrev)}" title="${favorites.has(team.abbrev) ? 'Remove from' : 'Add to'} favorites: ${esc(team.abbrev)} games stay at the top (saved in this browser)" aria-label="Favorite ${esc(team.name || team.abbrev)}">${favorites.has(team.abbrev) ? '★' : '☆'}</button>
    <b class="tot">${started(game) ? ls.totals[side] : ''}</b>
  </div>`;
}

// The data delay button sits in the card footer while a game can still be on (radio + horn icons are in the team rows).
const footExtra = (game) => (game.status.state === 'final' ? '' : delayButton(game, waitFor.get(game.id)));
/** Preseason and playoff games get a tag; they never count toward our season stats (regular season only). */
const GAME_TYPES = { 1: ['pre', 'Preseason'], 3: ['po', 'Playoffs'] };
function typeTag(game) {
  const t = GAME_TYPES[game.gameType];
  return t ? `<span class="gtype ${t[0]}" title="${t[0] === 'pre' ? 'Preseason: not counted in our season stats' : 'Playoffs: kept apart from our regular-season stats'}">${t[1]}</span>` : '';
}

function gameHtml(game) {
  const tc = teamColors(game, { dark: true });
  // Before puck drop the box score page is a preview (pick, goalies, lineups); it needs the live data service.
  const hasBox = game.status.state === 'live' || game.status.state === 'final' || (game.status.state === 'pre' && live);
  const open = openGames.has(game.id);
  const n = game.goals.length;
  const head = `<div class="gh"><h3>Goals</h3><button type="button" class="more" aria-expanded="${open}" data-id="${game.id}">${open ? '▴ Hide' : `▾ Show all (${n})`}</button></div>`;
  const goals = !started(game) ? ''
    : !n ? '<p class="no-goals">No goals yet.</p>'
    : `${head}${open ? `<div class="gts">${game.goals.map((g) => goalTile(game, g, tc)).join('')}</div>
    <button type="button" class="more more-bottom" aria-expanded="true" data-id="${game.id}">▴ Hide goals</button>` : `<div class="gstrip" tabindex="0" aria-label="Goals, scroll sideways">${game.goals.map((g) => goalChip(game, g, tc)).join('')}</div>`}`;
  const links = [
    game.video?.recap ? videoLink(game.video.recap, game.video.recapId, `${game.away.abbrev} @ ${game.home.abbrev} · Recap`, 'Recap') : '',
    game.video?.condensed ? videoLink(game.video.condensed, game.video.condensedId, `${game.away.abbrev} @ ${game.home.abbrev} · Condensed game`, 'Condensed') : '',
  ].join('');
  return `<article class="game cd ph-${phase(game)}" data-id="${game.id}" style="--away:${tc.away};--home:${tc.home}">
    <div class="status ${game.status.state}"><span class="label">${clockSpan(game, statusText(game), seenFor.get(game.id), true)}${strengthBadge(game, tc)}</span><span class="hdr-r">${typeTag(game)}<span class="venue" title="${esc(game.venue)}">${esc(game.venue)}</span></span></div>
    <div class="tbs">${teamBlock(game, 'away', tc, true)}${teamBlock(game, 'home', tc, true)}</div>
    ${statLines(game, tc)}
    ${predictionLine(game, tc)}
    ${goals}
    <div class="cd-foot"><span class="videos">${links}</span>${hasBox ? `<a class="cg-box" href="game.html?id=${game.id}" aria-label="View game: ${esc(game.away.abbrev)} at ${esc(game.home.abbrev)}">View Game ›</a>` : ''}${footExtra(game)}</div>
  </article>`;
}

// Goal strips scroll sideways: touch swipes natively, a mouse drags (below).
// A refresh rebuilds the cards, so remember where each strip was scrolled to.
const stripPos = new Map();
function saveStrips() { gamesEl.querySelectorAll('.cd').forEach((c) => { const st = c.querySelector('.gstrip'); if (st) stripPos.set(c.dataset.id, st.scrollLeft); }); }
function restoreStrips() { gamesEl.querySelectorAll('.cd').forEach((c) => { const st = c.querySelector('.gstrip'); if (st && stripPos.has(c.dataset.id)) st.scrollLeft = stripPos.get(c.dataset.id); }); }

/** Goal scorers and assists in one game, so their names link to player cards. */
const namesCache = new Map();
function gameNames(game) {
  const key = `${game.id}:${(game.goals ?? []).length}`;
  if (!namesCache.has(key)) {
    const people = (game.goals ?? []).flatMap((g) => [
      { ...g.scorer, fullName: [g.scorer.firstName, g.scorer.lastName].filter(Boolean).join(' ') },
      ...(g.assists ?? []),
    ]);
    const avoid = ['away', 'home'].flatMap((s) => [game[s]?.name, game[s]?.placeName, game[s]?.commonName, game[s]?.abbrev]);
    namesCache.set(key, playerIndex(people, { avoid }));
  }
  return namesCache.get(key);
}

function render(data) {
  saveStrips();
  $('#dateLabel').textContent = prettyDate(data.date);
  setTitle(data.date);
  const edges = data.games.map((g) => ({ g, e: edgeOf(g) })).filter((x) => x.e).sort((a, b) => b.e.pts - a.e.pts);
  const edgeList = edges.length ? `<section class="edges"><h2>Where we differ from the market</h2><ul>${edges.map(({ g, e }) => `<li>${edgeTag(e)} <span>${esc(g.away.abbrev)} @ ${esc(g.home.abbrev)} · us ${Math.round(e.ours * 100)}%, books ${Math.round(e.market * 100)}%</span></li>`).join('')}</ul><p>Markets are usually sharp. Our stats page tracks how these games turn out.</p></section>` : '';
  gamesEl.innerHTML = data.games.length
    ? edgeList + ordered(data.games).map((g) => linkPlayers(gameHtml(g), gameNames(g))).join('')
    : '<p class="msg">No games scheduled on this date.</p>';
  restoreStrips();
}

gamesEl.addEventListener('toggle', (e) => {
  const d = e.target.closest?.('details.pred-why');
  if (!d) return;
  const id = Number(d.dataset.pid);
  if (d.open) openWhy.add(id); else openWhy.delete(id);
}, true);

gamesEl.addEventListener('click', (e) => {
  const fav = e.target.closest('button[data-fav]');
  if (fav) { toggleFavorite(fav.dataset.fav); if (current?.games) render(current); return; }
  const more = e.target.closest('.cd .more');
  if (!more) return;
  const id = Number(more.dataset.id);
  if (openGames.has(id)) openGames.delete(id); else openGames.add(id);
  if (current?.games) render(current);
});

let drag = null;
gamesEl.addEventListener('pointerdown', (e) => {
  const strip = e.target.closest('.gstrip');
  if (!strip || e.pointerType !== 'mouse' || e.button !== 0) return;
  drag = { strip, x: e.clientX, left: strip.scrollLeft, moved: false };
});
window.addEventListener('pointermove', (e) => {
  if (!drag) return;
  const dx = e.clientX - drag.x;
  if (!drag.moved && Math.abs(dx) < 5) return;
  drag.moved = true;
  drag.strip.classList.add('dragging');
  drag.strip.scrollLeft = drag.left - dx;
});
window.addEventListener('pointerup', () => {
  if (!drag) return;
  const { strip, moved } = drag;
  drag = null;
  strip.classList.remove('dragging');
  if (moved) { // a drag is not a click: swallow the click that follows so no video opens
    const stop = (ev) => { ev.preventDefault(); ev.stopPropagation(); };
    window.addEventListener('click', stop, { capture: true, once: true });
    setTimeout(() => window.removeEventListener('click', stop, { capture: true }), 0);
  }
});
gamesEl.addEventListener('dragstart', (e) => { if (e.target.closest('.gstrip')) e.preventDefault(); });

let lastText = '';

// ── Data delay for video/audio (see delay.js) ──
const waitFor = new Map(); // gameId -> ms of history still missing (page just opened)
let seenFor = new Map(); // gameId -> when the shown reading reached the viewer (live clock)
let tickTimer = null;
/** The scoreboard as each game's viewer should see it: games with a delay come from an older refresh. */
function delayedView(data) {
  const { games, wait, seenAt } = delayScores(data.date, null);
  waitFor.clear();
  for (const [k, v] of wait) waitFor.set(k, v);
  seenFor = seenAt;
  return games.some((g, i) => g !== data.games[i]) ? { ...data, games } : data;
}
/** Draw what's due now. While a delay is on, this runs every second so held-back plays land on time. */
function show(force = false) {
  cancelLater(tickTimer); tickTimer = null;
  if (!latest?.games) return;
  const v = delayedView(latest);
  current = v;
  // The radio-open flags make a pregame card redraw when its radio buttons appear; the delay bits redraw the chips.
  const text = JSON.stringify(v) + v.games.map((g) => `${radioOpen(g) ? 1 : 0}:${getDelay(g.id)}:${Math.ceil((waitFor.get(g.id) ?? 0) / 1000)}:${getDelay(g.id) ? JSON.stringify(satAt(g.id)) : ''}`).join(',');
  if (force || text !== lastText) render(v); // only redraw when something changed
  lastText = text;
  if (v.games.some((g, i) => getDelay(g.id) && (delayable(g) || delayable(latest.games[i])))) tickTimer = later(() => show(), 1000);
}
onDelayChange(() => show(true));

// Which date is "Today"? Games belong to their start date in Eastern time (what the NHL API
// uses). The day only turns over at 10:00 local time, and any date with live games wins.
const TURNOVER_HOUR = 10;
function etDate(ms) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(ms));
}
async function defaultDate() {
  const now = Date.now();
  const shifted = new Date(now - TURNOVER_HOUR * 3600_000);
  const local = `${shifted.getFullYear()}-${String(shifted.getMonth() + 1).padStart(2, '0')}-${String(shifted.getDate()).padStart(2, '0')}`;
  const et = etDate(now);
  const base = local < et ? local : et; // never ahead of Eastern today
  const hasLive = async (d) => {
    try { return !!(await getData(`scores/${d}.json`))?.games?.some((g) => g.status.state === 'live'); } catch { return false; }
  };
  for (const d of [shiftDate(base, 1), base, shiftDate(base, -1)]) {
    if (d <= et && await hasLive(d)) return d;
  }
  return base;
}

// Scores come from the live Worker when configured, else the static data/scores/<date>.json
// files a GitHub Action saves (server.js serves those live when running locally).
async function load(date, { quiet = false } = {}) {
  cancelLater(refreshTimer); refreshTimer = null;
  if (window.__radioShell) return; // this page now only hosts the radio; the page on screen is in the frame
  // Live games keep refreshing in a hidden tab too, so goal horns sound while the reader is elsewhere.
  if (!quiet) { gamesEl.innerHTML = '<p class="msg">Loading…</p>'; lastText = ''; }
  try {
    if (!date) date = await defaultDate();
    dateInput.value = date;
    history.replaceState(null, '', `?date=${date}`);
    const data = await getData(`scores/${date}.json`);
    if (!data) {
      current = { date }; latest = null; cancelLater(tickTimer);
      $('#dateLabel').textContent = prettyDate(date);
      setTitle(date);
      gamesEl.innerHTML = '<p class="msg">No scores saved for this date.</p>';
      return;
    }
    delayScores(date, data); // keep this refresh for the data delay
    latest = data;
    show();
    loadSat(data.games).then((changed) => { if (changed && latest === data) show(true); });
    loadPredictions(data).then(async (changed) => {
      if ((await loadLineups(data)) || changed) { if (latest === data) show(true); }
    }).catch(() => {});
    // Keep live games fresh: every few seconds while a game is on, every minute before puck drop.
    const states = data.games.map((g) => g.status.state);
    if (states.includes('live') || data.games.some((g) => g.status.imminent)) refreshTimer = later(() => load(data.date, { quiet: true }), LIVE_REFRESH_MS);
    else if (states.includes('pre') || data.games.some((g) => g.status.settling)) refreshTimer = later(() => load(data.date, { quiet: true }), 60_000);
  } catch (err) {
    if (!quiet) gamesEl.innerHTML = `<p class="msg">Couldn't load scores: ${esc(err.message)}</p>`;
    else if (current?.date) refreshTimer = later(() => load(current.date, { quiet: true }), LIVE_REFRESH_MS); // a blip: keep trying
  }
}

// Back to the tab: if a browser froze it anyway (phones do), catch up right away instead of waiting a tick.
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible' && refreshTimer && current?.date) load(current.date, { quiet: true });
});

dateInput.addEventListener('change', () => dateInput.value && load(dateInput.value));
$('#prev').addEventListener('click', () => current && load(shiftDate(current.date, -1)));
$('#next').addEventListener('click', () => current && load(shiftDate(current.date, 1)));
$('#today').addEventListener('click', () => load());

load(new URLSearchParams(location.search).get('date'));
installPlayerLinks();
startClocks();

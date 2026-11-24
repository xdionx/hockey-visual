import '../horn.js'; // goal horns for games with a horn on, on every page
// Team deficiencies view of Momentum stats: stats.html?view=teams&season=<20262027>&tteam=<ABC>
// For each team: the areas it loses ground in (in goals per game against an average team), other warning
// signs, and the players and goalies behind it, each with the numbers that explain why. Logic: src/deficiencies.js.
import { loadSeason, currentSeason, fmt } from '../player/store.js';
import { getStatic } from '../data.js';
import { recentFile } from '../src/seasonStats.js';
import { installPlayerLinks, playerLink } from '../player/link.js';
import { esc, makeSortable, teamColor } from '../game/core.js';
import { deficiencies, headline, onIceText, AREAS, ord } from '../src/deficiencies.js';
import { tagChips, goalieZones } from './tags.js';

installPlayerLinks();
const main = document.querySelector('#stats');
const params = new URLSearchParams(location.search);
const FIRST = 20202021; // first season with goalie expected goals against
const prev = (s) => Number(`${Math.floor(s / 10000) - 1}${Math.floor(s / 10000)}`);
const seasons = () => { const out = []; for (let s = currentSeason(); s >= FIRST; s = prev(s)) out.push(s); return out; };
const pct = (v, d = 1) => fmt.pct(v, d);
const cls = (v) => (v == null ? '' : v > 0.005 ? 'up' : v < -0.005 ? 'down' : '');
const gpg = (v) => (v == null ? '-' : `${fmt.signed(v, 2)}`);

let state = null;
const recentCache = new Map();
/** Each team's last 10 games of player lines (current season only), or null. */
const loadRecent = (season) => { if (!recentCache.has(season)) recentCache.set(season, getStatic(`seasons/${recentFile(season)}`).catch(() => null)); return recentCache.get(season); };
const opts = () => (state.last ? { last: LAST, recent: state.recent } : {});
const LAST = 10;

/** Season / Last 10 games switch for the team numbers (players and on-ice lists stay season-long). */
function spanToggle(last) {
  const b = (k, label) => `<button type="button" data-span="${k}" aria-pressed="${(k === 'last') === last}">${label}</button>`;
  return `<div class="pc-type td-span" role="group" aria-label="All games or the last ${LAST}">${b('all', 'All games')}${b('last', `Last ${LAST} games`)}</div>`;
}

function chips(list, selected) {
  return `<nav class="ms-seasons" aria-label="Season">${list.map((s) => `<a class="ms-chip" href="?view=teams&season=${s}"${s === selected ? ' aria-current="true"' : ''}>${fmt.season(s)}</a>`).join('')}</nav>`;
}

/** A bar from the middle: right and green when the team is above average, left and red when below. */
function meter(v, max = 0.8) {
  if (v == null) return '';
  const w = Math.min(1, Math.abs(v) / max) * 50;
  return `<span class="td-meter" aria-hidden="true"><b class="${v >= 0 ? 'up' : 'down'}" style="${v >= 0 ? 'left:50%' : `left:${50 - w}%`};width:${w}%"></b></span>`;
}

function areaTile(a, team, n, last) {
  const tone = a.trouble ? 'td-bad' : a.strength ? 'td-good' : '';
  const tag = a.trouble ? '<span class="td-tag td-tag-bad">Trouble spot</span>' : a.strength ? '<span class="td-tag td-tag-good">Strength</span>' : '';
  return `<div class="td-area ${tone}">
    <div class="td-area-k">${a.label}${tag}</div>
    <div class="td-area-v ${cls(a.value)}">${gpg(a.value)}<small> goals / game</small></div>
    ${meter(a.value)}
    <div class="td-area-r">${ord(a.rank)} of ${n}</div>
    <ul class="td-why">${areaWhy(a, team, last)}</ul>
  </div>`;
}

function areaWhy(a, team, last) {
  const li = (s) => `<li>${s}</li>`;
  if (a.value == null) return li('Not in this season file yet.');
  if (a.key === 'play') {
    const createGap = a.forPg - a.leagueFor;
    const allowGap = a.leagueFor - a.agPg;
    const which = Math.min(createGap, allowGap) < -0.5
      ? (createGap < allowGap ? 'The bigger problem is creating: it builds less than most teams.' : 'The bigger problem is defending: opponents build more against it than most teams manage.')
      : null;
    return [
      li(`Gets <b>${pct(a.share)}</b> of the momentum in its games (${ord(a.shareRank)}), goals left out.`),
      li(`Builds ${fmt.dec(a.forPg, 1)} a game (${ord(a.forRank)}) and allows ${fmt.dec(a.agPg, 1)} (${ord(a.agRank)}, 1st allows least). Average team: ${fmt.dec(a.leagueFor, 1)}.`),
      li(`Shot attempts: ${pct(a.satShare)} (${ord(a.satRank)}).`),
      which ? li(which) : '',
    ].join('');
  }
  if (a.key === 'finishing') {
    return [
      li(`Scores <b>${fmt.dec(a.goals, 2)}</b> goals a game on a goalie from shots average NHL shooters would turn into ${fmt.dec(a.expected, 2)}.`),
      li(`Shooting ${pct(a.shPct)} where ${pct(a.xShPct)} would be normal for those shots.`),
      a.value < 0 ? li('Finishing runs hot and cold: only about a third of a cold year carries into the next.') : '',
    ].join('');
  }
  const gs = team.goalies.filter((g) => g.gs > 0);
  const rows = gs.map((g) => `<li class="td-goalie"><span>${playerLink(g.id, g.name)} <small>${g.gs} start${g.gs === 1 ? '' : 's'}</small></span><b class="${cls(g.gsax)}">${fmt.signed(g.gsax, 1)}</b></li>`).join('');
  const worst = gs.filter((g) => g.gs >= (team.playersLast ? 2 : 3)).sort((x, y) => x.gsax - y.gsax)[0];
  return [
    li(`Allows <b>${fmt.dec(a.goals, 2)}</b> goals a game on shots an average NHL goalie would let in ${fmt.dec(a.expected, 2)}.`),
    worst && worst.gsax <= (team.playersLast ? -1.5 : -3) ? li(`Most of it is ${playerLink(worst.id, worst.name)}: ${worst.ga} goals on shots worth ${fmt.dec(worst.expGa, 1)} to an average goalie, in ${worst.gs} starts.`) : '',
    rows ? `<li class="td-gl"><span class="td-gl-h">Goals saved above expected${last && !team.playersLast ? ' (whole season)' : ''}</span><ul>${rows}</ul></li>` : '',
  ].join('');
}

function playerRow(p) {
  const flagOnly = p.cost > -0.05;
  return `<li class="td-player">
    <div class="td-player-h"><span class="td-pn">${playerLink(p.id, p.name)} <small>${esc(p.pos)} · ${p.gp} ${p.goalie ? "starts" : "GP"}</small></span>${flagOnly ? '<span class="td-flagonly" title="Flagged for a specific area, no total cost">area flag only</span>' : `<span class="td-cost" title="Goals below a typical player at the position so far: momentum plus scoring, with early finishing luck mostly discounted">${fmt.signed(p.cost, 1)} goals</span>`}</div>
    ${tagChips(p.reasons)}
    <ul class="td-why">${p.reasons.map((r) => `<li>${r.text}</li>`).join('')}</ul>
  </li>`;
}

/** Second row of tiles: power play, penalty kill, discipline, faceoffs (goals per game where it makes sense). */
function specialTiles(team) {
  const sp = team.special;
  if (!sp) return '';
  const tile = (a, valueTxt, unit, why) => `<div class="td-area ${a.trouble ? 'td-bad' : ''}"><div class="td-area-k">${a.label}${a.trouble ? '<span class="td-tag td-tag-bad">Trouble spot</span>' : ''}</div>
    <div class="td-area-v ${cls(a.key === 'disc' ? -a.value : a.value - (a.key === 'fo' ? a.league : 0))}">${valueTxt}<small> ${unit}</small></div><div class="td-area-r">${ord(a.rank)} of 32</div><ul class="td-why"><li>${why}</li></ul></div>`;
  return `<div class="dx-areas2">
    ${tile(sp.pp, gpg(sp.pp.value), 'goals / game', `${pct(sp.pp.rate, 0)} on ${sp.pp.opp} chances (league ${pct(sp.pp.league, 0)}).`)}
    ${tile(sp.pk, gpg(sp.pk.value), 'goals / game', `${pct(sp.pk.rate, 0)} killed in ${sp.pk.opp} times short (league ${pct(sp.pk.league, 0)}).`)}
    ${tile(sp.disc, fmt.dec(sp.disc.taken, 1), 'penalties / game', `Draws ${fmt.dec(sp.disc.drawn, 1)} a game, ${fmt.signed(sp.disc.value, 1)} net.`)}
    ${sp.fo ? tile(sp.fo, pct(sp.fo.value, 1), 'won', `League average is ${pct(sp.fo.league, 1)}.`) : ''}
  </div>`;
}

/** Goalies with the split of where their goals come from. */
function goalieBlock(team) {
  const gs = team.goalies.filter((g) => g.gs > 0 && g.areas);
  if (!gs.length) return '';
  const rows = gs.map((g) => `<li class="td-player"><div class="td-player-h"><span class="td-pn">${playerLink(g.id, g.name)} <small>G · ${g.gs} start${g.gs === 1 ? '' : 's'}</small></span><span class="td-cost ${cls(g.gsax)}" style="${g.gsax >= 0 ? 'color:#4ade80' : ''}">${fmt.signed(g.gsax, 1)} goals</span></div>${tagChips(g.flags.map((f) => ({ k: f.k })), g.gsax <= -1.5 ? ['gsax'] : [])}${goalieZones(g.areas)}${g.flags.length ? `<ul class="td-why">${g.flags.map((f) => `<li>${f.text}</li>`).join('')}</ul>` : ''}</li>`).join('');
  return `<h3 class="pc-sub">Goalies <small>where the goals come from: outside vs inside the home plate${team.playersLast ? ', last 10 games' : ''}</small></h3><ul class="td-players" style="grid-template-columns:1fr">${rows}</ul>`;
}

function teamCard(r, team) {
  const opts = r.teams.slice().sort((a, b) => a.abbrev.localeCompare(b.abbrev)).map((t) => `<option value="${t.abbrev}"${t.abbrev === team.abbrev ? ' selected' : ''}>${t.abbrev}</option>`).join('');
  const checks = team.checks.map((c) => `<li>${c.text}</li>`).join('');
  const players = team.players.slice(0, 6);
  return `<section class="pc-card td-team" style="--team:${teamColor(team.abbrev)}">
    <div class="td-team-h">
      <label class="ms-select ms-on"><span>Team</span><select data-tteam aria-label="Team">${opts}</select></label>
      ${spanToggle(!!r.last)}
      <div class="td-rec">${r.last ? `Last ${team.gp} games: ` : ''}<b>${team.w}-${team.l}-${team.otl}</b> · ${pct(team.ptsPct)} of points (${ord(team.ptsRank)}) · goal diff ${fmt.signed(team.gdPerGame, 2)} a game</div>
    </div>
    <p class="td-lede">${esc(headline(team))}</p>
    <div class="td-areas">${AREAS.map(([k]) => areaTile(team.areas[k], team, r.n, r.last)).join('')}</div>
    ${specialTiles(team)}
    ${goalieBlock(team)}
    ${checks ? `<h3 class="pc-sub">Other warning signs${r.last ? ' <small>all games</small>' : ''}</h3><ul class="td-checks">${checks}</ul>` : ''}
    <h3 class="pc-sub">Underperforming so far <small>${r.last ? (team.playersLast ? `last ${r.last} games, so the numbers are small and noisy: ` : 'whole season, since this season has no per-game player data: ') : ''}goals below a typical player at the position this season; short-term, not a verdict on the player</small></h3>
    ${players.length ? `<ul class="td-players">${players.map(playerRow).join('')}</ul>` : '<p class="pq-note">No skater with enough games is this far below a typical player yet.</p>'}
    ${team.onIce?.length ? `<h3 class="pc-sub">The team does worse with them on the ice <small>${r.last && !team.playersLast ? 'whole season, ' : ''}and they are below a typical player on their own numbers</small></h3>
    <ul class="td-players">${team.onIce.map((r) => `<li class="td-player"><div class="td-player-h"><span class="td-pn">${playerLink(r.id, r.name)} <small>${esc(r.pos)} · ${r.gp} GP</small></span><span class="td-cost" title="${r.goalie ? "Share of points in his starts minus the team's other games" : "Share of shot attempts with him on the ice minus the team's other players at his position"}">${r.tag ?? `${fmt.signed(r.gap * 100, 0)} pts`}</span></div><ul class="td-why"><li>${r.text ?? onIceText(r)}</li></ul></li>`).join('')}</ul>
    <p class="pq-note">Skater shot attempts come from shift charts; goalies are judged on points in their starts. Usage matters (who he plays against, where shifts start, who he plays with), so treat this as a reason to watch the player, not a verdict. Needs 150+ minutes.</p>` : ''}
    <p class="pq-note">Player goals add momentum (0.023 goals per point, as in "How it was won") and scoring (finishing plus assists), each against the average forward or defenseman. Skaters need ${r.minGp}+ games; a traded player counts for their latest team.</p>
  </section>`;
}

function overview(r, selected) {
  const rows = r.teams.slice().sort((a, b) => a.ptsPct - b.ptsPct).map((t) => {
    const leak = t.trouble[0];
    const cell = (a) => `<td class="pc-o ${cls(a.value)}${a.trouble ? ' td-hot' : ''}" data-v="${a.value ?? ''}">${gpg(a.value)} <small>${ord(a.rank)}</small></td>`;
    return `<tr data-pick="${t.abbrev}" style="--team:${teamColor(t.abbrev)}"${t.abbrev === selected ? ' aria-selected="true"' : ''}>
      <td class="l ms-team"><button type="button" class="td-pick" data-pick="${t.abbrev}">${t.abbrev}</button></td><td data-v="${t.ptsPct}">${pct(t.ptsPct)}</td>
      ${AREAS.map(([k]) => cell(t.areas[k])).join('')}${t.special ? cell(t.special.pp) + cell(t.special.pk) : '<td></td><td></td>'}<td class="l">${leak ? leak.label : '<span class="td-none">None</span>'}</td><td data-v="${t.players.filter((p) => p.cost <= -1.5).length}">${t.players.filter((p) => p.cost <= -1.5).length}</td></tr>`;
  }).join('');
  return `<section class="pc-card td-all"><h2>Where every team loses ground <small>goals per game against an average team${r.last ? `, last ${r.last} games` : ''}</small></h2>
    <div class="pc-scroll"><table class="pc-table sortable"><thead><tr><th class="l" data-sort>Team</th><th data-sort>Pts %</th>
      ${AREAS.map(([, l], i) => `<th class="pc-o" data-sort title="Goals per game above (+) or below (−) an average team">${l}</th>`).join('')}<th class="pc-o" data-sort title="Goals per game vs the league power-play rate">Power play</th><th class="pc-o" data-sort title="Goals per game vs the league penalty-kill rate">Penalty kill</th><th class="l">Biggest leak</th><th data-sort title="Skaters 1.5+ goals below a typical player at the position this season">Underperforming</th></tr></thead>
      <tbody>${rows}</tbody></table></div>
    <p class="pq-note">Worst record first. Tap a team to see its card. Red cells are trouble spots: bottom third of the league, or a tenth of a goal a game below average.</p>
  </section>`;
}

function intro() {
  return `<section class="pc-card td-how"><details class="ms-fold"><summary>How this works</summary>
    <p>Every team gets three numbers in the same unit, goals per game against an average team, so you can see which hurts most.</p>
    <ul class="td-why">
      <li><b>Driving play</b>: momentum built minus momentum allowed (goals left out), turned into goals. This is the part that best predicts future results.</li>
      <li><b>Finishing</b>: goals scored against what average NHL shooters would score from the same shots. Explains records, but swings a lot.</li>
      <li><b>Goaltending</b>: goals an average NHL goalie would allow on the shots faced, minus goals actually allowed.</li>
    </ul>
    <p>For players, the finishing part uses the separate <b>Scoring</b> stat, which adds <b>playmaking</b> to finishing: goals above what an average shooter would score from the same shots, plus assists above an average forward or defenseman (each assist worth about 3/4 of a goal). A player with few goals but plenty of assists isn't flagged as a poor finisher. Team finishing is unchanged, since every goal already has its assists.</p>
    <p>Below those, <b>Power play</b> and <b>Penalty kill</b> are goals per game against the league rate, <b>Discipline</b> is penalties taken and drawn, and <b>Faceoffs</b> is the share of draws won. Players and goalies carry colored tags for the specific area that is weak: shot volume (shots on goal per attempt), penalties, faceoffs, and for goalies goals allowed outside or inside the home plate. Seasons before 2026-27 get these once rebuilt. Back-to-backs aren't scored yet.</p>
  </details></section>`;
}

function render() {
  const { season, report: r } = state;
  const head = `<section class="ms-hero"><span class="pc-kicker">Our model · regular season</span><h1>Team <b>deficiencies</b></h1>
    <p>Where each team is losing ground, which players it shows up in, and the numbers behind it.</p>${chips(seasons(), season)}</section>`;
  if (!r) {
    main.innerHTML = `${head}<section class="pc-card"><p class="pq-note">${fmt.season(season)} hasn't been built yet. Pick another season above.</p></section>`;
    return;
  }
  const team = r.teams.find((t) => t.abbrev === state.team) ?? r.teams.slice().sort((a, b) => a.ptsPct - b.ptsPct)[0];
  state.team = team.abbrev;
  main.innerHTML = `${head}<div class="pc-cols">${teamCard(r, team)}${overview(r, team.abbrev)}${intro()}</div>`;
  makeSortable(main);
}

function syncUrl() {
  const q = new URLSearchParams({ view: 'teams', season: state.season });
  if (state.last) q.set('span', 'last10');
  if (state.team) q.set('tteam', state.team);
  history.replaceState(null, '', `?${q}`);
}

async function show(season) {
  state.season = season;
  const total = await loadSeason(season);
  state.total = total;
  state.recent = state.last ? await loadRecent(season) : null;
  state.report = total ? deficiencies(total, opts()) : null;
  render();
}

main.addEventListener('click', async (e) => {
  const b = e.target.closest('[data-span]');
  if (!b || !state.total) return;
  state.last = b.dataset.span === 'last';
  if (state.last) state.recent = await loadRecent(state.season);
  state.report = deficiencies(state.total, opts());
  syncUrl();
  render();
});

main.addEventListener('change', (e) => {
  if (!e.target.matches('[data-tteam]')) return;
  state.team = e.target.value;
  syncUrl();
  render();
  main.querySelector('[data-tteam]')?.focus();
});

main.addEventListener('click', (e) => {
  const pick = e.target.closest('[data-pick]');
  if (pick && !e.target.closest('a')) {
    state.team = pick.dataset.pick;
    syncUrl();
    render();
    main.querySelector('.td-team')?.scrollIntoView({ block: 'start' });
    return;
  }
  const a = e.target.closest('a.ms-chip');
  if (a && !e.metaKey && !e.ctrlKey) {
    e.preventDefault();
    show(Number(new URL(a.href).searchParams.get('season'))).then(syncUrl);
  }
});

async function start() {
  const list = seasons();
  const asked = Number(params.get('season'));
  state = { team: (params.get('tteam') || '').toUpperCase() || null, last: params.get('span') === 'last10' };
  let season = list.includes(asked) ? asked : list[0];
  // Early in a season, start on last season until there are a few weeks of games.
  if (!list.includes(asked)) {
    const cur = await loadSeason(season);
    if (!cur || (cur.games ?? 0) < 150) season = list[1] ?? season;
  }
  await show(season);
}

start().catch((err) => {
  console.error(err);
  main.innerHTML = '<p class="msg">Could not load the season file. Try again in a minute.</p>';
});

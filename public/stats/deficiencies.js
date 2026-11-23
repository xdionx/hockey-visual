import '../horn.js'; // goal horns for games with a horn on, on every page
// Team deficiencies view of Momentum stats: stats.html?view=teams&season=<20262027>&tteam=<ABC>
// For each team: the areas it loses ground in (in goals per game against an average team), other warning
// signs, and the players and goalies behind it, each with the numbers that explain why. Logic: src/deficiencies.js.
import { loadSeason, currentSeason, fmt } from '../player/store.js';
import { installPlayerLinks, playerLink } from '../player/link.js';
import { esc, makeSortable, teamColor } from '../game/core.js';
import { deficiencies, headline, AREAS, ord } from '../src/deficiencies.js';

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

function chips(list, selected) {
  return `<nav class="ms-seasons" aria-label="Season">${list.map((s) => `<a class="ms-chip" href="?view=teams&season=${s}"${s === selected ? ' aria-current="true"' : ''}>${fmt.season(s)}</a>`).join('')}</nav>`;
}

/** A bar from the middle: right and green when the team is above average, left and red when below. */
function meter(v, max = 0.8) {
  if (v == null) return '';
  const w = Math.min(1, Math.abs(v) / max) * 50;
  return `<span class="td-meter" aria-hidden="true"><b class="${v >= 0 ? 'up' : 'down'}" style="${v >= 0 ? 'left:50%' : `left:${50 - w}%`};width:${w}%"></b></span>`;
}

function areaTile(a, team, n) {
  const tone = a.trouble ? 'td-bad' : a.strength ? 'td-good' : '';
  const tag = a.trouble ? '<span class="td-tag td-tag-bad">Trouble spot</span>' : a.strength ? '<span class="td-tag td-tag-good">Strength</span>' : '';
  return `<div class="td-area ${tone}">
    <div class="td-area-k">${a.label}${tag}</div>
    <div class="td-area-v ${cls(a.value)}">${gpg(a.value)}<small> goals / game</small></div>
    ${meter(a.value)}
    <div class="td-area-r">${ord(a.rank)} of ${n}</div>
    <ul class="td-why">${areaWhy(a, team)}</ul>
  </div>`;
}

function areaWhy(a, team) {
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
  const worst = gs.filter((g) => g.gs >= 3).sort((x, y) => x.gsax - y.gsax)[0];
  return [
    li(`Allows <b>${fmt.dec(a.goals, 2)}</b> goals a game on shots an average NHL goalie would let in ${fmt.dec(a.expected, 2)}.`),
    worst && worst.gsax <= -3 ? li(`Most of it is ${playerLink(worst.id, worst.name)}: ${worst.ga} goals on shots worth ${fmt.dec(worst.expGa, 1)} to an average goalie, in ${worst.gs} starts.`) : '',
    rows ? `<li class="td-gl"><span class="td-gl-h">Goals saved above expected</span><ul>${rows}</ul></li>` : '',
  ].join('');
}

function playerRow(p) {
  return `<li class="td-player">
    <div class="td-player-h"><span class="td-pn">${playerLink(p.id, p.name)} <small>${esc(p.pos)} · ${p.gp} GP</small></span><span class="td-cost" title="Goals of goal difference lost against a typical player at the position, momentum plus finishing">${fmt.signed(p.cost, 1)} goals</span></div>
    <ul class="td-why">${p.reasons.map((r) => `<li>${r.text}</li>`).join('')}</ul>
  </li>`;
}

function teamCard(r, team) {
  const opts = r.teams.slice().sort((a, b) => a.abbrev.localeCompare(b.abbrev)).map((t) => `<option value="${t.abbrev}"${t.abbrev === team.abbrev ? ' selected' : ''}>${t.abbrev}</option>`).join('');
  const checks = team.checks.map((c) => `<li>${c.text}</li>`).join('');
  const players = team.players.slice(0, 6);
  return `<section class="pc-card td-team" style="--team:${teamColor(team.abbrev)}">
    <div class="td-team-h">
      <label class="ms-select ms-on"><span>Team</span><select data-tteam aria-label="Team">${opts}</select></label>
      <div class="td-rec"><b>${team.w}-${team.l}-${team.otl}</b> · ${pct(team.ptsPct)} of points (${ord(team.ptsRank)}) · goal diff ${fmt.signed(team.gdPerGame, 2)} a game</div>
    </div>
    <p class="td-lede">${esc(headline(team))}</p>
    <div class="td-areas">${AREAS.map(([k]) => areaTile(team.areas[k], team, r.n)).join('')}</div>
    ${checks ? `<h3 class="pc-sub">Other warning signs</h3><ul class="td-checks">${checks}</ul>` : ''}
    <h3 class="pc-sub">Players holding them back <small>goals lost against a typical player at the position, this season</small></h3>
    ${players.length ? `<ul class="td-players">${players.map(playerRow).join('')}</ul>` : '<p class="pq-note">No skater with enough games is costing this team 1.5 goals yet.</p>'}
    <p class="pq-note">Player goals add momentum (0.023 goals per point, as in "How it was won") and finishing, each against the average forward or defenseman. Skaters need ${r.minGp}+ games; a traded player counts for their latest team.</p>
  </section>`;
}

function overview(r, selected) {
  const rows = r.teams.slice().sort((a, b) => a.ptsPct - b.ptsPct).map((t) => {
    const leak = t.trouble[0];
    const cell = (a) => `<td class="pc-o ${cls(a.value)}${a.trouble ? ' td-hot' : ''}" data-v="${a.value ?? ''}">${gpg(a.value)} <small>${ord(a.rank)}</small></td>`;
    return `<tr data-pick="${t.abbrev}" style="--team:${teamColor(t.abbrev)}"${t.abbrev === selected ? ' aria-selected="true"' : ''}>
      <td class="l ms-team"><button type="button" class="td-pick" data-pick="${t.abbrev}">${t.abbrev}</button></td><td data-v="${t.ptsPct}">${pct(t.ptsPct)}</td>
      ${AREAS.map(([k]) => cell(t.areas[k])).join('')}<td class="l">${leak ? leak.label : '<span class="td-none">None</span>'}</td><td data-v="${t.players.length}">${t.players.length}</td></tr>`;
  }).join('');
  return `<section class="pc-card td-all"><h2>Where every team loses ground <small>goals per game against an average team</small></h2>
    <div class="pc-scroll"><table class="pc-table sortable"><thead><tr><th class="l" data-sort>Team</th><th data-sort>Pts %</th>
      ${AREAS.map(([, l], i) => `<th class="pc-o" data-sort title="Goals per game above (+) or below (−) an average team">${l}</th>`).join('')}<th class="l">Biggest leak</th><th data-sort title="Skaters costing the team 1.5+ goals this season">Players</th></tr></thead>
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
    <p>Power play, penalty kill and back-to-backs aren't in the season files yet, so they aren't scored here.</p>
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
  if (state.team) q.set('tteam', state.team);
  history.replaceState(null, '', `?${q}`);
}

async function show(season) {
  state.season = season;
  const total = await loadSeason(season);
  state.report = total ? deficiencies(total) : null;
  render();
}

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
  state = { team: (params.get('tteam') || '').toUpperCase() || null };
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

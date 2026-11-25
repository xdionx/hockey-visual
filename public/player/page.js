import '../horn.js'; // goal horns for games with a horn on, on every page
// Full player card: profile, this season in depth, SAT and momentum for every season, season-by-season
// table and the last five games. player.html?id=<playerId>
import { loadPlayer, loadSeason, ourStats, fmt, positionName, typeToggle, getStatsType, setStatsType, GAME_TYPES } from './store.js';
import { teamColor, esc, decisionLabel, initVideo } from '../game/core.js';
import { installPlayerLinks } from './link.js';
import { rankBit } from './quick.js';
import { getData, getStatic } from '../data.js';
import { FIRST_FULL_SEASON, leagueRate, leagueSavePct, recentFile, recentAll } from '../src/seasonStats.js';
import { leagueGoalies, teamGameIds, startFromGame } from '../src/goalieCard.js';
import { installTips } from './tips.js';
import { skaterCard } from '../src/skaterCard.js';
import { skaterSections, loadSkaterGames, loadClips, loadSeasonClips, clipsHtml, lastGamesSection, rangeToggle as skRange, navHtml as skNav } from './skater.js';
import { goalieSections, lastStartsSection, navHtml, rangeToggle } from './goalie.js';
import { combineSeasons } from '../src/player.js';
import { goalieRating, W } from '../src/predict.js';

const id = new URLSearchParams(location.search).get('id');
const main = document.querySelector('#player');
installPlayerLinks();
initVideo(main);

const initials = (n) => String(n ?? '?').split(/\s+/).map((w) => w[0]).slice(0, 2).join('').toUpperCase();
const QS_TIP = (o) => `Quality start: save % at least the league average this season${o.lgSv ? ` (${fmt.sv(o.lgSv)})` : ''}, or under 20 shots with 2 goals or fewer allowed and a save % of .885+. A pulled starter is judged on the shots he faced; relief appearances don't count.`;
const tile = (label, value, sub = '', cls = '', tip = '') => `<div class="pq-t ${cls}"${tip ? ` title="${tip.replace(/"/g, '&quot;')}"` : ''}><span class="pq-v">${value}</span><span class="pq-k">${label}</span>${sub ? `<span class="pq-s">${sub}</span>` : ''}</div>`;

function hero(p) {
  const facts = [
    ['Age', fmt.age(p.birthDate)],
    ['Height', fmt.height(p.height)],
    ['Weight', p.weight ? `${p.weight} lb` : null],
    [p.goalie ? 'Catches' : 'Shoots', p.shoots],
    ['Born', p.birthPlace],
    ['Draft', p.draft ? `${p.draft.year} ${p.draft.team}, round ${p.draft.round}, #${p.draft.overall} overall` : 'Undrafted'],
  ].filter(([, v]) => v != null);
  const mug = p.headshot
    ? `<img class="pc-mug" src="${esc(p.headshot)}" alt="" onerror="this.replaceWith(Object.assign(document.createElement('span'),{className:'pc-mug pq-mug-fb',textContent:'${esc(initials(p.fullName))}'}))">`
    : `<span class="pc-mug pq-mug-fb">${esc(initials(p.fullName))}</span>`;
  return `<section class="pc-hero" style="--team:${teamColor(p.team)}">
    ${mug}
    <div class="pc-id">
      <span class="pc-kicker">${p.number != null ? `#${p.number} · ` : ''}${esc(positionName(p.position))}${p.active ? '' : ' · Inactive'}</span>
      <h1>${esc(p.firstName)} <b>${esc(p.lastName)}</b></h1>
      <span class="pc-team">${esc(p.teamName ?? '')}</span>
      <dl class="pc-facts">${facts.map(([k, v]) => `<div><dt>${k}</dt><dd>${esc(v)}</dd></div>`).join('')}</dl>
    </div>
    ${p.teamLogo ? `<img class="pc-logo" src="${esc(p.teamLogo)}" alt="${esc(p.teamName ?? '')}" onerror="this.remove()">` : ''}
  </section>`;
}

function card(title, sub, html, cls = '') {
  return `<section class="pc-card ${cls}"><h2>${title}${sub ? ` <small>${sub}</small>` : ''}</h2>${html}</section>`;
}

const svPts = (v) => (v == null ? '-' : `${fmt.signed(v * 100, 1)}%`);

/** Our goaltending numbers for this season (goals saved above expected and what our pick makes of it). */
function goalieOurs(p, ours, pick) {
  if (!ours || ours.gsax == null) return '';
  const sa = p.now?.shotsAgainst;
  const xsv = sa ? 1 - ours.xgaAvg / sa : null;
  return `
    <h3 class="pc-sub">Our numbers <small>from the play-by-play, ${ours.gp} finished games</small></h3>
    <div class="pq-grid pc-grid">
      ${tile('GSAx', fmt.signed(ours.gsax, 1), rankBit(ours.gsaxRank) || 'goals saved above expected', 'pq-ours')}
      ${tile('GSAx/GP', fmt.signed(ours.gsaxPerGame, 2), 'per game played', 'pq-ours')}
      ${tile('Goals against', ours.ga, `avg goalie ${fmt.dec(ours.xgaAvg)} on the same shots`, 'pq-ours')}
      ${sa ? tile('SV% vs exp', svPts(ours.gsax / sa), `expected ${fmt.sv(xsv)} on these shots`, 'pq-ours') : ''}
      ${tile('Starts', ours.starts, `${ours.gp} games played`, 'pq-ours')}
      ${ours.qs != null ? tile('Quality starts', ours.qs, `${rankBit(ours.qsRank) || 'good games started'}`, 'pq-ours', QS_TIP(ours)) : ''}
      ${ours.qs != null ? tile('QS%', fmt.pct(ours.qsPct, 0), 'share of starts', 'pq-ours', QS_TIP(ours)) : ''}
      ${pick?.id ? tile('Pick edge', fmt.signed(W.goalie * pick.value, 2), 'goals a game in our pick when starting, vs an average goalie', 'pq-ours') : ''}
    </div>
    <p class="pq-note">GSAx is how many goals this goalie kept out beyond what an average NHL goalie would allow on the same shots (distance, angle and shot type, our own estimate). Goalie skill is real over a season, but in six seasons of tests save streaks, big saves and goalie pulls didn't swing games, so goalies get no in-game momentum.${pick?.id ? ' What does help is who starts: <b>Pick edge</b> is what the goalie\'s GSAx this season and last (shrunk toward average) adds to our pre-game pick on the Scores page.' : ''}</p>`;
}

function thisSeason(p, ours, pick, v) {
  const n = v.now;
  if (v.playoffs && !n && !ours) return card('Playoffs', '', `<p class="pq-note">${esc(p.fullName)} hasn't played an NHL playoff game yet.</p>`);
  if (!n && !ours) return card('This season', fmt.season(p.currentSeason ?? ''), '<p class="pq-note">No games this regular season yet.</p>');
  let tiles;
  if (p.goalie) {
    tiles = [tile('GP', n?.gp ?? 0), tile('W', n?.wins ?? '-'), tile('L', n?.losses ?? '-'), ...(v.playoffs ? [] : [tile('OTL', n?.otLosses ?? '-')]), tile('SV%', fmt.sv(n?.savePct), '', 'pq-hl'),
      tile('GAA', fmt.dec(n?.gaa, 2)), tile('SO', n?.shutouts ?? '-'), tile('Shots against', n?.shotsAgainst ?? '-'), tile('TOI/GP', fmt.toi(n?.toiPerGame))];
  } else {
    tiles = [
      tile('GP', n?.gp ?? ours?.gp ?? 0), tile('G', n?.goals ?? '-'), tile('A', n?.assists ?? '-'), tile('P', n?.points ?? '-', '', 'pq-hl'),
      tile('+/-', n ? fmt.signed(n.plusMinus, 0) : '-'), tile('PIM', n?.pim ?? '-'), tile('TOI/GP', fmt.toi(n?.toiPerGame ?? ours?.toiPerGame)),
      tile('Shots', n?.shots ?? '-'), tile('S%', fmt.pct(n?.shootingPct)), tile('PPP', n?.ppp ?? '-'),
      ...(n?.foPct ? [tile('FO%', fmt.pct(n.foPct))] : []),
      ...(v.playoffs && n?.gwg ? [tile('GWG', n.gwg)] : []),
    ];
  }
  const ourTiles = p.goalie ? goalieOurs(p, ours, pick) : !ours ? '' : `
    <h3 class="pc-sub">Our numbers <small>from the play-by-play, ${ours.gp} finished games</small></h3>
    <div class="pq-grid pc-grid">
      ${tile('SAT/GP', fmt.dec(ours.satPerGame), rankBit(ours.satRank), 'pq-ours')}
      ${tile('MOM/GP', fmt.signed(ours.momPerGame, 1), rankBit(ours.momRank), 'pq-ours')}
      ${ours.satPer60 != null ? tile('SAT/60', fmt.dec(ours.satPer60), '', 'pq-ours') : ''}
      ${ours.momPer60 != null ? tile('MOM/60', fmt.signed(ours.momPer60, 1), '', 'pq-ours') : ''}
      ${tile('MOM +/GP', fmt.signed(ours.momPosPerGame, 1), 'created', 'pq-ours')}
      ${tile('MOM −/GP', fmt.signed(ours.momNegPerGame, 1), 'given up', 'pq-ours')}
      ${tile('SAT', ours.row.sat, `${ours.row.sog} on goal`, 'pq-ours')}
      ${tile('MOM', fmt.signed(ours.row.mom, 1), v.playoffs ? 'playoff total' : 'season total', 'pq-ours')}
      ${ours.gaa != null ? tile('Goals vs avg', fmt.signed(ours.gaa, 1), rankBit(ours.finRank) || 'vs an average shooter', 'pq-ours') : ''}
      ${ours.scoringVsAvg != null ? tile('Scoring vs avg', fmt.signed(ours.scoringVsAvg, 1), rankBit(ours.scoreRank) || `goals ${fmt.signed(ours.gaa, 1)}, assists ${fmt.signed(ours.playVsAvg, 1)}`, 'pq-ours') : ''}
      ${ours.abovePct != null ? tile('Above avg games', fmt.pct(ours.abovePct, 0), `below avg ${fmt.pct(ours.belowPct, 0)}, ${ours.row.tg} games rated`, 'pq-ours') : ''}
      ${ours.shPct != null ? tile('S% on a goalie', fmt.pct(ours.shPct), `avg shooter ${fmt.pct(ours.xShPct)} on the same shots`, 'pq-ours') : ''}
    </div>`;
  const title = v.playoffs ? (v.season === p.currentSeason ? 'These playoffs' : 'Latest playoffs') : 'This season';
  return card(title, `${fmt.season(v.season)} ${v.playoffs ? 'playoffs' : 'regular season'}`, `<div class="pq-grid pc-grid">${tiles.join('')}</div>${ourTiles}`);
}

/** Two bar charts, one per number, a bar per season (oldest left). Seasons not built yet are hollow. */
const yr = (s) => `${String(s).slice(2, 4)}-${String(s).slice(6, 8)}`;

function trend(rows, goalie = false, playoffs = false) {
  const list = rows.filter((r) => r.season >= FIRST_FULL_SEASON).slice().reverse();
  if (!list.length) return '';
  const chart = (key, label, signed, fmtV) => {
    const vals = list.map((r) => r.ours?.[key]);
    const max = Math.max(0.01, ...vals.filter((v) => v != null).map((v) => Math.abs(v)));
    const W = 34;
    const H = 120;
    const neg = vals.some((v) => v != null && v < 0);
    const zero = signed && neg ? H / 2 + 8 : H;
    const scale = signed && neg ? (H / 2 - 8) / max : (H - 18) / max;
    const bars = list.map((r, i) => {
      const v = r.ours?.[key];
      const x = i * W + 6;
      if (v == null) return `<g><rect class="pt-pend" x="${x}" y="${zero - 14}" width="${W - 12}" height="14" rx="2"><title>${fmt.season(r.season)}: not built yet</title></rect><text class="pt-y" x="${x + (W - 12) / 2}" y="${H + 28}">${yr(r.season)}</text></g>`;
      const h = Math.max(1.5, Math.abs(v) * scale);
      const y = v >= 0 ? zero - h : zero;
      return `<g${r.ours.complete ? '' : ' class="pt-part"'}><rect class="${v >= 0 ? 'pt-up' : 'pt-down'}" x="${x}" y="${y}" width="${W - 12}" height="${h}" rx="2"><title>${fmt.season(r.season)}: ${fmtV(v)} (${r.ours.gp} GP${r.ours.complete || r.season === list.at(-1).season ? '' : ', still being built'})</title></rect>
        <text class="pt-v" x="${x + (W - 12) / 2}" y="${v >= 0 ? y - 4 : y + h + 11}">${fmtV(v)}</text>
        <text class="pt-y" x="${x + (W - 12) / 2}" y="${H + 28}">${yr(r.season)}</text></g>`;
    }).join('');
    const w = list.length * W + 12;
    return `<figure class="pt"><figcaption>${label}</figcaption><div class="pt-scroll"><svg viewBox="0 0 ${w} ${H + 34}" width="${w}" height="${H + 34}" role="img" aria-label="${label} by season">
      <line class="pt-zero" x1="0" x2="${w}" y1="${zero}" y2="${zero}"/>${bars}</svg></div></figure>`;
  };
  const pending = list.some((r) => !r.ours && !r.built);
  if (goalie) {
    return card(playoffs ? 'Playoff goaltending by season' : 'Goaltending by season', `${playoffs ? 'playoffs' : 'regular season'}, vs an average goalie on the same shots`,
      `<div class="pt-wrap">${chart('gsax', 'Goals saved above expected', true, (v) => fmt.signed(v, 1))}${chart('svVsExp', 'SV% vs expected (points)', true, (v) => fmt.signed(v * 100, 1))}${chart('qsPct', 'Quality start %', false, (v) => fmt.pct(v, 0))}</div>
      ${pending ? '<p class="pq-note">Hollow bars are seasons we are still building from the NHL play-by-play (goalie numbers go back to 2020-21 so far). They fill in on their own.</p>' : ''}`);
  }
  return card(playoffs ? 'Playoff SAT and momentum' : 'SAT and momentum by season', `per game, ${playoffs ? 'each playoff run' : 'regular season'}`,
    `<div class="pt-wrap">${chart('satPerGame', 'SAT per game', false, (v) => v.toFixed(1))}${chart('momPerGame', 'Momentum per game', true, (v) => fmt.signed(v, 1))}</div>
    ${pending ? '<p class="pq-note">Hollow bars are seasons we are still building from the NHL play-by-play (about a dozen seasons a day). They fill in on their own.</p>' : ''}`);
}

function seasonsTable(p, rows, v) {
  const careerOurs = (() => {
    const have = rows.filter((r) => r.ours);
    const gp = have.reduce((a, r) => a + r.ours.gp, 0);
    if (!gp) return null;
    const xg = have.reduce((a, r) => a + (r.ours.row.xg ?? 0), 0);
    const xgg = have.reduce((a, r) => a + (r.ours.row.xgg ?? 0), 0);
    return { gp, sat: have.reduce((a, r) => a + r.ours.row.sat, 0) / gp, mom: have.reduce((a, r) => a + r.ours.row.mom, 0) / gp, seasons: have.length, gaa: have.some((r) => r.ours.gaa != null) ? have.reduce((a, r) => a + (r.ours.gaa ?? 0), 0) : null, xgg };
  })();
  const goalieCells = (r) => {
    if (r.season < FIRST_FULL_SEASON) return '<td class="pc-na" title="No full play-by-play before 2009-10">n/a</td><td class="pc-na">n/a</td><td class="pc-na">n/a</td><td class="pc-na">n/a</td>';
    if (r.ours?.gsax == null) return `<td class="pc-na" title="${r.built ? 'No games in our data' : 'Still being built'}">${r.built ? '-' : '…'}</td><td class="pc-na">${r.built ? '-' : '…'}</td><td class="pc-na">${r.built ? '-' : '…'}</td><td class="pc-na">${r.built ? '-' : '…'}</td>`;
    const part = !r.ours.complete && r.season !== p.currentSeason;
    const t = r.ours.gsaxRank ? ` title="${fmt.ord(r.ours.gsaxRank.rank)} NHL, among ${r.ours.gsaxRank.of} goalies with 5+ starts"` : '';
    return `<td class="pc-o ${r.ours.gsax >= 0 ? 'up' : 'down'}${part ? ' pc-part' : ''}"${t}>${fmt.signed(r.ours.gsax, 1)}${part ? '*' : ''}</td><td class="pc-o${part ? ' pc-part' : ''}">${r.ours.svVsExp == null ? '-' : svPts(r.ours.svVsExp)}</td><td class="pc-o">${r.ours.qs ?? '-'}</td><td class="pc-o">${r.ours.qsPct == null ? '-' : fmt.pct(r.ours.qsPct, 0)}</td>`;
  };
  const ourCells = (r) => {
    if (p.goalie) return goalieCells(r);
    if (r.season < FIRST_FULL_SEASON) return '<td class="pc-na" title="No full play-by-play before 2009-10">n/a</td><td class="pc-na">n/a</td><td class="pc-na">n/a</td>';
    if (!r.ours) return `<td class="pc-na" title="${r.built ? 'No games in our data' : 'Still being built'}">${r.built ? '-' : '…'}</td><td class="pc-na">${r.built ? '-' : '…'}</td><td class="pc-na">${r.built ? '-' : '…'}</td>`;
    const fin = `<td class="pc-o"${r.ours.shPct != null ? ` title="Shot ${fmt.pct(r.ours.shPct)}; an average shooter ${fmt.pct(r.ours.xShPct)} on the same shots"` : ''}>${fmt.signed(r.ours.gaa, 1)}</td>`;
    const t = (rk) => (rk ? ` title="${fmt.ord(rk.rank)} of ${rk.of} skaters"` : '');
    if (!r.ours.complete && r.season !== p.currentSeason) {
      const why = ` title="Still being built: ${r.ours.games} games of this season so far"`;
      return `<td class="pc-o pc-part"${why}>${fmt.dec(r.ours.satPerGame)}*</td><td class="pc-o pc-part"${why}>${fmt.signed(r.ours.momPerGame, 1)}*</td>${fin}`;
    }
    return `<td class="pc-o"${t(r.ours.satRank)}>${fmt.dec(r.ours.satPerGame)}</td><td class="pc-o ${r.ours.momPerGame >= 0 ? 'up' : 'down'}"${t(r.ours.momRank)}>${fmt.signed(r.ours.momPerGame, 1)}</td>${fin}`;
  };
  const head = p.goalie
    ? `<th class="l">Season</th><th class="l">Team</th><th>GP</th><th>W</th><th>L</th>${v.playoffs ? '' : '<th>OTL</th>'}<th>SV%</th><th>GAA</th><th>SO</th><th class="pc-o" title="Goals saved above expected (our model)">GSAx</th><th class="pc-o" title="Save % minus what an average goalie would stop on the same shots">SV% vs exp</th><th class="pc-o" title="Quality starts: save % at least the league average, or under 20 shots with 2 goals or fewer and .885+">QS</th><th class="pc-o" title="Quality starts divided by games started">QS%</th>`
    : '<th class="l">Season</th><th class="l">Team</th><th>GP</th><th>G</th><th>A</th><th>P</th><th>+/-</th><th>PIM</th><th>TOI/GP</th><th class="pc-o" title="Own shot attempts per game (our model)">SAT/GP</th><th class="pc-o" title="Momentum impact per game (our model)">MOM/GP</th><th class="pc-o" title="Goals scored minus what an average NHL shooter would score from the same shots">Goals vs avg</th>';
  const line = (r, label = fmt.season(r.season), team = r.team, ours = ourCells(r)) => (p.goalie
    ? `<td class="l">${label}</td><td class="l">${esc(team)}</td><td>${r.gp}</td><td>${r.wins}</td><td>${r.losses}</td>${v.playoffs ? '' : `<td>${r.otLosses}</td>`}<td>${fmt.sv(r.savePct)}</td><td>${fmt.dec(r.gaa, 2)}</td><td>${r.shutouts}</td>${ours}`
    : `<td class="l">${label}</td><td class="l">${esc(team)}</td><td>${r.gp}</td><td>${r.goals}</td><td>${r.assists}</td><td><b>${r.points}</b></td><td>${fmt.signed(r.plusMinus, 0)}</td><td>${r.pim}</td><td>${fmt.toi(r.toiPerGame)}</td>${ours}`);
  const careerGoalie = (() => {
    const have = rows.filter((r) => r.ours?.gsax != null);
    if (!have.length) return '<td></td><td></td><td></td><td></td>';
    const gsax = have.reduce((a, r) => a + r.ours.gsax, 0);
    const sa = have.reduce((a, r) => a + (r.shotsAgainst ?? 0), 0);
    return `<td class="pc-o ${gsax >= 0 ? 'up' : 'down'}" title="Added up across the ${have.length} seasons we have">${fmt.signed(gsax, 1)}</td><td class="pc-o">${sa ? svPts(gsax / sa) : '-'}</td>${(() => { const q = have.filter((r) => r.ours.qs != null); const st = q.reduce((a, r) => a + r.ours.qsStarts, 0); const n = q.reduce((a, r) => a + r.ours.qs, 0); return st ? `<td class="pc-o">${n}</td><td class="pc-o">${fmt.pct(n / st, 0)}</td>` : '<td></td><td></td>'; })()}`;
  })();
  const careerCells = p.goalie ? careerGoalie : careerOurs ? `<td class="pc-o" title="Across the ${careerOurs.seasons} seasons we have">${fmt.dec(careerOurs.sat)}</td><td class="pc-o">${fmt.signed(careerOurs.mom, 1)}</td><td class="pc-o" title="Added up across the seasons we have">${fmt.signed(careerOurs.gaa, 1)}</td>` : '<td></td><td></td><td></td>';
  const career = v.career ? `<tr class="pc-tot">${line(v.career, v.playoffs ? 'Career playoffs' : 'Career', `${v.list.length} season${v.list.length === 1 ? '' : 's'}`, careerCells)}</tr>` : '';
  if (v.playoffs && !rows.length) return '';
  return card(v.playoffs ? 'Playoffs by season' : 'Season by season', v.playoffs ? 'NHL playoffs' : 'NHL regular season', `<div class="pc-scroll"><table class="pc-table"><thead><tr>${head}</tr></thead><tbody>${rows.map((r) => `<tr>${line(r)}</tr>`).join('')}${career}</tbody></table></div>
    ${p.goalie ? `<p class="pq-note">GSAx and SV% vs exp are our own numbers from every game's play-by-play: goals kept out beyond what an average NHL goalie would allow on the same shots that season. Built back to 2020-21 so far; older seasons fill in as we rebuild them. Hover a GSAx value for the league rank that season.${rows.some((r) => r.ours && !r.ours.complete && r.season !== p.currentSeason) ? ' * = season still being built, numbers so far.' : ''}</p>` : `<p class="pq-note">SAT/GP, MOM/GP and Goals vs avg are our own numbers, built from every game's play-by-play (2009-10 on). Goals vs avg is how many more (or fewer) goals the player scored than an average NHL shooter would have from the same shots that season; about a third of a hot or cold year carries into the next. Scoring vs avg adds the player's assists above an average player at the position (each worth about 3/4 of a goal), so setting up goals counts too. Hover a value for the league rank that season.${rows.some((r) => r.ours && !r.ours.complete && r.season !== p.currentSeason) ? ' * = season still being built, numbers so far.' : ''}</p>`}`);
}

async function lastFive(p) {
  if (!p.last5.length) return '';
  const games = await Promise.all(p.last5.map((g) => getData(`games/${g.gameId}.json`).catch(() => null)));
  const mine = (game) => {
    if (!game) return null;
    for (const side of ['away', 'home']) {
      const pl = game.players?.[side] ?? {};
      const hit = [...(pl.forwards ?? []), ...(pl.defense ?? []), ...(pl.goalies ?? [])].find((x) => x.id === p.id);
      if (hit) return hit;
    }
    return null;
  };
  const head = p.goalie
    ? '<th class="l">Date</th><th class="l">Opp</th><th title="Decision: W or L in regulation, OTW or OTL in overtime, SOW or SOL in a shootout">Dec</th><th>SA</th><th>GA</th><th>SV%</th><th class="pc-o" title="Goals saved above expected that game (as on the box score)">GSAx</th><th>TOI</th><th>Rating</th>'
    : '<th class="l">Date</th><th class="l">Opp</th><th>G</th><th>A</th><th>P</th><th>SOG</th><th>TOI</th><th class="pc-o">SAT</th><th class="pc-o">MOM</th><th>Rating</th>';
  const rows = p.last5.map((g, i) => {
    const m = mine(games[i]);
    const date = new Date(`${g.date}T12:00:00Z`).toLocaleDateString(undefined, { month: 'short', day: 'numeric', timeZone: 'UTC' });
    const link = `<a href="game.html?id=${g.gameId}">${date}</a>`;
    const opp = `${g.home ? 'vs' : '@'} ${esc(g.opponent)}`;
    const rating = m?.rating != null ? `<span class="pc-rate">${m.rating.toFixed(1)}</span>` : '-';
    return p.goalie
      ? `<tr><td class="l">${link}</td><td class="l">${opp}</td><td>${esc((games[i] ? decisionLabel(games[i], g.decision) : g.decision) ?? '-')}</td><td>${g.shotsAgainst ?? '-'}</td><td>${g.goalsAgainst ?? '-'}</td><td>${fmt.sv(g.savePct)}</td><td class="pc-o ${(m?.gsax ?? 0) >= 0 ? 'up' : 'down'}">${m?.gsax != null ? fmt.signed(m.gsax, 1) : '-'}</td><td>${esc(g.toi ?? '-')}</td><td>${rating}</td></tr>`
      : `<tr><td class="l">${link}</td><td class="l">${opp}</td><td>${g.goals}</td><td>${g.assists}</td><td><b>${g.points}</b></td><td>${g.shots}</td><td>${esc(g.toi ?? '-')}</td><td class="pc-o">${m?.attempts ?? '-'}</td><td class="pc-o ${(m?.momentum ?? 0) >= 0 ? 'up' : 'down'}">${m ? fmt.signed(m.momentum, 1) : '-'}</td><td>${rating}</td></tr>`;
  });
  return card('Last 5 games', 'tap a date for the box score', `<div class="pc-scroll"><table class="pc-table"><thead><tr>${head}</tr></thead><tbody>${rows.join('')}</tbody></table></div>`);
}

async function load() {
  if (!id || !/^\d{7,8}$/.test(id)) {
    main.innerHTML = '<p class="msg">No player selected. <a href="./">Back to scores</a></p>';
    return;
  }
  const p = await loadPlayer(id);
  if (!p) {
    main.innerHTML = '<p class="msg">Couldn\'t load this player right now. Player cards need the live data service.</p>';
    return;
  }
  document.title = `${p.fullName} · Player card`;
  // Last five games don't change with the toggle: load them once.
  const last5 = p.goalie ? Promise.resolve('') : lastFive(p).catch(() => '');
  const views = {};
  let range = 0; // goalies: 0 = all games, 10 = last 10 starts
  let startsFor = null;
  const showGoalie = async (type, v) => {
    const startsP = (startsFor ??= {})[type] ??= loadStarts(p, v);
    const body = () => {
      const lg = v.file ? leagueGoalies(v.file, v.playoffs ? 2 : undefined) : null;
      return lg && v.ours ? goalieSections({ id: p.id, lg, ours: v.ours, now: v.now, pick: v.pick, starts: body.starts, n: range, playoffs: v.playoffs }) : '';
    };
    const paint = () => {
      const html = body();
      main.querySelector('#gc-body').innerHTML = html || thisSeason(p, v.ours, v.pick, v);
      main.querySelector('#gc-last').innerHTML = lastStartsSection(body.starts, v.playoffs);
    };
    main.innerHTML = `${hero(p)}<div class="gc-bar">${typeToggle(type, 'pc-type-main')}${v.playoffs ? '' : rangeToggle(range)}</div>${navHtml()}<div class="pc-cols" id="gc-body"></div><div class="pc-cols" id="gc-hist">${trend(v.rows, true, v.playoffs)}${seasonsTable(p, v.rows, v)}</div><div id="gc-last" class="pc-cols"></div>`;
    document.querySelectorAll('.pt-scroll').forEach((el) => { el.scrollLeft = el.scrollWidth; });
    body.starts = null;
    paint();
    startsP.then((st) => { if (getStatsType() !== type) return; body.starts = st; paint(); });
  };
  main.addEventListener('click', (e) => {
    const b = e.target.closest('[data-gc-range]');
    if (!b || b.getAttribute('aria-pressed') === 'true') return;
    range = Number(b.dataset.gcRange);
    show(getStatsType());
  });
  installTips(main);
  const sk = { tab: 'g', all: false, games: {}, clips: {}, past: {}, season: null, recent: null };
  const prevSeasonOf = (s) => Number(`${Math.floor(s / 10000) - 1}${Math.floor(s / 10000)}`);
  // This season's def file and the two before it (Defending blends all three).
  const loadDefFiles = (season) => ((sk.defs ??= {})[season] ??= Promise.all([season, prevSeasonOf(season), prevSeasonOf(prevSeasonOf(season))].map((x) => getStatic(`seasons/${x}-def.json`).catch(() => null))));
  const loadRecentFile = (season) => (sk.recent ??= getStatic(`seasons/${recentFile(season)}`).catch(() => null));
  const showSkater = async (type, v, seasonCard0) => {
    const [defFile, ...defPrev] = v.playoffs ? [null] : await loadDefFiles(v.season);
    const seasonCard = defFile ? skaterCard(v.file, p.id, { def: defFile, defPrev }) ?? seasonCard0 : seasonCard0;
    const key = type;
    const rng = v.playoffs ? 0 : range;
    let card = seasonCard;
    let winNote = '';
    if (rng) {
      const win = recentAll(await loadRecentFile(v.season), rng);
      const c = win ? skaterCard(win, p.id, { win: true, def: defFile, defPrev }) : null;
      if (c) card = c; else winNote = '<p class="pq-note">Not enough recent games for a last 10 view yet; showing the season.</p>';
    }
    const seasons = v.playoffs ? [] : p.nhl.map((r) => r.season).filter((x) => x >= FIRST_FULL_SEASON);
    const cur = sk.season ?? v.season;
    const paint = () => {
      const clips = cur === v.season || v.playoffs ? sk.clips[key] : sk.past[cur];
      main.querySelector('#sk-body').innerHTML = winNote + skaterSections({ card, now: v.now, games: sk.games[key], clips: clips ? Object.assign(clips, { shots: sk.clips[key]?.shots }) : clips, tab: sk.tab, all: sk.all, playoffs: v.playoffs, range: card.isWin ? rng : 0, seasons, clipSeason: cur });
      main.querySelector('#sk-last').innerHTML = lastGamesSection(sk.games[key], v.playoffs);
    };
    sk.repaint = paint;
    sk.v = v; sk.key = key; sk.type = type;
    main.innerHTML = `${hero(p)}<div class="gc-bar">${typeToggle(type, 'pc-type-main')}${v.playoffs ? '' : skRange(rng)}</div>${skNav()}<div class="pc-cols" id="sk-body"></div><div class="pc-cols" id="sk-hist">${trend(v.rows, false, v.playoffs)}${seasonsTable(p, v.rows, v)}</div><div id="sk-last" class="pc-cols"></div><div id="pc-last5"></div>`;
    document.querySelectorAll('.pt-scroll').forEach((el) => { el.scrollLeft = el.scrollWidth; });
    paint();
    if (!(key in sk.games)) {
      sk.games[key] = null;
      loadSkaterGames(p, v).then(async (g) => {
        sk.games[key] = g;
        if (getStatsType() === type) paint();
        sk.clips[key] = await loadClips(p, g);
        if (getStatsType() === type) paint();
      }).catch(() => { sk.games[key] = []; sk.clips[key] = []; if (getStatsType() === type) paint(); });
    }
    document.querySelector('#pc-last5').outerHTML = await last5 || '';
  };
  main.addEventListener('click', (e) => {
    const t = e.target.closest('[data-sk-tab]');
    const a = e.target.closest('[data-sk-all]');
    if (!t && !a) return;
    if (t) { sk.tab = t.dataset.skTab; sk.all = false; } else sk.all = a.dataset.skAll === '1';
    sk.repaint?.();
  });
  main.addEventListener('change', async (e) => {
    const sel = e.target.closest('[data-sk-season]');
    if (!sel) return;
    sk.season = Number(sel.value);
    sk.all = false;
    if (sk.season !== sk.v.season && !sk.past[sk.season]) {
      sk.repaint();
      sk.past[sk.season] = await loadSeasonClips(p, sk.season);
    }
    sk.repaint();
  });
  const show = async (type) => {
    views[type] ??= buildView(p, type);
    const v = await views[type];
    if (getStatsType() !== type) return; // toggled again while loading
    if (p.goalie) return showGoalie(type, v);
    const card = v.file && v.ours ? skaterCard(v.file, p.id) : null;
    if (card) return showSkater(type, v, card);
    main.innerHTML = `${hero(p)}${typeToggle(type, 'pc-type-main')}<div class="pc-cols">${thisSeason(p, v.ours, v.pick, v)}${trend(v.rows, p.goalie, v.playoffs)}${seasonsTable(p, v.rows, v)}<div id="pc-last5"></div></div>`;
    // Season bars scroll sideways on narrow screens: start at the newest seasons.
    document.querySelectorAll('.pt-scroll').forEach((el) => { el.scrollLeft = el.scrollWidth; });
    document.querySelector('#pc-last5').outerHTML = await last5 || '';
  };
  main.addEventListener('click', (e) => {
    const b = e.target.closest('[data-stats-type]');
    if (!b || b.getAttribute('aria-pressed') === 'true') return;
    setStatsType(b.dataset.statsType);
    const q = new URLSearchParams(location.search);
    if (getStatsType() === 'playoffs') q.set('type', 'playoffs'); else q.delete('type');
    history.replaceState(null, '', `?${q}`);
    show(getStatsType());
  });
  await show(getStatsType());
}

/** Every start this regular season, from the saved game files (shots, goals and their clips). Empty when there are none. */
async function loadStarts(p, v) {
  if (v.playoffs || !v.file || !v.ours) return [];
  const rate = leagueRate(v.file);
  const lgSv = leagueSavePct(v.file);
  const ids = teamGameIds(v.file, v.ours.row.t).filter((g) => g.starter === p.id);
  const out = [];
  let next = 0;
  const worker = async () => {
    while (next < ids.length) {
      const g = ids[next++];
      const game = await getData(`games/${g.id}.json`).catch(() => null);
      const s = game ? startFromGame(game, p.id, rate, lgSv) : null;
      if (s) out.push(s);
    }
  };
  await Promise.all(Array.from({ length: 6 }, worker));
  return out.sort((a, b) => a.date.localeCompare(b.date) || a.id - b.id);
}

/** Everything the season cards need for the regular season or the playoffs. */
async function buildView(p, type) {
  const gameType = GAME_TYPES[type];
  const playoffs = type === 'playoffs';
  const list = playoffs ? p.playoffs : p.nhl;
  // Our totals for every NHL season (or playoff run) this player has.
  const files = await Promise.all(list.map((r) => (r.season >= FIRST_FULL_SEASON ? loadSeason(r.season, gameType) : null)));
  const rows = list.map((r, i) => {
    const o = ourStats(files[i], p.id);
    // Goalies: save % vs expected needs the NHL's shots against for that season.
    if (o?.gsax != null) o.svVsExp = r.shotsAgainst ? o.gsax / r.shotsAgainst : null;
    return { ...r, built: !!files[i], ours: o };
  });
  if (playoffs) {
    // The card up top shows the latest playoff run (this season's once it starts).
    const latest = rows[0] ?? null;
    const poFile = latest ? await loadSeason(latest.season, gameType) : null;
    return { playoffs, list, rows, season: latest?.season ?? p.currentSeason, now: latest, ours: latest?.ours ?? null, pick: null, career: combineSeasons(p.playoffs, p.goalie), file: poFile };
  }
  const curFile = await loadSeason(p.currentSeason);
  const ours = rows.find((r) => r.season === p.currentSeason)?.ours ?? ourStats(curFile, p.id);
  const pick = p.goalie ? goalieRating(p.id, curFile, await loadSeason(p.currentSeason - 10001)) : null;
  return { playoffs, list, rows, season: p.currentSeason, now: p.now, ours, pick, career: p.career, file: curFile };
}

load().catch((err) => { main.innerHTML = `<p class="msg">Couldn't load this player: ${esc(err.message)}</p>`; });

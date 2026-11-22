// Full player card: profile, this season in depth, SAT and momentum for every season, season-by-season
// table and the last five games. player.html?id=<playerId>
import { loadPlayer, loadSeason, ourStats, fmt, positionName } from './store.js';
import { teamColor, esc } from '../game/core.js';
import { installPlayerLinks } from './link.js';
import { rankBit } from './quick.js';
import { getData } from '../data.js';
import { FIRST_FULL_SEASON } from '../src/seasonStats.js';

const id = new URLSearchParams(location.search).get('id');
const main = document.querySelector('#player');
installPlayerLinks();

const initials = (n) => String(n ?? '?').split(/\s+/).map((w) => w[0]).slice(0, 2).join('').toUpperCase();
const tile = (label, value, sub = '', cls = '') => `<div class="pq-t ${cls}"><span class="pq-v">${value}</span><span class="pq-k">${label}</span>${sub ? `<span class="pq-s">${sub}</span>` : ''}</div>`;

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
  </section>`;
}

function card(title, sub, html, cls = '') {
  return `<section class="pc-card ${cls}"><h2>${title}${sub ? ` <small>${sub}</small>` : ''}</h2>${html}</section>`;
}

function thisSeason(p, ours) {
  const n = p.now;
  if (!n && !ours) return card('This season', fmt.season(p.currentSeason ?? ''), '<p class="pq-note">No games this regular season yet.</p>');
  let tiles;
  if (p.goalie) {
    tiles = [tile('GP', n?.gp ?? 0), tile('W', n?.wins ?? '-'), tile('L', n?.losses ?? '-'), tile('OTL', n?.otLosses ?? '-'), tile('SV%', fmt.sv(n?.savePct), '', 'pq-hl'),
      tile('GAA', fmt.dec(n?.gaa, 2)), tile('SO', n?.shutouts ?? '-'), tile('Shots against', n?.shotsAgainst ?? '-'), tile('TOI/GP', fmt.toi(n?.toiPerGame))];
  } else {
    tiles = [
      tile('GP', n?.gp ?? ours?.gp ?? 0), tile('G', n?.goals ?? '-'), tile('A', n?.assists ?? '-'), tile('P', n?.points ?? '-', '', 'pq-hl'),
      tile('+/-', n ? fmt.signed(n.plusMinus, 0) : '-'), tile('PIM', n?.pim ?? '-'), tile('TOI/GP', fmt.toi(n?.toiPerGame ?? ours?.toiPerGame)),
      tile('Shots', n?.shots ?? '-'), tile('SH%', fmt.pct(n?.shootingPct)), tile('PPP', n?.ppp ?? '-'),
      ...(n?.foPct ? [tile('FO%', fmt.pct(n.foPct))] : []),
    ];
  }
  const ourTiles = p.goalie || !ours ? '' : `
    <h3 class="pc-sub">Our numbers <small>from the play-by-play, ${ours.gp} finished games</small></h3>
    <div class="pq-grid pc-grid">
      ${tile('SAT/GP', fmt.dec(ours.satPerGame), rankBit(ours.satRank), 'pq-ours')}
      ${tile('MOM/GP', fmt.signed(ours.momPerGame, 1), rankBit(ours.momRank), 'pq-ours')}
      ${tile('SAT/60', fmt.dec(ours.satPer60), '', 'pq-ours')}
      ${tile('MOM/60', fmt.signed(ours.momPer60, 1), '', 'pq-ours')}
      ${tile('MOM +/GP', fmt.signed(ours.momPosPerGame, 1), 'created', 'pq-ours')}
      ${tile('MOM −/GP', fmt.signed(ours.momNegPerGame, 1), 'given up', 'pq-ours')}
      ${tile('SAT', ours.row.sat, `${ours.row.sog} on goal`, 'pq-ours')}
      ${tile('MOM', fmt.signed(ours.row.mom, 1), 'season total', 'pq-ours')}
      ${ours.gaa != null ? tile('Goals vs avg', fmt.signed(ours.gaa, 1), rankBit(ours.finRank) || 'vs an average shooter', 'pq-ours') : ''}
      ${ours.shPct != null ? tile('Sh% on a goalie', fmt.pct(ours.shPct), `avg shooter ${fmt.pct(ours.xShPct)} on the same shots`, 'pq-ours') : ''}
    </div>`;
  return card('This season', `${fmt.season(p.currentSeason)} regular season`, `<div class="pq-grid pc-grid">${tiles.join('')}</div>${ourTiles}`);
}

/** Two bar charts, one per number, a bar per season (oldest left). Seasons not built yet are hollow. */
const yr = (s) => `${String(s).slice(2, 4)}-${String(s).slice(6, 8)}`;

function trend(rows) {
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
  return card('SAT and momentum by season', 'per game, regular season',
    `<div class="pt-wrap">${chart('satPerGame', 'SAT per game', false, (v) => v.toFixed(1))}${chart('momPerGame', 'Momentum per game', true, (v) => fmt.signed(v, 1))}</div>
    ${pending ? '<p class="pq-note">Hollow bars are seasons we are still building from the NHL play-by-play (about a dozen seasons a day). They fill in on their own.</p>' : ''}`);
}

function seasonsTable(p, rows) {
  const careerOurs = (() => {
    const have = rows.filter((r) => r.ours);
    const gp = have.reduce((a, r) => a + r.ours.gp, 0);
    if (!gp) return null;
    const xg = have.reduce((a, r) => a + (r.ours.row.xg ?? 0), 0);
    const xgg = have.reduce((a, r) => a + (r.ours.row.xgg ?? 0), 0);
    return { gp, sat: have.reduce((a, r) => a + r.ours.row.sat, 0) / gp, mom: have.reduce((a, r) => a + r.ours.row.mom, 0) / gp, seasons: have.length, gaa: have.some((r) => r.ours.gaa != null) ? have.reduce((a, r) => a + (r.ours.gaa ?? 0), 0) : null, xgg };
  })();
  const ourCells = (r) => {
    if (p.goalie) return '';
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
    ? '<th class="l">Season</th><th class="l">Team</th><th>GP</th><th>W</th><th>L</th><th>OTL</th><th>SV%</th><th>GAA</th><th>SO</th>'
    : '<th class="l">Season</th><th class="l">Team</th><th>GP</th><th>G</th><th>A</th><th>P</th><th>+/-</th><th>PIM</th><th>TOI/GP</th><th class="pc-o" title="Own shot attempts per game (our model)">SAT/GP</th><th class="pc-o" title="Momentum impact per game (our model)">MOM/GP</th><th class="pc-o" title="Goals scored minus what an average NHL shooter would score from the same shots">Goals vs avg</th>';
  const line = (r, label = fmt.season(r.season), team = r.team, ours = ourCells(r)) => (p.goalie
    ? `<td class="l">${label}</td><td class="l">${esc(team)}</td><td>${r.gp}</td><td>${r.wins}</td><td>${r.losses}</td><td>${r.otLosses}</td><td>${fmt.sv(r.savePct)}</td><td>${fmt.dec(r.gaa, 2)}</td><td>${r.shutouts}</td>`
    : `<td class="l">${label}</td><td class="l">${esc(team)}</td><td>${r.gp}</td><td>${r.goals}</td><td>${r.assists}</td><td><b>${r.points}</b></td><td>${fmt.signed(r.plusMinus, 0)}</td><td>${r.pim}</td><td>${fmt.toi(r.toiPerGame)}</td>${ours}`);
  const careerCells = careerOurs ? `<td class="pc-o" title="Across the ${careerOurs.seasons} seasons we have">${fmt.dec(careerOurs.sat)}</td><td class="pc-o">${fmt.signed(careerOurs.mom, 1)}</td><td class="pc-o" title="Added up across the seasons we have">${fmt.signed(careerOurs.gaa, 1)}</td>` : '<td></td><td></td><td></td>';
  const career = p.career ? `<tr class="pc-tot">${line(p.career, 'Career', `${p.nhl.length} season${p.nhl.length === 1 ? '' : 's'}`, careerCells)}</tr>` : '';
  return card('Season by season', 'NHL regular season', `<div class="pc-scroll"><table class="pc-table"><thead><tr>${head}</tr></thead><tbody>${rows.map((r) => `<tr>${line(r)}</tr>`).join('')}${career}</tbody></table></div>
    ${p.goalie ? '' : `<p class="pq-note">SAT/GP, MOM/GP and Goals vs avg are our own numbers, built from every game's play-by-play (2009-10 on). Goals vs avg is how many more (or fewer) goals the player scored than an average NHL shooter would have from the same shots that season; about a third of a hot or cold year carries into the next. Hover a value for the league rank that season.${rows.some((r) => r.ours && !r.ours.complete && r.season !== p.currentSeason) ? ' * = season still being built, numbers so far.' : ''}</p>`}`);
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
    ? '<th class="l">Date</th><th class="l">Opp</th><th>SA</th><th>GA</th><th>SV%</th><th>TOI</th><th>Rating</th>'
    : '<th class="l">Date</th><th class="l">Opp</th><th>G</th><th>A</th><th>P</th><th>SOG</th><th>TOI</th><th class="pc-o">SAT</th><th class="pc-o">MOM</th><th>Rating</th>';
  const rows = p.last5.map((g, i) => {
    const m = mine(games[i]);
    const date = new Date(`${g.date}T12:00:00Z`).toLocaleDateString(undefined, { month: 'short', day: 'numeric', timeZone: 'UTC' });
    const link = `<a href="game.html?id=${g.gameId}">${date}</a>`;
    const opp = `${g.home ? 'vs' : '@'} ${esc(g.opponent)}`;
    const rating = m?.rating != null ? `<span class="pc-rate">${m.rating.toFixed(1)}</span>` : '-';
    return p.goalie
      ? `<tr><td class="l">${link}</td><td class="l">${opp}</td><td>${g.shotsAgainst ?? '-'}</td><td>${g.goalsAgainst ?? '-'}</td><td>${fmt.sv(g.savePct)}</td><td>${esc(g.toi ?? '-')}</td><td>${rating}</td></tr>`
      : `<tr><td class="l">${link}</td><td class="l">${opp}</td><td>${g.goals}</td><td>${g.assists}</td><td><b>${g.points}</b></td><td>${g.shots}</td><td>${esc(g.toi ?? '-')}</td><td class="pc-o">${m?.attempts ?? '-'}</td><td class="pc-o ${(m?.momentum ?? 0) >= 0 ? 'up' : 'down'}">${m ? fmt.signed(m.momentum, 1) : '-'}</td><td>${rating}</td></tr>`;
  });
  return card('Last 5 games', 'tap a date for the box score', `<div class="pc-scroll"><table class="pc-table"><thead><tr>${head}</tr></thead><tbody>${rows.join('')}</tbody></table></div>`);
}

function playoffs(p) {
  if (!p.playoffs.length) return '';
  const head = p.goalie ? '<th class="l">Season</th><th class="l">Team</th><th>GP</th><th>W</th><th>L</th><th>SV%</th><th>GAA</th><th>SO</th>' : '<th class="l">Season</th><th class="l">Team</th><th>GP</th><th>G</th><th>A</th><th>P</th><th>+/-</th><th>PIM</th><th>TOI/GP</th>';
  const rows = p.playoffs.map((r) => (p.goalie
    ? `<tr><td class="l">${fmt.season(r.season)}</td><td class="l">${esc(r.team)}</td><td>${r.gp}</td><td>${r.wins}</td><td>${r.losses}</td><td>${fmt.sv(r.savePct)}</td><td>${fmt.dec(r.gaa, 2)}</td><td>${r.shutouts}</td></tr>`
    : `<tr><td class="l">${fmt.season(r.season)}</td><td class="l">${esc(r.team)}</td><td>${r.gp}</td><td>${r.goals}</td><td>${r.assists}</td><td><b>${r.points}</b></td><td>${fmt.signed(r.plusMinus, 0)}</td><td>${r.pim}</td><td>${fmt.toi(r.toiPerGame)}</td></tr>`)).join('');
  return `<details class="pc-card pc-fold"><summary><h2>Playoffs <small>${p.playoffs.length} season${p.playoffs.length === 1 ? '' : 's'}</small></h2></summary><div class="pc-scroll"><table class="pc-table"><thead><tr>${head}</tr></thead><tbody>${rows}</tbody></table></div></details>`;
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
  // Our season totals for every NHL season this player has.
  const files = await Promise.all(p.nhl.map((r) => (r.season >= FIRST_FULL_SEASON ? loadSeason(r.season) : null)));
  const rows = p.nhl.map((r, i) => ({ ...r, built: !!files[i], ours: ourStats(files[i], p.id) }));
  const ours = rows.find((r) => r.season === p.currentSeason)?.ours ?? ourStats(await loadSeason(p.currentSeason), p.id);
  main.innerHTML = `${hero(p)}<div class="pc-cols">${thisSeason(p, ours)}${p.goalie ? '' : trend(rows)}${seasonsTable(p, rows)}<div id="pc-last5"></div>${playoffs(p)}</div>`;
  // Season bars scroll sideways on narrow screens: start at the newest seasons.
  document.querySelectorAll('.pt-scroll').forEach((el) => { el.scrollLeft = el.scrollWidth; });
  document.querySelector('#pc-last5').outerHTML = await lastFive(p) || '';
}

load().catch((err) => { main.innerHTML = `<p class="msg">Couldn't load this player: ${esc(err.message)}</p>`; });

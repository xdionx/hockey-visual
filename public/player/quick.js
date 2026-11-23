// Quick view: a lightbox with the player's current regular season (or latest playoffs) at a glance.
// GP, G, A, P, PIM, TOI/GP from the NHL; SAT/GP and momentum/GP from our own season totals.
import { loadPlayer, loadSeason, ourStats, currentSeason, fmt, positionName, typeToggle, getStatsType, setStatsType, typeQuery, GAME_TYPES } from './store.js';
import { teamColor, esc } from '../game/core.js';
import { ICONS } from './link.js';

let dialog = null;
let token = 0;

function ensureDialog() {
  if (dialog) return dialog;
  dialog = document.createElement('dialog');
  dialog.className = 'pq';
  dialog.setAttribute('aria-label', 'Player quick view');
  document.body.append(dialog);
  dialog.addEventListener('click', (e) => {
    if (e.target === dialog || e.target.closest('[data-pq-close]')) { dialog.close(); return; }
    const b = e.target.closest('[data-stats-type]');
    if (b && b.getAttribute('aria-pressed') !== 'true' && dialog.dataset.id) {
      setStatsType(b.dataset.statsType);
      openQuickView(dialog.dataset.id);
    }
  });
  return dialog;
}

const mug = (p) => (p?.headshot
  ? `<img class="pq-mug" src="${esc(p.headshot)}" alt="" onerror="this.replaceWith(Object.assign(document.createElement('span'),{className:'pq-mug pq-mug-fb',textContent:this.dataset.i}))" data-i="${esc(initials(p.fullName))}">`
  : `<span class="pq-mug pq-mug-fb">${esc(initials(p?.fullName))}</span>`);
const initials = (n) => String(n ?? '?').split(/\s+/).map((w) => w[0]).slice(0, 2).join('').toUpperCase();

function tile(label, value, sub = '', cls = '') {
  return `<div class="pq-t ${cls}"><span class="pq-v">${value}</span><span class="pq-k">${label}</span>${sub ? `<span class="pq-s">${sub}</span>` : ''}</div>`;
}

/** "12th of 410" plus a small bar showing where that sits (best at the right). */
export function rankBit(r) {
  if (!r) return '';
  const pct = r.of > 1 ? 100 * (1 - (r.rank - 1) / (r.of - 1)) : 100;
  return `${fmt.ord(r.rank)} of ${r.of}<i class="pq-bar"><b style="width:${pct.toFixed(0)}%"></b></i>`;
}

function body(id, p, ours, season, type) {
  const playoffs = type === 'playoffs';
  const name = p?.fullName ?? ours?.row?.n ?? 'Player';
  const team = p?.team ?? ours?.row?.t ?? '';
  const color = teamColor(team);
  const goalie = p ? p.goalie : ours?.row?.p === 'G';
  const now = playoffs ? p?.playoffs?.find((r) => r.season === season) : p?.now;
  const label = playoffs ? (season ? `${fmt.season(season)} playoffs${season === p?.currentSeason ? '' : ' (latest)'}` : 'Playoffs') : `${fmt.season(season)} regular season`;
  const full = `player.html?id=${encodeURIComponent(id)}${typeQuery(type)}`;
  let tiles;
  if (goalie) {
    tiles = [
      tile('GP', now?.gp ?? ours?.gp ?? 0), tile('W', now?.wins ?? '-'), tile('L', now?.losses ?? '-'), ...(playoffs ? [] : [tile('OTL', now?.otLosses ?? '-')]),
      tile('SV%', fmt.sv(now?.savePct)), tile('GAA', fmt.dec(now?.gaa, 2)), tile('SO', now?.shutouts ?? '-'), tile('TOI/GP', fmt.toi(now?.toiPerGame)),
      ...(ours?.gsax != null ? [
        tile('GSAx', fmt.signed(ours.gsax, 1), rankBit(ours.gsaxRank), 'pq-ours'),
        ...(now?.shotsAgainst ? [tile('SV% vs exp', `${fmt.signed((ours.gsax / now.shotsAgainst) * 100, 1)}%`, `expected ${fmt.sv(1 - ours.xgaAvg / now.shotsAgainst)}`, 'pq-ours')] : []),
      ] : []),
    ];
  } else {
    tiles = [
      tile('GP', now?.gp ?? ours?.gp ?? 0), tile('G', now?.goals ?? '-'), tile('A', now?.assists ?? '-'), tile('P', now?.points ?? '-', '', 'pq-hl'),
      tile('PIM', now?.pim ?? '-'), tile('TOI/GP', fmt.toi(now?.toiPerGame ?? ours?.toiPerGame)),
      tile('SAT/GP', fmt.dec(ours?.satPerGame), rankBit(ours?.satRank), 'pq-ours'),
      tile('MOM/GP', fmt.signed(ours?.momPerGame, 1), rankBit(ours?.momRank), 'pq-ours'),
      ...(ours?.abovePct != null ? [tile('Above avg', fmt.pct(ours.abovePct, 0), `below ${fmt.pct(ours.belowPct, 0)}`, 'pq-ours')] : []),
      ...(ours?.gaa != null ? [tile('Goals vs avg', fmt.signed(ours.gaa, 1), rankBit(ours.finRank), 'pq-ours')] : []),
    ];
  }
  const sub = [p?.number != null ? `#${p.number}` : null, positionName(p?.position ?? ours?.row?.p), p?.teamName ?? team].filter(Boolean).join(' · ');
  const span = playoffs ? 'these playoffs' : 'this season';
  const note = playoffs && !now && !ours ? `${esc(name)} hasn't played an NHL playoff game yet.` : goalie ? (ours?.gsax != null ? `GSAx (goals saved above expected) is goals kept out beyond what an average NHL goalie would allow on the same shots, from our own play-by-play model across ${ours.gp} games ${span}. Ranks are among goalies with 5+ starts.` : '') : ours
    ? `SAT, MOM and Goals vs avg (goals scored minus what an average shooter would score from the same shots) come from our own play-by-play model, across ${ours.gp} of ${ours.games} finished games ${span}. Ranks are among skaters with ${ours.minGp}+ games.`
    : `No SAT or momentum yet: this player hasn't played a finished game ${span}.`;
  return `
    <div class="pq-head" style="--team:${color}">
      ${mug(p ?? { fullName: name })}
      <div class="pq-who"><h2>${esc(name)}</h2><span>${esc(sub)}</span></div>
      <a class="pq-icon" href="${full}" target="_blank" rel="noopener" title="Open full player card in a new tab" aria-label="Open full player card in a new tab">${ICONS.pop}</a>
      <button class="pq-icon" type="button" data-pq-close aria-label="Close">&times;</button>
    </div>
    <div class="pq-body">
      ${typeToggle(type, 'pc-type-quick')}
      <div class="pq-label">${esc(label)}</div>
      ${playoffs && !now && !ours ? '' : `<div class="pq-grid">${tiles.join('')}</div>`}
      ${!p ? '<p class="pq-note">NHL season stats couldn\'t load right now.</p>' : ''}
      ${note ? `<p class="pq-note">${note}</p>` : ''}
      <a class="pq-full" href="${full}" target="_blank" rel="noopener">Full player card ${ICONS.pop}</a>
    </div>`;
}

export async function openQuickView(id) {
  const d = ensureDialog();
  const mine = ++token;
  d.innerHTML = `<div class="pq-head"><span class="pq-mug pq-mug-fb"></span><div class="pq-who"><h2>Loading…</h2></div><button class="pq-icon" type="button" data-pq-close aria-label="Close">&times;</button></div><div class="pq-body pq-loading"></div>`;
  if (!d.open) d.showModal();
  d.dataset.id = id;
  const type = getStatsType();
  const p = await loadPlayer(id);
  // Playoffs: this season's once they start, else the player's latest playoff run.
  const season = type === 'playoffs' ? p?.playoffs?.[0]?.season ?? null : p?.currentSeason ?? currentSeason();
  const total = season ? await loadSeason(season, GAME_TYPES[type]) : null;
  if (mine !== token || !d.open) return;
  d.innerHTML = body(id, p, ourStats(total, id), season, type);
}

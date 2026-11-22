// Quick view: a lightbox with the player's current regular season at a glance.
// GP, G, A, P, PIM, TOI/GP from the NHL; SAT/GP and momentum/GP from our own season totals.
import { loadPlayer, loadSeason, ourStats, currentSeason, fmt, positionName } from './store.js';
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
    if (e.target === dialog || e.target.closest('[data-pq-close]')) dialog.close();
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

function body(id, p, ours, season) {
  const name = p?.fullName ?? ours?.row?.n ?? 'Player';
  const team = p?.team ?? ours?.row?.t ?? '';
  const color = teamColor(team);
  const goalie = p ? p.goalie : ours?.row?.p === 'G';
  const now = p?.now;
  const label = `${fmt.season(season)} regular season`;
  let tiles;
  if (goalie) {
    tiles = [
      tile('GP', now?.gp ?? ours?.gp ?? 0), tile('W', now?.wins ?? '-'), tile('L', now?.losses ?? '-'), tile('OTL', now?.otLosses ?? '-'),
      tile('SV%', fmt.sv(now?.savePct)), tile('GAA', fmt.dec(now?.gaa, 2)), tile('SO', now?.shutouts ?? '-'), tile('TOI/GP', fmt.toi(now?.toiPerGame)),
    ];
  } else {
    tiles = [
      tile('GP', now?.gp ?? ours?.gp ?? 0), tile('G', now?.goals ?? '-'), tile('A', now?.assists ?? '-'), tile('P', now?.points ?? '-', '', 'pq-hl'),
      tile('PIM', now?.pim ?? '-'), tile('TOI/GP', fmt.toi(now?.toiPerGame ?? ours?.toiPerGame)),
      tile('SAT/GP', fmt.dec(ours?.satPerGame), rankBit(ours?.satRank), 'pq-ours'),
      tile('MOM/GP', fmt.signed(ours?.momPerGame, 1), rankBit(ours?.momRank), 'pq-ours'),
      ...(ours?.gaa != null ? [tile('Goals vs avg', fmt.signed(ours.gaa, 1), rankBit(ours.finRank), 'pq-ours')] : []),
    ];
  }
  const sub = [p?.number != null ? `#${p.number}` : null, positionName(p?.position ?? ours?.row?.p), p?.teamName ?? team].filter(Boolean).join(' · ');
  const note = goalie ? '' : ours
    ? `SAT, MOM and Goals vs avg (goals scored minus what an average shooter would score from the same shots) come from our own play-by-play model, across ${ours.gp} of ${ours.games} finished games this season. Ranks are among skaters with ${ours.minGp}+ games.`
    : 'No SAT or momentum yet: this player hasn\'t played a finished game this season.';
  return `
    <div class="pq-head" style="--team:${color}">
      ${mug(p ?? { fullName: name })}
      <div class="pq-who"><h2>${esc(name)}</h2><span>${esc(sub)}</span></div>
      <a class="pq-icon" href="player.html?id=${encodeURIComponent(id)}" target="_blank" rel="noopener" title="Open full player card in a new tab" aria-label="Open full player card in a new tab">${ICONS.pop}</a>
      <button class="pq-icon" type="button" data-pq-close aria-label="Close">&times;</button>
    </div>
    <div class="pq-body">
      <div class="pq-label">${esc(label)}</div>
      <div class="pq-grid">${tiles.join('')}</div>
      ${!p ? '<p class="pq-note">NHL season stats couldn\'t load right now.</p>' : ''}
      ${note ? `<p class="pq-note">${note}</p>` : ''}
      <a class="pq-full" href="player.html?id=${encodeURIComponent(id)}" target="_blank" rel="noopener">Full player card ${ICONS.pop}</a>
    </div>`;
}

export async function openQuickView(id) {
  const d = ensureDialog();
  const mine = ++token;
  d.innerHTML = `<div class="pq-head"><span class="pq-mug pq-mug-fb"></span><div class="pq-who"><h2>Loading…</h2></div><button class="pq-icon" type="button" data-pq-close aria-label="Close">&times;</button></div><div class="pq-body pq-loading"></div>`;
  if (!d.open) d.showModal();
  const p = await loadPlayer(id);
  const season = p?.currentSeason ?? currentSeason();
  const total = await loadSeason(season);
  if (mine !== token || !d.open) return;
  d.innerHTML = body(id, p, ourStats(total, id), season);
}

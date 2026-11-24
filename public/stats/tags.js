// Shared pieces of the deficiency views: area tag chips and the goalie inside / outside home plate split.
import { AREA_LABEL } from '../src/areas.js';
import { fmt } from '../player/store.js';

const CLS = { fin: 'a-fin', mom: 'a-play', mn: 'a-disc', below: 'a-low', vol: 'a-vol', disc: 'a-disc', fo: 'a-fo', give: 'a-give', oi: 'a-oi', gsax: 'a-g', out: 'a-g', inn: 'a-g' };

/** Colored chips for the areas a player or goalie is flagged in (one per area, in order). */
export function tagChips(reasons, extra = []) {
  const keys = [...new Set([...reasons.map((r) => r.k), ...extra].filter((k) => AREA_LABEL[k]))];
  return keys.length ? `<div class="dx-tags">${keys.map((k) => `<span class="dx-tag ${CLS[k] ?? ''}">${AREA_LABEL[k]}</span>`).join('')}</div>` : '';
}

/** One zone of the goalie split: goals allowed against an average goalie on the same shots, as a bar from the middle. */
function zone(label, z) {
  if (!z || !z.sa) return '';
  const w = Math.min(1, Math.abs(z.vs) / 8) * 50;
  const cls = z.vs >= 0 ? 'up' : 'down';
  return `<div class="dx-gz"><div class="dx-gz-h"><span>${label}</span><b class="${cls}">${fmt.signed(z.vs, 1)}</b></div>
    <div class="dx-gz-s">${z.ga} goals on ${z.sa} shots · ${fmt.pct(z.sv, 1)} saved <small>(average goalie ${fmt.pct(z.avgSv, 1)})</small></div>
    <span class="td-meter" aria-hidden="true"><b class="${cls}" style="${z.vs >= 0 ? 'left:50%' : `left:${50 - w}%`};width:${w}%"></b></span></div>`;
}

/** Outside / inside the home plate for a goalie's areas (from goalieAreas), or '' when the season file has no split. */
export function goalieZones(areas) {
  if (!areas || (!areas.out.sa && !areas.inn.sa)) return '';
  return `<div class="dx-gzs">${zone('Outside the home plate', areas.out)}${zone('Inside the home plate', areas.inn)}</div>`;
}

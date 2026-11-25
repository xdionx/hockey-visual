// Specific weak spots (and strengths) for skaters, goalies and teams, from the fields added in season version 9:
// shot volume (shots on goal per attempt), penalties, faceoffs, giveaways, and goalies' goals from outside / inside
// the home plate. League-relative, with sample minimums. Pure, works on a season-shaped total (a season file, or
// recentTotal() for a last-N window).
const isD = (p) => p === 'D';
const sum = (rows, k) => rows.reduce((a, r) => a + (r[k] ?? 0), 0);
const pct = (v, d = 0) => `${(v * 100).toFixed(d)}%`;
const fmt1 = (v) => v.toFixed(1);

// Minimums: [season, last-N window].
export const MIN = {
  vol: { F: [60, 25], D: [80, 30] }, // shot attempts
  pen: [15, 5], // games, and 8 / 3 penalties taken
  fo: [150, 40], // faceoffs
  give: [15, 5], // games
  goalieShots: [80, 30], // shots on each side of the plate
  goalieStarts: [3, 2],
};
export const VOL_Z = -2;
export const PEN_NET = [5, 3];
export const FO_Z = -2;
export const GOALIE_Z = -1.5;
export const GOALIE_OUT_COST = [-3, -1.5]; // goals below an average goalie on that zone

/** League baselines every player is compared with. `win` = a last-N window (looser minimums, tighter limits). */
export function areaBase(total, { win = false } = {}) {
  const sk = Object.values(total?.players ?? {}).filter((p) => p.p !== 'G' && p.pen != null);
  const gk = Object.values(total?.players ?? {}).filter((p) => p.p === 'G' && p.psa != null);
  const byPos = (f) => sk.filter(f);
  const vol = (rows) => (sum(rows, 'sat') ? sum(rows, 'sog') / sum(rows, 'sat') : null);
  const centers = byPos((p) => p.p === 'C');
  const fo = sum(centers, 'fw') + sum(centers, 'fl');
  return {
    win: win ? 1 : 0,
    has: sk.length > 0,
    volF: vol(byPos((p) => p.p !== 'D')),
    volD: vol(byPos((p) => p.p === 'D')),
    fo: fo ? sum(centers, 'fw') / fo : null,
    outRate: sum(gk, 'osa') ? sum(gk, 'oga') / sum(gk, 'osa') : null, // goals per shot outside the plate
    inRate: sum(gk, 'psa') ? sum(gk, 'pga') / sum(gk, 'psa') : null,
    giveF: sum(byPos((p) => p.p !== 'D'), 'gv') / Math.max(1, sum(byPos((p) => p.p !== 'D'), 'gp')),
    giveD: sum(byPos((p) => isD(p.p)), 'gv') / Math.max(1, sum(byPos((p) => isD(p.p)), 'gp')),
  };
}

/** Numbers for one skater row against the baseline (nulls where the sample is too small). */
export function skaterAreas(row, base) {
  const w = base.win;
  const k = isD(row.p) ? 'D' : 'F';
  const rate = k === 'D' ? base.volD : base.volF;
  const out = { vol: null, pen: null, fo: null, give: null };
  if (row.pen == null || !base.has) return out;
  if (rate != null && (row.sat ?? 0) >= MIN.vol[k][w]) {
    const exp = row.sat * rate;
    out.vol = { share: row.sog / row.sat, base: rate, lost: exp - row.sog, z: (row.sog - exp) / Math.sqrt(row.sat * rate * (1 - rate)), sat: row.sat };
  }
  if (row.gp >= MIN.pen[w]) out.pen = { taken: row.pen, drawn: row.pd ?? 0, net: row.pen - (row.pd ?? 0), pim: row.pim ?? 0, perGame: (row.pd - row.pen) / row.gp };
  const fo = (row.fw ?? 0) + (row.fl ?? 0);
  if (row.p === 'C' && base.fo != null && fo >= MIN.fo[w]) out.fo = { pct: row.fw / fo, base: base.fo, n: fo, lost: fo * base.fo - row.fw, z: (row.fw - fo * base.fo) / Math.sqrt(fo * base.fo * (1 - base.fo)) };
  if (row.gp >= MIN.give[w]) out.give = { perGame: row.gv / row.gp, takePerGame: row.tk / row.gp, base: k === 'D' ? base.giveD : base.giveF };
  return out;
}

/** Plain-language flags for a skater: [{ k, label, text, soft }]. Only the real problems; giveaways are context. */
export function skaterFlags(row, base) {
  const a = skaterAreas(row, base);
  const w = base.win;
  const kind = isD(row.p) ? 'defenseman' : 'forward';
  const out = [];
  if (a.vol && a.vol.z <= VOL_Z) {
    out.push({ k: 'vol', label: 'Shot volume', z: a.vol.z, text: `Only ${pct(a.vol.share)} of ${a.vol.sat} shot attempts reach the net (typical ${kind}: ${pct(a.vol.base)}): about ${Math.round(a.vol.lost)} fewer shots on goal than a typical ${kind} gets from the same attempts, too many blocked or missed.` });
  }
  if (a.pen && a.pen.taken >= (w ? 3 : 8) && a.pen.net >= PEN_NET[w]) {
    out.push({ k: 'disc', label: 'Penalties', z: -a.pen.net, text: `Takes penalties: ${a.pen.taken} taken and ${a.pen.drawn} drawn in ${row.gp} games (${a.pen.net} more taken than drawn, ${a.pen.pim} PIM). Each net minor gives the other team about 0.2 goals on the power play.` });
  }
  if (a.fo && a.fo.z <= FO_Z) {
    out.push({ k: 'fo', label: 'Faceoffs', z: a.fo.z, text: `Wins ${pct(a.fo.pct)} of ${a.fo.n} faceoffs (league centers: ${pct(a.fo.base)}), about ${Math.round(a.fo.lost)} fewer won than average.` });
  }
  if (a.give && a.give.base && a.give.perGame >= 1.4 * a.give.base && a.give.takePerGame <= 0.25 * a.give.perGame) {
    out.push({ k: 'give', label: 'Giveaways', soft: true, text: `Gives it away ${a.give.perGame.toFixed(1)} a game against ${a.give.takePerGame.toFixed(1)} takeaways (typical: ${a.give.base.toFixed(1)}). Context only: rinks count giveaways differently and heavy puck carriers give away more.` });
  }
  return out;
}

/** A goalie's goals allowed outside / inside the home plate against an average goalie on the same shots. */
export function goalieAreas(row, base) {
  if (row.psa == null || base.outRate == null) return null;
  const w = base.win;
  const zone = (sa, ga, rate) => {
    const exp = sa * rate;
    return { sa, ga, exp, vs: exp - ga, sv: sa ? 1 - ga / sa : null, avgSv: 1 - rate, z: sa >= MIN.goalieShots[w] ? (exp - ga) / Math.sqrt(Math.max(0.01, sa * rate * (1 - rate))) : null, ok: sa >= MIN.goalieShots[w] };
  };
  return { out: zone(row.osa ?? 0, row.oga ?? 0, base.outRate), inn: zone(row.psa ?? 0, row.pga ?? 0, base.inRate), soft: row.sf ?? 0, gs: row.gs ?? 0 };
}

/** Flags for a goalie: perimeter goals outside the plate, struggling inside it. */
export function goalieFlags(row, base) {
  const a = goalieAreas(row, base);
  const w = base.win;
  if (!a || (row.gs ?? 0) < MIN.goalieStarts[w]) return [];
  const out = [];
  if (a.out.ok && a.out.vs <= GOALIE_OUT_COST[w] && a.out.z <= GOALIE_Z) {
    out.push({ k: 'out', label: 'Perimeter goals', z: a.out.z, text: `Outside the home plate: ${a.out.ga} goals on ${a.out.sa} shots (${pct(a.out.sv, 1)} saved; average goalie ${pct(a.out.avgSv, 1)}), ${fmt1(-a.out.vs)} more than an average goalie would allow. ${a.soft} of his goals came from outside the plate on shots worth under 6%, goals he is not supposed to allow.` });
  }
  if (a.inn.ok && a.inn.vs <= GOALIE_OUT_COST[w] && a.inn.z <= GOALIE_Z) {
    out.push({ k: 'inn', label: 'Struggles inside the plate', z: a.inn.z, text: `Inside the home plate: ${a.inn.ga} goals on ${a.inn.sa} shots (${pct(a.inn.sv, 1)} saved; average goalie ${pct(a.inn.avgSv, 1)}), ${fmt1(-a.inn.vs)} more than an average goalie would allow.` });
  }
  return out;
}

export const AREA_LABEL = { fin: 'Finishing', mom: 'Driving play', mn: 'Giving it away', below: 'Low impact', vol: 'Shot volume', disc: 'Penalties', fo: 'Faceoffs', give: 'Giveaways', oi: 'On-ice', gsax: 'Goaltending', out: 'Perimeter goals', inn: 'Struggles inside the plate' };

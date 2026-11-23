// Pre-game prediction from our model (the v5 work in scripts/goalie-lab/, fit on 2021-24 and checked on
// 2024-27): each team's season-to-date momentum share (v4, goals counted as shots), its probable starting
// goalie's goals saved above expected, and whether it played yesterday. Pure; no fetching.
//
//   predictGame({ total, prev, away: 'TOR', home: 'MTL', n: 312, b2b: { away: false, home: true } })
//   -> { away: 0.57, home: 0.43, gap: 0.31, parts: {...} } or null when it's too early to say.
import { gameObj } from './seasonStats.js';

// Expected goal gap (away minus home) = 18.257 x share gap + 1.467 x goalie gap - 0.472 x back-to-back gap - 0.152,
// then a win chance from a logistic fit on the same games (a = -0.011, b = 0.665).
export const W = { share: 18.257, goalie: 1.467, b2b: -0.472, home: -0.152 };
export const LOGIT = { a: -0.011, b: 0.665 };
const GOALIE_SHRINK = 40; // expected goals of average goaltending added to every goalie's record
export const MIN_GAMES = 5;

/** Season-to-date momentum share (goals left out) per team, from game rows before game number n. */
function shares(rows) {
  const t = new Map();
  const get = (k) => t.get(k) ?? (t.set(k, { gp: 0, f: 0, a: 0, starts: [] }), t.get(k));
  for (const g of rows) {
    if (g.an == null || g.hn == null) continue;
    const A = get(g.away);
    const H = get(g.home);
    A.gp++; A.f += g.an; A.a += g.hn; if (g.ags) A.starts.push(g.ags);
    H.gp++; H.f += g.hn; H.a += g.an; if (g.hgs) H.starts.push(g.hgs);
  }
  return t;
}

/** The goalie who started most of a team's last 5 games (ties: the most recent). */
export function probableStarter(starts) {
  const last = starts.slice(-5);
  let best = null;
  let most = 0;
  for (let i = last.length - 1; i >= 0; i--) {
    const c = last.filter((x) => x === last[i]).length;
    if (c > most) { best = last[i]; most = c; }
  }
  return best;
}

/** Goals saved above expected per expected goal (shrunk), over this season and last. Scaled to real goal totals. */
export function goalieRating(id, total, prev) {
  if (!id) return { id: null, value: 0 };
  const league = (tot) => Object.values(tot?.players ?? {}).filter((p) => p.p === 'G' && p.xga != null).reduce((a, p) => [a[0] + p.ga, a[1] + p.xga], [0, 0]);
  const [lg, lx] = [league(total), league(prev)].reduce((a, b) => [a[0] + b[0], a[1] + b[1]], [0, 0]);
  const scale = lx > 100 ? lg / lx : 1.1;
  let ga = 0;
  let xga = 0;
  let name = null;
  for (const tot of [total, prev]) {
    const p = tot?.players?.[String(id)];
    if (!p || p.xga == null) continue;
    ga += p.ga ?? 0; xga += p.xga * scale; name ??= p.n;
  }
  return { id, name: name ?? total?.players?.[String(id)]?.n ?? null, gsax: xga - ga, value: (xga - ga) / (xga + GOALIE_SHRINK) };
}

export function predictGame({ total, prev = null, away, home, n = Infinity, b2b = {} }) {
  const rows = (total?.g ?? []).map(gameObj).filter((g) => g.n < n);
  const t = shares(rows);
  const A = t.get(away);
  const H = t.get(home);
  if (!A || !H || A.gp < MIN_GAMES || H.gp < MIN_GAMES) return null;
  const share = (x) => x.f / (x.f + x.a);
  const ga = goalieRating(probableStarter(A.starts), total, prev);
  const gh = goalieRating(probableStarter(H.starts), total, prev);
  const bb = (b2b.away ? 1 : 0) - (b2b.home ? 1 : 0);
  const gap = W.share * (share(A) - share(H)) + W.goalie * (ga.value - gh.value) + W.b2b * bb + W.home;
  const pAway = 1 / (1 + Math.exp(-(LOGIT.a + LOGIT.b * gap)));
  return {
    away: pAway,
    home: 1 - pAway,
    gap,
    parts: {
      share: { away: share(A), home: share(H), gp: { away: A.gp, home: H.gp } },
      goalie: { away: ga, home: gh },
      b2b: { away: !!b2b.away, home: !!b2b.home },
    },
  };
}

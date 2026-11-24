// Margins and the puck line: turns our expected goal gap and the books' prices into the same terms so the
// two can sit side by side. Pure functions; no fetching.
//
// Terms: gap = expected goals, away minus home. A "side" is 'away' or 'home'. The puck line is the NHL's
// spread: the favorite lays 1.5 goals (must win by 2+), the underdog gets 1.5 (must lose by 1 or not at all,
// where a shootout goal counts as the one-goal margin).
import { LOGIT } from './predict.js';
import { impliedProb, noVigAway, BOOK_NAMES } from './odds.js';

export const LEAGUE_TOTAL = 6.4; // goals per game, used when a game has no book total
// Goal counts are modelled as two Poisson counts (a Skellam margin). Empty-net goals stretch real margins
// (this season 58.6% of games are decided by 2+ goals; plain Poisson at 6.4 goals gives 54.3%), so the total is
// widened by this factor, which matches that rate.
export const SPREAD_WIDEN = 1.25;

const pois = (m, k) => {
  let p = Math.exp(-m);
  for (let i = 1; i <= k; i++) p *= m / i;
  return p;
};

/** Chance a team with expected margin `gap` (its goals minus the other's) wins by at least k goals, given the game total. */
export function winByAtLeast(gap, total = LEAGUE_TOTAL, k = 2) {
  const t = Math.max(1, total) * SPREAD_WIDEN;
  const g = Math.max(-t + 0.6, Math.min(t - 0.6, gap));
  const mu = (t + g) / 2;
  const mv = (t - g) / 2;
  const pv = Array.from({ length: 26 }, (_, j) => pois(mv, j));
  let p = 0;
  for (let i = 0; i < 26; i++) {
    const pi = pois(mu, i);
    for (let j = 0; j < 26; j++) if (i - j >= k) p += pi * pv[j];
  }
  return p;
}

/** The expected goal gap (away minus home) behind a saved pick: its own gap, or the one that gives its win chance. */
export function gapOf(pick) {
  if (!pick) return null;
  if (pick.gap != null) return pick.gap;
  const p = Math.min(0.999, Math.max(0.001, pick.a));
  return (Math.log(p / (1 - p)) - LOGIT.a) / LOGIT.b;
}
/** Expected goal gap that the books' win chance (margin removed) implies, through our own win-chance curve. */
export function impliedGap(pAway) {
  if (pAway == null) return null;
  const p = Math.min(0.999, Math.max(0.001, pAway));
  return (Math.log(p / (1 - p)) - LOGIT.a) / LOGIT.b;
}

/** One book's puck line with its margin removed: { fav: side, favCover, favPrice, dogPrice } or null. */
export function puckLine(b) {
  const pl = b?.pl;
  if (!pl || pl.a == null || pl.h == null || !pl.line) return null;
  const pa = impliedProb(pl.a);
  const ph = impliedProb(pl.h);
  if (pa == null || ph == null) return null;
  const fav = pl.line < 0 ? 'home' : 'away';
  const homeCover = ph / (pa + ph);
  return { fav, favCover: fav === 'home' ? homeCover : 1 - homeCover, favPrice: fav === 'home' ? pl.h : pl.a, dogPrice: fav === 'home' ? pl.a : pl.h };
}

/** Profit on a 1-unit stake at American odds, if it wins. */
export const payout = (american) => (american > 0 ? american / 100 : 100 / -american);

/** The book we show first: DraftKings, else FanDuel. */
export const mainBook = (books) => (books?.dk ? 'dk' : books?.fd ? 'fd' : null);

/**
 * Book line against our pick for one game: { book, name, fav, ml, pFav, line, total, ourFav, agree, ours: {pFav, gapFav,
 * cover}, market: {gapFav, cover} } where *Fav numbers are for the team the book makes the moneyline favorite, or null with no lines.
 */
export function lineView(books, pick) {
  const k = mainBook(books);
  if (!k || !pick) return null;
  const b = books[k];
  const pAway = noVigAway(b.a, b.h);
  if (pAway == null) return null;
  const fav = pAway >= 0.5 ? 'away' : 'home';
  const sign = fav === 'away' ? 1 : -1;
  const total = b.tl?.line ?? null;
  const gap = gapOf(pick);
  const ourFav = pick.a >= 0.5 ? 'away' : 'home';
  const pl = puckLine(b);
  // Cover chance for the side that lays 1.5 (the puck-line favorite, which is usually the moneyline favorite).
  const layer = pl?.fav ?? fav;
  const layerSign = layer === 'away' ? 1 : -1;
  return {
    book: k, name: BOOK_NAMES[k], fav, ml: { a: b.a, h: b.h }, pFav: fav === 'away' ? pAway : 1 - pAway,
    pl, total, tl: b.tl ?? null,
    ourFav, agree: ourFav === fav,
    ours: { pFav: fav === 'away' ? pick.a : 1 - pick.a, gapFav: sign * gap, layer, cover: winByAtLeast(layerSign * gap, total ?? LEAGUE_TOTAL, 2) },
    market: { gapFav: sign * impliedGap(pAway), cover: pl?.favCover ?? null },
  };
}

export const COVER_EDGE = 0.05; // we "take a side" of the puck line when our cover chance differs from the book's by 5+ points

/**
 * How our picks did against the puck line, from finished games with a margin. Everything is judged on each game's
 * closing lines (the last snapshot before puck drop) from the main book. Returns counts plus:
 *  - cover: Brier score of our and the book's chance that the 1.5-goal favorite covers (lower is better), and how
 *    often favorites really covered against what the book's prices expected;
 *  - picked: how often the team we pick covered its own puck line, against what the lines expected for that team;
 *  - bets: the games where we differ from the book by COVER_EDGE+, settled at the book's price (1 unit each);
 *  - margin: average miss in goals of our expected margin and of the margin the book's moneyline implies.
 */
export function spreadReport(odds) {
  const rows = Object.entries(odds?.games ?? {}).map(([id, g]) => ({ id, ...g })).filter((g) => g.result && g.margin != null && g.pick && mainBook(g.books));
  const views = rows.map((g) => ({ g, v: lineView(g.books, g.pick), b: g.books[mainBook(g.books)] })).filter((x) => x.v);
  const withPl = views.filter((x) => x.v.pl && x.v.market.cover != null);
  const mean = (xs) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);

  // 1. Puck-line favorite covers: calibration of both sources.
  const covers = withPl.map(({ g, v }) => {
    const sign = v.pl.fav === 'away' ? 1 : -1;
    const hit = sign * g.margin >= 2;
    return { hit, us: v.ours.cover, mk: v.market.cover };
  });
  const brier = (key) => mean(covers.map((c) => (c[key] - (c.hit ? 1 : 0)) ** 2));

  // 2. The team we pick, against the puck line the book gave that team.
  const picked = withPl.map(({ g, v }) => {
    const side = g.pick.a >= 0.5 ? 'away' : 'home';
    const sign = side === 'away' ? 1 : -1;
    const lays = v.pl.fav === side;
    const covered = lays ? sign * g.margin >= 2 : sign * g.margin >= -1;
    const expected = lays ? v.market.cover : 1 - v.market.cover;
    return { covered, expected, lays };
  });

  // 3. Bets: where we and the book differ on the favorite covering.
  const bets = withPl.filter(({ v }) => Math.abs(v.ours.cover - v.market.cover) >= COVER_EDGE).map(({ g, v }) => {
    const takeFav = v.ours.cover > v.market.cover;
    const sign = v.pl.fav === 'away' ? 1 : -1;
    const favCovered = sign * g.margin >= 2;
    const won = takeFav === favCovered;
    const price = takeFav ? v.pl.favPrice : v.pl.dogPrice;
    return { won, units: won ? payout(price) : -1, takeFav };
  });

  // 4. Margin miss: ours against the book's implied margin, on every finished game with a pick and a moneyline.
  const miss = (f) => mean(views.map((x) => Math.abs(f(x) - x.g.margin)));
  return {
    games: views.length,
    withPl: withPl.length,
    cover: withPl.length ? { n: covers.length, actual: mean(covers.map((c) => (c.hit ? 1 : 0))), bookExpected: mean(covers.map((c) => c.mk)), ourExpected: mean(covers.map((c) => c.us)), brierUs: brier('us'), brierBook: brier('mk') } : null,
    picked: picked.length ? { n: picked.length, covered: picked.filter((p) => p.covered).length, expected: mean(picked.map((p) => p.expected)) * picked.length } : null,
    bets: { n: bets.length, won: bets.filter((b) => b.won).length, units: bets.reduce((a, b) => a + b.units, 0) },
    margin: views.length ? { n: views.length, us: miss((x) => x.g.pick ? gapOf(x.g.pick) : 0), book: miss((x) => impliedGap(noVigAway(x.b.a, x.b.h))), zero: mean(views.map((x) => Math.abs(x.g.margin))) } : null,
  };
}

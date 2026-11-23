// Sportsbook odds from the NHL's own partner feed (api-web.nhle.com/v1/partner-game/<country>/now): one
// book per country (DraftKings for the US, FanDuel for Canada), today's games only, so we save a snapshot
// shortly before each puck drop and compare it with our own pre-game pick later. Pure functions.
//
// data/odds.json: { updated, games: { <gameId>: { date, start, away, home, books: { dk: { a, h, t }, fd: {...} },
//   pick: { a, gap, t }, result: 'away' | 'home' | null, margin, goals } } } where a/h are American moneylines
//   (regulation + OT/SO, "MONEY_LINE_2_WAY"), a in pick is our away win chance and gap our expected goal gap
//   (away minus home). Since Nov 23 each book also has pl (puck line: line = the home team's, e.g. -1.5, with a/h
//   the away/home prices) and tl (total: line, o/u prices). margin and goals are the final away-minus-home
//   goals and total goals, saved with the result.

export const BOOKS = { DraftKings: 'dk', FanDuel: 'fd' };
export const BOOK_NAMES = { dk: 'DraftKings', fd: 'FanDuel' };

/** American odds to the win chance they imply, vig included: -150 -> .600, +130 -> .435. */
export function impliedProb(american) {
  const n = Number(american);
  if (!Number.isFinite(n) || n === 0) return null;
  return n < 0 ? -n / (-n + 100) : 100 / (n + 100);
}

/** Away win chance with the book's margin taken out (the two implied chances are scaled to sum to 1). */
export function noVigAway(a, h) {
  const pa = impliedProb(a);
  const ph = impliedProb(h);
  return pa == null || ph == null ? null : pa / (pa + ph);
}

/** One partner response -> [{ gameId, start, book, a, h }] using the two-way moneyline. */
export function parsePartner(raw) {
  const book = BOOKS[raw?.bettingPartner?.name];
  if (!book) return [];
  const find = (team, d) => team?.odds?.find((o) => o.description === d);
  const ml = (team) => find(team, 'MONEY_LINE_2_WAY')?.value;
  return (raw.games ?? []).filter((g) => g.gameType === 2).map((g) => {
    const out = { gameId: g.gameId, start: g.startTimeUTC, book, a: ml(g.awayTeam), h: ml(g.homeTeam) };
    // Puck line: the home team's line (-1.5 when it is the favorite) with each side's price.
    const ph = find(g.homeTeam, 'PUCK_LINE');
    const pa = find(g.awayTeam, 'PUCK_LINE');
    const line = Number(ph?.qualifier);
    if (ph && pa && Number.isFinite(line) && Math.abs(line) === 1.5) out.pl = { line, a: pa.value, h: ph.value };
    // Total: the over is priced on the home team's entry, the under on the away team's ("O6.5" / "U6.5").
    const over = find(g.homeTeam, 'OVER_UNDER');
    const under = find(g.awayTeam, 'OVER_UNDER');
    const tl = Number(String(over?.qualifier ?? '').replace(/^O/, ''));
    if (over && under && Number.isFinite(tl) && tl > 0) out.tl = { line: tl, o: over.value, u: under.value };
    return out;
  }).filter((g) => g.a != null && g.h != null);
}

/**
 * Folds fresh snapshots into the saved odds. A game's lines and pick keep updating until puck drop and
 * freeze at the last snapshot before it (the closing line). `picks` is Map(gameId -> away win chance, or { away, gap }).
 */
export function mergeOdds(saved, snapshots, picks, nowMs, dateOf = {}) {
  const games = { ...(saved?.games ?? {}) };
  for (const s of snapshots) {
    if (Date.parse(s.start) <= nowMs) continue; // started: keep the closing line already saved
    const g = games[s.gameId] ?? (games[s.gameId] = { date: dateOf[s.gameId] ?? s.start.slice(0, 10), start: s.start, books: {}, pick: null, result: null });
    g.books[s.book] = { a: s.a, h: s.h, ...(s.pl ? { pl: s.pl } : {}), ...(s.tl ? { tl: s.tl } : {}), t: new Date(nowMs).toISOString() };
  }
  for (const [id, p] of picks) {
    const g = games[id];
    const a = typeof p === 'number' ? p : p.away;
    if (g && Date.parse(g.start) > nowMs) g.pick = { a: Math.round(a * 1000) / 1000, ...(typeof p === 'object' && p.gap != null ? { gap: Math.round(p.gap * 100) / 100 } : {}), t: new Date(nowMs).toISOString() };
  }
  return { updated: new Date(nowMs).toISOString(), games };
}

/** Rows to judge: games with a result, our saved pick and at least one book. */
export function comparable(odds) {
  return Object.entries(odds?.games ?? {}).filter(([, g]) => g.result && g.pick && Object.keys(g.books).length).map(([id, g]) => ({ id, ...g }));
}

const winProb = (p, result) => (result === 'away' ? p : 1 - p);
/** Accuracy, Brier score and log loss (lower is better for the last two) for a list of away win chances. */
export function score(rows, pAway) {
  let n = 0;
  let right = 0;
  let brier = 0;
  let loss = 0;
  for (const r of rows) {
    const p = pAway(r);
    if (p == null) continue;
    n++;
    const y = r.result === 'away' ? 1 : 0;
    if ((p > 0.5) === (y === 1) && p !== 0.5) right++;
    brier += (p - y) ** 2;
    loss -= Math.log(Math.min(0.999, Math.max(0.001, winProb(p, r.result))));
  }
  return n ? { n, accuracy: right / n, brier: brier / n, logLoss: loss / n } : null;
}

/** Per-source away win chances for one row: ours, each book without its margin, and the books' average. */
export function sources(r) {
  const out = { us: r.pick.a };
  const books = [];
  for (const [k, b] of Object.entries(r.books)) {
    const p = noVigAway(b.a, b.h);
    if (p != null) { out[k] = p; books.push(p); }
  }
  if (books.length) out.market = books.reduce((x, y) => x + y, 0) / books.length;
  return out;
}

export const EDGE_MIN = 0.07; // flag a game when our pick and the books differ by 7+ points

/** Books' average away win chance (margin removed), or null with no lines. */
export function marketAway(books) {
  const ps = Object.values(books ?? {}).map((b) => noVigAway(b.a, b.h)).filter((p) => p != null);
  return ps.length ? ps.reduce((x, y) => x + y, 0) / ps.length : null;
}

/** Where we like a side more than the market does: { side, pts, ours, market } (chances for that side), or null. */
export function edge(pickAway, books, min = EDGE_MIN) {
  const m = marketAway(books);
  if (pickAway == null || m == null || Math.abs(pickAway - m) < min) return null;
  const side = pickAway > m ? 'away' : 'home';
  const ours = side === 'away' ? pickAway : 1 - pickAway;
  const market = side === 'away' ? m : 1 - m;
  return { side, pts: Math.round((ours - market) * 100), ours, market };
}

/** Everything the comparison card shows: scores per source, on the games every source covers. */
export function compare(odds) {
  const rows = comparable(odds).filter((r) => r.books.dk && r.books.fd);
  const all = comparable(odds);
  const by = (rs, key) => score(rs, (r) => sources(r)[key]);
  return {
    games: all.length,
    both: rows.length,
    us: by(all, 'us'), dk: by(all.filter((r) => r.books.dk), 'dk'), fd: by(all.filter((r) => r.books.fd), 'fd'),
    // Same games for everyone, so the scores are directly comparable.
    same: rows.length ? { us: by(rows, 'us'), dk: by(rows, 'dk'), fd: by(rows, 'fd'), market: by(rows, 'market') } : null,
    // The flagged games: how often the side we liked more won, against the side the market liked more.
    flagged: (() => {
      const f = all.map((r) => ({ r, e: edge(r.pick.a, r.books) })).filter((x) => x.e);
      const ours = f.filter((x) => x.r.result === x.e.side).length;
      return { n: f.length, ours, market: f.length - ours };
    })(),
    // Games where we and the market disagree most, with how they ended.
    gaps: all.filter((r) => sources(r).market != null).map((r) => ({ ...r, s: sources(r) }))
      .sort((x, y) => Math.abs(y.s.us - y.s.market) - Math.abs(x.s.us - x.s.market)).slice(0, 8),
  };
}

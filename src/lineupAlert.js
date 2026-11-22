// Lineup alert: a team's top skaters (by momentum per game, this season and last) who are not dressed.
// The pick itself doesn't change: the lineup model only beat it within noise (scripts/impact-lab, v6 test).
// But teams missing one of their top 3 won about 5 points less often than the pick said, and about
// 4 to 15 points less with two out (2024-27 held out), so the card flags it. Pure; no fetching.
//
// The final lineup is set 5 to 10 minutes before puck drop (away first, then home); the NHL's
// right-rail scratches fill in then. Players on injured reserve aren't on that list.

export const TOP_N = 3;
export const PTS_PER_PLAYER = 5; // win chance points, from the lab
const SHRINK = 20; // games of average (zero) momentum added to every player's record
const MIN_GP = 5;

/** A team's top skaters by shrunk momentum per game: [{ id, name, rank }]. */
export function topPlayers(total, prev, team, n = TOP_N) {
  const out = [];
  for (const [id, p] of Object.entries(total?.players ?? {})) {
    if (p.t !== team || p.p === 'G' || (p.gp ?? 0) < MIN_GP) continue;
    const q = prev?.players?.[id];
    const gp = p.gp + (q && q.p !== 'G' ? q.gp ?? 0 : 0);
    const mom = (p.mom ?? 0) + (q && q.p !== 'G' ? q.mom ?? 0 : 0);
    out.push({ id: Number(id), name: p.n, rate: mom / (gp + SHRINK) });
  }
  return out.sort((a, b) => b.rate - a.rate).slice(0, n).map((x, i) => ({ id: x.id, name: x.name, rank: i + 1 }));
}

const norm = (s) => String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z]/g, '');

/** Which of the top players are scratched (scratches are names, scratchIds ids when the feed has them). */
export function missingTop(top, scratches = [], scratchIds = []) {
  const names = new Set(scratches.map(norm));
  const ids = new Set(scratchIds.map(Number));
  return top.filter((p) => ids.has(p.id) || names.has(norm(p.name)));
}

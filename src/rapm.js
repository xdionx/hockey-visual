// Adjusted defense (RAPM style): a ridge regression over 5v5 stints that gives each skater the shot attempts per 60 the
// other team takes while he is on the ice, after accounting for who else is on the ice (teammates and opponents).
// Lower is better. Pure; the update script feeds it every saved stint of the season.
export const ALPHA = 3e4;
export const MIN_SECONDS = 6000; // 100 minutes of 5v5 before a player gets a number

/** rows: stints from stintRows (all games, concatenated). Returns { gpa, players: { id: { d, h } } } (d = attempts against per 60, relative to the average skater; h = 5v5 hours). */
export function fitDefense(rows, goalsPerAttempt = 0.0627, alpha = ALPHA) {
  const ids = [...new Set(rows.flatMap((r) => [...r[1], ...r[2]]))].sort((a, b) => a - b);
  const P = ids.length, n = 2 * P + 1;
  if (!P) return { gpa: goalsPerAttempt, players: {} };
  const idx = new Map(ids.map((id, i) => [id, i]));
  const A = new Float64Array(n * n);
  const b = new Float64Array(n);
  const secs = new Float64Array(P);
  let ySum = 0, wSum = 0;
  for (const r of rows) {
    for (const id of r[1]) secs[idx.get(id)] += r[0];
    for (const id of r[2]) secs[idx.get(id)] += r[0];
    ySum += (r[3] + r[4]) * 3600; wSum += 2 * r[0];
  }
  const ybar = ySum / wSum;
  const cols = new Int32Array(11);
  for (const r of rows) {
    const w = r[0];
    for (const [atk, dfn, val, home] of [[r[1], r[2], r[3], 1], [r[2], r[1], r[4], 0]]) {
      let c = 0;
      for (const id of atk) cols[c++] = idx.get(id);
      for (const id of dfn) cols[c++] = P + idx.get(id);
      if (home) cols[c++] = 2 * P;
      const y = (val * 3600) / w - ybar;
      for (let i = 0; i < c; i++) {
        b[cols[i]] += w * y;
        for (let j = 0; j < c; j++) A[cols[i] * n + cols[j]] += w;
      }
    }
  }
  for (let i = 0; i < 2 * P; i++) A[i * n + i] += alpha;
  const beta = cholSolve(A, b, n);
  const players = {};
  let tot = 0, mean = 0;
  for (let i = 0; i < P; i++) { tot += secs[i]; mean += beta[P + i] * secs[i]; }
  mean /= tot;
  for (let i = 0; i < P; i++) if (secs[i] >= MIN_SECONDS) players[ids[i]] = { d: Math.round((beta[P + i] - mean) * 1000) / 1000, h: Math.round((secs[i] / 3600) * 100) / 100 };
  return { gpa: goalsPerAttempt, players };
}

/** Solves A x = b for a symmetric positive definite A (n x n, row-major), in place. */
function cholSolve(A, b, n) {
  for (let j = 0; j < n; j++) {
    let d = A[j * n + j];
    for (let k = 0; k < j; k++) d -= A[j * n + k] * A[j * n + k];
    const l = Math.sqrt(d);
    A[j * n + j] = l;
    for (let i = j + 1; i < n; i++) {
      let s = A[i * n + j];
      for (let k = 0; k < j; k++) s -= A[i * n + k] * A[j * n + k];
      A[i * n + j] = s / l;
    }
  }
  const y = new Float64Array(n);
  for (let i = 0; i < n; i++) { let s = b[i]; for (let k = 0; k < i; k++) s -= A[i * n + k] * y[k]; y[i] = s / A[i * n + i]; }
  const x = new Float64Array(n);
  for (let i = n - 1; i >= 0; i--) { let s = y[i]; for (let k = i + 1; k < n; k++) s -= A[k * n + i] * x[k]; x[i] = s / A[i * n + i]; }
  return x;
}

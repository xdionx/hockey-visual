# Compares goalie game score variants per goalie-game and per goalie-season. Needs the pickle from persist.py.
import sys, numpy as np, pandas as pd
d = pd.read_pickle(sys.argv[1])
ULL = 8476999
# League calibration of the current xG: scale so each season's xG sums to its goals
d['xgc'] = d.xg * d.groupby('season').goal.transform('sum') / d.groupby('season').xg.transform('sum')
g = d.groupby(['season', 'game', 'goalie', 'gname', 'gteam']).agg(sa=('goal', 'size'), ga=('goal', 'sum'), xga=('xg', 'sum'), xgac=('xgc', 'sum'), xga2=('xg2', 'sum')).reset_index()
g['sv'] = g.sa - g.ga
g['gsax'] = g.xga - g.ga; g['gsax2'] = g.xga2 - g.ga
g['gs0'] = -0.75 * g.ga + 0.1 * g.sv + 0.35 * g.gsax          # current
g['gs1'] = -0.75 * g.ga + 0.1 * g.sv + 0.35 * (g.xgac - g.ga) # same formula, xG calibrated to league
g['gs2'] = 1.0 * g.gsax2                                      # proposed: goals saved above a context-aware expectation
def rating(s):
    raw = 6 + 1.5 * s; k = 0.4
    return np.where(raw > 9, 9 + k * (raw - 9), np.where(raw < 4, 4 + k * (raw - 4), raw))
for v in ('0', '1', '2'): g['r' + v] = rating(g['gs' + v])
# starter = goalie with the most shots for his team that game
g['st'] = g.groupby(['game', 'gteam']).sa.transform('max') == g.sa
S = g[g.st & (g.sa >= 10)].copy()
print('Average starter rating per start (all five seasons):')
print('  current %.2f   calibrated-xG %.2f   proposed %.2f   (league average should read 6.0)' % (S.r0.mean(), S.r1.mean(), S.r2.mean()))
print('  spread (sd): %.2f / %.2f / %.2f' % (S.r0.std(), S.r1.std(), S.r2.std()))
print('  share of starts rated 8.0+: %.1f%% / %.1f%% / %.1f%%' % tuple(100 * (S['r' + v] >= 8).mean() for v in '012'))
print('  share of starts rated under 4.0: %.1f%% / %.1f%% / %.1f%%' % tuple(100 * (S['r' + v] < 4).mean() for v in '012'))
print('  mean shots faced %.1f, goals against %.2f, xGA raw %.2f, xGA proposed %.2f' % (S.sa.mean(), S.ga.mean(), S.xga.mean(), S.xga2.mean()))
print('  correlation of rating with shots faced: %.2f / %.2f / %.2f' % tuple(S[['sa', 'r' + v]].corr().iloc[0, 1] for v in '012'))
# per goalie-season
def season_tab(season, mingp):
    s = S[S.season == season].groupby(['goalie', 'gname']).agg(gp=('sa', 'size'), sa=('sa', 'mean'), gsax=('gsax', 'mean'), gsax2=('gsax2', 'mean'), r0=('r0', 'mean'), r1=('r1', 'mean'), r2=('r2', 'mean'), team=('gteam', 'last')).reset_index()
    s = s[s.gp >= mingp].copy()
    for v in '012': s['k' + v] = s['r' + v].rank(ascending=False).astype(int)
    return s.sort_values('r0', ascending=False)
t = season_tab(20262027, 5)
print('\n2026-27 so far, goalies with >= 5 starts (%d goalies): current vs proposed average rating and rank' % len(t))
print(t[['gname', 'gp', 'sa', 'gsax', 'gsax2', 'r0', 'k0', 'r2', 'k2']].head(15).round(2).to_string(index=False))
print('...'); print(t[t.goalie == ULL][['gname', 'gp', 'sa', 'gsax', 'gsax2', 'r0', 'k0', 'r1', 'k1', 'r2', 'k2']].round(2).to_string(index=False))
print('\nAll goalies, 2026-27, sorted by proposed rating (top 10 / bottom 5):')
u = t.sort_values('r2', ascending=False); print(pd.concat([u.head(10), u.tail(5)])[['gname', 'gp', 'gsax', 'gsax2', 'r0', 'k0', 'r2', 'k2']].round(2).to_string(index=False))
# Ullmark across seasons
for s in sorted(d.season.unique()):
    x = season_tab(s, 10); y = x[x.goalie == ULL]
    if len(y): print(s, 'Ullmark', y[['gp', 'sa', 'gsax', 'gsax2', 'r0', 'k0', 'r2', 'k2']].round(2).to_dict('records')[0], 'of', len(x))
# Does a goalie's average depend on how many shots his team lets up?
print('\nHow much of a goalie season average comes from his team (goalies with >= 20 starts, season level):')
A = S.groupby(['season', 'goalie']).agg(gp=('sa', 'size'), sa=('sa', 'mean'), r0=('r0', 'mean'), r2=('r2', 'mean'), gsax=('gsax', 'mean')).reset_index(); A = A[A.gp >= 20]
print('  corr(avg rating, avg shots faced): current %.2f, proposed %.2f   (n=%d)' % (A[['r0', 'sa']].corr().iloc[0, 1], A[['r2', 'sa']].corr().iloc[0, 1], len(A)))
# Reliability: split halves by parity of games, whole career pooled (goalies with >= 40 starts)
S['rk'] = S.groupby('goalie').game.rank(method='dense'); S['half'] = (S.rk % 2).astype(int)
h = S.groupby(['goalie', 'half']).agg(n=('sa', 'size'), r0=('r0', 'mean'), r2=('r2', 'mean'), g0=('gs0', 'mean'), g2=('gs2', 'mean')).unstack('half').dropna(); h = h[(h[('n', 0)] >= 20) & (h[('n', 1)] >= 20)]
print('\nSplit half (odd vs even starts, %d goalies with 40+ starts): correlation of average rating: current %.2f, proposed %.2f' % (len(h), np.corrcoef(h[('r0', 0)], h[('r0', 1)])[0, 1], np.corrcoef(h[('r2', 0)], h[('r2', 1)])[0, 1]))
# Season to season among movers and all
B = S.groupby(['season', 'goalie']).agg(gp=('sa', 'size'), r0=('r0', 'mean'), r2=('r2', 'mean'), team=('gteam', lambda x: x.mode()[0])).reset_index(); B = B[B.gp >= 20]
B['nxt'] = B.season.map({20222023: 20232024, 20232024: 20242025, 20242025: 20252026, 20252026: 20262027})
R = B.rename(columns={'r0': 'n0', 'r2': 'n2', 'team': 'nteam'})[['season', 'goalie', 'n0', 'n2', 'nteam']].rename(columns={'season': 'nxt'})
J = B.merge(R, on=['nxt', 'goalie'])
print('Season to season (20+ starts both years, n=%d): current %.2f, proposed %.2f' % (len(J), J[['r0', 'n0']].corr().iloc[0, 1], J[['r2', 'n2']].corr().iloc[0, 1]))
M = J[J.team != J.nteam]
if len(M) > 15: print('  goalies who changed teams (n=%d): current %.2f, proposed %.2f' % (len(M), M[['r0', 'n0']].corr().iloc[0, 1], M[['r2', 'n2']].corr().iloc[0, 1]))

# Credit per save and cost per goal, by kind of shot
print('\nWhat one shot is worth to the goalie (rating points = 1.5 x game score), by kind of shot')
d['sv_cur'] = 0.1 + 0.35 * d.xg; d['g_cur'] = -1.1 + 0.35 * d.xg
d['sv_new'] = d.xg2; d['g_new'] = d.xg2 - 1
kinds = {'even strength': d.strength == 'EV', 'penalty kill (facing a PP)': d.strength == 'PP', 'goalie team on PP (SH shots)': d.strength == 'SH',
  'rebound (1-3 s)': d.reb == 1, 'tip / deflection': d.tip == 1, 'inner plate': d.inner == 1, 'outer plate': d.outer == 1, 'perimeter (wide/other)': d.plate == 0, 'all shots': d.goal >= 0}
rows = []
for k, m in kinds.items():
    x = d[m]; rows.append(dict(kind=k, shots=len(x), goal_pct=100 * x.goal.mean(), xG_cur=100 * x.xg.mean(), xG_new=100 * x.xg2.mean(),
      save_cur=1.5 * x.sv_cur.mean(), save_new=1.5 * x.sv_new.mean(), goal_cur=1.5 * x.g_cur.mean(), goal_new=1.5 * x.g_new.mean()))
print(pd.DataFrame(rows).round(3).to_string(index=False))

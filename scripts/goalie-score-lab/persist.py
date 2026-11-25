# Is a goalie's result in each kind of save skill (repeatable) or luck? Odd/even-game split-half and season-to-season correlations.
import sys, json, numpy as np, pandas as pd
sys.path.insert(0, __import__('os').path.dirname(__file__))
from lib import *
d = load(sys.argv[1]); M = json.load(open(sys.argv[2]))['xG + all']
d['t3v3'] = ((d.sh == 3) & (d.dk == 3)).astype(int)
for k in ['slap', 'snap', 'backhand', 'wrist', 'tip-in', 'deflected', 'wrap-around']: d['ty_' + k.replace('-', '')] = (d.ptype == k).astype(int)
X = np.c_[d[M['cols']].values.astype(float)]; d['xg2'] = predict(X, np.array(M['b']))
d['r1'] = d.goal - d.xg; d['r2'] = d.goal - d.xg2
d['rank'] = d.groupby(['season', 'goalie']).game.transform(lambda s: s.rank(method='dense'))
d['half'] = (d['rank'] % 2).astype(int)
cats = {'all shots': d.sa if False else np.ones(len(d), bool), 'even strength': d.strength == 'EV', 'facing a power play (PK)': d.strength == 'PP',
        'rebounds (1-3 s)': d.reb == 1, 'tips & deflections': d.tip == 1, 'inside home plate': d.plate == 1, 'inner plate': d.inner == 1,
        'outer plate': d.outer == 1, 'perimeter (outside plate)': d.plate == 0, 'perimeter, not tip, EV': (d.plate == 0) & (d.strength == 'EV') & (d.tip == 0)}
def split(mask, col, minshots):
    s = d[mask]; g = s.groupby(['season', 'goalie', 'half']).agg(n=('goal', 'size'), r=(col, 'mean')).unstack('half').dropna()
    g = g[(g[('n', 0)] >= minshots) & (g[('n', 1)] >= minshots)]
    if len(g) < 20: return None
    r = np.corrcoef(g[('r', 0)], g[('r', 1)])[0, 1]; return r, len(g), g[('n', 0)].mean()
print('Split-half (odd vs even games, same season). r = correlation of goals-above-expected per shot between halves; 0 = pure luck.')
print('Spearman-Brown reliability of a full season = 2r/(1+r).\n')
print(f"{'category':30s} {'min':>4s} {'xG r':>7s} {'xG2 r':>7s} {'goalie-seasons':>15s} {'shots/half':>10s}")
for name, m in cats.items():
    ms = 300 if name == 'all shots' else 100 if name in ('even strength',) or 'plate' in name or 'perimeter' in name else 40
    a = split(m, 'r1', ms); b = split(m, 'r2', ms)
    if a: print(f"{name:30s} {ms:4d} {a[0]:7.3f} {b[0]:7.3f} {a[1]:15d} {a[2]:10.0f}")
# Season to season
print('\nSeason to season (goalie with >= N shots in both seasons): correlation of goals above expected per 100 shots')
print(f"{'category':30s} {'min':>4s} {'xG r':>7s} {'xG2 r':>7s} {'pairs':>6s}")
for name, m in cats.items():
    ms = 800 if name == 'all shots' else 300 if name in ('even strength',) or 'plate' in name or 'perimeter' in name else 60
    out = []
    for col in ('r1', 'r2'):
        s = d[m].groupby(['season', 'goalie']).agg(n=('goal', 'size'), r=(col, 'mean')).reset_index()
        s = s[s.n >= ms]; s['nxt'] = s.season.map({20222023: 20232024, 20232024: 20242025, 20242025: 20252026, 20252026: 20262027})
        j = s.merge(s[['season', 'goalie', 'r']].rename(columns={'season': 'nxt', 'r': 'r_next'}), on=['nxt', 'goalie'])
        out.append((np.corrcoef(j.r, j.r_next)[0, 1], len(j)) if len(j) > 20 else (np.nan, len(j)))
    print(f"{name:30s} {ms:4d} {out[0][0]:7.3f} {out[1][0]:7.3f} {out[0][1]:6d}")
d.to_pickle(sys.argv[3])

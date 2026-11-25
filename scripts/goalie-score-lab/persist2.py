# Pooled over all seasons: odd vs even games per goalie. Gives every goalie enough shots in each category.
import sys, numpy as np, pandas as pd
d = pd.read_pickle(sys.argv[1])
d['rank'] = d.groupby('goalie').game.transform(lambda s: s.rank(method='dense')); d['half'] = (d['rank'] % 2).astype(int)
d['perim'] = (d.plate == 0).astype(int)
cats = {'all shots': np.ones(len(d), bool), 'even strength': d.strength == 'EV', 'facing a power play (PK)': d.strength == 'PP',
  'rebounds (1-3 s)': d.reb == 1, 'tips & deflections': d.tip == 1, 'inside home plate': d.plate == 1, 'inner plate (close to net)': d.inner == 1,
  'outer plate': d.outer == 1, 'perimeter (outside plate)': d.perim == 1, 'perimeter, EV, no tip': (d.perim == 1) & (d.strength == 'EV') & (d.tip == 0),
  'high-danger (xG >= .15)': d.xg >= .15, 'low-danger (xG < .06)': d.xg < .06}
print(f"{'category':32s} {'min/half':>8s} {'goalies':>7s} {'r xG':>6s} {'r xG2':>6s} {'sd of goalie talent (goals/100 shots)':>40s}")
for name, m in cats.items():
    mn = {'all shots': 800}.get(name, 150 if name in ('even strength', 'inside home plate', 'perimeter (outside plate)', 'perimeter, EV, no tip', 'low-danger (xG < .06)') else 50)
    out = []
    for col in ('r1', 'r2'):
        g = d[m].groupby(['goalie', 'half']).agg(n=('goal', 'size'), r=(col, 'mean')).unstack('half').dropna()
        g = g[(g[('n', 0)] >= mn) & (g[('n', 1)] >= mn)]
        r = np.corrcoef(g[('r', 0)], g[('r', 1)])[0, 1]
        sd = np.sqrt(max(np.cov(g[('r', 0)], g[('r', 1)])[0, 1], 0)) * 100   # sd of persistent part, goals per 100 shots
        out.append((r, len(g), sd))
    print(f"{name:32s} {mn:8d} {out[0][1]:7d} {out[0][0]:6.2f} {out[1][0]:6.2f} {out[1][2]:12.2f}")

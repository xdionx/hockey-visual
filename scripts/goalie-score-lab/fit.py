# Final fit of the goalie expected-goals model on every shot, plus a per-season intercept shift so each season's expected goals equal its goals.
import sys, json, numpy as np, pandas as pd
sys.path.insert(0, __import__('os').path.dirname(__file__))
from lib import *
d = load(sys.argv[1]); d['t3v3'] = ((d.sh == 3) & (d.dk == 3)).astype(int)
for k in ['slap', 'snap', 'backhand', 'tip-in', 'deflected', 'wrap-around']: d['ty_' + k.replace('-', '')] = (d.ptype == k).astype(int)
cols = ['pp', 't3v3', 'reb', 'ty_slap', 'ty_snap', 'ty_backhand', 'ty_tipin', 'ty_deflected', 'ty_wraparound', 'inner', 'outer', 'wide']
X = np.c_[d.lx.values, d[cols].values.astype(float)]; y = d.goal.values.astype(float)
b = logit_fit(X, y); print('logloss', logloss(y, predict(X, b)), dict(zip(['icpt', 'lx'] + cols, np.round(b, 4))))
z0 = np.c_[np.ones(len(X)), X] @ b; shift = {}
for s, idx in d.groupby('season').indices.items():
    sh = 0.0
    for _ in range(30):
        p = 1 / (1 + np.exp(-(z0[idx] + sh))); sh += (y[idx].sum() - p.sum()) / (p * (1 - p)).sum()
    shift[int(str(s)[:4])] = round(sh, 4)
print('shift', shift)
json.dump(dict(cols=cols, b=[round(v, 4) for v in b], shift=shift), open(sys.argv[2], 'w'))

# Fits a richer expected-goals model (strength, rebound, sequence, tips, area) on early seasons, tests on later ones.
import sys, json, numpy as np, pandas as pd
sys.path.insert(0, __import__('os').path.dirname(__file__))
from lib import *
d = load(sys.argv[1])
d['n10c'] = np.minimum(d.n10, 3)
d['ppx'] = d.pp * d.lx; d['wide_pp'] = d.wide * d.pp
d['t3v3'] = ((d.sh == 3) & (d.dk == 3)).astype(int)
for k in ['slap', 'snap', 'backhand', 'wrist', 'tip-in', 'deflected', 'wrap-around']: d['ty_' + k.replace('-', '')] = (d.ptype == k).astype(int)
d['en6'] = (d.sh < d.dk).astype(int)
SETS = {
  'current xG': [],
  'xG + strength': ['pp', 'sh_', 't3v3'],
  'xG + rebound (1-3 s)': ['reb'],
  'xG + shot type/tip': ['ty_slap', 'ty_snap', 'ty_backhand', 'ty_tipin', 'ty_deflected', 'ty_wraparound', 'tip'],
  'xG + area': ['inner', 'outer', 'wide'],
  'xG + all': ['pp', 'sh_', 't3v3', 'reb', 'ty_slap', 'ty_snap', 'ty_backhand', 'ty_tipin', 'ty_deflected', 'ty_wraparound', 'inner', 'outer', 'wide'],
}
train = d[d.season <= 20232024]; test = d[d.season >= 20242025]
print(f"train {len(train)} shots (2022-24), test {len(test)} shots (2024-27)\n")
print(f"{'model':28s} {'test logloss':>12s} {'AUC':>7s}")
res = {}
for name, cols in SETS.items():
    Xtr = train[cols].values.astype(float) if cols else np.zeros((len(train), 0)); Xte = test[cols].values.astype(float) if cols else np.zeros((len(test), 0))
    # offset-free logistic with logit(xG) as a feature
    Xtr = np.c_[train.lx.values, Xtr]; Xte = np.c_[test.lx.values, Xte]
    b = logit_fit(Xtr, train.goal.values.astype(float)); p = predict(Xte, b)
    res[name] = dict(cols=['lx'] + cols, b=b.tolist(), ll=logloss(test.goal.values, p), auc=auc(test.goal.values, p))
    print(f"{name:28s} {res[name]['ll']:12.5f} {res[name]['auc']:7.4f}")
print(f"{'(raw xG, uncalibrated)':28s} {logloss(test.goal.values, test.xg.values):12.5f} {auc(test.goal.values, test.xg.values):7.4f}")
print(); full = res['xG + all']
for c, b in zip(['intercept'] + full['cols'], full['b']): print(f"  {c:12s} {b:+.3f}")
json.dump(res, open(sys.argv[2], 'w'))

import numpy as np, pandas as pd
def load(path):
    d = pd.read_csv(path)
    d = d[d.strength != ''].copy()
    d['reb'] = ((d.gap > 1) & (d.gap <= 3)).astype(int)  # previous shot on goal by same team 1-3 s earlier (<= 1 s is mostly a double-logged shot or a tip)
    d['seq'] = ((d.gapAny <= 6) & (d.reb == 0)).astype(int)  # another attempt (miss/block) within 6 s, not a rebound
    d['tip'] = d.ptype.isin(['tip-in', 'deflected']).astype(int)
    d['pp'] = (d.strength == 'PP').astype(int)         # goalie's team shorthanded (facing a power play)
    d['sh_'] = (d.strength == 'SH').astype(int)        # goalie's team on the power play
    d['inner'] = (d.area == 'inner').astype(int)
    d['outer'] = (d.area == 'outer').astype(int)
    d['wide'] = (d.area == 'wide').astype(int)
    d['plate'] = d.inner | d.outer
    d['lx'] = np.log(d.xg / (1 - d.xg))
    return d
def logit_fit(X, y, offset=None, l2=1e-6, it=30):
    X = np.c_[np.ones(len(X)), X]; b = np.zeros(X.shape[1]); off = 0 if offset is None else offset
    for _ in range(it):
        z = X @ b + off; p = 1 / (1 + np.exp(-z)); w = p * (1 - p)
        g = X.T @ (y - p) - l2 * b; H = (X * w[:, None]).T @ X + l2 * np.eye(len(b))
        step = np.linalg.solve(H, g); b += step
        if abs(step).max() < 1e-8: break
    return b
def predict(X, b, offset=None):
    X = np.c_[np.ones(len(X)), X]; z = X @ b + (0 if offset is None else offset); return 1 / (1 + np.exp(-z))
def logloss(y, p): p = np.clip(p, 1e-6, 1 - 1e-6); return -np.mean(y * np.log(p) + (1 - y) * np.log(1 - p))
def auc(y, p):
    r = pd.Series(p).rank().values; n1 = y.sum(); n0 = len(y) - n1
    return (r[y == 1].sum() - n1 * (n1 + 1) / 2) / (n1 * n0)

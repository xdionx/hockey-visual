"""Scoring lab: does adding assists to finishing give a fairer, more lasting picture of a skater's scoring?

    python3 -I scripts/scoring-lab/scoring.py players.csv      # from players.mjs; needs numpy + pandas

Per player-season (skaters, 20+ games), split each player's games into first and second half (by date) and
into odd / even games, and compare per-game measures:
  fin    goals on a goalie minus what an average shooter scores from the same shots (the site's Goals vs avg)
  g, a1, a2, pts   goals, primary and secondary assists, points
  play   playmaking: assists against a typical player at the position, weighted
  score  fin + play (finishing plus playmaking, in goals)
"""
import sys
import numpy as np
import pandas as pd

d = pd.read_csv(sys.argv[1])
d['F'] = np.where(d.pos == 'D', 'D', 'F')
rate = d.groupby('season').apply(lambda s: s.xgg.sum() / s.xg.sum()).rename('rate')
d = d.join(rate, on='season')
d['fin'] = d.xgg - d.xg * d.rate
d['axg'] = d.xg * d.rate
d['pts'] = d.g + d.a1 + d.a2
d['ev_a1'] = d.a1 - d.pa1
d['ev_a2'] = d.a2 - d.pa2
d = d.sort_values(['season', 'game'])
d['k'] = d.groupby(['season', 'pid']).cumcount()
d['n'] = d.groupby(['season', 'pid']).pid.transform('size')
d = d[d.n >= 20]
d['half'] = np.where(d.k < d.n / 2, 1, 2)
d['odd'] = d.k % 2
print(f'{d.season.nunique()} seasons, {d.game.nunique():,} games, {d.groupby(["season", "pid"]).ngroups:,} player-seasons (20+ GP)')
print('league rate (goals per our xG):', ' '.join(f'{s}: {r:.2f}' for s, r in rate.items()))

cols = ['g', 'a1', 'a2', 'pts', 'fin', 'axg', 'mom', 'pa1', 'ev_a1', 'xgg']


def per_game(grp):
    s = grp[cols].sum()
    s['gp'] = len(grp)
    return s


def split(key):
    out = d.groupby(['season', 'pid', 'F', key]).apply(per_game).reset_index()
    out = out.pivot_table(index=['season', 'pid', 'F'], columns=key, values=cols + ['gp'])
    out.columns = [f'{c}_{h}' for c, h in out.columns]
    return out.dropna()


def pg(t, c, h):
    return t[f'{c}_{h}'] / t[f'gp_{h}']


def r(a, b):
    m = np.isfinite(a) & np.isfinite(b)
    return np.corrcoef(a[m], b[m])[0, 1]


oe = split('odd')
hh = split('half')

# Position averages per game for the playmaking part (per season, per F/D).
for t, (h1, h2) in ((oe, (0, 1)), (hh, (1, 2))):
    for h in (h1, h2):
        for c in ['a1', 'a2', 'g', 'pts']:
            t[f'{c}pg_{h}'] = pg(t, c, h)
            t[f'{c}dev_{h}'] = t[f'{c}pg_{h}'] - t.groupby(level=['season', 'F'])[f'{c}pg_{h}'].transform('mean')
        t[f'finpg_{h}'] = pg(t, 'fin', h)
        t[f'mompg_{h}'] = pg(t, 'mom', h)
        t[f'axgpg_{h}'] = pg(t, 'axg', h)

print('\n1) How much of each number is skill (odd vs even games, same season; higher = more repeatable)')
for name, c in [('Goals vs avg (finishing)', 'finpg'), ('Goals', 'gpg'), ('Primary assists', 'a1pg'), ('Secondary assists', 'a2pg'), ('Points', 'ptspg'), ('Shot chances (avg-shooter goals)', 'axgpg'), ('Momentum', 'mompg')]:
    print(f'   {name:34s} r {r(oe[f'{c}_0'].values, oe[f'{c}_1'].values):.2f}')

# Weights: first half -> second half points per game, fit on 2021-24, tested on 2024-27.
fit = hh.index.get_level_values('season') < 20242025
test = ~fit
y = pg(hh, 'pts', 2).values
yg = pg(hh, 'g', 2).values


def ols(X, y, m):
    X1 = np.column_stack([np.ones(m.sum()), X[m]])
    b, *_ = np.linalg.lstsq(X1, y[m], rcond=None)
    return b


def show(name, X, target, label):
    X = np.column_stack(X)
    b = ols(X, target, fit)
    pred = np.column_stack([np.ones(len(X)), X]) @ b
    print(f'   {name:44s} {label} r {r(pred[test], target[test]):.3f}   weights {" ".join(f"{v:+.2f}" for v in b[1:])}')
    return b


g1 = pg(hh, 'g', 1).values
a11 = pg(hh, 'a1', 1).values
a21 = pg(hh, 'a2', 1).values
fin1 = pg(hh, 'fin', 1).values
axg1 = pg(hh, 'axg', 1).values
mom1 = pg(hh, 'mom', 1).values
print('\n2) First half of a season predicting the second half (fit 2021-24, held-out test 2024-27)')
print('   Target: points per game')
show('Goals vs avg alone', [fin1], y, 'pts')
show('Goals alone', [g1], y, 'pts')
show('Points', [g1 + a11 + a21], y, 'pts')
bw = show('Goals, primary, secondary assists', [g1, a11, a21], y, 'pts')
show('Goals vs avg + assists', [fin1, a11, a21], y, 'pts')
show('Shot chances + goals vs avg + assists', [axg1, fin1, a11, a21], y, 'pts')
show('+ momentum', [axg1, fin1, a11, a21, mom1], y, 'pts')
print('   Target: goals per game')
show('Goals vs avg alone', [fin1], yg, 'gls')
show('Shot chances + goals vs avg', [axg1, fin1], yg, 'gls')
show('Shot chances + goals vs avg + assists', [axg1, fin1, a11, a21], yg, 'gls')

# Players who look like poor finishers: do their assists tell us anything about what comes next?
print('\n3) Players a cold first half would flag (Goals vs avg -1.5 or worse in the half), by first-half assists')
flag = (hh['fin_1'] <= -1.5).values
adev = (hh['a1dev_1'] + 0.5 * hh['a2dev_1']).values
for lab, m in [('fewer assists than typical', flag & (adev < 0)), ('more assists than typical', flag & (adev >= 0))]:
    pts2 = hh['ptsdev_2'].values
    fin2 = hh['fin_2'].values
    print(f'   {lab:28s} n {m.sum():4d}   2nd half points/GP vs position avg {np.nanmean(pts2[m]):+.3f}   2nd half Goals vs avg {np.nanmean(fin2[m]):+.2f}')

# How much a finishing number should be trusted with this many chances: shrink = var(true)/(var(true)+noise).
print('\n4) Trust in a Goals vs avg number by sample (odd/even reliability from player-seasons)')
season_fin = d.groupby(['season', 'pid']).agg(fin=('fin', 'sum'), axg=('axg', 'sum'), gp=('fin', 'size'))
# Noise of goals vs avg is about sqrt(expected goals) (Poisson). True spread from the observed spread minus noise.
ratio = season_fin.fin / np.sqrt(season_fin.axg)
var_obs = (season_fin.fin ** 2 / season_fin.axg).mean()
print(f'   observed variance per expected goal {var_obs:.2f} (pure luck would be 1.00)')
tau = max(0.0, var_obs - 1)  # true variance per expected goal^2 ... approximated per xG
true_sd_rate = np.sqrt(max(1e-9, (season_fin.fin ** 2).mean() - season_fin.axg.mean()) / (season_fin.axg ** 2).mean())
k = 1 / true_sd_rate ** 2
print(f'   true finishing spread {true_sd_rate:.3f} goals per expected goal; half-trust point k = {k:.0f} expected goals')
for x in [3, 6, 10, 20, 40]:
    print(f'   {x:2d} expected goals: trust {x / (x + k):.0%} of the raw Goals vs avg')

# Credit weights from the held-out fit, scaled so a goal = 1.
print('\n5) Weights from the points fit, goal = 1:', ' '.join(f'{v / bw[1]:.2f}' for v in bw[1:]))

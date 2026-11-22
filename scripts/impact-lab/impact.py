"""Player impact lab: momentum, finishing (goals vs avg shooter) and goaltending (saves vs avg).

python3 -I impact.py players.csv
"""
import sys
import numpy as np
import pandas as pd

df = pd.read_csv(sys.argv[1])
df['date'] = pd.to_datetime(df['date'])
sk = df[df.pos != 'G'].copy()
gk = df[df.pos == 'G'].copy()

# League rate per season: goals on a goalie per expected goal (our xG runs low).
rate = sk.groupby('season').apply(lambda d: d.xgg.sum() / d.xg.sum(), include_groups=False)
print('League rate (goals per our xG):', rate.round(3).to_dict())
sk['gva'] = sk.xgg - sk.xg * sk.season.map(rate)          # goals vs average shooter
gk['gsaa'] = gk.xga * gk.season.map(rate) - gk.gag        # goals saved vs average goalie

def r(a, b):
    a, b = np.asarray(a, float), np.asarray(b, float)
    m = ~(np.isnan(a) | np.isnan(b))
    return np.corrcoef(a[m], b[m])[0, 1] if m.sum() > 2 else np.nan

out = []
def say(*a):
    s = ' '.join(str(x) for x in a)
    print(s)
    out.append(s)

# ---------------------------------------------------------------- 1. How games are won (team level)
say('\n== 1. How games are won ==')
tg = sk.groupby(['season', 'game', 'team']).agg(gf=('gf', 'first'), ga=('ga', 'first'), won=('won', 'first'), end=('end', 'first'),
                                                  xg=('xg', 'sum'), xgg=('xgg', 'sum'), gva=('gva', 'sum'), tn=('tn', 'first'), on=('on', 'first')).reset_index()
st = gk[gk.st == 1].groupby(['season', 'game', 'team']).agg(gsaa=('gsaa', 'sum')).reset_index()
allg = gk.groupby(['season', 'game', 'team']).agg(gsaa_all=('gsaa', 'sum')).reset_index()
tg = tg.merge(allg, on=['season', 'game', 'team'], how='left')
opp = tg[['season', 'game', 'team', 'xg', 'gva', 'gsaa_all', 'tn']].rename(columns={'team': 'opp_t', 'xg': 'oxg', 'gva': 'ogva', 'gsaa_all': 'ogsaa', 'tn': 'otn'})
tg = tg.merge(opp, on=['season', 'game'])
tg = tg[tg.team != tg.opp_t]
tg['rate'] = tg.season.map(rate)
tg['chance'] = (tg.xg - tg.oxg) * tg.rate          # shot quality edge, in average-shooter goals
tg['fin'] = tg.gva - tg.ogva                         # finishing edge
tg['goalie'] = tg.gsaa_all - tg.ogsaa                # goaltending edge
tg['mom'] = tg.tn / (tg.tn + tg.otn)                 # momentum share, goals left out
dec = tg[tg.gf != tg.ga]
reg = dec[dec.end == 'REG']
say(f'{dec.game.nunique()} games')
for k, lab in [('mom', 'Won momentum (share > 50%)'), ('chance', 'Better chances (more expected goals)'), ('fin', 'Better finishing'), ('goalie', 'Better goaltending')]:
    thr = 0.5 if k == 'mom' else 0
    w = dec[dec[k] > thr]
    say(f'  {lab}: won {w.won.mean():.1%} of {len(w)} team-games')
# Which piece "decided" the game: biggest component of the winner's goal edge (regulation goal diff identity).
win = reg[reg.won == 1].copy()
comp = win[['chance', 'fin', 'goalie']]
win['top'] = comp.idxmax(axis=1)
say('  Regulation winners, biggest piece of their goal edge:', (win.top.value_counts(normalize=True)).round(3).to_dict())
say(f'  Winners who lost the momentum battle: {(win.mom < 0.5).mean():.1%}; of those, carried by finishing {((win.mom < .5) & (win.top == "fin")).sum() / (win.mom < .5).sum():.1%}, goaltending {((win.mom < .5) & (win.top == "goalie")).sum() / (win.mom < .5).sum():.1%}')
# Logistic of win on the pieces
from numpy.linalg import lstsq
def logit_fit(X, y, iters=50):
    X = np.column_stack([np.ones(len(X)), X]); b = np.zeros(X.shape[1])
    for _ in range(iters):
        p = 1 / (1 + np.exp(-X @ b)); W = p * (1 - p)
        H = X.T @ (X * W[:, None]) + 1e-6 * np.eye(len(b)); b += np.linalg.solve(H, X.T @ (y - p))
    return b
def logit_pred(b, X):
    return 1 / (1 + np.exp(-(np.column_stack([np.ones(len(X)), X]) @ b)))
def scores(p, y):
    p = np.clip(p, 1e-6, 1 - 1e-6)
    return dict(acc=((p > .5) == y).mean(), logloss=-(y * np.log(p) + (1 - y) * np.log(1 - p)).mean())
y = dec.won.values.astype(float)
for cols in [['mom'], ['mom', 'fin'], ['mom', 'fin', 'goalie'], ['chance', 'fin', 'goalie']]:
    X = dec[cols].values
    b = logit_fit(X, y)
    say(f'  win ~ {"+".join(cols)}: acc {scores(logit_pred(b, X), y)["acc"]:.1%}')

# ---------------------------------------------------------------- 2. Players: above / average / below
say('\n== 2. How often players are above, at, or below average ==')
sk['F'] = np.where(sk.pos == 'D', 'D', 'F')
# Per game "impact" in goals: momentum converted to goals plus finishing. Momentum -> goals scale from team level.
k_mom = np.polyfit(tg.tn - tg.otn, tg.gf - tg.ga, 1)[0]
say(f'  one momentum point is worth about {k_mom:.3f} goals of goal differential (team level)')
sk['impact'] = sk.mom * k_mom + sk.gva
for col in ['mom', 'impact']:
    g = sk.groupby(['season', 'F'])[col]
    mu, sd = g.transform('mean'), g.transform('std')
    sk[col + '_tier'] = np.select([sk[col] > mu + 0.5 * sd, sk[col] < mu - 0.5 * sd], [1, -1], 0)
say('  Share of all skater-games by tier (impact):', sk.impact_tier.value_counts(normalize=True).sort_index().round(3).to_dict())
# Player-season profiles
ps = sk.groupby(['season', 'pid', 'F']).agg(gp=('game', 'size'), above=('impact_tier', lambda t: (t == 1).mean()), below=('impact_tier', lambda t: (t == -1).mean()),
                                           mom=('mom', 'mean'), gva=('gva', 'mean'), impact=('impact', 'mean'), sd=('impact', 'std')).reset_index()
ps = ps[ps.gp >= 40]
say(f'  {len(ps)} player-seasons with 40+ games. Above-average games: median {ps.above.median():.0%}, top tenth {ps.above.quantile(.9):.0%}, bottom tenth {ps.above.quantile(.1):.0%}')
# Reliability: odd vs even games within a season
sk = sk.sort_values(['pid', 'date'])
sk['half'] = sk.groupby(['season', 'pid']).cumcount() % 2
hh = sk.groupby(['season', 'pid', 'half']).agg(gp=('game', 'size'), above=('impact_tier', lambda t: (t == 1).mean()), below=('impact_tier', lambda t: (t == -1).mean()),
                                             mom=('mom', 'mean'), gva=('gva', 'mean'), impact=('impact', 'mean')).unstack('half')
hh = hh[(hh['gp'][0] >= 20) & (hh['gp'][1] >= 20)]
say('  Same season, odd games vs even games (r, higher = real skill not luck):')
for c in ['above', 'below', 'mom', 'gva', 'impact']:
    say(f'    {c}: {r(hh[c][0], hh[c][1]):.2f}')
# Season to season
nx = ps.copy(); nx['season'] = nx.season.map(lambda s: int(f'{s // 10000 + 1}{s // 10000 + 2}'))
yy = ps.merge(nx, on=['season', 'pid'], suffixes=('', '_prev'))
say('  Last season vs this season (r):')
for c in ['above', 'below', 'mom', 'gva', 'impact', 'sd']:
    say(f'    {c}: {r(yy[c + "_prev"], yy[c]):.2f}')
def resid(y_, x_):
    b_ = np.polyfit(x_, y_, 1)
    return y_ - np.poly1d(b_)(x_)
if len(yy) > 10:
    say(f'    Does last season\'s above% tell us more than last season\'s average impact? partial r = {r(resid(yy.above_prev, yy.impact_prev), resid(yy.impact, yy.impact_prev)):.2f}')
    say(f'    ...and below%? partial r = {r(resid(yy.below_prev, yy.impact_prev), resid(yy.impact, yy.impact_prev)):.2f}')
# Tier vs team result when player is in the lineup
say('  Team win % by how many skaters had an above / below game:')
cnt = sk.groupby(['game', 'team']).agg(up=('impact_tier', lambda t: (t == 1).sum()), dn=('impact_tier', lambda t: (t == -1).sum()), won=('won', 'first'))
cnt['net'] = cnt.up - cnt.dn
say('   ', cnt.groupby(pd.cut(cnt.net, [-20, -4, -2, 0, 2, 4, 20])).won.agg(['mean', 'size']).round(3).to_dict('index'))

# ---------------------------------------------------------------- 3. Prediction from the lineup's history
say('\n== 3. Prediction: lineup player history vs team history ==')
# Running, strictly prior, per-player stats (career within our data, previous seasons count half).
sk = sk.sort_values(['date', 'game'])
gk = gk.sort_values(['date', 'game'])
def prior(d, keys, vals):
    d = d.copy()
    for v in vals:
        d[v + '_c'] = d.groupby(keys)[v].cumsum() - d[v]
    d['n_c'] = d.groupby(keys).cumcount()
    return d
sk['above1'] = (sk.impact_tier == 1).astype(float); sk['below1'] = (sk.impact_tier == -1).astype(float)
skp = prior(sk, ['pid'], ['mom', 'gva', 'xg', 'xgg', 'above1', 'below1', 'impact'])
# Shrink toward average with 20 games of league-average prior; finishing shrinks on xG (talent ~ half real over 30 xG).
K = 20
skp['mom_r'] = skp.mom_c / (skp.n_c + K)
skp['imp_r'] = skp.impact_c / (skp.n_c + K)
skp['abv_r'] = (skp.above1_c + K * 0.31) / (skp.n_c + K) - 0.31
skp['blw_r'] = (skp.below1_c + K * 0.31) / (skp.n_c + K) - 0.31
skp['fin_r'] = skp.gva_c / (skp.xg_c + 30)      # goals vs avg per expected goal, shrunk
gkp = prior(gk, ['pid'], ['gsaa', 'xga'])
gkp['g_r'] = gkp.gsaa_c / (gkp.xga_c + 60)        # saves vs avg per expected goal against, shrunk
lin = skp.groupby(['season', 'game', 'date', 'team', 'opp', 'home', 'won', 'gf', 'ga']).agg(
    L_mom=('mom_r', 'sum'), L_imp=('imp_r', 'sum'), L_abv=('abv_r', 'sum'), L_blw=('blw_r', 'sum'), L_fin=('fin_r', 'sum'), n=('pid', 'size')).reset_index()
gs = gkp[gkp.st == 1][['game', 'team', 'g_r']].rename(columns={'g_r': 'G'})
lin = lin.merge(gs, on=['game', 'team'], how='left').fillna({'G': 0})
# Team season-to-date momentum share (the current model's main input).
tt = tg.sort_values('game')[['season', 'game', 'team', 'tn', 'otn']].copy()
tt['cf'] = tt.groupby(['season', 'team']).tn.cumsum() - tt.tn
tt['ca'] = tt.groupby(['season', 'team']).otn.cumsum() - tt.otn
tt['T_mom'] = (tt.cf + 200) / (tt.cf + tt.ca + 400) - 0.5
tt['tgp'] = tt.groupby(['season', 'team']).cumcount()
lin = lin.merge(tt[['game', 'team', 'T_mom', 'tgp']], on=['game', 'team'])
o = lin[['game', 'team'] + [c for c in lin.columns if c[:2] in ('L_', 'T_') or c == 'G']].rename(columns=lambda c: 'o_' + c if c not in ('game',) else c)
m = lin.merge(o, on='game')
m = m[(m.team != m.o_team) & (m.home == 1) & (m.tgp >= 10)]
for c in ['L_mom', 'L_imp', 'L_abv', 'L_blw', 'L_fin', 'G', 'T_mom']:
    m['d_' + c] = m[c] - m['o_' + c]
m = m[m.gf != m.ga]
train = m[m.season <= 20232024]; test = m[m.season >= 20242025]
say(f'  train {len(train)} games (2021-24), test {len(test)} games (2024-27), home team side, 10+ games in')
ytr, yte = train.won.values.astype(float), test.won.values.astype(float)
gd = (test.gf - test.ga).values
sets = {
    'home only': [],
    'team momentum to date (like v4)': ['d_T_mom'],
    'team momentum + starting goalie': ['d_T_mom', 'd_G'],
    'lineup momentum': ['d_L_mom'],
    'lineup momentum + goalie': ['d_L_mom', 'd_G'],
    'lineup momentum + finishing + goalie': ['d_L_mom', 'd_L_fin', 'd_G'],
    'lineup above/below % + goalie': ['d_L_abv', 'd_L_blw', 'd_G'],
    'lineup momentum + finishing + above/below + goalie': ['d_L_mom', 'd_L_fin', 'd_L_abv', 'd_L_blw', 'd_G'],
    'team momentum + lineup momentum + finishing + goalie': ['d_T_mom', 'd_L_mom', 'd_L_fin', 'd_G'],
}
for name, cols in sets.items():
    Xtr = train[cols].values if cols else np.zeros((len(train), 0)); Xte = test[cols].values if cols else np.zeros((len(test), 0))
    b = logit_fit(Xtr, ytr)
    p = logit_pred(b, Xte)
    sc = scores(p, yte)
    say(f'  {name:55s} pick {sc["acc"]:.1%}  log loss {sc["logloss"]:.4f}  r(goal diff) {r(p, gd):.3f}')

open(sys.argv[1].replace('.csv', '-results.txt'), 'w').write('\n'.join(out) + '\n')

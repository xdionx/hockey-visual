# Shooter finishing skill, strength of schedule, rest and travel: do they help the v4 team model?
#   python3 -I scripts/goalie-lab/context.py <all.json> <out.json>
import json, sys, math
from collections import defaultdict
from datetime import date
import numpy as np, pandas as pd
D = json.load(open(sys.argv[1])); D.sort(key=lambda g: (g['date'], g['id']))
OUT = {}
pr = lambda *a: print(*a, flush=True)
def corr(a, b): return float(np.corrcoef(np.asarray(a, float), np.asarray(b, float))[0, 1])
TZ = dict(ANA=-8, LAK=-8, SJS=-8, SEA=-8, VAN=-8, VGK=-8, ARI=-7, UTA=-7, CGY=-7, COL=-7, EDM=-7, CHI=-6, DAL=-6, MIN=-6, NSH=-6, STL=-6, WPG=-6)
tz = lambda t: TZ.get(t, -5)
# per-season xG calibration
cal = defaultdict(lambda: [0, 0.0])
for g in D:
    for e in g['ev']:
        if e['k'] in ('s', 'g') and e.get('gid') and e['xg'] is not None: cal[g['season']][0] += e['k'] == 'g'; cal[g['season']][1] += e['xg']
cal = {s: v[0] / v[1] for s, v in cal.items()}

# ---------- 1. shooter finishing: is it a skill? ----------
pr('== 1. Shooter finishing skill ==')
rows = []
for g in D:
    c = cal[g['season']]
    for e in g['ev']:
        if e['k'] in ('s', 'g') and e.get('gid') and e['xg'] is not None and e.get('pid'):
            rows.append((g['season'], g['id'], e['pid'], e['k'] == 'g', e['xg'] * c))
S = pd.DataFrame(rows, columns=['season', 'gameid', 'pid', 'goal', 'xg'])
mid = {s: np.median(x.gameid.unique()) for s, x in S.groupby('season')}
S['half'] = (S.gameid >= S.season.map(mid)).astype(int)
h = S.groupby(['season', 'pid', 'half']).agg(G=('goal', 'sum'), X=('xg', 'sum'), n=('goal', 'size')).unstack('half').dropna()
h = h[(h[('n', 0)] >= 60) & (h[('n', 1)] >= 60)]
f0 = h[('G', 0)] / h[('X', 0)]; f1 = h[('G', 1)] / h[('X', 1)]
sh0 = h[('G', 0)] / h[('n', 0)]; sh1 = h[('G', 1)] / h[('n', 1)]
pr(f'player-seasons {len(h)} (60+ shots each half): r(goals/xG H1,H2) = {corr(f0, f1):.3f}; r(shooting % H1,H2) = {corr(sh0, sh1):.3f}')
y = S.groupby(['pid', 'season']).agg(G=('goal', 'sum'), X=('xg', 'sum'), n=('goal', 'size')).reset_index()
y = y.merge(y.assign(season=y.season.map(lambda s: s + 10001)), on=['pid', 'season'], suffixes=('', '_prev'))
y = y[(y.n >= 80) & (y.n_prev >= 80)]
pr(f'season to next season (80+ shots both): r(goals/xG) = {corr(y.G / y.X, y.G_prev / y.X_prev):.3f}  n={len(y)}')
OUT['shooterPersist'] = dict(halves=len(h), rHalf=corr(f0, f1), rShPctHalf=corr(sh0, sh1), rYear=corr(y.G / y.X, y.G_prev / y.X_prev), nYear=len(y))
# top/bottom: how big is it? split by prior 2 seasons
pr('  spread: players with prior-season goals/xG in top vs bottom fifth, next season:')
y['q'] = pd.qcut(y.G_prev / y.X_prev, 5, labels=False)
pr(y.groupby('q').apply(lambda x: pd.Series(dict(prev=x.G_prev.sum() / x.X_prev.sum(), next=x.G.sum() / x.X.sum(), n=len(x)))).round(3).to_string())

# ---------- walk games in order, building leak-free pre-game features ----------
SHRINK = float(sys.argv[3]) if len(sys.argv) > 3 else 15.0
ptal = defaultdict(lambda: [0.0, 0.0])  # shooter career-to-date in sample: goals, xG
gtal = defaultdict(lambda: [0.0, 0.0])  # goalie: goals against, xGA
tal = lambda pid: (ptal[pid][0] + SHRINK) / (ptal[pid][1] + SHRINK) if pid else 1.0
gq = lambda gid: (gtal[gid][1] - gtal[gid][0]) / (gtal[gid][1] + 40) if gid else 0.0
last = {}  # team -> (date, venue team)
road = defaultdict(int)
P = []
season = None
for g in D:
    if g['season'] != season:
        season = g['season']; T = defaultdict(lambda: dict(gp=0, nf=0.0, na=0.0, fin=0.0, finx=0.0, gf=0, opp=[], sh=[], gfx=0.0))
        G = []  # games so far this season for SOS: (home, away, home share)
        teams = sorted({x for gg in D if gg['season'] == season for x in (gg['a'], gg['h'])}); ix = {t: i for i, t in enumerate(teams)}
        rating = {t: 0.0 for t in teams}; last_rating_date = None; last.clear(); road.clear()
    c = cal[season]
    a, hm = g['a'], g['h']
    d = date.fromisoformat(g['date'])
    # SOS ratings from games before today (re-solved once per date)
    if g['date'] != last_rating_date and len(G) > 60:
        X = np.zeros((len(G) + len(teams), len(teams) + 1)); yv = np.zeros(len(G) + len(teams))
        for i, (H_, A_, s) in enumerate(G): X[i, ix[H_]] = 1; X[i, ix[A_]] = -1; X[i, -1] = 1; yv[i] = s - 0.5
        lam = 4.0
        for j in range(len(teams)): X[len(G) + j, j] = math.sqrt(lam)
        b = np.linalg.lstsq(X, yv, rcond=None)[0]; rating = {t: b[ix[t]] for t in teams}; last_rating_date = g['date']
    starter = {}
    for e in g['ev']:
        if e['k'] in ('s', 'g') and e.get('gid') and e['s'] is not None and (1 - e['s']) not in starter: starter[1 - e['s']] = e['gid']
    # in-game finishing-weighted shots (shooter talent known before the game), plate 3x like v4
    fin = [0.0, 0.0]; xgf = [0.0, 0.0]; finx = [0.0, 0.0]
    for e in g['ev']:
        if e['k'] in ('s', 'g') and e['s'] is not None and e['xg'] is not None:
            w = 3 if e['hp'] else 1
            fin[e['s']] += w * (tal(e.get('pid')) - 1); xgf[e['s']] += e['xg'] * c; finx[e['s']] += e['xg'] * c * (tal(e.get('pid')) - 1)
    A, H = T[a], T[hm]
    share = lambda X_: X_['nf'] / (X_['nf'] + X_['na']) if X_['nf'] + X_['na'] else .5
    rest = {}
    for side, team in ((0, a), (1, hm)):
        venue = hm
        if team in last:
            pd_, pv = last[team]; rest[side] = dict(days=(d - pd_).days, tzs=abs(tz(venue) - tz(pv)), b2b=int((d - pd_).days == 1))
        else: rest[side] = dict(days=4, tzs=0, b2b=0)
        rest[side]['road'] = road[team] + 1 if side == 0 else 0
    pts = lambda gf, ga, end: 2 if gf > ga else (1 if end in ('OT', 'SO') else 0)
    if A['gp'] >= 10 and H['gp'] >= 10:
        sos = lambda X_: float(np.mean(X_['opp']))
        adj = lambda X_: float(np.mean([s + rating.get(o, 0) for s, o in zip(X_['sh'], X_['oppn'])]))
        P.append(dict(season=season, date=g['date'], gd=g['ag'] - g['hg'], win=int(g['ag'] > g['hg']),
            mom=share(A) - share(H), gq=gq(starter.get(0)) - gq(starter.get(1)),
            fin=A['fin'] / A['gp'] - H['fin'] / H['gp'], finx=A['finx'] / A['gp'] - H['finx'] / H['gp'],
            luck=(A['gf'] - A['gfx']) / A['gp'] - (H['gf'] - H['gfx']) / H['gp'],
            rate=rating.get(a, 0) - rating.get(hm, 0), adj=adj(A) - adj(H),
            b2b=rest[0]['b2b'] - rest[1]['b2b'], ab2b=rest[0]['b2b'], hb2b=rest[1]['b2b'], dayd=min(rest[0]['days'], 4) - min(rest[1]['days'], 4),
            tzs=rest[0]['tzs'] - rest[1]['tzs'], atzs=rest[0]['tzs'], road=rest[0]['road'],
            # same-game pieces
            gsh=g['an'] / (g['an'] + g['hn']) - 0.5, gfin=fin[0] - fin[1], gnd=g['an'] - g['hn']))
    # update after the game
    gs = g['an'] / (g['an'] + g['hn'])
    for side, team, opp, s in ((0, a, hm, gs), (1, hm, a, 1 - gs)):
        X_ = T[team]; X_['gp'] += 1; X_['nf'] += g['an'] if side == 0 else g['hn']; X_['na'] += g['hn'] if side == 0 else g['an']
        X_['fin'] += fin[side]; X_['finx'] += finx[side]; X_['gf'] += g['ag'] if side == 0 else g['hg']; X_['gfx'] += xgf[side]
        X_.setdefault('oppn', []).append(opp); X_['sh'].append(s); X_['opp'].append(0)
    G.append((hm, a, 1 - gs))
    last[a] = (d, hm); last[hm] = (d, hm); road[a] += 1; road[hm] = 0
    for e in g['ev']:
        if e['k'] in ('s', 'g') and e.get('gid') and e['xg'] is not None:
            if e.get('pid'): ptal[e['pid']][0] += e['k'] == 'g'; ptal[e['pid']][1] += e['xg'] * c
            gtal[e['gid']][0] += e['k'] == 'g'; gtal[e['gid']][1] += e['xg'] * c
P = pd.DataFrame(P)
pr(f'\n== next-game tests (games {len(P)}; fit 2021-24, test 2024-27) ==')
train, test = P[P.season < 20242025], P[P.season >= 20242025]
def fit(cols, tr=train, te=test):
    X = np.column_stack([tr[c] for c in cols] + [np.ones(len(tr))]); b = np.linalg.lstsq(X, tr.gd, rcond=None)[0]
    Xt = np.column_stack([te[c] for c in cols] + [np.ones(len(te))]); p = Xt @ b; m = te.gd != 0
    return b, corr(p, te.gd), float(np.mean((p[m] > 0) == (te.gd[m] > 0)))
E = {}
for cols in (['mom'], ['mom', 'gq'], ['fin'], ['finx'], ['luck'], ['mom', 'fin'], ['mom', 'finx'], ['mom', 'luck'], ['mom', 'gq', 'fin'],
             ['rate'], ['adj'], ['adj', 'gq'], ['mom', 'rate'], ['b2b'], ['mom', 'gq', 'b2b'], ['mom', 'gq', 'b2b', 'tzs'], ['mom', 'gq', 'dayd'], ['mom', 'gq', 'road'],
             ['adj', 'gq', 'fin', 'b2b'], ['mom', 'gq', 'fin', 'b2b']):
    b, r, pk = fit(cols); E['+'.join(cols)] = dict(r=r, pick=pk, coef=[float(x) for x in b])
    pr(f'  {"+".join(cols):28s} r={r:.4f} pick={pk:.4f}  coef {np.round(b, 3)}')
OUT['next'] = E
# rest/travel raw effects (all seasons, all games incl. first 10)
pr('\n== rest and travel, raw (games after each team\'s 10th) ==')
def eff(mask, label):
    x = P[mask]; pr(f'  {label:40s} n={len(x):5d} away win {x.win.mean():.3f} away goal gap {x.gd.mean():+.3f} away v4 share {0.5 + x.gsh.mean():.3f}')
    return dict(n=len(x), win=x.win.mean(), gd=x.gd.mean(), share=0.5 + x.gsh.mean())
OUT['rest'] = {k: eff(m, k) for k, m in [('all', P.win >= 0), ('away b2b, home rested', (P.ab2b == 1) & (P.hb2b == 0)), ('home b2b, away rested', (P.ab2b == 0) & (P.hb2b == 1)),
    ('both b2b', (P.ab2b == 1) & (P.hb2b == 1)), ('away crossed 2+ time zones', P.atzs >= 2), ('away 4th+ road game in a row', P.road >= 4)]}
# residual effect of b2b after model
b, _, _ = fit(['mom', 'gq'], P, P); X = np.column_stack([P.mom, P.gq, np.ones(len(P))]); P['res'] = P.gd - X @ b
pr('  residual goal gap (after v4 + goalie) when away b2b & home rested: %+.3f ± %.3f' % (P[(P.ab2b == 1) & (P.hb2b == 0)].res.mean(), P[(P.ab2b == 1) & (P.hb2b == 0)].res.std() / math.sqrt(((P.ab2b == 1) & (P.hb2b == 0)).sum())))
pr('  residual when home b2b & away rested: %+.3f ± %.3f' % (P[(P.ab2b == 0) & (P.hb2b == 1)].res.mean(), P[(P.ab2b == 0) & (P.hb2b == 1)].res.std() / math.sqrt(((P.ab2b == 0) & (P.hb2b == 1)).sum())))
# same-game: weighting shots by shooter talent
pr('\n== same-game winner pick, shots weighted by shooter talent (known before the game) ==')
m = P.gd != 0
for cc in (0, 1, 2, 4, 8):
    s = P.gnd + cc * P.gfin
    pr(f'  v4 no-goals + {cc} x finishing: pick {np.mean((s[m] > 0) == (P.gd[m] > 0)):.4f}')
json.dump(OUT, open(sys.argv[2], 'w'), default=float, indent=1)

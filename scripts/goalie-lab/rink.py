# Rink scorer bias: do some arenas record more of an event than the same teams' road games show?
#   python3 -I scripts/goalie-lab/rink.py <pbpCacheDir> <out.json>
import gzip, json, sys, os, math
from collections import defaultdict
import numpy as np, pandas as pd
sys.path = [p for p in sys.path if p]
HP = lambda x, y: x is not None and y is not None and (lambda ax, ay: 54 <= ax <= 89 and (ay <= 4 + (89 - ax) * 18 / 20 if ax >= 69 else ay <= 22))(abs(x), abs(y))
K = {'shot-on-goal': 'sog', 'missed-shot': 'miss', 'blocked-shot': 'block', 'hit': 'hit', 'giveaway': 'give', 'takeaway': 'take', 'goal': 'goal'}
rows = []
for f in sorted(os.listdir(sys.argv[1])):
    if not f.endswith('.ndjson.gz'): continue
    for line in gzip.open(os.path.join(sys.argv[1], f), 'rt'):
        g = json.loads(line)
        if not g.get('plays'): continue
        c = defaultdict(float); dist = []; hp = 0; n = 0
        for p in g['plays']:
            if p['periodDescriptor'].get('periodType') == 'SO': continue
            k = K.get(p['typeDescKey'])
            if not k: continue
            c[k] += 1
            d = p.get('details', {})
            if k in ('sog', 'goal') and d.get('xCoord') is not None:
                dist.append(math.hypot(89 - abs(d['xCoord']), d['yCoord'])); hp += HP(d['xCoord'], d['yCoord']); n += 1
        per = sum(1 for p in g['plays'] if p['typeDescKey'] == 'period-start' and p['periodDescriptor'].get('periodType') != 'SO')
        rows.append(dict(season=int(f[:8]), id=g['id'], home=g['homeTeam']['abbrev'], away=g['awayTeam']['abbrev'], **c,
                         dist=np.mean(dist) if dist else np.nan, hpShare=hp / n if n else np.nan))
G = pd.DataFrame(rows).fillna({k: 0 for k in K.values()})
G['n'] = G.groupby('season').id.rank()
G['half'] = (G.groupby('season').id.rank(pct=True) > .5).astype(int)
metrics = ['sog', 'miss', 'block', 'hit', 'give', 'take', 'goal', 'dist', 'hpShare']
def factors(df):
    """rink factor = per-game value in a team's home games / per-game value in its road games (both teams' events)."""
    h = df.groupby('home')[metrics].mean(); a = df.groupby('away')[metrics].mean()
    return h / a
OUT = {}
pr = lambda *a: print(*a, flush=True)
pr('Rink factor = events per game at that rink / events per game in the same team\'s road games (1.00 = no bias).\n')
allf = []
for s, df in G.groupby('season'):
    f = factors(df); f['season'] = s; allf.append(f.reset_index().rename(columns={'home': 'team'}))
F = pd.concat(allf)
summ = []
for m in metrics:
    sd = F[m].std()
    # season to season: same rink next season
    a = F[['team', 'season', m]]; b = a.assign(season=a.season - 10001)
    j = a.merge(b, on=['team', 'season'], suffixes=('', '_next')).dropna()
    yr = np.corrcoef(j[m], j[m + '_next'])[0, 1]
    # within season halves
    hh = []
    for s, df in G.groupby('season'):
        if df.shape[0] < 900: continue
        f0, f1 = factors(df[df.half == 0])[m], factors(df[df.half == 1])[m]
        hh.append(pd.DataFrame({'a': f0, 'b': f1}))
    hh = pd.concat(hh).dropna(); hr = np.corrcoef(hh.a, hh.b)[0, 1]
    lo, hi = F[m].quantile(.05), F[m].quantile(.95)
    summ.append(dict(metric=m, spreadSD=round(sd, 3), p5=round(lo, 3), p95=round(hi, 3), rSeasonToSeason=round(yr, 2), rHalfToHalf=round(hr, 2)))
S = pd.DataFrame(summ); pr(S.to_string(index=False)); OUT['summary'] = S.to_dict('records')
pr('\nMost extreme rink-seasons for hits and shots on goal:')
for m in ['hit', 'sog', 'miss', 'block', 'give', 'take']:
    t = F.sort_values(m)[['team', 'season', m]]
    pr(f'  {m}: highest', ', '.join(f"{r.team} {str(r.season)[2:4]}-{str(r.season)[6:]} {r[m]:.2f}" for _, r in t.tail(3).iterrows()),
       '| lowest', ', '.join(f"{r.team} {str(r.season)[2:4]}-{str(r.season)[6:]} {r[m]:.2f}" for _, r in t.head(3).iterrows()))
# how much would correcting shots move a team's v4-ish share? (bias hits both teams' shots equally at a rink, so the share barely moves)
pr('\nPer-team consistency of the hits factor by season (rows = rinks with biggest average):')
P = F.pivot(index='team', columns='season', values='hit').round(2)
P['avg'] = P.mean(axis=1); pr(P.sort_values('avg').iloc[list(range(4)) + list(range(-4, 0))].to_string())
OUT['factors'] = F.round(4).to_dict('records')
json.dump(OUT, open(sys.argv[2], 'w'), default=float, indent=1)

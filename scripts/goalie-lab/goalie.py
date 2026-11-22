import json, sys, math, random
import numpy as np, pandas as pd
from collections import defaultdict
D = json.load(open(sys.argv[1]))
D.sort(key=lambda g: (g['date'], g['id']))
OUT = {}
def pr(*a): print(*a, flush=True)
def corr(a, b):
    a, b = np.asarray(a, float), np.asarray(b, float)
    return float(np.corrcoef(a, b)[0, 1]) if len(a) > 2 else None

# ---------- per-shot table (SOG + goals vs a goalie in net) ----------
rows = []
games = []
for g in D:
    ev = g['ev']
    def_goalie_in = lambda e: e['sit'] and len(str(e['sit'])) == 4 and int(str(e['sit'])[3 if e['s'] == 0 else 0]) == 1
    # streak/state per goalie
    st = {}
    lastga = {}
    starter = {0: None, 1: None}  # side -> goalie (side = defending side)
    shots_by_side = []
    for i, e in enumerate(ev):
        if e['k'] not in ('s', 'g') or e['s'] is None: continue
        if e['xg'] is None or not e.get('gid'): continue
        if not def_goalie_in(e): continue
        dside = 1 - e['s']
        gid = e['gid']
        if starter[dside] is None: starter[dside] = gid
        s = st.setdefault(gid, dict(streak=0, sv=0, ga=0, xga=0.0, n=0))
        ppl = str(e['sit']); us = int(ppl[1 if e['s'] == 0 else 2]); them = int(ppl[2 if e['s'] == 0 else 1])
        goal = 1 if e['k'] == 'g' else 0
        rows.append(dict(season=g['season'], gameid=g['id'], gid=gid, t=e['t'], per=e['per'], xg=e['xg'], hp=e['hp'], goal=goal,
                         streak=s['streak'], n=s['n'], gsax=s['xga'] - s['ga'], sincega=e['t'] - lastga.get(gid, -9999),
                         pp=1 if us > them else 0, sh=1 if us < them else 0))
        s['n'] += 1; s['xga'] += e['xg']
        if goal: s['ga'] += 1; s['streak'] = 0; lastga[gid] = e['t']
        else: s['sv'] += 1; s['streak'] += 1
    g['starter'] = starter
S = pd.DataFrame(rows)
pr('shots', len(S), 'goal rate', S.goal.mean().round(4), 'mean xg', S.xg.mean().round(4))
# calibrate our xG to the data (overall scale), per season
S['xgc'] = S.xg * S.groupby('season').goal.transform('sum') / S.groupby('season').xg.transform('sum')
# goalie talent: season goals/xG excluding this game
gs = S.groupby(['season', 'gid']).agg(G=('goal', 'sum'), X=('xgc', 'sum'))
gg = S.groupby(['season', 'gid', 'gameid']).agg(g1=('goal', 'sum'), x1=('xgc', 'sum')).reset_index()
gg = gg.merge(gs.reset_index(), on=['season', 'gid'])
K = 60.0  # shrink: add K expected goals at league rate
gg['tal'] = (gg.G - gg.g1 + K) / (gg.X - gg.x1 + K)
S = S.merge(gg[['season', 'gid', 'gameid', 'tal']], on=['season', 'gid', 'gameid'])
S['exp'] = S.xgc * S.tal

def table(df, col, bins, labels):
    df = df.copy(); df['b'] = pd.cut(df[col], bins, labels=labels, right=False)
    t = df.groupby('b', observed=True).agg(shots=('goal', 'size'), goals=('goal', 'sum'), xg=('xgc', 'sum'), exp=('exp', 'sum'))
    t['sv%'] = 1 - t.goals / t.shots; t['act/xG'] = t.goals / t.xg; t['act/exp(talent)'] = t.goals / t.exp
    return t.round(3)
pr('\n== A. Save streak before a shot (consecutive saves this game) ==')
A = table(S, 'streak', [0, 1, 5, 10, 15, 20, 30, 999], ['0', '1-4', '5-9', '10-14', '15-19', '20-29', '30+'])
pr(A); OUT['streak'] = A.reset_index().astype({'b': str}).to_dict('records')
pr('\n-- same, excluding first 2 shots of game, even strength only --')
pr(table(S[(S.pp == 0) & (S.sh == 0)], 'streak', [0, 1, 5, 10, 15, 20, 30, 999], ['0', '1-4', '5-9', '10-14', '15-19', '20-29', '30+']))
pr('\n== A2. Seconds since this goalie last allowed a goal ==')
A2 = table(S[S.sincega < 9999], 'sincega', [0, 60, 120, 300, 600, 1200, 99999], ['<1m', '1-2m', '2-5m', '5-10m', '10-20m', '20m+'])
pr(A2); OUT['sincega'] = A2.reset_index().astype({'b': str}).to_dict('records')
pr('\n== A3. In-game GSAx so far (xGA - GA) before the shot ==')
A3 = table(S[S.n >= 10], 'gsax', [-99, -1.5, -0.5, 0.5, 1.5, 99], ['<-1.5', '-1.5..-0.5', '-0.5..0.5', '0.5..1.5', '>1.5'])
pr(A3); OUT['gsaxSoFar'] = A3.reset_index().astype({'b': str}).to_dict('records')
# logistic-like check: is streak still significant after xG + talent? simple binned residual with SE
S['res'] = S.goal - S.exp
for lo, hi in [(0, 1), (1, 10), (10, 20), (20, 999)]:
    x = S[(S.streak >= lo) & (S.streak < hi)]
    pr(f'streak {lo}-{hi}: resid/shot {x.res.mean():+.4f} ± {x.res.std()/math.sqrt(len(x)):.4f}  (n={len(x)})')

# ---------- B. what happens next (team level) after goalie events ----------
pr('\n== B. Next 2 minutes after an event, for the goalie\'s team ==')
def window(ev, i, side, t0, w, per):
    sf = sa = gf = ga = 0
    for e in ev[i + 1:]:
        if e['t'] > t0 + w or e['per'] != per: break
        if e['k'] in ('s', 'g', 'm', 'b') and e['s'] is not None:
            if e['s'] == side: sf += 1; gf += e['k'] == 'g'
            else: sa += 1; ga += e['k'] == 'g'
    return sf, sa, gf, ga
def before(ev, i, side, t0, w, per):
    sf = sa = 0
    for e in reversed(ev[:i]):
        if e['t'] < t0 - w or e['per'] != per: break
        if e['k'] in ('s', 'g', 'm', 'b') and e['s'] is not None:
            if e['s'] == side: sf += 1
            else: sa += 1
    return sf, sa
agg = defaultdict(lambda: np.zeros(7))
for g in D:
    ev = g['ev']; streak = {0: 0, 1: 0}; score = [0, 0]
    for i, e in enumerate(ev):
        if e['k'] not in ('s', 'g') or e['s'] is None or not e.get('gid') or e['per'] > 3: 
            if e['k'] == 'g' and e['s'] is not None: score[e['s']] += 1
            continue
        side = 1 - e['s']  # goalie's team
        sit = str(e['sit'] or '')
        if sit != '1551': 
            if e['k'] == 'g': score[e['s']] += 1; streak[side] = 0
            elif e['k'] == 's': streak[side] += 1
            continue
        if e['t'] % 1200 > 1080: # skip last 2 min of period
            if e['k'] == 'g': score[e['s']] += 1; streak[side] = 0
            else: streak[side] += 1
            continue
        lead = score[side] - score[e['s']]
        if e['k'] == 'g':
            kinds = ['goal against']; streak[side] = 0; score[e['s']] += 1
        else:
            streak[side] += 1
            kinds = ['HD save' if e['hp'] else 'other save']
            if e['xg'] >= 0.15: kinds.append('big save (xG>=.15)')
            if streak[side] in (10, 15, 20): kinds.append(f'streak hits {streak[side]}')
        sf, sa, gf, ga = window(ev, i, side, e['t'], 120, e['per'])
        bf, ba = before(ev, i, side, e['t'], 120, e['per'])
        for k in kinds:
            for kk in (k, f'{k} | lead {max(-1,min(1,lead))}'):
                agg[kk] += np.array([1, sf, sa, gf, ga, bf, ba])
B = []
for k, v in sorted(agg.items()):
    n, sf, sa, gf, ga, bf, ba = v
    B.append(dict(event=k, n=int(n), attShareBefore=round(bf / (bf + ba), 3), attShareAfter=round(sf / (sf + sa), 3), gfPer100=round(100 * gf / n, 2), gaPer100=round(100 * ga / n, 2)))
B = pd.DataFrame(B); pr(B.to_string()); OUT['after'] = B.to_dict('records')

# ---------- C. goalie replaced mid-game ----------
pr('\n== C. Goalie pulled for another goalie (not empty net) ==')
def states(g):
    """score timeline: list of (t, ag, hg)"""
    sc = [0, 0]; out = [(0, 0, 0)]
    for e in g['ev']:
        if e['k'] == 'g' and e['s'] is not None and e['per'] <= 4: sc[e['s']] += 1; out.append((e['t'], sc[0], sc[1]))
    return out
def at(tl, t):
    a = h = 0
    for (tt, x, y) in tl:
        if tt <= t: a, h = x, y
        else: break
    return a, h
def rate_window(g, side, t0, t1):
    sf = sa = gf = ga = 0
    for e in g['ev']:
        if t0 <= e['t'] < t1 and e['k'] in ('s', 'g', 'm', 'b') and e['s'] is not None and e['per'] <= 3 and str(e['sit']) == '1551':
            if e['s'] == side: sf += 1; gf += e['k'] == 'g'
            else: sa += 1; ga += e['k'] == 'g'
    return sf, sa, gf, ga
pulls = []
for g in D:
    seen = {0: None, 1: None}; lastt = {0: 0, 1: 0}
    for e in g['ev']:
        if e['k'] not in ('s', 'g') or e['s'] is None or not e.get('gid') or e['per'] > 3: continue
        side = 1 - e['s']
        if seen[side] is None: seen[side] = e['gid']
        elif seen[side] != e['gid'] and seen[side] != 'done':
            pulls.append((g, side, lastt[side] + 1)); seen[side] = 'done'
        if seen[side] != 'done': lastt[side] = e['t']
pr('pulls', len(pulls))
# baseline: every team-game trailing at checkpoint every 5 min in periods 1-3
base = defaultdict(lambda: np.zeros(3))  # (deficit, period) -> [n, win, gd_rest]
for g in D:
    tl = states(g); fa, fh = g['ag'], g['hg']
    for side in (0, 1):
        for t in range(300, 3600, 300):
            a, h = at(tl, t); d = (a - h) if side == 0 else (h - a)
            if d >= 0: continue
            fd = (fa - fh) if side == 0 else (fh - fa)
            per = t // 1200 + 1
            base[(max(d, -4), per)] += [1, fd > 0, fd - d]
diffs=[]; wd=[]
C = np.zeros(8); win = 0; expwin = 0; gdrest = 0; expgd = 0
for g, side, t in pulls:
    tl = states(g); a, h = at(tl, t); d = (a - h) if side == 0 else (h - a)
    fd = (g['ag'] - g['hg']) if side == 0 else (g['hg'] - g['ag'])
    per = min(3, t // 1200 + 1)
    b = base.get((max(min(d, -1) if d < 0 else d, -4), per))
    if d < 0 and b is not None and b[0] > 50:
        win += fd > 0; expwin += b[1] / b[0]; gdrest += fd - d; expgd += b[2] / b[0]; diffs.append((fd - d) - b[2] / b[0]); wd.append((fd>0) - b[1]/b[0])
    sb = rate_window(g, side, max(0, t - 600), t); sa_ = rate_window(g, side, t, t + 600)
    C += np.array([*sb, *sa_])
npull = len([1 for g, s, t in pulls])
pr(f'att share 10 min before {C[0]/(C[0]+C[1]):.3f}  after {C[4]/(C[4]+C[5]):.3f}; GF/GA before {C[2]:.0f}/{C[3]:.0f} after {C[6]:.0f}/{C[7]:.0f} (even strength)')
nd = sum(1 for g, s, t in pulls if True)
OUT['pulls'] = dict(n=len(pulls), shareBefore=C[0]/(C[0]+C[1]), shareAfter=C[4]/(C[4]+C[5]), gfBefore=C[2], gaBefore=C[3], gfAfter=C[6], gaAfter=C[7], win=int(win), expWin=expwin, gdRest=gdrest, expGdRest=expgd)
pr(f'matched n={len(diffs)} gd diff/game {np.mean(diffs):+.3f}±{np.std(diffs)/np.sqrt(len(diffs)):.3f} win diff {np.mean(wd):+.3f}±{np.std(wd)/np.sqrt(len(wd)):.3f}')
pr(f'trailing teams that changed goalie: wins {win} vs expected {expwin:.1f} for same deficit/period; goal diff rest of game {gdrest:+.0f} vs expected {expgd:+.1f}')

# ---------- D. hot through 2 periods -> 3rd period ----------
pr('\n== D. Goalie GSAx in periods 1-2 vs his 3rd period ==')
S12 = S[S.per <= 2].groupby(['gameid', 'gid']).agg(g12=('goal', 'sum'), x12=('xgc', 'sum'), n12=('goal', 'size'), tal=('tal', 'first'))
S3 = S[S.per == 3].groupby(['gameid', 'gid']).agg(g3=('goal', 'sum'), x3=('xgc', 'sum'), e3=('exp', 'sum'), n3=('goal', 'size'))
J = S12.join(S3, how='inner'); J = J[J.n12 >= 15]
J['gsax12'] = J.x12 - J.g12
J['b'] = pd.qcut(J.gsax12, 5)
Dt = J.groupby('b', observed=True).agg(goalies=('g3', 'size'), ga3=('g3', 'sum'), xg3=('x3', 'sum'), exp3=('e3', 'sum'), shots3=('n3', 'sum'))
Dt['p3 sv%'] = 1 - Dt.ga3 / Dt.shots3; Dt['p3 act/xG'] = Dt.ga3 / Dt.xg3; Dt['p3 act/exp(talent)'] = Dt.ga3 / Dt.exp3
pr(Dt.round(3)); pr('r(gsax12, p3 gsax) =', round(corr(J.gsax12, J.x3 - J.g3), 4), ' after talent:', round(corr(J.gsax12, J.e3 - J.g3), 4), 'n', len(J))
OUT['hot12'] = dict(r=corr(J.gsax12, J.x3 - J.g3), rTalent=corr(J.gsax12, J.e3 - J.g3), n=len(J), table=Dt.reset_index().astype({'b': str}).round(4).to_dict('records'))

# ---------- E. prediction: next game ----------
pr('\n== E. Next-game prediction: team shots model + goalie ==')
tot = defaultdict(lambda: dict(gp=0, nf=0, na=0))
gtot = defaultdict(lambda: dict(G=0.0, X=0.0, n=0, last=[]))   # per goalie, career-to-date in sample (carries across seasons)
ttot = defaultdict(lambda: dict(G=0.0, X=0.0))  # team goalies, season to date
gx = S.groupby(['gameid', 'gid']).agg(G=('goal', 'sum'), X=('xgc', 'sum'), n=('goal', 'size'))
gx = {k: v for k, v in zip(gx.index, gx.to_dict('records'))}
P = []
cur = None
for g in D:
    if g['season'] != cur:
        cur = g['season']; tot.clear(); ttot.clear()
    A, H = tot[g['a']], tot[g['h']]
    sa_, sh_ = g['starter'][0], g['starter'][1]
    def gq(gid, K=40):
        q = gtot[gid]; return (q['X'] - q['G']) / (q['X'] + K) if gid else 0  # GSAx per xG, shrunk
    def recent(gid, n=5):
        q = gtot[gid]['last'][-n:]; 
        return sum(x - y for y, x in q) / (sum(x for y, x in q) + 10) if q else 0
    def tq(team, K=40):
        q = ttot[(team)]; return (q['X'] - q['G']) / (q['X'] + K)
    share = lambda T: T['nf'] / (T['nf'] + T['na']) if T['nf'] + T['na'] else .5
    if A['gp'] >= 10 and H['gp'] >= 10:
        P.append(dict(season=g['season'], mom=share(A) - share(H), gq=gq(sa_) - gq(sh_), tq=tq(g['a']) - tq(g['h']), rec=recent(sa_) - recent(sh_),
                      gd=g['ag'] - g['hg'], win=1 if g['ag'] > g['hg'] else 0))
    A['gp'] += 1; A['nf'] += g['an']; A['na'] += g['hn']; H['gp'] += 1; H['nf'] += g['hn']; H['na'] += g['an']
    for side, team in ((0, g['a']), (1, g['h'])):
        for (gid_, gm) in [(k[1], v) for k, v in [((g['id'], x), gx.get((g['id'], x))) for x in set(e.get('gid') for e in g['ev'] if e.get('gid'))] if v]:
            pass
    for x in set(e.get('gid') for e in g['ev'] if e.get('gid')):
        v = gx.get((g['id'], x))
        if not v: continue
        q = gtot[x]; q['G'] += v['G']; q['X'] += v['X']; q['n'] += v['n']; q['last'].append((v['G'], v['X']))
        # which team? goalie defends side whose starter... use roster: shots against him are by the other side
    # team goalie totals
    for side, team in ((0, g['a']), (1, g['h'])):
        GG = sum(1 for e in g['ev'] if e['k'] == 'g' and e['s'] == 1 - side and e.get('gid'))
        XX = sum(e['xg'] for e in g['ev'] if e['k'] in ('s', 'g') and e['s'] == 1 - side and e.get('gid') and e['xg'])
        ttot[team]['G'] += GG; ttot[team]['X'] += XX * 1.0
P = pd.DataFrame(P)
pr('games', len(P), 'sd gq', P.gq.std(), 'sd mom', P.mom.std())
for c in ['mom', 'gq', 'tq', 'rec']: pr(f'  r({c}, goal gap) = {corr(P[c], P.gd):.4f}')
train = P[P.season < 20242025]; test = P[P.season >= 20242025]
def fit(cols):
    X = np.column_stack([train[c] for c in cols] + [np.ones(len(train))]); b = np.linalg.lstsq(X, train.gd, rcond=None)[0]
    if not len(test): return b, float('nan'), None
    Xt = np.column_stack([test[c] for c in cols] + [np.ones(len(test))]); return b, corr(Xt @ b, test.gd), float(np.mean(((Xt @ b) > np.median(Xt @ b)) == (test.gd > 0)))
E = {}
def pick(cols):
    b,_,_=fit(cols); Xt=np.column_stack([test[c] for c in cols]+[np.ones(len(test))]); p=Xt@b; m=test.gd!=0
    return float(np.mean((p[m]>0)==(test.gd[m]>0)))
pr('pick next game mom', pick(['mom']), 'mom+gq', pick(['mom','gq']))
for cols in (['mom'], ['gq'], ['mom', 'gq'], ['mom', 'tq'], ['mom', 'gq', 'rec'], ['mom', 'rec']):
    b, r, _ = fit(cols); E['+'.join(cols)] = dict(r=r, coef=[round(x, 3) for x in b]); pr(f'  test 2024-27 r({"+".join(cols)}) = {r:.4f}  coef {np.round(b,3)}')
OUT['nextGame'] = E

# ---------- F. goalie skill persistence + rebounds ----------
pr('\n== F. Is it a skill? first half vs second half of season, goalies 400+ shots each half ==')
reb = []
for g in D:
    ev = g['ev']
    for i, e in enumerate(ev):
        if e['k'] != 's' or not e.get('gid') or e['s'] is None: continue
        r = 0
        for f in ev[i + 1:]:
            if f['t'] - e['t'] > 3 or f['per'] != e['per']: break
            if f['k'] in ('s', 'g', 'm', 'b') and f['s'] == e['s']: r = 1; break
        reb.append((g['id'], e['gid'], r, e['t']))
R = pd.DataFrame(reb, columns=['gameid', 'gid', 'reb', 't'])
pr('rebound rate per save', round(R.reb.mean(), 4))
# goal rate on rebound shots
S2 = S.copy()
gm = {g['id']: g for g in D}
mid = {s: sorted(x.gameid.unique())[len(x.gameid.unique()) // 2] for s, x in S.groupby('season')}
S['half'] = [1 if gi >= mid[s] else 0 for gi, s in zip(S.gameid, S.season)]
R = R.merge(S[['gameid', 'season']].drop_duplicates(), on='gameid'); R['half'] = [1 if gi >= mid[s] else 0 for gi, s in zip(R.gameid, R.season)]
h = S.groupby(['season', 'gid', 'half']).agg(G=('goal', 'sum'), X=('xgc', 'sum'), n=('goal', 'size')).unstack('half')
rr = R.groupby(['season', 'gid', 'half']).reb.mean().unstack('half')
h = h[(h[('n', 0)] >= 400) & (h[('n', 1)] >= 400)]
g0 = (h[('X', 0)] - h[('G', 0)]) / h[('n', 0)]; g1 = (h[('X', 1)] - h[('G', 1)]) / h[('n', 1)]
sv0 = 1 - h[('G', 0)] / h[('n', 0)]; sv1 = 1 - h[('G', 1)] / h[('n', 1)]
rr = rr.loc[h.index]
pr(f'goalie-seasons {len(h)}; r(sv% H1, sv% H2) = {corr(sv0, sv1):.3f}; r(GSAx/shot H1,H2) = {corr(g0, g1):.3f}; r(rebound rate H1,H2) = {corr(rr[0], rr[1]):.3f}; r(rebound H1, GSAx/shot H2) = {corr(rr[0], g1):.3f}')
OUT['persist'] = dict(n=len(h), sv=corr(sv0, sv1), gsax=corr(g0, g1), reb=corr(rr[0], rr[1]), rebToGsax=corr(rr[0], g1))

# ---------- G. close after 2 periods: does a hot goalie hold on? ----------
pr('\n== G. Games within one goal after 2 periods: win % by periods 1-2 shot share and goalie GSAx gap ==')
gs12 = S[S.per <= 2].groupby(['gameid']).apply(lambda x: x.assign(side=0)).reset_index(drop=True) if False else None
Gr = []
x12 = {}
for (gi, gid_), v in S[S.per <= 2].groupby(['gameid', 'gid']).agg(G=('goal', 'sum'), X=('xgc', 'sum')).iterrows(): x12.setdefault(gi, {})[gid_] = v.X - v.G
for g in D:
    sc = [0, 0]; att = [0, 0]; gsx = [0.0, 0.0]
    for e in g['ev']:
        if e['per'] > 2 or e['s'] is None: continue
        if e['k'] in ('s', 'g', 'm', 'b'): att[e['s']] += 1
        if e['k'] == 'g': sc[e['s']] += 1
        if e['k'] in ('s', 'g') and e.get('gid') and e['xg'] is not None: gsx[1 - e['s']] += e['xg'] * 0.98 - (e['k'] == 'g')
    d = sc[0] - sc[1]
    if abs(d) > 1 or not sum(att): continue
    Gr.append(dict(lead=d, share=att[0] / sum(att), gsx=gsx[0] - gsx[1], win=1 if g['ag'] > g['hg'] else 0))
    Gr.append(dict(lead=-d, share=1 - att[0] / sum(att), gsx=gsx[1] - gsx[0], win=1 - (1 if g['ag'] > g['hg'] else 0)))
Gr = pd.DataFrame(Gr)
Gr['shareB'] = pd.cut(Gr.share, [0, .45, .55, 1], labels=['outshot', 'even', 'outshooting'])
Gr['gsxB'] = pd.cut(Gr.gsx, [-99, -1, 1, 99], labels=['goalie worse', 'similar', 'goalie better'])
Gr = Gr.iloc[::2].reset_index(drop=True)  # one row per game (away side) so rows are independent
X = np.column_stack([Gr.lead, Gr.share - .5, Gr.gsx, np.ones(len(Gr))]); b = np.linalg.lstsq(X, Gr.win, rcond=None)[0]
res = Gr.win - X @ b; cov = np.linalg.inv(X.T @ X) * res.var(); se = np.sqrt(np.diag(cov))
pr(f'linear win model, n={len(Gr)}: per goal of lead {b[0]:+.3f}±{se[0]:.3f}; per 10 pts of shot share {b[1]/10:+.3f}±{se[1]/10:.3f}; per goal saved above expected (gap) {b[2]:+.3f}±{se[2]:.3f}')
X2 = np.column_stack([Gr.lead, Gr.share - .5, np.ones(len(Gr))]); b2 = np.linalg.lstsq(X2, Gr.win, rcond=None)[0]
pr(f'  without goalie term: share coef per 10 pts {b2[1]/10:+.3f}')
OUT['close2'] = dict(n=len(Gr), lead=b[0], share10=b[1]/10, gsax=b[2], gsaxSe=se[2], share10se=se[1]/10)
json.dump(OUT, open(sys.argv[2], 'w'), default=float, indent=1)

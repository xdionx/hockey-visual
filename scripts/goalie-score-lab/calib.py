import sys, numpy as np, pandas as pd
sys.path.insert(0, __import__('os').path.dirname(__file__))
from lib import *
d = load(sys.argv[1])
print(f"shots {len(d)}, goals {d.goal.sum()}, goal rate {d.goal.mean():.4f}, mean xG {d.xg.mean():.4f}\n")
def tab(title, key):
    t = d.groupby(key).agg(shots=('goal', 'size'), goals=('goal', 'sum'), rate=('goal', 'mean'), xg=('xg', 'mean'))
    t['act/xG'] = t.rate / t.xg; t['share'] = t.shots / len(d)
    print('==', title, '=='); print(t.round(4).to_string()); print()
tab('strength (PP = goalie team shorthanded, facing a power play)', 'strength')
tab('rebound (prior shot on goal by same team 1-3 s earlier)', 'reb')
d['gapb'] = pd.cut(d.gap, [-1, 1, 2, 3, 5, 8, 15, 1e9]); tab('seconds since previous shot on goal', 'gapb')
d['seqb'] = pd.cut(d.n10, [-1, 0, 1, 2, 3, 99]); tab('shot attempts by that team in prior 10 s', 'seqb')
tab('shot type', 'ptype')
tab('area', 'area')
d['perim'] = np.where(d.plate == 1, 'plate', 'outside plate'); tab('plate vs outside', 'perim')
d['rebz'] = d.reb.astype(str) + '/' + d.area; tab('rebound x area', 'rebz')
d['stz'] = d.strength + '/' + d.area; tab('strength x area', 'stz')
d['stt'] = d.strength + '/tip' + d.tip.astype(str); tab('strength x tip', 'stt')
d['stp'] = d.sh.astype(str) + 'v' + d.dk.astype(str); t = d.groupby('stp').size(); keep = t[t > 800].index; d2 = d[d.stp.isin(keep)]
t = d2.groupby('stp').agg(shots=('goal', 'size'), rate=('goal', 'mean'), xg=('xg', 'mean')); t['act/xG'] = t.rate / t.xg; print('== skaters (shooter v defender) =='); print(t.round(4).to_string()); print()

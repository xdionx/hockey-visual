# Predicting who dresses from the team's last game, and whether a predicted lineup keeps the lineup model's gain.
import sys
exec(open('missing.py').read())
say('\n== 5. Predicting the lineup from the last game ==')
s5 = skp.copy()
s5['mom_post'] = (s5.mom_c + s5.mom) / (s5.n_c + 1 + K)
s5['fin_post'] = (s5.gva_c + s5.gva) / (s5.xg_c + s5.xg + 30)
s5['imp_post'] = (s5.impact_c + s5.impact) / (s5.n_c + 1 + K)
tgames = s5[['season', 'team', 'date', 'game']].drop_duplicates().sort_values(['season', 'team', 'date', 'game'])
tgames['prev'] = tgames.groupby(['season', 'team']).game.shift(1)
dressed = s5.groupby(['game', 'team']).pid.apply(set)
hits, sizes = [], []
for row in tgames.dropna(subset=['prev']).itertuples():
    now = dressed[(row.game, row.team)]; before = dressed[(int(row.prev), row.team)]
    hits.append(len(now & before)); sizes.append(len(now))
hits = np.array(hits); sizes = np.array(sizes)
say(f'  skaters dressed per game {sizes.mean():.1f}; same as last game {hits.mean():.1f} ({(hits / sizes).mean():.1%}); identical lineup {(hits == sizes).mean():.1%} of games; 1 change {(sizes - hits == 1).mean():.1%}; 2+ changes {(sizes - hits >= 2).mean():.1%}')
prevsum = s5.groupby(['game', 'team']).agg(P_mom=('mom_post', 'sum'), P_fin=('fin_post', 'sum')).reset_index().rename(columns={'game': 'prev'})
tp = tgames.dropna(subset=['prev']).astype({'prev': int}).merge(prevsum, on=['prev', 'team'])[['game', 'team', 'P_mom', 'P_fin']]
m5 = mt.merge(tp, on=['game', 'team']).merge(tp.rename(columns={'team': 'o_team', 'P_mom': 'o_P_mom', 'P_fin': 'o_P_fin'}), on=['game', 'o_team'])
m5['d_P_mom'] = m5.P_mom - m5.o_P_mom; m5['d_P_fin'] = m5.P_fin - m5.o_P_fin
tr5, te5 = m5[m5.season <= 20232024], m5[m5.season >= 20242025]
for name, cols in [('team momentum + goalie', ['d_T_mom', 'd_G']),
                   ('team + ACTUAL lineup mom + finishing + goalie', ['d_T_mom', 'd_L_mom', 'd_L_fin', 'd_G']),
                   ('team + LAST-GAME lineup mom + finishing + goalie', ['d_T_mom', 'd_P_mom', 'd_P_fin', 'd_G'])]:
    b = logit_fit(tr5[cols].values, tr5.won.values.astype(float))
    for lab, sub in [('all', te5), ('key player out', te5[te5.anymiss]), ('full lineups', te5[~te5.anymiss])]:
        p = logit_pred(b, sub[cols].values); sc = scores(p, sub.won.values.astype(float))
        say(f'  {name:50s} {lab:15s} pick {sc["acc"]:.1%} log loss {sc["logloss"]:.4f} r {r(p, (sub.gf - sub.ga).values):.3f} (n {len(sub)})')
# Of key players out today, how many were also out last game?
open('lineup-results.txt', 'w').write('\n'.join(out) + '\n')

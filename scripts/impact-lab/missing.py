# Appended test: games where a team's usual top players are missing. Runs impact.py first (exec), then this.
import sys
exec(open('impact.py').read())
say('\n== 4. Games with key players missing ==')
# Season-to-date team regulars: top 3 skaters by prior mom per game on this team (10+ games for the team).
sk2 = sk.sort_values(['date', 'game']).copy()
sk2['tgp_p'] = sk2.groupby(['season', 'team', 'pid']).cumcount()
sk2['tmom_p'] = sk2.groupby(['season', 'team', 'pid']).mom.cumsum() - sk2.mom
games_t = sk2[['season', 'game', 'date', 'team']].drop_duplicates().sort_values(['date', 'game'])
# For each team-game, the set of players who'd played 10+ prior games for this team, ranked by prior mom/gp.
miss = []
hist = {}
for (season, game, date, team), grp in sk2.groupby(['season', 'game', 'date', 'team'], sort=False):
    pass
# Faster: build per team-season running dict.
sk2 = sk2.sort_values(['season', 'team', 'date', 'game'])
for (season, team), d in sk2.groupby(['season', 'team']):
    tot = {}
    for game, g in d.groupby('game', sort=False):
        ranked = sorted(((v[1] / v[0], p) for p, v in tot.items() if v[0] >= 10), reverse=True)[:3]
        top = [p for _, p in ranked]
        dressed = set(g.pid)
        miss.append((game, team, sum(1 for p in top if p not in dressed), len(top)))
        for p, mo in zip(g.pid, g.mom):
            n, s = tot.get(p, (0, 0.0)); tot[p] = (n + 1, s + mo)
mm = pd.DataFrame(miss, columns=['game', 'team', 'miss', 'ntop'])
mt = m.merge(mm, on=['game', 'team']).merge(mm.rename(columns={'team': 'o_team', 'miss': 'o_miss', 'ntop': 'o_ntop'}), on=['game', 'o_team'])
mt['anymiss'] = (mt.miss > 0) | (mt.o_miss > 0)
tr2, te2 = mt[mt.season <= 20232024], mt[mt.season >= 20242025]
say(f'  test games with a top-3 player out on either side: {te2.anymiss.sum()} of {len(te2)}')
for name, cols in [('team momentum + goalie', ['d_T_mom', 'd_G']), ('team + lineup momentum + finishing + goalie', ['d_T_mom', 'd_L_mom', 'd_L_fin', 'd_G'])]:
    b = logit_fit(tr2[cols].values, tr2.won.values.astype(float))
    for lab, sub in [('key player out', te2[te2.anymiss]), ('full lineups', te2[~te2.anymiss])]:
        p = logit_pred(b, sub[cols].values); sc = scores(p, sub.won.values.astype(float))
        say(f'  {name:45s} {lab:15s} pick {sc["acc"]:.1%} log loss {sc["logloss"]:.4f} r {r(p, (sub.gf - sub.ga).values):.3f} (n {len(sub)})')
# How much does a missing top player cost? goal diff vs team-only expectation
b = logit_fit(train[['d_T_mom', 'd_G']].values, ytr)
mt['exp'] = logit_pred(b, mt[['d_T_mom', 'd_G']].values)
mt['net_miss'] = mt.miss - mt.o_miss
say('  Home win % minus team-model expectation, by (home top players out − away top players out):')
for k, d in mt.groupby(mt.net_miss.clip(-2, 2)):
    say(f'    {k:+d}: actual {d.won.mean():.1%} vs expected {d.exp.mean():.1%} (n {len(d)})')
open('missing-results.txt', 'w').write('\n'.join(out) + '\n')

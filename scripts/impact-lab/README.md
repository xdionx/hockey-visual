# Impact lab (research, not used by the site)

Player impact from momentum, finishing (goals vs an average shooter) and goaltending (saves vs an
average goalie): how games are won, how often players are above/at/below average, and whether a
lineup's player history helps the pre-game pick.

    node scripts/cache-pbp.js <cache> --seasons 20212022,...
    node scripts/impact-lab/players.mjs <cache> players.csv   # one row per player per game
    python3 -I scripts/impact-lab/impact.py players.csv       # needs numpy + pandas

`results-2026-11-22.txt`: 6,932 games, 2021-22 to 2026-27 (372 games so far).

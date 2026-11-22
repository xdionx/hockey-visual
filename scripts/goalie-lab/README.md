# Goalie lab (research, not used by the site)

Tests whether goalie events signal a momentum shift: save streaks, time since a goal against,
in-game saves above expected, big saves, goalie changes, hot first 40 minutes, starter quality
for the next game, and rebound control.

    node scripts/cache-pbp.js <cache> --seasons 20212022,...   # slim play-by-play
    node scripts/goalie-lab/flatten.mjs <cache> <all.json>       # shots + v4 team totals per game
    python3 -I scripts/goalie-lab/goalie.py <all.json> <out.json> # needs numpy + pandas

`results-2026-11-22.txt` is the run over 6,920 games (2021-22 to 2026-27 so far).

# Scoring lab (research)

Does adding assists to finishing give a fairer, more lasting picture of a skater's scoring?

    node scripts/cache-pbp.js <cache> --seasons 20212022,...
    node scripts/scoring-lab/players.mjs <cache> players.csv
    python3 -I scripts/scoring-lab/scoring.py players.csv      # needs numpy + pandas

Results (2021-22 to 2026-27, 6,937 games): see results-2026-11-23.txt.

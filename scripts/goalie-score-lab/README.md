# Goalie score lab (research, not used by the site)

Tests how to weight goalie saves by type (strength, rebounds, tips, plate area) and compares goalie game score variants.

    node scripts/cache-pbp.js <cache> --seasons 20222023,...,20262027
    node scripts/goalie-score-lab/flatten.mjs <cache> shots.csv      # one row per shot a goalie faced
    python3 -I scripts/goalie-score-lab/calib.py shots.csv            # goal rate vs our xG by kind of shot
    python3 -I scripts/goalie-score-lab/model.py shots.csv model.json # richer xG, trained 2022-24, tested 2024-27
    python3 -I scripts/goalie-score-lab/persist.py shots.csv model.json d.pkl; persist2.py d.pkl  # luck vs skill per save type
    python3 -I scripts/goalie-score-lab/score.py d.pkl                # current vs proposed ratings (needs numpy + pandas)

Results from 2026-11-25 are in results-*.txt. Findings: /mnt/project-files/goalie-score-lab/FINDINGS.md.

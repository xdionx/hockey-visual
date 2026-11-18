# hockey-visual

Per-player NHL game scorecards that will roll up into season and career scores.

![Scores page](docs/scores-page.png)

The first piece is a scores page. Pick a date and see every game's linescore (goals by
period, OT/SO when played, total, shots) and the goal scorers with assists.
Live games refresh every 30 seconds.

## Hosting (GitHub Pages)

| Site | Branch | URL |
| --- | --- | --- |
| Production | `main` | https://xdionx.github.io/hockey-visual/ |
| Test | `develop` | https://xdionx.github.io/hockey-visual/test/ |

GitHub Pages only serves static files, and the NHL API can't be called from a
browser (it sends no CORS headers). So the GitHub Action in
`.github/workflows/publish.yml`:

1. runs `scripts/update-data.js`, which saves each date's scores as
   `data/scores/<date>.json` (plus `data/latest.json` for "today"),
2. keeps those files on the `scores-data` branch so only the last 2 days and
   the next 2 weeks are re-fetched each run,
3. publishes `main` at the site root and `develop` under `/test/`.

It runs on every push to `main` or `develop`, every 10 minutes from noon to
3 AM Eastern (GitHub can delay scheduled runs by a few minutes), and on demand
from the Actions tab. Live scores on the hosted site are therefore up to about
10 minutes behind.

One-time setup: in the repo's **Settings → Pages**, set **Source** to
**GitHub Actions**.

## Run it locally

Needs Node 18 or newer, and nothing else (no `npm install`).

```
npm start          # http://localhost:3000   (PORT=4000 npm start to change)
npm test           # unit tests for the data layer
```

Locally, `server.js` answers the same `data/...` URLs live from the NHL API,
so you don't need to run the data script. Open
`http://localhost:3000/?date=2026-11-14` to jump straight to a date.

## Layout

| Path | What it is |
| --- | --- |
| `src/nhlApi.js` | NHL API client with a small cache and 429 back-off. Already has `getBoxscore`, `getPlayByPlay`, `getRightRail`, `getPlayer` for the scorecard work. |
| `src/normalize.js` | Pure functions that turn raw API games into `{ status, away, home, linescore, goals }`. Reusable by later scorecard / season / career code. |
| `scripts/update-data.js` | Saves score files for the hosted site. |
| `server.js` | Local dev server. Zero dependencies. |
| `public/` | The page: `index.html`, `app.js`, `styles.css`. |
| `test/` | `node --test` tests against a saved real-game fixture (regulation, OT, shootout). |

## NHL API notes

- `GET /v1/score/{date}` (or `/v1/score/now`) returns every game for a date,
  with each goal (period, time, scorer, assists, strength). The linescore is
  built from that list; the shootout column shows the deciding goal only
  (1-0), matching nhl.com and the official `right-rail` linescore.
- `gameState`: `FUT`/`PRE` upcoming, `LIVE`/`CRIT` in progress, `FINAL`/`OFF` done.
- Behind a corporate/agent HTTPS proxy, run with `NODE_USE_ENV_PROXY=1` (Node 22.21+).

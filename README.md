# hockey-visual

Per-player NHL game scorecards that will roll up into season and career scores.

![Scores page](docs/scores-page.png)

The first piece is a scores page. Pick a date and see every game's linescore (goals by
period, OT/SO when played, total, shots) and the goal scorers with assists.
Live games refresh every 30 seconds.

## Run it

Needs Node 18 or newer, and nothing else (no `npm install`).

```
npm start          # http://localhost:3000   (PORT=4000 npm start to change)
npm test           # unit tests for the data layer
```

Open `http://localhost:3000/?date=2026-11-14` to jump straight to a date.

## Why there's a server

`api-web.nhle.com` sends no CORS headers, so a browser page can't call it
directly. `server.js` serves the page and exposes `/api/scores?date=YYYY-MM-DD`,
which fetches from the NHL API and returns a cleaned-up shape.

## Layout

| Path | What it is |
| --- | --- |
| `src/nhlApi.js` | NHL API client with a small cache. Already has `getBoxscore`, `getPlayByPlay`, `getRightRail`, `getPlayer` for the scorecard work. |
| `src/normalize.js` | Pure functions that turn raw API games into `{ status, away, home, linescore, goals }`. Reusable by later scorecard / season / career code. |
| `server.js` | Static file server + `/api/scores` proxy. Zero dependencies. |
| `public/` | The page: `index.html`, `app.js`, `styles.css`. |
| `test/` | `node --test` tests against a saved real-game fixture (regulation, OT, shootout). |

## NHL API notes

- `GET /v1/score/{date}` (or `/v1/score/now`) returns every game for a date,
  with each goal (period, time, scorer, assists, strength). The linescore is
  built from that list; the shootout column shows the deciding goal only
  (1-0), matching nhl.com and the official `right-rail` linescore.
- `gameState`: `FUT`/`PRE` upcoming, `LIVE`/`CRIT` in progress, `FINAL`/`OFF` done.
- Behind a corporate/agent HTTPS proxy, run with `NODE_USE_ENV_PROXY=1` (Node 22.21+).

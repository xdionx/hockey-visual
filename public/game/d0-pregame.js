// Design "Pregame" (view 0): the matchup before puck drop, our pick against the books, the tale of the
// tape and a scouting card per team. It stays available once the game starts, so you can look back at
// how the teams came in. game.pregame is filled in by game.js.
import { esc } from './core.js';
import { hero } from './d2-broadcast.js';
import { colors, header } from './d6-story.js';
import { pregameDek, pregameCards } from './d6-pregame.js';

export default {
  id: 'pregame',
  name: 'Pregame',
  inspiration: 'The matchup: our pick, the tale of the tape and a scouting card per team',
  classes: 'd-story d-broadcast d-analytics d-scorecards',
  render(game) {
    const c = colors(game);
    const state = game.status.state;
    const started = state === 'live' || state === 'final';
    const dek = started
      ? ['How the teams came into this game. Season numbers are to date, so they now include this game, and our pick is worked out from them; it can differ a little from the pick before puck drop.']
      : state === 'pre' ? pregameDek(game) : [game.status.label];
    return `<div class="b-wrap st-wrap">
      ${hero(game, c, { strip: false, shots: true })}
      <section class="st-sec" id="st-pregame">
        ${header(0, 'pregame', 'Pregame', 'How the teams came into the game')}
        <div class="st-lede"><h1>${esc(game.away.commonName)} at ${esc(game.home.commonName)}</h1>${dek.map((d) => `<p>${esc(d)}</p>`).join('')}</div>
        ${pregameCards(game, c)}
      </section>
    </div>`;
  },
};

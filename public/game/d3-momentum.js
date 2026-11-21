// Design "Momentum": everything we know about who was pushing the play, and why.
import { hero } from './d2-broadcast.js';
import { kpis, flowChart } from './d4-analytics.js';
import { momentumTimeline } from './d6-chapters.js';
import { colors, header, miniScore, momentumChart, momentumStrip, drivers, killers, periodWins, mountMomentumTips } from './d6-story.js';

export default {
  id: 'broadcast', // keeps saved tab preferences working
  name: 'Momentum',
  inspiration: 'Minute-by-minute momentum, the shifts and what drove them',
  classes: 'd-story d-broadcast d-analytics d-scorecards',
  render(game) {
    const c = colors(game);
    const started = game.status.state === 'live' || game.status.state === 'final';
    return `<div class="b-wrap st-wrap">
      ${hero(game, c, { strip: false, shots: true })}
      ${started ? `
      <section class="st-sec">
        ${header(1, 'momentum', 'Momentum', 'Who was pushing the play, minute by minute. Above the line is the home team, below is the away team.')}
        ${momentumChart(game, c)}
        ${periodWins(game, c)}
      </section>
      <section class="st-sec">
        ${header(2, 'swings', 'What moved it', 'The shifts in the game and the players behind them.')}
        <div class="b-cols st-cols"><div>${momentumTimeline(game, c)}</div><div>${drivers(game, c)}${killers(game, c)}</div></div>
      </section>
      <section class="st-sec">
        ${header(3, 'attempts', 'Pressure by the numbers', 'Shot attempts through the game, with the key indicators.')}
        ${kpis(game, c)}
        ${flowChart(game, c)}
      </section>` : '<p class="st-empty">Momentum appears once the game starts.</p>'}
    </div>`;
  },
  mount(root, game) {
    mountMomentumTips(root, game, colors(game));
  },
};

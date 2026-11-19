// Simulation mode for the box score (?id=<gameId>&sim=<speed>): replays a finished game from its
// play-by-play as if it were live, through the same render path, goal horns included.
import { sliceRaw, replayDuration } from '../src/replay.js';
import { normalizeGameDetail } from '../src/gameDetail.js';
import { getData } from '../data.js';
import { resetGoals } from '../horn.js';

const SPEEDS = [1, 5, 10, 20, 60, 120];
const clockLabel = (t) => {
  const n = Math.floor(t / 1200) + 1;
  const into = t - (n - 1) * 1200;
  const left = Math.max(0, (n > 3 ? 300 : 1200) - into);
  const p = n <= 3 ? ['1st', '2nd', '3rd'][n - 1] : n === 4 ? 'OT' : `${n - 3}OT`;
  return `${p} ${Math.floor(left / 60)}:${String(Math.floor(left % 60)).padStart(2, '0')}`;
};

/** Starts the simulation; `show(gameData)` draws each frame. Returns false when the raw data isn't available. */
export async function startSim({ id, speed, bar, show, onMissing }) {
  // Never just spin: give the data service 30 seconds, then say so.
  const raw = await Promise.race([
    getData(`raw/${id}.json`),
    new Promise((_, reject) => setTimeout(() => reject(new Error('the replay data took too long to load')), 30_000)),
  ]);
  if (!raw?.pbp?.plays?.length) { onMissing(); return; }
  const dur = replayDuration(raw);
  let t = 0;
  let playing = true;
  let loop = true;
  let spd = SPEEDS.includes(speed) ? speed : 20;
  let holdUntil = 0;

  bar.hidden = false;
  bar.innerHTML = `<span class="sim-tag">SIMULATION</span>
    <button type="button" id="sim-play" aria-label="Pause">⏸</button>
    <input id="sim-scrub" type="range" min="0" max="${dur}" step="1" value="0" aria-label="Game clock">
    <span id="sim-clock" class="sim-clock"></span>
    <label>Speed <select id="sim-speed">${SPEEDS.map((s) => `<option value="${s}"${s === spd ? ' selected' : ''}>${s}x</option>`).join('')}</select></label>
    <button type="button" id="sim-restart">⟲ Restart</button>
    <label><input id="sim-loop" type="checkbox" checked> Loop</label>`;
  const $ = (s) => bar.querySelector(s);
  const frame = (quiet) => {
    if (!quiet) resetGoals(); // jumping around the game must not honk for goals we skipped over
    show(normalizeGameDetail(sliceRaw(raw, t)));
    $('#sim-scrub').value = t;
    $('#sim-clock').textContent = t >= dur ? 'Final' : clockLabel(t);
  };
  const setPlaying = (p) => { playing = p; $('#sim-play').textContent = p ? '⏸' : '▶'; $('#sim-play').setAttribute('aria-label', p ? 'Pause' : 'Play'); };
  $('#sim-play').addEventListener('click', () => { if (!playing && t >= dur) t = 0; setPlaying(!playing); frame(false); });
  $('#sim-restart').addEventListener('click', () => { t = 0; setPlaying(true); frame(false); });
  $('#sim-speed').addEventListener('change', (e) => { spd = Number(e.target.value); });
  $('#sim-loop').addEventListener('change', (e) => { loop = e.target.checked; });
  $('#sim-scrub').addEventListener('input', (e) => { t = Number(e.target.value); frame(false); });

  frame(false);
  setInterval(() => {
    if (!playing) return;
    if (Date.now() < holdUntil) return;
    if (t >= dur) {
      if (!loop) { setPlaying(false); return; }
      t = 0; frame(false); return;
    }
    t = Math.min(dur, t + spd);
    frame(true);
    if (t >= dur) holdUntil = Date.now() + 8000; // let the final score sit for a moment before the loop restarts
  }, 1000);
}

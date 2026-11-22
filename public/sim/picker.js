import '../horn.js'; // goal horns for games with a horn on, on every page
// Pick a finished game to replay: choose a date, then a game.
import { getData } from '../data.js';

const dateInput = document.querySelector('#date');
const list = document.querySelector('#games');
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const shift = (iso, d) => { const x = new Date(`${iso}T12:00:00Z`); x.setUTCDate(x.getUTCDate() + d); return x.toISOString().slice(0, 10); };

async function show(date) {
  dateInput.value = date;
  history.replaceState(null, '', `?date=${date}`);
  list.innerHTML = '<p class="msg">Loading…</p>';
  try {
    const data = await getData(`scores/${date}.json`);
    const finals = (data?.games ?? []).filter((g) => g.status.state === 'final');
    list.innerHTML = finals.length
      ? `<div class="compact">${finals.map((g) => `<a class="game cg" style="display:block;text-decoration:none;color:inherit" href="game.html?id=${g.id}&sim=20">
          <div class="cg-head"><div class="status final"><span class="label">${esc(g.status.label)}</span></div>
          <div class="cg-score"><b>${esc(g.away.abbrev)} ${g.linescore.totals.away}</b> – <b>${g.linescore.totals.home} ${esc(g.home.abbrev)}</b></div>
          <div class="cg-act">▶ Simulate</div></div></a>`).join('')}</div>`
      : '<p class="msg">No finished games on this date.</p>';
  } catch (err) {
    list.innerHTML = `<p class="msg">Couldn't load games: ${esc(err.message)}</p>`;
  }
}

document.querySelector('#prev').addEventListener('click', () => show(shift(dateInput.value, -1)));
document.querySelector('#next').addEventListener('click', () => show(shift(dateInput.value, 1)));
dateInput.addEventListener('change', () => dateInput.value && show(dateInput.value));
(async () => {
  const q = new URLSearchParams(location.search).get('date');
  show(q ?? (await getData('latest.json'))?.date ?? new Date().toISOString().slice(0, 10));
})();

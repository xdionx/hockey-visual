// Site menu, shared by every page: Scores, Standings, Momentum stats (with its four views) and the Simulator.
// Injected at the top of <body>; links are relative, so it works at the site root and under /test/.
const path = location.pathname.split('/').pop() || 'index.html';
const view = new URLSearchParams(location.search).get('view');
const here = {
  'index.html': 'scores', 'game.html': 'scores', 'player.html': 'stats', 'standings.html': 'standings', 'sim.html': 'sim', 'stats.html': 'stats',
}[path] ?? null;
const statsView = path === 'stats.html' ? (['compare', 'teams', 'league'].includes(view) ? view : 'stats') : null;
const cur = (on) => (on ? ' aria-current="page"' : '');
const STATS = [['stats', 'Stats', 'stats.html'], ['compare', 'Compare', 'stats.html?view=compare'], ['teams', 'Team deficiencies', 'stats.html?view=teams'], ['league', 'League deficiencies', 'stats.html?view=league']];
const sub = (cls) => STATS.map(([k, label, href]) => `<a href="${href}"${cur(statsView === k)}>${label}</a>`).join('');

const nav = document.createElement('div');
nav.className = 'hv-nav';
nav.innerHTML = `<div class="in"><a class="brand" href="./">NHL <i>Scores</i></a>
  <nav class="links" aria-label="Site">
    <a href="./"${cur(here === 'scores')}>Scores</a>
    <a href="standings.html"${cur(here === 'standings')}>Standings</a>
    <div class="dd${here === 'stats' ? ' on' : ''}"><button type="button" aria-haspopup="true" aria-expanded="false">Momentum stats &#9662;</button><div class="menu">${sub()}</div></div>
    <a href="sim.html"${cur(here === 'sim')}>Simulator</a>
  </nav>
  <button class="burger" type="button" aria-label="Menu" aria-expanded="false">&#9776;</button></div>
  <div class="sheet"><a href="./"${cur(here === 'scores')}>Scores</a><a href="standings.html"${cur(here === 'standings')}>Standings</a><a href="stats.html"${cur(here === 'stats' && statsView === 'stats')}>Momentum stats</a><div class="sub">${sub()}</div><a href="sim.html"${cur(here === 'sim')}>Simulator</a></div>`;
document.body.prepend(nav);
document.body.classList.add('hv-has-nav');

const dd = nav.querySelector('.dd');
const sheet = nav.querySelector('.sheet');
const burger = nav.querySelector('.burger');
const ddBtn = dd.querySelector('button');
const closeAll = () => { dd.classList.remove('open'); ddBtn.setAttribute('aria-expanded', 'false'); sheet.classList.remove('open'); burger.setAttribute('aria-expanded', 'false'); };
ddBtn.addEventListener('click', (e) => { e.stopPropagation(); const open = dd.classList.toggle('open'); ddBtn.setAttribute('aria-expanded', String(open)); });
burger.addEventListener('click', (e) => { e.stopPropagation(); const open = sheet.classList.toggle('open'); burger.setAttribute('aria-expanded', String(open)); });
document.addEventListener('click', (e) => { if (!nav.contains(e.target)) closeAll(); });
document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeAll(); });

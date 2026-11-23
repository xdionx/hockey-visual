// Momentum stats has two views: Stats (page.js, the default), Team deficiencies (deficiencies.js,
// stats.html?view=teams) and League deficiencies (league.js, stats.html?view=league). Only the chosen view's module loads, so each view stays its own file.
const params = new URLSearchParams(location.search);
const view = ['teams', 'league'].includes(params.get('view')) ? params.get('view') : 'stats';

document.querySelectorAll('[data-view]').forEach((a) => {
  const on = a.dataset.view === view;
  if (on) a.setAttribute('aria-current', 'page');
  // Carry the season across so switching views keeps you in the same year.
  a.addEventListener('click', () => {
    const season = new URLSearchParams(location.search).get('season');
    const q = new URLSearchParams();
    if (a.dataset.view !== 'stats') q.set('view', a.dataset.view);
    if (season) q.set('season', season);
    a.href = `stats.html${q.size ? `?${q}` : ''}`;
  });
});
document.body.dataset.view = view;
if (view === 'league') {
  document.title = 'League deficiencies · Momentum stats';
  import('./league.js');
} else if (view === 'teams') {
  document.title = 'Team deficiencies · Momentum stats';
  import('./deficiencies.js');
} else {
  import('./page.js');
}

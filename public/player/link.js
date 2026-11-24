// Player names anywhere on the site link to that player's card.
//
// Pages render HTML strings; linkPlayers() turns every known player name in the text of that HTML
// into a link (full names, "C. McDavid" style names and, where unambiguous, last names). Clicking
// a name opens the quick view (a lightbox). Hovering one shows two small buttons: the eye opens the
// quick view, the pop-out opens the full player card in a new tab. Ctrl/Cmd/middle click on a name
// also opens the full card in a new tab.
import { openQuickView } from './quick.js';

export const playerUrl = (id) => `player.html?id=${encodeURIComponent(id)}`;

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const reEsc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * Name lookup for a page. people: [{ id, fullName, name, lastName }]. Last names only count when
 * no one else on the page has the same last name and it isn't also a word from a team name.
 * Pass avoid (team names etc.) to keep last names like those out.
 */
export function playerIndex(people, { lastNames = true, avoid = [] } = {}) {
  const exact = new Map();
  const ambiguous = new Set();
  const add = (key, id, map = exact) => {
    const k = String(key ?? '').trim();
    if (k.length < 3) return;
    if (map.has(k) && map.get(k) !== id) ambiguous.add(k);
    else map.set(k, id);
  };
  const last = new Map();
  for (const p of people) {
    if (!p?.id) continue;
    add(p.fullName, p.id);
    add(p.name, p.id);
    if (lastNames && p.lastName) add(p.lastName, p.id, last);
  }
  const blocked = new Set(avoid.flatMap((a) => String(a ?? '').split(/\s+/)));
  for (const [k, id] of last) if (!ambiguous.has(k) && !blocked.has(k) && !WORDS.has(k) && !exact.has(k)) exact.set(k, id);
  for (const k of ambiguous) exact.delete(k);
  const keys = [...exact.keys()].sort((a, b) => b.length - a.length);
  const re = keys.length ? new RegExp(`(?<![\\p{L}\\p{M}\\p{N}])(${keys.map(reEsc).join('|')})(?![\\p{L}\\p{M}\\p{N}])`, 'gu') : null;
  return { map: exact, re };
}

// Last names that are also everyday words or labels on these pages; those only link as full names.
const WORDS = new Set(['Point', 'Power', 'Wood', 'Day', 'Young', 'King', 'Little', 'Strong', 'Hunt', 'Bear', 'Gold', 'Rich', 'Long', 'Black', 'White', 'Brown', 'Green', 'Hill', 'Bishop', 'Rust', 'Hart', 'Hall', 'Lee', 'Love', 'Rose', 'Price', 'Miller', 'Sharp', 'Carrier', 'Hope', 'Fox', 'Bird', 'Major', 'Rush', 'Chase', 'Best', 'Grant', 'Mercer', 'Nash', 'Ward', 'Walker', 'Shaw', 'Shore', 'Martin', 'Even', 'Home', 'Away', 'Shots', 'Goal', 'Goals', 'Final', 'Save', 'Block', 'Hits', 'Ice', 'Net', 'Post', 'Slot', 'Wing', 'Box', 'Lane', 'Glass', 'Story', 'Stars', 'Mark', 'Kelly', 'Justin', 'Marc']);

const SKIP = new Set(['SCRIPT', 'STYLE', 'TEXTAREA', 'OPTION', 'SELECT', 'TITLE', 'svg', 'SVG', 'HEAD']);

/** HTML string -> the same HTML with player names linked. */
let memo = { html: null, index: null, out: null };
export function linkPlayers(html, index) {
  if (!index?.re) return html;
  if (memo.html === html && memo.index === index) return memo.out;
  const tpl = document.createElement('template');
  tpl.innerHTML = html;
  const walker = document.createTreeWalker(tpl.content, NodeFilter.SHOW_TEXT, {
    acceptNode(node) {
      for (let el = node.parentNode; el && el.nodeType === 1; el = el.parentNode) {
        if (SKIP.has(el.tagName) || el.namespaceURI === 'http://www.w3.org/2000/svg' || el.classList.contains('pn') || el.hasAttribute('data-nolink')) return NodeFilter.FILTER_REJECT;
      }
      index.re.lastIndex = 0;
      return index.re.test(node.data) ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_REJECT;
    },
  });
  const nodes = [];
  for (let n = walker.nextNode(); n; n = walker.nextNode()) nodes.push(n);
  for (const node of nodes) {
    // A link inside a button or another link is invalid HTML, so those get a span that acts as a link.
    const nested = !!node.parentNode.closest?.('a, button, summary, label');
    const frag = document.createDocumentFragment();
    let at = 0;
    for (const m of node.data.matchAll(index.re)) {
      const id = index.map.get(m[0]);
      if (!id) continue;
      if (m.index > at) frag.append(node.data.slice(at, m.index));
      const el = document.createElement(nested ? 'span' : 'a');
      el.className = 'pn';
      el.dataset.pid = id;
      if (nested) { el.setAttribute('role', 'link'); el.tabIndex = 0; } else el.setAttribute('href', playerUrl(id));
      el.textContent = m[0];
      frag.append(el);
      at = m.index + m[0].length;
    }
    if (at < node.data.length) frag.append(node.data.slice(at));
    node.replaceWith(frag);
  }
  const out = tpl.innerHTML;
  memo = { html, index, out };
  return out;
}

/** One player name as a link, for pages that know the id while rendering. */
export function playerLink(id, text) {
  return id ? `<a class="pn" href="${playerUrl(id)}" data-pid="${esc(id)}">${esc(text)}</a>` : esc(text);
}

const POP_ICON = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M14 4h6v6M20 4l-9 9M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>';
const EYE_ICON = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12Z" fill="none" stroke="currentColor" stroke-width="2"/><circle cx="12" cy="12" r="3" fill="currentColor"/></svg>';
export const ICONS = { pop: POP_ICON, eye: EYE_ICON };

function loadCss() {
  if (document.querySelector('link[data-player-css]')) return;
  const here = new URL(import.meta.url);
  const css = new URL('player.css', here);
  css.search = here.search; // same deploy stamp as this module
  const link = document.createElement('link');
  link.rel = 'stylesheet';
  link.href = css.href;
  link.dataset.playerCss = '';
  document.head.append(link);
}

let installed = false;
/** Click, keyboard and hover handling for every .pn on the page. Call once per page. */
export function installPlayerLinks() {
  if (installed) return;
  installed = true;
  loadCss();
  const open = (id, e) => {
    if (e?.metaKey || e?.ctrlKey || e?.shiftKey) window.open(playerUrl(id), '_blank', 'noopener');
    else openQuickView(id);
  };
  // Capture phase, so a name inside a clickable row or goal chip opens the player, not the row.
  document.addEventListener('click', (e) => {
    const el = e.target.closest?.('.pn[data-pid]');
    if (!el) return;
    e.stopPropagation();
    if (el.tagName === 'A' && (e.metaKey || e.ctrlKey || e.shiftKey)) return; // the browser opens the new tab
    e.preventDefault();
    open(el.dataset.pid, e);
  }, true);
  document.addEventListener('auxclick', (e) => {
    const el = e.target.closest?.('span.pn[data-pid]');
    if (el && e.button === 1) { e.preventDefault(); window.open(playerUrl(el.dataset.pid), '_blank', 'noopener'); }
  }, true);
  document.addEventListener('keydown', (e) => {
    const el = e.target.closest?.('span.pn[data-pid]');
    if (el && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); e.stopPropagation(); open(el.dataset.pid, e); }
  }, true);

  // Hover buttons (mouse only; on touch a tap opens the quick view, which has its own pop-out).
  // Hover intent: the buttons only appear once the mouse rests on a name for a moment, so sweeping
  // across names (or dragging a goal strip) never pops them up in the way. Never while a button is held.
  const chip = document.createElement('div');
  chip.className = 'pn-chip';
  chip.innerHTML = `<button type="button" data-act="quick" title="Quick view" aria-label="Quick view">${EYE_ICON}</button><a data-act="pop" target="_blank" rel="noopener" title="Open player card in a new tab" aria-label="Open player card in a new tab">${POP_ICON}</a>`;
  document.body.append(chip);
  const SHOW_DELAY = 450;
  let current = null; // the name the chip is showing for
  let pending = null; // the name we are waiting on
  let showTimer = null;
  let hideTimer = null;
  let lastXY = null;
  const isOn = () => chip.classList.contains('on');
  const cancel = () => { clearTimeout(showTimer); showTimer = null; pending = null; };
  const hide = () => { cancel(); clearTimeout(hideTimer); chip.classList.remove('on'); current = null; };
  const later = () => { clearTimeout(hideTimer); hideTimer = setTimeout(hide, 220); };
  const show = (el) => {
    showTimer = null; pending = null;
    if (!el.isConnected) return;
    current = el;
    chip.dataset.pid = el.dataset.pid;
    chip.querySelector('[data-act="pop"]').href = playerUrl(el.dataset.pid);
    const r = el.getBoundingClientRect();
    const w = chip.offsetWidth;
    const h = chip.offsetHeight;
    const left = Math.min(window.innerWidth - w - 4, Math.max(4, r.right - 6));
    const top = r.top - h - 2 < 4 ? r.bottom + 2 : r.top - h + 4;
    chip.style.left = `${left}px`;
    chip.style.top = `${top}px`;
    chip.classList.add('on');
  };
  const arm = (el) => { clearTimeout(showTimer); pending = el; showTimer = setTimeout(() => show(el), SHOW_DELAY); };
  document.addEventListener('pointerover', (e) => {
    if (e.pointerType !== 'mouse') return;
    if (chip.contains(e.target)) { if (isOn()) clearTimeout(hideTimer); return; }
    const el = e.target.closest?.('.pn[data-pid]');
    if (!el || e.buttons) return;
    clearTimeout(hideTimer);
    if (current === el && isOn()) return;
    if (isOn()) hide(); // moving to another name: drop the old buttons, wait again
    lastXY = [e.clientX, e.clientY];
    arm(el);
  });
  // Still moving across the name: keep waiting until the mouse settles.
  document.addEventListener('pointermove', (e) => {
    if (!pending || e.pointerType !== 'mouse') return;
    if (e.buttons) { cancel(); return; }
    if (lastXY && Math.hypot(e.clientX - lastXY[0], e.clientY - lastXY[1]) > 3) { lastXY = [e.clientX, e.clientY]; arm(pending); }
  }, { passive: true });
  document.addEventListener('pointerout', (e) => {
    if (e.pointerType !== 'mouse') return;
    const el = e.target.closest?.('.pn[data-pid]');
    if (el && el.contains(e.relatedTarget)) return;
    if (el && el === pending) cancel();
    if ((el && el === current) || chip.contains(e.target)) later();
  });
  document.addEventListener('pointerdown', (e) => { if (!chip.contains(e.target)) hide(); }, true);
  chip.addEventListener('click', (e) => {
    const b = e.target.closest('[data-act]');
    if (!b) return;
    e.stopPropagation();
    if (b.dataset.act === 'quick') { e.preventDefault(); openQuickView(chip.dataset.pid); }
    hide();
  }, true);
  addEventListener('scroll', hide, { passive: true, capture: true });
  addEventListener('blur', hide);
}

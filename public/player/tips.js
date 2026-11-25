// Hover cards: hold the mouse on any element with a title for 0.4 s and a styled card explains it (tap on touch, Esc or
// moving away closes it). Takes over native titles so the browser's slow plain tooltip does not show too.
export function installTips(root) {
  let card = null, timer = null, cur = null;
  const hide = () => { clearTimeout(timer); timer = null; card?.remove(); card = null; cur = null; };
  const show = (el) => {
    const text = el.dataset.tip;
    if (!text) return;
    hide(); cur = el;
    card = document.createElement('div');
    card.className = 'tip-card'; card.setAttribute('role', 'tooltip'); card.textContent = text;
    document.body.append(card);
    const r = el.getBoundingClientRect(), c = card.getBoundingClientRect();
    const left = Math.max(8, Math.min(innerWidth - c.width - 8, r.left + r.width / 2 - c.width / 2));
    const top = r.top - c.height - 8 > 8 ? r.top - c.height - 8 : r.bottom + 8;
    card.style.left = `${left}px`; card.style.top = `${top}px`;
  };
  const target = (e) => {
    const el = e.target.closest?.('[title],[data-tip]');
    if (!el || !root.contains(el)) return null;
    if (el.hasAttribute('title')) { el.dataset.tip = el.getAttribute('title'); el.removeAttribute('title'); }
    return el;
  };
  root.addEventListener('mouseover', (e) => { const el = target(e); if (!el || el === cur) return; hide(); timer = setTimeout(() => show(el), 400); });
  root.addEventListener('mouseout', (e) => { if (!e.relatedTarget || !cur?.contains(e.relatedTarget)) hide(); });
  root.addEventListener('focusin', (e) => { const el = target(e); if (el) show(el); });
  root.addEventListener('focusout', hide);
  root.addEventListener('click', (e) => { const el = target(e); if (el && matchMedia('(hover: none)').matches) (cur === el ? hide() : show(el)); });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') hide(); });
  window.addEventListener('scroll', hide, { passive: true });
}

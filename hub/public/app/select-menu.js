// Gives every select.om-select in a .om-select-wrap OMAKO DS's own list, where
// there's a pointer. The native select stays in the page, hidden, and stays
// the truth: the value, the form and the change events are still its own.
// Touch screens keep the native select, whose picker suits a thumb better.
//
// The list opens in the page's top layer, fixed under the button, because a
// dialog like the palette clips anything inside it.

import { h } from './dom.js';

const pointer = () => window.matchMedia('(hover: hover) and (pointer: fine)').matches;
let seq = 0;
let openOne = null; // the menu that's open, so a second one closes the first

function labelOf(select) {
  const own = select.getAttribute('aria-label');
  if (own) return own;
  const label = select.labels && select.labels[0];
  if (label) return label.textContent.trim();
  const wrapLabel = select.closest('label');
  return wrapLabel ? wrapLabel.textContent.replace(select.textContent, '').trim() : '';
}

function enhance(select) {
  if (select.dataset.menu || !select.parentElement) return;
  let wrap = select.parentElement;
  if (!wrap.classList.contains('om-select-wrap')) {
    wrap = h('span', { class: 'om-select-wrap' });
    select.replaceWith(wrap);
    wrap.append(select);
  }
  select.dataset.menu = '1';
  const id = `om-listbox-${++seq}`;
  const text = h('span');
  const button = h('button', { type: 'button', class: 'om-select-btn', 'aria-haspopup': 'listbox', 'aria-expanded': 'false', 'aria-controls': id }, text);
  const list = h('ul', { class: 'om-listbox', role: 'listbox', id, tabindex: '-1', hidden: true });
  let active = -1;

  // The native select keeps its place for forms and labels, out of sight.
  select.hidden = true;
  select.tabIndex = -1;
  wrap.append(button);

  function sync() {
    const chosen = select.options[select.selectedIndex];
    text.textContent = chosen ? chosen.textContent : '';
    button.disabled = select.disabled;
    const name = labelOf(select);
    button.setAttribute('aria-label', name ? `${name}, ${text.textContent}` : text.textContent);
    list.setAttribute('aria-label', name || 'Options');
  }

  function paintActive() {
    [...list.children].forEach((li, i) => li.classList.toggle('is-active', i === active));
    const li = list.children[active];
    if (li) {
      list.setAttribute('aria-activedescendant', li.id);
      li.scrollIntoView({ block: 'nearest' });
    }
  }

  function place() {
    const r = button.getBoundingClientRect();
    list.style.position = 'fixed';
    list.style.left = `${Math.round(r.left)}px`;
    list.style.minWidth = `${Math.round(r.width)}px`;
    const below = window.innerHeight - r.bottom;
    const tall = Math.min(list.scrollHeight, 280) + 8;
    if (below < tall && r.top > below) {
      list.style.top = 'auto';
      list.style.bottom = `${Math.round(window.innerHeight - r.top + 6)}px`;
    } else {
      list.style.bottom = 'auto';
      list.style.top = `${Math.round(r.bottom + 6)}px`;
    }
  }

  function open() {
    if (button.disabled) return;
    if (openOne && openOne !== close) openOne();
    list.replaceChildren(...[...select.options].map((o, i) => h('li', {
      class: 'om-option',
      role: 'option',
      id: `${id}-${i}`,
      'aria-selected': String(i === select.selectedIndex),
      'aria-disabled': o.disabled ? 'true' : null,
      onMousemove() { if (active !== i) { active = i; paintActive(); } },
      onClick(e) { e.preventDefault(); choose(i); },
    }, h('i', { class: 'om-icon om-i-check om-option-check', 'aria-hidden': 'true' }), o.textContent)));
    document.body.append(list);
    list.hidden = false;
    button.setAttribute('aria-expanded', 'true');
    active = Math.max(0, select.selectedIndex);
    place();
    paintActive();
    list.focus({ preventScroll: true });
    openOne = close;
    document.addEventListener('mousedown', outside, true);
    window.addEventListener('resize', close);
    window.addEventListener('scroll', onScroll, true);
  }

  function close(refocus = true) {
    if (list.hidden) return;
    list.hidden = true;
    button.setAttribute('aria-expanded', 'false');
    list.remove();
    if (openOne === close) openOne = null;
    document.removeEventListener('mousedown', outside, true);
    window.removeEventListener('resize', close);
    window.removeEventListener('scroll', onScroll, true);
    if (refocus === true) button.focus({ preventScroll: true });
  }

  function onScroll(e) { if (!list.contains(e.target)) close(false); }
  function outside(e) { if (!list.contains(e.target) && e.target !== button && !button.contains(e.target)) close(false); }

  function choose(i) {
    const o = select.options[i];
    if (!o || o.disabled) return;
    const changed = select.selectedIndex !== i;
    select.selectedIndex = i;
    sync();
    close();
    if (changed) {
      select.dispatchEvent(new Event('input', { bubbles: true }));
      select.dispatchEvent(new Event('change', { bubbles: true }));
    }
  }

  function step(delta) {
    const n = select.options.length;
    for (let k = 1; k <= n; k += 1) {
      const i = (active + delta * k + n) % n;
      if (!select.options[i].disabled) { active = i; break; }
    }
    paintActive();
  }

  let typed = '';
  let typedAt = 0;
  function typeAhead(ch) {
    const now = Date.now();
    typed = now - typedAt > 700 ? ch : typed + ch;
    typedAt = now;
    const start = typed.length === 1 ? active + 1 : active;
    const opts = [...select.options];
    for (let k = 0; k < opts.length; k += 1) {
      const i = (start + k) % opts.length;
      if (opts[i].textContent.trim().toLowerCase().startsWith(typed)) { active = i; paintActive(); return; }
    }
  }

  button.addEventListener('click', () => (list.hidden ? open() : close()));
  button.addEventListener('keydown', (e) => {
    if (['ArrowDown', 'ArrowUp', 'Enter', ' '].includes(e.key)) {
      e.preventDefault();
      e.stopPropagation();
      open();
    }
  });
  list.addEventListener('keydown', (e) => {
    // Handled here, so a dialog or the palette around it doesn't act on the
    // same key: Esc closes this list, not the palette.
    const keys = { ArrowDown: () => step(1), ArrowUp: () => step(-1), Home: () => { active = -1; step(1); }, End: () => { active = 0; step(-1); }, Enter: () => choose(active), ' ': () => choose(active), Escape: () => close() };
    if (keys[e.key]) {
      e.preventDefault();
      e.stopPropagation();
      keys[e.key]();
    } else if (e.key === 'Tab') {
      close(false);
    } else if (e.key.length === 1 && /\S/.test(e.key)) {
      typeAhead(e.key.toLowerCase());
    }
  });

  // Options and the chosen one can change from code: a repaint refills them.
  new MutationObserver(sync).observe(select, { childList: true, subtree: true, attributes: true });
  select.addEventListener('change', sync);
  sync();
}

function scan(root) {
  if (!pointer()) return;
  if (root.matches && root.matches('select.om-select')) enhance(root);
  if (root.querySelectorAll) root.querySelectorAll('select.om-select').forEach(enhance);
}

// Every select the app ever draws, on any page and in the palette.
export function startSelectMenus() {
  scan(document.body);
  new MutationObserver((records) => {
    for (const r of records) r.addedNodes.forEach((n) => { if (n.nodeType === 1) scan(n); });
  }).observe(document.body, { childList: true, subtree: true });
}

// Is a select's list open? A dialog's own keys wait while one is.
export const selectMenuOpen = () => !!openOne;

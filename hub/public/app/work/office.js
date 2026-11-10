// The office as a framed window on the Desk. No controls: clicking it goes to
// the office. test/office-shots.js clips #office-window, so the id stays.

import { h } from '../dom.js';

const KEY = 'v2.office.collapsed'; // v2's key, so a closed office stays closed

function isCollapsed() {
  try { return localStorage.getItem(KEY) === '1'; } catch { return false; }
}

export function officeWindow() {
  const frameWrap = h('div', { class: 'work-office-frame' });
  const toggle = h('button', { type: 'button', class: 'om-btn om-btn-ghost work-office-toggle' });

  function setCollapsed(collapsed) {
    frameWrap.hidden = collapsed;
    toggle.textContent = collapsed ? 'Show' : 'Hide';
    toggle.setAttribute('aria-expanded', String(!collapsed));
    try { localStorage.setItem(KEY, collapsed ? '1' : ''); } catch { /* it just won't stick */ }
    // The frame is the costly part: a closed office loads nothing.
    if (!collapsed && !frameWrap.children.length) {
      frameWrap.append(
        h('iframe', { src: '/office?mini=1', title: 'The office, live', tabindex: '-1' }),
        h('a', { class: 'work-office-open', href: '/office', 'aria-label': 'Open the office' }));
    }
  }
  toggle.addEventListener('click', () => setCollapsed(!frameWrap.hidden));
  setCollapsed(isCollapsed());

  return h('section', { id: 'office-window', class: 'work-office', 'aria-label': 'The office' },
    h('div', { class: 'work-office-head' },
      h('a', { class: 'om-label work-office-title', href: '/office' }, 'Office'),
      toggle),
    frameWrap);
}

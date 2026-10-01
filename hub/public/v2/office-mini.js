// v2/office-mini.js — t-278. The pixel office lives PERMANENTLY in the
// dashboard's left rail as its own card ABOVE the agents roster (boss
// order 2026-08-23: not a toggle — always there, collapsible). The card
// holds a live same-origin iframe on /office?mini=1 (chrome hidden,
// canvas stretched edge-to-edge so there are no letterbox bars; shares
// the bureau_token localStorage), a collapse caret, and a maximize
// button to /office full screen — whose own minimize icon is the way
// back here. Collapse state persists.
//
// Composition pattern (same as project-create.js): builds its own card,
// touches no other module's DOM.
import { icon } from './components.js';

(function () {
  'use strict';

  var COLLAPSE_KEY = 'v2.office.collapsed';

  function ready(cb) {
    if (window.BureauV2 && window.BureauV2.state) return cb();
    var off = window.BureauV2 ? window.BureauV2.on('v2:ready', function () { off(); cb(); }) : null;
    if (!window.BureauV2) {
      document.addEventListener('DOMContentLoaded', function poll() {
        if (window.BureauV2) { ready(cb); } else { setTimeout(poll, 50); }
      });
    }
  }

  ready(init);
  ready(followOfficeLink);

  // The full office links back here with a hash naming what was clicked:
  // #board (the mission list), #review (what waits on you), #brain, or
  // #mission=<id>. Handled once on load and on later hash changes, then
  // the hash is cleared so a reload does not reopen it.
  function followOfficeLink() {
    function follow() {
      var h = location.hash.replace(/^#/, '');
      if (!h) return;
      var V2 = window.BureauV2, m = h.match(/^mission=(.+)$/);
      if (m) V2.emit('v2:mission:open', { id: decodeURIComponent(m[1]) });
      else if (h === 'brain') V2.emit('v2:brain:open', {});
      else if (h === 'review' || h === 'board') {
        var el = document.getElementById(h === 'review' ? 'v2-needs-me-now' : 'v2-board');
        if (el) {
          el.scrollIntoView({ block: 'start' });
          if (!el.hasAttribute('tabindex')) el.setAttribute('tabindex', '-1');
          el.focus({ preventScroll: true });
        }
      } else return;
      history.replaceState(null, '', location.pathname + location.search);
    }
    // peek-panel.js loads after this file: wait until it has booted (it
    // fills BureauV2.peekPanel) so a mission link has a listener, 2s max
    var tries = 0;
    (function wait() {
      var pp = window.BureauV2.peekPanel;
      if ((pp && pp.registerSection) || tries++ > 40) return setTimeout(follow, 0);
      setTimeout(wait, 50);
    })();
    window.addEventListener('hashchange', follow);
  }

  function init() {
    var agentsRail = document.getElementById('v2-agents-rail');
    if (!agentsRail) return;
    injectStyle();

    var card = document.createElement('section');
    card.className = 'v2-card';
    card.id = 'v2-office-card';
    card.setAttribute('aria-label', 'The pixel office (live)');

    var head = document.createElement('h2');
    head.className = 'v2-region-title v2-office-card__head';

    var caretBtn = document.createElement('button');
    caretBtn.type = 'button';
    caretBtn.className = 'v2-icon-btn v2-office-card__caret';
    caretBtn.setAttribute('aria-label', 'Collapse or expand the office');
    caretBtn.innerHTML = icon('chevron-down');

    var title = document.createElement('span');
    title.textContent = 'Office';

    var full = document.createElement('a');
    full.className = 'v2-icon-btn v2-office-card__full';
    full.href = '/office';
    full.title = 'Open the office full screen';
    full.setAttribute('aria-label', 'Open the office full screen');
    full.innerHTML = icon('maximize-2');

    var left = document.createElement('span');
    left.className = 'v2-office-card__left';
    left.appendChild(caretBtn);
    left.appendChild(title);
    head.appendChild(left);
    head.appendChild(full);
    card.appendChild(head);

    var frameWrap = document.createElement('div');
    frameWrap.className = 'v2-office-card__frame';
    var frame = document.createElement('iframe');
    frame.src = '/office?mini=1';
    frame.title = 'The pixel office (live)';
    frameWrap.appendChild(frame);
    // A click, tap or Enter anywhere on the mini office opens the full
    // office: one transparent link over the frame (the frame itself takes
    // no pointer input in mini mode).
    var open = document.createElement('a');
    open.className = 'v2-office-card__open';
    open.href = '/office';
    open.setAttribute('aria-label', 'Open the office full screen');
    frameWrap.appendChild(open);
    card.appendChild(frameWrap);

    agentsRail.insertAdjacentElement('beforebegin', card);

    function setCollapsed(collapsed) {
      frameWrap.hidden = collapsed;
      caretBtn.innerHTML = icon(collapsed ? 'chevron-right' : 'chevron-down');
      caretBtn.setAttribute('aria-expanded', String(!collapsed));
      try { localStorage.setItem(COLLAPSE_KEY, collapsed ? '1' : ''); } catch (e) {}
    }
    caretBtn.addEventListener('click', function () { setCollapsed(!frameWrap.hidden); });

    var saved = '';
    try { saved = localStorage.getItem(COLLAPSE_KEY) || ''; } catch (e) {}
    if (saved === '1') setCollapsed(true);
  }

  function injectStyle() {
    if (document.getElementById('v2-office-mini-style')) return;
    var style = document.createElement('style');
    style.id = 'v2-office-mini-style';
    style.textContent = [
      '.v2-office-card__head { display: flex; align-items: center; justify-content: space-between; }',
      '.v2-office-card__left { display: inline-flex; align-items: center; gap: 2px; }',
      '.v2-office-card__caret, .v2-office-card__full { color: var(--v2-color-text-secondary); }',
      '.v2-office-card__caret:hover, .v2-office-card__full:hover { color: var(--v2-color-text-primary); }',
      // Edge to edge: the frame bleeds through the card padding so the
      // canvas fills the full card width with no bars around it.
      '.v2-office-card__frame { position: relative; margin: 0 calc(-1 * var(--v2-space-3, 12px)) calc(-1 * var(--v2-space-3, 12px)); overflow: hidden; border-radius: 0 0 var(--v2-radius, 8px) var(--v2-radius, 8px); background: #14121f; }',
      '.v2-office-card__open { position: absolute; inset: 0; cursor: pointer; }',
      '.v2-office-card__open:focus-visible { outline: 2px solid var(--v2-color-text-primary); outline-offset: -2px; }',
      '.v2-office-card__frame iframe { display: block; width: 100%; aspect-ratio: 16 / 9; border: 0; }',
    ].join('\n');
    document.head.appendChild(style);
  }
})();

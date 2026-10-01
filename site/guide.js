// site/guide.js: a guided tour of the console's controls, on demand only.
// Ported from allmiibo's tutorial (web/js/tutorial.js): a spotlight over one
// control, a bubble beside it, SKIP / BACK / NEXT, the arrow keys, Escape.
// Never starts by itself; the GUIDE button (or #guide) opens it. Loaded
// lazily by site.js, which zooms the console out first so every control is
// on screen. Called "guide" because TOUR is already a cartridge.
(function () {
  'use strict';
  var PAD = 8, BUBBLE_ROOM = 190;
  var REDUCED = matchMedia('(prefers-reduced-motion: reduce)').matches;

  // A step targets one element, or several (the spotlight covers them all).
  // Steps whose targets are hidden (the strip on a short screen, a control
  // that isn't there) are left out, so phones and desktops get the right set.
  var STEPS = [
    { target: ['screen'], title: 'The screen', body: 'This is the office. Scroll, or use the arrow keys, to walk through it one stop at a time.' },
    { target: ['dpad'], title: 'The D-pad', body: 'Moves between stops. The arrow keys do the same.' },
    { target: ['btn-a', 'btn-b'], title: 'A and B', body: 'A replays the moment (and stamps, at the boss\'s door). B goes back one stop. Z and X on a keyboard.' },
    { target: ['pill-start'], title: 'START', body: 'Opens the cartridges. Enter on a keyboard.' },
    { target: ['pill-select'], title: 'SELECT', body: 'Changes the screen colours. Shift on a keyboard.' },
    { target: ['rack'], title: 'The cartridges', body: 'TOUR walks through Bureau. JOIN puts you on the waitlist. CODE is the GitHub page. Pick one to put it in.' },
    { target: ['wheel'], title: 'Sound', body: 'Off until you turn it on. The wheel shows ON or OFF. M on a keyboard.' },
    { target: ['power'], title: 'Power', body: 'Turning it off and on again takes you back to the title screen.' },
    { target: ['real-link'], title: 'The full page', body: 'Screenshots of the real dashboard, the roadmap, and answers to common questions.' },
    { target: ['plain-link'], title: 'Plain view', body: 'The same words without the console. Works with a screen reader and a keyboard alone.' },
    { target: ['guide-btn'], title: 'That\'s it', body: 'This guide is here whenever you want it again.' },
  ];

  var state = null;

  function visible(id) {
    var n = document.getElementById(id);
    if (!n || n.closest('[hidden]')) return null;
    var r = n.getBoundingClientRect(), cs = getComputedStyle(n);
    if ((r.width === 0 && r.height === 0) || cs.visibility === 'hidden' || cs.display === 'none' || +cs.opacity === 0) return null;
    if (r.bottom < 0 || r.top > innerHeight || r.right < 0 || r.left > innerWidth) return null;
    return n;
  }
  // The box around every visible target of a step, or null.
  function box(step) {
    var b = null;
    step.target.forEach(function (id) {
      var n = visible(id);
      if (!n) return;
      var r = n.getBoundingClientRect();
      b = b ? { top: Math.min(b.top, r.top), left: Math.min(b.left, r.left), bottom: Math.max(b.bottom, r.bottom), right: Math.max(b.right, r.right) }
            : { top: r.top, left: r.left, bottom: r.bottom, right: r.right };
    });
    return b;
  }

  function build() {
    var root = document.createElement('div');
    root.className = 'guide';
    root.innerHTML =
      '<div class="guide-veil"></div><div class="guide-spot"></div>' +
      '<div class="guide-bubble" role="dialog" aria-modal="true" aria-labelledby="guide-title" tabindex="-1">' +
        '<div class="guide-step"></div><h2 id="guide-title"></h2><p></p>' +
        '<div class="guide-row"><button class="guide-skip" type="button">SKIP</button><div class="guide-dots"></div>' +
        '<button class="guide-back" type="button">BACK</button><button class="guide-next" type="button"></button></div>' +
      '</div>';
    document.body.appendChild(root);
    return root;
  }

  // Re-placed every frame while open: the console tilts and eases its zoom,
  // and the spotlight has to stay on the control, not where it was.
  function place() {
    if (!state) return;
    var step = state.steps[state.at], b = box(step);
    var spot = state.root.querySelector('.guide-spot'), bubble = state.root.querySelector('.guide-bubble');
    var vw = innerWidth, vh = innerHeight;
    if (!b) {
      spot.style.opacity = '0';
      bubble.style.left = Math.max(12, (vw - bubble.offsetWidth) / 2) + 'px';
      bubble.style.top = Math.max(12, (vh - bubble.offsetHeight) / 2) + 'px';
      return;
    }
    var top = Math.max(0, b.top - PAD), bottom = Math.min(vh, b.bottom + PAD);
    var left = Math.max(0, b.left - PAD), right = Math.min(vw, b.right + PAD);
    spot.style.opacity = '1';
    spot.style.top = top + 'px'; spot.style.left = left + 'px';
    spot.style.width = (right - left) + 'px'; spot.style.height = (bottom - top) + 'px';
    var below = vh - bottom, above = top, bw = bubble.offsetWidth, bh = bubble.offsetHeight;
    var x, y;
    if (below >= BUBBLE_ROOM || below >= above) { y = bottom + 12; x = left; }
    else if (above >= bh + 24) { y = above - bh - 12; x = left; }
    else {
      // tall target (the screen on a phone): beside it, else over its lower part
      y = Math.min(vh - bh - 12, Math.max(12, top + 12));
      x = right + 12 + bw <= vw ? right + 12 : left - 12 - bw >= 0 ? left - 12 - bw : (vw - bw) / 2;
      if (x === (vw - bw) / 2) y = vh - bh - 12;
    }
    bubble.style.left = Math.round(Math.max(12, Math.min(vw - 12 - bw, x))) + 'px';
    bubble.style.top = Math.round(Math.max(12, Math.min(vh - 12 - bh, y))) + 'px';
  }
  function loop() { if (!state) return; place(); state.raf = requestAnimationFrame(loop); }

  function render() {
    var root = state.root, step = state.steps[state.at], last = state.at === state.steps.length - 1;
    root.querySelector('#guide-title').textContent = step.title;
    root.querySelector('.guide-bubble p').textContent = step.body;
    root.querySelector('.guide-step').textContent = (state.at + 1) + ' / ' + state.steps.length;
    root.querySelector('.guide-back').hidden = state.at === 0;
    root.querySelector('.guide-skip').hidden = last;
    root.querySelector('.guide-next').textContent = last ? 'DONE' : 'NEXT';
    root.querySelector('.guide-dots').innerHTML = state.steps.map(function (s, i) { return '<span class="guide-dot' + (i === state.at ? ' on' : '') + '"></span>'; }).join('');
    place();
    root.classList.add('ready');
    root.querySelector('.guide-bubble').focus();
  }
  function go(d) {
    var n = state.at + d;
    if (n < 0) return;
    if (n >= state.steps.length) return stop();
    state.at = n; render();
  }

  function stop() {
    if (!state) return;
    cancelAnimationFrame(state.raf);
    document.removeEventListener('keydown', state.onKey, true);
    state.root.remove();
    document.documentElement.style.overflow = state.overflow;
    var back = state.returnTo;
    state = null;
    if (back && back.focus) back.focus();
  }

  function start() {
    if (state) stop();
    var steps = STEPS.filter(function (s) { return box(s); });
    if (!steps.length) return false;
    var root = build();
    // While open, the console sleeps: every key is the guide's (Tab still
    // moves between its buttons), none reaches the page behind.
    var onKey = function (e) {
      if (e.key === 'Tab') return;
      e.stopPropagation();
      if (e.key === 'Escape') { e.preventDefault(); stop(); }
      else if (e.key === 'ArrowRight' || e.key === 'ArrowDown') { e.preventDefault(); go(1); }
      else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') { e.preventDefault(); go(-1); }
      else if (e.key === 'Enter' && document.activeElement && document.activeElement.classList.contains('guide-bubble')) { e.preventDefault(); go(1); }
    };
    // no scrolling behind it: a scroll would zoom the console back in
    state = { root: root, steps: steps, at: 0, onKey: onKey, raf: 0, returnTo: document.activeElement, overflow: document.documentElement.style.overflow };
    document.documentElement.style.overflow = 'hidden';
    if (REDUCED) root.classList.add('still');
    root.querySelector('.guide-next').addEventListener('click', function () { go(1); });
    root.querySelector('.guide-back').addEventListener('click', function () { go(-1); });
    root.querySelector('.guide-skip').addEventListener('click', stop);
    root.querySelector('.guide-veil').addEventListener('click', stop);
    document.addEventListener('keydown', onKey, true);
    render();
    loop();
    return true;
  }

  window.BureauGuide = { start: start, stop: stop, get open() { return !!state; } };
})();

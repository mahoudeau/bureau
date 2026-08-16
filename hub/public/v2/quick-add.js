// v2/quick-add.js — t-72 (goal: t-53). Upgrades t-64's board.js quick-add
// form with an optional body textarea + a template picker (t-55 item i6).
// Owns only this file and its sibling data module, templates.js — board.js
// and peek-panel.js are never edited.
//
// Coordination note (also logged on this mission, per its own instruction
// to coordinate rather than edit board.js): board.js builds
// #v2-quickadd-form exactly ONCE at init and never re-renders it
// afterward (only the board's columns sub-container gets replaced on
// every state refresh), with its own bubble-phase submit handler that
// POSTs title/project/priority only. That form is not swappable without
// touching board.js's source, so this file instead:
//   1. Waits for #v2-quickadd-form to exist (a short bounded poll — the
//      form is created once and never destroyed, so no MutationObserver
//      is needed and there is no re-render loop to guard against), then
//      appends a body <textarea> and a template-picker row into it as
//      new DOM children — decorating board.js's output, never editing
//      its source file.
//   2. Intercepts the form's submit in the CAPTURE phase on `document`.
//      A capture-phase listener on an ancestor always runs before a
//      bubble-phase listener on the target itself, regardless of which
//      was attached first — the one reliable way to run ahead of
//      board.js's already-registered handler without touching it. This
//      file calls stopImmediatePropagation() so board.js's original
//      handler never fires for this form, then performs the complete
//      POST itself: title/project/priority always (byte-identical to
//      what board.js's own handler would have sent when body is left
//      empty — the mission's own "no regression" requirement), plus
//      body only when non-empty.
//
// Ships plain, unstyled DOM per this mission's own instruction (compose
// existing v2- primitives / tokens.css, no ad-hoc visual language): no
// injected <style> block, only v2- prefixed class hooks for future
// composition to style.
import { TEMPLATES } from './templates.js';

(function () {
  'use strict';

  var esc = function (s) {
    return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; });
  };

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

  function init() {
    var V2 = window.BureauV2;
    waitForForm(function (form) { decorate(V2, form); });
  }

  function waitForForm(cb) {
    var existing = document.getElementById('v2-quickadd-form');
    if (existing) { cb(existing); return; }
    var tries = 0;
    var timer = setInterval(function () {
      var f = document.getElementById('v2-quickadd-form');
      tries++;
      if (f) { clearInterval(timer); cb(f); }
      else if (tries > 100) { clearInterval(timer); } // ~5s: board.js's mount never appeared, give up quietly
    }, 50);
  }

  function decorate(V2, form) {
    var titleInput = document.getElementById('v2-qa-title');
    var projectSelect = document.getElementById('v2-qa-project');
    var prioSelect = document.getElementById('v2-qa-prio');
    var errEl = document.getElementById('v2-qa-err');
    if (!titleInput || !projectSelect || !prioSelect) return; // board.js's contract changed underneath us — fail quiet, not loud

    var picker = document.createElement('div');
    picker.className = 'v2-quickadd__templates';
    picker.setAttribute('role', 'group');
    picker.setAttribute('aria-label', 'Mission templates');
    picker.innerHTML = TEMPLATES.map(function (t) {
      return '<button type="button" class="v2-quickadd__template-btn" data-template="' + esc(t.id) + '">' + esc(t.label) + '</button>';
    }).join('');

    var body = document.createElement('textarea');
    body.className = 'v2-quickadd__body';
    body.id = 'v2-qa-body';
    body.placeholder = 'Body (optional) — Acceptance section, references, anything the builder needs. Pick a template below or write your own.';

    // Visual order: title -> template picker -> body -> project/priority/submit.
    // Each insertAdjacentElement('afterend', ...) call lands its element
    // immediately after titleInput, so inserting body first and picker
    // second leaves picker closest to the title, matching the order above.
    titleInput.insertAdjacentElement('afterend', body);
    titleInput.insertAdjacentElement('afterend', picker);

    picker.querySelectorAll('.v2-quickadd__template-btn').forEach(function (btn) {
      btn.addEventListener('click', function () {
        var tpl = TEMPLATES.find(function (t) { return t.id === btn.getAttribute('data-template'); });
        if (!tpl) return;
        body.value = tpl.body;
        body.focus();
      });
    });

    document.addEventListener('submit', function (e) {
      if (e.target !== form) return;
      e.preventDefault();
      e.stopImmediatePropagation();
      submit(V2, form, titleInput, projectSelect, prioSelect, body, errEl);
    }, true);
  }

  function submit(V2, form, titleInput, projectSelect, prioSelect, bodyEl, errEl) {
    var title = titleInput.value.trim();
    if (errEl) errEl.hidden = true;
    if (!title) {
      if (errEl) { errEl.textContent = 'A mission needs a title.'; errEl.hidden = false; }
      return;
    }
    var payload = {
      title: title,
      project: projectSelect.value || 'general',
      priority: +prioSelect.value,
      created_by: 'human'
    };
    var bodyText = bodyEl.value.trim();
    if (bodyText) payload.body = bodyText;
    V2.api('/api/tasks', { method: 'POST', body: JSON.stringify(payload) }).then(function (r) {
      if (r && r.error) { if (errEl) { errEl.textContent = r.error; errEl.hidden = false; } return; }
      titleInput.value = '';
      bodyEl.value = '';
      form.hidden = true;
      V2.refresh();
    });
  }
})();

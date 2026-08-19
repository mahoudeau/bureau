// v2/project-create.js — t-255. Owns the "new project" affordance on
// #v2-projects-rail: a plus button in the rail header opening a small
// inline create form, wired to the same POST /api/projects call v1's own
// create form (hub/public/index.html) already makes. v2 shipped without
// any create path — the registry could only be edited (project-edit.js)
// or filtered (board.js), never grown, so adding a project meant falling
// back to v1 or a raw API call.
//
// Owns no board.js mount: the form lives BETWEEN the rail's h2 header and
// the .v2-region-body board.js rebuilds (setRegionBody replaces only that
// body element's innerHTML), so a v2:state refresh mid-typing never wipes
// the form — no data-editing coordination needed, unlike project-edit.js
// whose edit UI lives inside the rebuilt rows.
//
// Label only, deliberately: createProject derives the id by slugifying
// the label, and entity/repo/capacity are already inline-editable on the
// created row (project-edit.js) — a four-field form here would duplicate
// that surface for no gain. Same lean shape as board.js's own quick-add.
//
// No prompt()/confirm()/alert(); validation and errors render inline
// (the same mechanical floor every v2 module holds to).
import { icon } from './components.js';

(function () {
  'use strict';

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
    var rail = document.getElementById('v2-projects-rail');
    if (!rail) return;
    var head = rail.querySelector('.v2-region-title');
    if (!head) return;
    injectStyle();

    var trigger = document.createElement('button');
    trigger.type = 'button';
    trigger.className = 'v2-icon-btn v2-pcreate__trigger';
    trigger.setAttribute('aria-label', 'New project');
    trigger.title = 'New project';
    trigger.setAttribute('aria-expanded', 'false');
    trigger.innerHTML = icon('plus');
    head.appendChild(trigger);

    var form = document.createElement('form');
    form.className = 'v2-pcreate';
    form.hidden = true;
    form.innerHTML =
      '<input class="v2-input v2-pcreate__label" placeholder="New project label…" aria-label="New project label" required>' +
      '<button type="submit" class="v2-btn v2-btn--secondary v2-pcreate__submit">Add</button>' +
      '<p class="v2-pcreate__err" hidden></p>';
    head.insertAdjacentElement('afterend', form);

    var labelInput = form.querySelector('.v2-pcreate__label');
    var submitBtn = form.querySelector('.v2-pcreate__submit');
    var err = form.querySelector('.v2-pcreate__err');

    function setOpen(open) {
      form.hidden = !open;
      trigger.setAttribute('aria-expanded', String(open));
      if (open) labelInput.focus();
      else { labelInput.value = ''; err.hidden = true; }
    }
    trigger.addEventListener('click', function () { setOpen(form.hidden); });
    labelInput.addEventListener('keydown', function (e) {
      if (e.key === 'Escape') { e.preventDefault(); setOpen(false); }
    });

    form.addEventListener('submit', function (e) {
      e.preventDefault();
      err.hidden = true;
      var label = labelInput.value.trim();
      if (!label) { err.textContent = 'A project needs a label.'; err.hidden = false; return; }
      labelInput.disabled = true;
      submitBtn.disabled = true;
      V2.api('/api/projects', { method: 'POST', body: JSON.stringify({ label: label }) }).then(function (r) {
        labelInput.disabled = false;
        submitBtn.disabled = false;
        if (r && r.error) {
          // Server-side messages are already human-shaped ("project
          // already exists", "label produces an empty or invalid id") —
          // shown as-is, same as project-edit.js does with PATCH errors.
          err.textContent = r.error;
          err.hidden = false;
          labelInput.focus();
          return;
        }
        setOpen(false);
        // Single-source-of-truth discipline (same as every v2 module):
        // never hand-paint the new row — refresh and let board.js's
        // renderProjects rebuild from the server-confirmed registry.
        V2.refresh();
      });
    });
  }

  function injectStyle() {
    if (document.getElementById('v2-project-create-style')) return;
    var style = document.createElement('style');
    style.id = 'v2-project-create-style';
    style.textContent = [
      // The rail header becomes a flex row so the trigger pins right of
      // the "PROJECTS" label without disturbing the title's own register
      // (v2.html's .v2-region-title rule keeps the type treatment).
      '#v2-projects-rail .v2-region-title { display: flex; align-items: center; justify-content: space-between; }',
      // .v2-icon-btn is sized for the 30px panel header — inside an 11px
      // rail header it only needs to not inflate the line. The glyph
      // reads at the muted header color until hover, same ghost
      // treatment as .v2-btn--ghost.
      '.v2-pcreate__trigger { color: var(--v2-color-text-secondary); }',
      '.v2-pcreate__trigger:hover { color: var(--v2-color-text-primary); }',
      '.v2-pcreate { display: flex; align-items: center; gap: var(--v2-space-2, 8px); position: relative; margin: 0 0 var(--v2-space-2, 8px); }',
      '.v2-pcreate__label { flex: 1; min-width: 0; }',
      // Error strip under the form, same shape as project-edit.js's
      // .v2-pedit__err — inline, never a modal.
      '.v2-pcreate__err { position: absolute; top: 100%; left: 0; margin-top: 2px; font-size: 11px; color: var(--v2-color-status-bug, #e5484d); background: var(--v2-color-bg, #fff); border: 1px solid var(--v2-color-status-bug, #e5484d); border-radius: var(--v2-radius-xs, 4px); padding: 2px 6px; white-space: nowrap; z-index: 5; }',
      // Tap-target floor at phone width (t-53 mechanical floors).
      '@media (max-width: 720px) { .v2-pcreate .v2-input, .v2-pcreate .v2-btn, .v2-pcreate__trigger { min-height: 44px; } .v2-pcreate .v2-input { font-size: 16px; } }'
    ].join('\n');
    document.head.appendChild(style);
  }
})();

// v2/project-edit.js — t-86 (goal: t-53, i10). Owns inline editing of the
// four project fields (label, entity, repo, capacity) rendered by
// board.js's #v2-projects-rail. Replaces t-53's bar-named worst-performing
// phone interaction — four separate window.prompt() dialogs (v1's own
// editProjectLabel/-Entity/-Repo/-Capacity, hub/public/index.html) — with
// small inline edit forms in place: tap/click a field, edit inline,
// confirm, same PATCH /api/projects/:id calls v1 already makes today.
//
// Owns no DOM mount of its own; decorates board.js's already-rendered
// [data-field] spans without ever editing board.js's source, same
// composition pattern t-65's keyboard.js already used on peek-panel.js.
// Coordination contract with board.js (t-86's own mission body, echoed
// here so the two files' halves of one fix stay legible independently):
// board.js's renderProjects() does a full innerHTML replace on every
// v2:state event (another agent's heartbeat, a task update, anything);
// that used to wipe an in-progress edit mid-keystroke (t-74's root
// cause). Fix is split across both files: this file marks the row
// `data-editing="true"` for the duration of an edit; board.js's own
// renderProjects() (t-86's own narrow edit to that file) skips its whole
// rebuild for one cycle whenever any row carries that flag.
//
// No prompt()/confirm()/alert() anywhere in this file (mechanical floor,
// grep-checked in the closing note) — validation and errors render inline
// via a small message under the field being edited.
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

  var esc = window.BureauV2Esc || function (s) {
    return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; });
  };

  // Per-field semantics, ported verbatim from v1's own prompt()-based
  // handlers (hub/public/index.html editProjectLabel/-Entity/-Repo/
  // -Capacity) so this mission changes the INTERACTION, not the behavior:
  // label is required and trimmed; entity/repo are trimmed, empty clears
  // the field; capacity is coerced to a number. Each still fires exactly
  // the PATCH v1 already made.
  var FIELDS = {
    label: {
      placeholder: 'Project label',
      toPatch: function (raw) {
        var v = raw.trim();
        if (!v) return { error: 'A project needs a label.' };
        return { body: { label: v } };
      },
      display: function (v) { return v; }
    },
    entity: {
      placeholder: 'Entity (scope wall) — empty clears',
      toPatch: function (raw) {
        return { body: { entity: raw.trim() } };
      },
      display: function (v) { return v ? '@' + v : ''; }
    },
    repo: {
      placeholder: 'Repo (https clone URL) — empty clears',
      toPatch: function (raw) {
        return { body: { repo: raw.trim() } };
      },
      display: function (v) { return v || ''; }
    },
    capacity: {
      placeholder: 'Capacity',
      inputType: 'number',
      toPatch: function (raw) {
        var n = +raw;
        if (!raw.trim() || isNaN(n) || n < 1 || n > 9) return { error: 'Capacity needs a number, 1-9.' };
        return { body: { capacity: n } };
      },
      display: function (v) { return String(v); }
    }
  };

  function currentValue(row, field) {
    // Read from the LIVE state (window.BureauV2.state), not the DOM text
    // — the DOM's display value is already formatted (e.g. "@acme", not
    // "acme"; the capacity span nests a child, not a plain text node) and
    // re-parsing formatted display text back into an edit value is more
    // fragile than reading the source of truth directly.
    var V2 = window.BureauV2;
    var id = row.getAttribute('data-project');
    var pj = ((V2.state && V2.state.projects) || []).find(function (p) {
      return (typeof p === 'string' ? p : p.id) === id;
    });
    if (!pj || typeof pj === 'string') return field === 'label' ? id : field === 'capacity' ? 1 : '';
    if (field === 'label') return pj.label || pj.id;
    if (field === 'capacity') return pj.capacity || 1;
    return pj[field] || '';
  }

  function init() {
    var V2 = window.BureauV2;
    var rail = document.getElementById('v2-projects-rail');
    if (!rail) return;
    injectStyle();

    // Delegated click listener: board.js rebuilds the row list on every
    // refresh (except mid-edit, per the coordination contract above), so
    // per-element listeners would need re-attaching after every rebuild.
    // One delegated listener on the rail survives every rebuild for free.
    // CAPTURE phase, not bubble: board.js's own row-level click-to-filter
    // listener is attached directly on each .v2-project-row (bubble
    // phase), which is CLOSER to the click target than this delegated
    // listener on the rail — in bubble order the row's own listener fires
    // first regardless of which listener was attached first or calls
    // stopPropagation from further out. A capture-phase listener on an
    // ancestor always runs before ANY bubble-phase listener anywhere in
    // the subtree, board.js's row listener included, so this reliably
    // intercepts a field click before filter-toggling ever sees it — the
    // same technique quick-add.js already established for an equivalent
    // problem (intercepting board.js's own form submit ahead of its
    // bubble-phase handler).
    rail.addEventListener('click', function (e) {
      var field = e.target.closest('[data-field]');
      if (!field) return;
      var row = field.closest('.v2-project-row');
      if (!row) return;
      // If this row is already mid-edit, the click landed somewhere
      // INSIDE the field's own replaced content — the confirm/cancel
      // buttons or the input itself, all of which are also descendants
      // of the [data-field] element and so also match .closest() here.
      // Let it through untouched: stopping propagation at this point
      // (capture phase, ahead of everything) would kill the click before
      // it ever reaches confirmBtn/cancelBtn's own bubble-phase
      // listeners, silently breaking Save/Cancel — a real bug an earlier
      // pass of this file had, caught by actually clicking Save in a
      // live browser and finding no PATCH request was ever sent, not by
      // reading the code.
      if (row.getAttribute('data-editing') === 'true') return;
      // t-133 (goal: t-53): the repo field's non-empty VIEW state is now a
      // real navigable link + hover/focus tooltip (board.js's own
      // .v2-repo-link — icon + tooltip + click-opens-new-tab, replacing
      // the old raw-URL text this field used to show). A bare field click
      // must NOT hijack that click into starting an edit, or the link
      // could never be followed. Editing an existing repo moves to the
      // small adjacent .v2-repo-editbtn (board.js renders it inside the
      // same [data-field="repo"] span, outside .v2-repo-link) instead —
      // that one still matches the generic path below unmodified, since
      // it is NOT inside .v2-repo-link. An EMPTY repo field renders no
      // link at all (nothing to hijack), so a bare click there still
      // starts editing exactly like every other field — this is how you
      // add a first repo, unchanged from before this mission.
      if (field.getAttribute('data-field') === 'repo' && e.target.closest('.v2-repo-link')) return;
      // Not yet editing: this click means "start editing" — take it over
      // from board.js's own row-level click-to-filter listener (bubble
      // phase, closer to the target, would otherwise fire first and
      // toggle the project filter instead of opening the edit UI).
      e.stopPropagation();
      beginEdit(V2, row, field);
    }, true);
  }

  function beginEdit(V2, row, field) {
    var key = field.getAttribute('data-field');
    var spec = FIELDS[key];
    if (!spec) return; // unknown field hook — nothing to edit

    row.setAttribute('data-editing', 'true');
    var savedHTML = field.innerHTML;
    var value = currentValue(row, key);

    var wrap = document.createElement('span');
    wrap.className = 'v2-pedit';
    var input = document.createElement('input');
    input.type = spec.inputType || 'text';
    input.className = 'v2-pedit__input';
    input.value = value;
    input.placeholder = spec.placeholder;
    if (spec.inputType === 'number') { input.min = '1'; input.max = '9'; }
    var err = document.createElement('span');
    err.className = 'v2-pedit__err';
    err.hidden = true;
    var confirmBtn = document.createElement('button');
    confirmBtn.type = 'button';
    confirmBtn.className = 'v2-pedit__ok';
    confirmBtn.setAttribute('aria-label', 'Save');
    confirmBtn.textContent = '✓'; // check mark glyph, not an emoji pictograph — same register as this codebase's plain kbd/UI glyphs elsewhere
    var cancelBtn = document.createElement('button');
    cancelBtn.type = 'button';
    cancelBtn.className = 'v2-pedit__cancel';
    cancelBtn.setAttribute('aria-label', 'Cancel');
    cancelBtn.textContent = '✕';

    wrap.appendChild(input);
    wrap.appendChild(confirmBtn);
    wrap.appendChild(cancelBtn);
    wrap.appendChild(err);
    field.innerHTML = '';
    field.appendChild(wrap);
    input.focus();
    input.select();

    var done = false;
    function endEdit() {
      if (done) return;
      done = true;
      row.removeAttribute('data-editing');
    }
    function cancel() {
      endEdit();
      field.innerHTML = savedHTML; // restore exactly what board.js last rendered
    }
    function confirm() {
      var result = spec.toPatch(input.value);
      if (result.error) {
        err.textContent = result.error;
        err.hidden = false;
        input.focus();
        return;
      }
      var id = row.getAttribute('data-project');
      confirmBtn.disabled = true;
      cancelBtn.disabled = true;
      input.disabled = true;
      V2.api('/api/projects/' + id, { method: 'PATCH', body: JSON.stringify(result.body) }).then(function (r) {
        if (r && r.error) {
          err.textContent = r.error;
          err.hidden = false;
          confirmBtn.disabled = false;
          cancelBtn.disabled = false;
          input.disabled = false;
          input.focus();
          return;
        }
        endEdit();
        // Don't hand-paint the new value here — end the edit and let the
        // next v2:state refresh (already in flight from this same PATCH,
        // or the next periodic one) rebuild the row from the real,
        // server-confirmed state, same single-source-of-truth discipline
        // every other v2- module in this codebase already follows.
        V2.refresh();
      });
    }

    confirmBtn.addEventListener('click', confirm);
    cancelBtn.addEventListener('click', cancel);
    input.addEventListener('keydown', function (e) {
      if (e.key === 'Enter') { e.preventDefault(); confirm(); }
      else if (e.key === 'Escape') { e.preventDefault(); cancel(); }
    });
    // Losing focus without using a button (tap elsewhere) cancels rather
    // than silently confirming — an accidental blur must never fire a
    // PATCH the user didn't explicitly ask for. Deferred one tick so a
    // click ON confirmBtn/cancelBtn (which itself blurs the input) is
    // handled by ITS OWN click listener first, not raced by blur.
    input.addEventListener('blur', function () {
      setTimeout(function () { if (!done) cancel(); }, 120);
    });
  }

  function injectStyle() {
    if (document.getElementById('v2-project-edit-style')) return;
    var style = document.createElement('style');
    style.id = 'v2-project-edit-style';
    style.textContent = [
      // [data-field] elements become tap targets — sized generously
      // (not just the text's own line-height) so this reads cleanly at
      // phone width, the mission's own specifically named motivation.
      '[data-field] { cursor: pointer; border-radius: var(--v2-radius-xs, 4px); padding: 2px 4px; margin: -2px -4px; display: inline-block; min-height: 20px; }',
      '[data-field]:hover { background: var(--v2-color-surface-raised, rgba(128,128,128,.12)); }',
      '[data-field][data-empty="true"]::before { content: "—"; color: var(--v2-color-text-muted, #999); }',
      '.v2-pedit { display: inline-flex; align-items: center; gap: 4px; position: relative; }',
      '.v2-pedit__input { font: inherit; font-size: inherit; padding: 3px 6px; border: 1px solid var(--v2-color-accent, #3f6fe0); border-radius: var(--v2-radius-xs, 4px); background: var(--v2-color-bg, #fff); color: var(--v2-color-text-primary, inherit); min-width: 8ch; }',
      '.v2-pedit__input[type=number] { width: 5ch; min-width: 0; }',
      '.v2-pedit__ok, .v2-pedit__cancel { border: none; background: none; cursor: pointer; font-size: 13px; line-height: 1; padding: 4px 6px; border-radius: var(--v2-radius-xs, 4px); color: var(--v2-color-text-secondary, #666); }',
      '.v2-pedit__ok:hover { background: var(--v2-color-status-on-track-soft, rgba(47,169,104,.15)); color: var(--v2-color-status-on-track, #2fa968); }',
      '.v2-pedit__cancel:hover { background: var(--v2-color-status-bug-soft, rgba(229,72,77,.15)); color: var(--v2-color-status-bug, #e5484d); }',
      '.v2-pedit__ok:disabled, .v2-pedit__cancel:disabled { opacity: .5; cursor: not-allowed; }',
      // Error text as a small floating strip under the field, never a
      // modal/alert() — this mission's own mechanical floor.
      '.v2-pedit__err { position: absolute; top: 100%; left: 0; margin-top: 2px; font-size: 11px; color: var(--v2-color-status-bug, #e5484d); background: var(--v2-color-bg, #fff); border: 1px solid var(--v2-color-status-bug, #e5484d); border-radius: var(--v2-radius-xs, 4px); padding: 2px 6px; white-space: nowrap; z-index: 5; }',
      // Phone width: widen the tap targets further and let the edit
      // control wrap onto its own line rather than overflow the row.
      '@media (max-width: 720px) { .v2-pedit { flex-wrap: wrap; } .v2-pedit__input { min-width: 12ch; font-size: 16px; } [data-field] { min-height: 28px; padding: 6px 6px; } }'
    ].join('\n');
    document.head.appendChild(style);
  }
})();

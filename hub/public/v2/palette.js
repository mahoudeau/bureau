// v2/palette.js — t-65 (goal: t-53). Owns #v2-palette. The cmd-K surface:
// jump to a mission by id/title, filter by project (token-pill pattern,
// close kin to Screenshot-2024-08-03-at-16.25.37.png), and a quick-add
// entry point when the query matches nothing. keyboard.js owns the global
// Cmd/Ctrl+K binding and emits 'v2:palette:open'; this file only reacts to
// that event and its own internal nav once open.
//
// Non-modal: no backdrop, no <dialog>, no prompt(). Closes on Escape,
// on selecting a result, or on an outside click — all standard combobox
// dismissal, not modal chrome.
//
// Rendering is split into buildShell() (runs once per open — creates the
// <input> and mounts its 'input' listener) and renderResults() (runs on
// every keystroke — only replaces the pills+results containers below the
// input). An earlier version rebuilt the whole palette, INCLUDING the
// input element itself, via one innerHTML swap inside the input's own
// 'input' handler — that destroys and recreates the element the browser
// is mid-keystroke on, so typing past the first character lost focus and
// silently stopped filtering (found by a critic actually typing a
// multi-character query, not by a synthetic single .value assignment).
// The <input> node is now created once per open and never replaced while
// the palette stays open.
(function () {
  'use strict';

  function ready(cb) {
    if (window.BureauV2) return cb();
    document.addEventListener('DOMContentLoaded', function poll() {
      if (window.BureauV2) cb(); else setTimeout(poll, 50);
    });
  }

  ready(init);

  function init() {
    var V2 = window.BureauV2;
    var palette = V2.mounts.palette;
    if (!palette) return;
    injectStyle();

    var esc = function (s) {
      return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; });
    };

    var activeProject = null;
    var selectedIndex = 0;
    var lastRows = []; // { kind: 'mission'|'create', id?, ... }
    var inputEl = null;
    var pillsEl = null;
    var resultsEl = null;

    V2.on('v2:palette:open', function () { open(); });

    function open() {
      activeProject = null;
      buildShell();
      palette.hidden = false;
      inputEl.value = '';
      inputEl.focus();
      renderResults('');
    }
    function close() { palette.hidden = true; }

    document.addEventListener('keydown', function (e) {
      if (palette.hidden) return;
      if (e.key === 'Escape') { close(); return; }
      if (e.key === 'ArrowDown') { e.preventDefault(); moveSelection(1); return; }
      if (e.key === 'ArrowUp') { e.preventDefault(); moveSelection(-1); return; }
      if (e.key === 'Enter') {
        var el = document.activeElement;
        if (el && el.id === 'v2-palette-input') { e.preventDefault(); activateSelected(); }
      }
    });
    document.addEventListener('click', function (e) {
      if (palette.hidden) return;
      if (palette.contains(e.target)) return;
      if (V2.mounts.searchEntry && V2.mounts.searchEntry.contains(e.target)) return;
      close();
    });

    function moveSelection(delta) {
      if (!lastRows.length) return;
      selectedIndex = (selectedIndex + delta + lastRows.length) % lastRows.length;
      highlightSelected();
    }
    function highlightSelected() {
      resultsEl.querySelectorAll('.v2-palette__row').forEach(function (row, i) {
        row.classList.toggle('v2-palette__row--selected', i === selectedIndex);
      });
    }
    function activateSelected() {
      var row = lastRows[selectedIndex];
      if (!row) return;
      if (row.kind === 'mission') { V2.emit('v2:mission:open', { id: row.id }); close(); return; }
      if (row.kind === 'create') { createMission(row.title); return; }
    }

    function createMission(title) {
      title = title.trim();
      if (!title) return;
      var project = activeProject || 'general';
      V2.api('/api/tasks', {
        method: 'POST',
        body: JSON.stringify({ title: title, project: project, priority: 3, created_by: 'human' })
      }).then(function (r) {
        if (!r || r.error) return;
        close();
        V2.refresh();
      });
    }

    function score(t, q) {
      var id = (t.id || '').toLowerCase(), title = (t.title || '').toLowerCase();
      if (id === q) return 100;
      if (id.indexOf(q) === 0) return 90;
      if (title.indexOf(q) === 0) return 80;
      if (id.indexOf(q) !== -1) return 60;
      if (title.indexOf(q) !== -1) return 50;
      return 0;
    }

    function projLabel(state, id) {
      var p = (state.projects || []).find(function (pj) { return (typeof pj === 'string' ? pj : pj.id) === id; });
      if (!p) return id;
      return typeof p === 'string' ? p : (p.label || id);
    }

    // Built once per open(); the <input> and hint button created here are
    // never replaced while the palette stays open — only buildShell()
    // creates DOM for them.
    function buildShell() {
      palette.innerHTML =
        '<div class="v2-palette__head">' +
        '<input class="v2-palette__input" id="v2-palette-input" placeholder="Jump to a mission, or type to create one…" autocomplete="off">' +
        '<button type="button" class="v2-palette__hint" aria-label="Palette keyboard shortcuts">⌨<span class="v2-palette__hint-tip">' +
        '<kbd>↑</kbd><kbd>↓</kbd> navigate · <kbd>Enter</kbd> open · <kbd>Esc</kbd> close</span></button>' +
        '</div>' +
        '<div class="v2-palette__pills" id="v2-palette-pills"></div>' +
        '<div class="v2-palette__results" id="v2-palette-results"></div>';
      inputEl = document.getElementById('v2-palette-input');
      pillsEl = document.getElementById('v2-palette-pills');
      resultsEl = document.getElementById('v2-palette-results');
      inputEl.addEventListener('input', function () { renderResults(inputEl.value); });
    }

    // Rebuilds ONLY the pills + results containers below the input — never
    // touches inputEl itself, so focus and cursor position survive every
    // keystroke.
    function renderResults(query) {
      var state = V2.state || { tasks: [], projects: [] };
      var q = query.trim().toLowerCase();
      var tasks = state.tasks || [];
      var scoped = activeProject ? tasks.filter(function (t) { return t.project === activeProject; }) : tasks;
      var results = q
        ? scoped.map(function (t) { return { t: t, s: score(t, q) }; }).filter(function (r) { return r.s > 0; })
          .sort(function (a, b) { return b.s - a.s; }).slice(0, 8).map(function (r) { return r.t; })
        : scoped.slice().sort(function (a, b) { return a.priority - b.priority || b.created_at.localeCompare(a.created_at); }).slice(0, 8);

      var exactMatch = q && results.some(function (t) { return (t.id || '').toLowerCase() === q || (t.title || '').toLowerCase() === q; });

      lastRows = results.map(function (t) { return { kind: 'mission', id: t.id, t: t }; });
      if (q && !exactMatch) lastRows.push({ kind: 'create', title: query.trim() });
      selectedIndex = 0;

      var projectPills = (state.projects || []).map(function (pj) {
        var id = typeof pj === 'string' ? pj : pj.id;
        return '<button type="button" class="v2-palette__pill' + (activeProject === id ? ' v2-palette__pill--active' : '') + '" data-project="' + esc(id) + '">' +
          esc(projLabel(state, id)) + (activeProject === id ? ' <span class="v2-palette__pill-x">✕</span>' : '') + '</button>';
      }).join('');
      pillsEl.innerHTML = projectPills;

      var rowsHtml = lastRows.map(function (row, i) {
        if (row.kind === 'create') {
          return '<div class="v2-palette__row v2-palette__row--create" data-index="' + i + '">+ Create "' + esc(row.title) + '"' + (activeProject ? ' in ' + esc(projLabel(state, activeProject)) : '') + '</div>';
        }
        var t = row.t;
        return '<div class="v2-palette__row" data-index="' + i + '">' +
          '<span class="v2-palette__row-id">' + esc(t.id) + '</span>' +
          '<span class="v2-palette__row-title">' + esc(t.title) + '</span>' +
          '<span class="v2-palette__row-meta">' + esc(t.status) + (t.project ? ' · ' + esc(t.project) : '') + '</span>' +
          '</div>';
      }).join('') || '<div class="v2-empty">No matches.</div>';
      resultsEl.innerHTML = rowsHtml;

      pillsEl.querySelectorAll('.v2-palette__pill').forEach(function (btn) {
        btn.addEventListener('click', function () {
          var id = btn.getAttribute('data-project');
          activeProject = activeProject === id ? null : id;
          renderResults(inputEl.value);
          inputEl.focus();
        });
      });
      resultsEl.querySelectorAll('.v2-palette__row').forEach(function (rowEl) {
        rowEl.addEventListener('click', function () {
          selectedIndex = +rowEl.getAttribute('data-index');
          activateSelected();
        });
      });
      highlightSelected();
    }
  }

  function injectStyle() {
    if (document.getElementById('v2-palette-style')) return;
    var style = document.createElement('style');
    style.id = 'v2-palette-style';
    style.textContent = [
      '.v2-palette__head { display: flex; align-items: center; gap: var(--v2-space-4, 8px); position: relative; }',
      '.v2-palette__input { flex: 1; font: inherit; font-size: var(--v2-font-size-base, 13px); padding: var(--v2-space-4, 8px); border: 1px solid var(--v2-color-border, var(--v2-hairline, rgba(128,128,128,.3))); border-radius: var(--v2-radius-sm, 6px); background: var(--v2-color-bg, var(--v2-bg, transparent)); color: var(--v2-color-text-primary, var(--v2-ink, inherit)); }',
      '.v2-palette__hint { width: 22px; height: 22px; border-radius: var(--v2-radius-full, 999px); border: 1px solid var(--v2-color-border, var(--v2-hairline, rgba(128,128,128,.3))); background: transparent; color: var(--v2-color-text-muted, var(--v2-muted, #999)); font-size: 11px; cursor: default; position: relative; flex: 0 0 auto; }',
      '.v2-palette__hint-tip { display: none; position: absolute; top: 26px; right: 0; white-space: nowrap; background: var(--v2-color-text-primary, #17181a); color: var(--v2-color-text-on-accent, var(--v2-on-accent, #fff)); font-size: 11px; padding: 6px 8px; border-radius: var(--v2-radius-sm, 5px); z-index: var(--v2-z-toast, 70); }',
      '.v2-palette__hint:hover .v2-palette__hint-tip, .v2-palette__hint:focus .v2-palette__hint-tip { display: block; }',
      '.v2-palette__hint-tip kbd { display: inline-block; border: 1px solid rgba(255,255,255,.35); border-radius: 3px; padding: 0 4px; font: inherit; }',
      '.v2-palette__pills { display: flex; flex-wrap: wrap; gap: var(--v2-space-3, 6px); margin-top: var(--v2-space-4, 8px); }',
      /* radius-sm (tight, Pure-Linear register), NOT radius-full: a full
         999px pill read as the retired soft-admin-template register a
         critic pass already rejected once on this goal (t-58 round 0) —
         the cited reference's own filter token (Screenshot-2024-08-03-at-
         16.25.37.png) uses the same tight radius as every other bordered
         element, never a fully rounded pill for a rectangular chip. */
      '.v2-palette__pill { font: inherit; font-size: var(--v2-font-size-xs, 11px); padding: 2px var(--v2-space-4, 8px); border-radius: var(--v2-radius-sm, 5px); border: 1px solid var(--v2-color-border, var(--v2-hairline, rgba(128,128,128,.3))); background: var(--v2-color-surface, transparent); color: var(--v2-color-text-secondary, var(--v2-ink-2, inherit)); cursor: pointer; }',
      '.v2-palette__pill--active { border-color: var(--v2-color-accent, var(--v2-accent, #3f6fe0)); color: var(--v2-color-accent, var(--v2-accent, #3f6fe0)); }',
      '.v2-palette__results { margin-top: var(--v2-space-4, 8px); max-height: 46vh; overflow-y: auto; }',
      '.v2-palette__row { display: flex; align-items: baseline; gap: var(--v2-space-4, 8px); padding: var(--v2-space-4, 8px); border-radius: var(--v2-radius-sm, 5px); cursor: pointer; font-size: var(--v2-font-size-sm, 12px); }',
      '.v2-palette__row--selected, .v2-palette__row:hover { background: var(--v2-color-row-selected-bg, rgba(63,111,224,.08)); }',
      '.v2-palette__row-id { color: var(--v2-color-text-muted, var(--v2-muted, #999)); font-variant-numeric: tabular-nums; flex: 0 0 auto; }',
      '.v2-palette__row-title { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }',
      '.v2-palette__row-meta { color: var(--v2-color-text-muted, var(--v2-muted, #999)); font-size: var(--v2-font-size-xs, 11px); flex: 0 0 auto; }',
      '.v2-palette__row--create { color: var(--v2-color-accent, var(--v2-accent, #3f6fe0)); font-weight: var(--v2-weight-medium, 600); }'
    ].join('\n');
    document.head.appendChild(style);
  }
})();

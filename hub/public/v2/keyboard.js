// v2/keyboard.js — t-65 (goal: t-53). The global keyboard map. Owns no DOM
// mount of its own; reads window.BureauV2 and DECORATES #v2-peek-panel's
// already-rendered item rows (data-item-index/data-item-id, the extension
// point t-64's peek-panel.js left on purpose) without ever editing that
// file, per this mission's explicit scope.
//
// Two responsibilities:
//   1. Cmd/Ctrl+K anywhere on the page → emit('v2:palette:open').
//   2. Inside an open, review-status peek panel, with focus NOT in a text
//      field: digits 1-9 jump focus to an item; a/r/l record that item's
//      verdict and auto-advance to the next one; Enter submits (clicks
//      Approve). This is the "5 items in 6 keystrokes" flow the i2
//      proposal itself costs out (a,a,a,a,a,Enter for an all-accept pass).
//
// Shortcut hints are taught ONLY on hover (STUDY-lead.md: "shortcuts are
// taught, not chrome" — see Screenshot-2024-08-03-at-16.32.40.png, a small
// dark tooltip chip spelling out the key sequence next to the action, never
// permanent legend text). This file injects exactly one such hover-only
// hint into the panel, decorative-only, rebuilt on every panel render
// (since peek-panel.js's innerHTML replace on each open would otherwise
// wipe it) — never a resting/always-visible shortcut list.
//
// Round 4 (this mission's own reference-must-win loop): the hint trigger
// itself was a literal '⌨' (U+2328 KEYBOARD) character — the boss caught
// this directly ("I see emojis in available screenshots while we agreed
// on an icon library"), and t-89 (the sibling sweep mission for every
// OTHER already-shipped Wave-1 file) explicitly carves this file out with
// "t-65 is handling its own fix as part of its own loop" — this is that
// fix. Swapped for t-66's vendored Lucide `icon('command')` glyph, the
// same component every other approved Wave-1 file composes with for a
// keyboard/shortcut affordance (there's no dedicated "keyboard" shape in
// the 30-icon vendored set; `command` is the closest semantic fit and is
// already the established glyph this codebase uses for keyboard-triggered
// affordances generally).
import { icon } from './components.js';

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
    var panel = V2.mounts.peekPanel;
    if (!panel) return;
    injectStyle();

    var focusedIndex = -1;

    function isTextInput(el) {
      if (!el) return false;
      var tag = el.tagName;
      return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || el.isContentEditable;
    }

    function items() {
      var rows = panel.hidden ? [] : Array.prototype.slice.call(panel.querySelectorAll('.v2-panel__item'));
      // Only "active" for keyboard nav when items are editable (status===review
      // renders radios; a closed/read-only mission's items have none).
      if (!rows.length || !rows[0].querySelector('input[type=radio]')) return [];
      return rows;
    }

    function applyFocus(rows) {
      rows.forEach(function (row, i) {
        row.classList.toggle('v2-panel__item--focused', i === focusedIndex);
      });
      if (focusedIndex >= 0 && rows[focusedIndex]) {
        rows[focusedIndex].scrollIntoView({ block: 'nearest' });
      }
    }

    function setVerdict(row, value) {
      var radio = row.querySelector('input[type=radio][value="' + value + '"]');
      if (radio) radio.checked = true;
    }

    // Rebuild the hover-taught hint + reset item focus every time the panel's
    // content changes (opened, closed, re-rendered after an action).
    //
    // IMPORTANT: hintTip is appended to document.body, NOT to `panel` itself,
    // and positioned with fixed coordinates read off panel's own rect. panel
    // is the node the MutationObserver below watches for childList changes
    // (that's how this file notices peek-panel.js re-rendering, without
    // editing that file); appending the hint AS A CHILD OF panel would make
    // the observer see its own insertion as a new mutation and re-fire
    // forever. Keeping it a sibling outside the observed subtree avoids that
    // entirely.
    var hintTip = null;
    function rebuildHint() {
      var rows = items();
      if (hintTip && hintTip.parentNode) hintTip.parentNode.removeChild(hintTip);
      hintTip = null;
      if (!rows.length) { focusedIndex = -1; return; }
      if (focusedIndex < 0 || focusedIndex >= rows.length) focusedIndex = 0;
      applyFocus(rows);
      hintTip = document.createElement('button');
      hintTip.type = 'button';
      hintTip.className = 'v2-kbd-hint';
      hintTip.setAttribute('aria-label', 'Keyboard shortcuts for this item list');
      hintTip.innerHTML = icon('command') + '<span class="v2-kbd-hint__tip">' +
        '<kbd>1</kbd>–<kbd>9</kbd> focus item · <kbd>A</kbd> accept · <kbd>R</kbd> reject · <kbd>L</kbd> later · <kbd>Enter</kbd> submit' +
        '</span>';
      var r = panel.getBoundingClientRect();
      hintTip.style.position = 'fixed';
      hintTip.style.top = (r.top + 12) + 'px';
      hintTip.style.left = (r.right - 56) + 'px';
      document.body.appendChild(hintTip);
    }

    new MutationObserver(rebuildHint).observe(panel, { childList: true });

    document.addEventListener('keydown', function (e) {
      var mod = e.metaKey || e.ctrlKey;

      // ---- 1. global cmd/ctrl+K ----
      if (mod && (e.key === 'k' || e.key === 'K')) {
        e.preventDefault();
        V2.emit('v2:palette:open', null);
        return;
      }

      // ---- 2. item-list nav: only when the panel is open with editable
      // items and focus isn't inside a text field (typing "a" in a comment
      // box must never fire a verdict). ----
      if (mod || e.altKey) return;
      if (isTextInput(document.activeElement)) return;
      var rows = items();
      if (!rows.length) return;

      if (/^[1-9]$/.test(e.key)) {
        var idx = +e.key - 1;
        if (idx < rows.length) { e.preventDefault(); focusedIndex = idx; applyFocus(rows); }
        return;
      }
      if (e.key === 'a' || e.key === 'A' || e.key === 'r' || e.key === 'R' || e.key === 'l' || e.key === 'L') {
        if (focusedIndex < 0) focusedIndex = 0;
        var row = rows[focusedIndex];
        if (!row) return;
        e.preventDefault();
        var value = (e.key === 'a' || e.key === 'A') ? 'approved' : (e.key === 'r' || e.key === 'R') ? 'rejected' : '';
        setVerdict(row, value);
        focusedIndex = Math.min(focusedIndex + 1, rows.length - 1);
        applyFocus(rows);
        return;
      }
      if (e.key === 'Enter') {
        var approveBtn = document.getElementById('v2-pp-approve');
        if (approveBtn) { e.preventDefault(); approveBtn.click(); }
        return;
      }
    });
  }

  function injectStyle() {
    if (document.getElementById('v2-keyboard-style')) return;
    var style = document.createElement('style');
    style.id = 'v2-keyboard-style';
    style.textContent = [
      '.v2-panel__item--focused { background: var(--v2-color-row-selected-bg, rgba(63,111,224,.08)); border-color: var(--v2-color-row-selected-border, var(--v2-accent, #3f6fe0)); }',
      /* .v2-kbd-hint\'s position/top/left are set inline in JS (fixed,
         computed off panel.getBoundingClientRect()) — it lives in
         document.body, not inside #v2-peek-panel, on purpose (see the
         comment on rebuildHint()); z-index still comes from the token set. */
      '.v2-kbd-hint { z-index: var(--v2-z-popover, 60); width: 20px; height: 20px; border-radius: var(--v2-radius-full, 999px); border: 1px solid var(--v2-color-border, var(--v2-hairline, rgba(128,128,128,.3))); background: var(--v2-color-surface, var(--v2-surface, transparent)); color: var(--v2-color-text-muted, var(--v2-muted, #999)); font-size: 11px; line-height: 18px; cursor: default; padding: 0; display: inline-flex; align-items: center; justify-content: center; }',
      '.v2-kbd-hint__tip { display: none; position: absolute; top: 26px; right: 0; white-space: nowrap; background: var(--v2-color-text-primary, #17181a); color: var(--v2-color-text-on-accent, var(--v2-on-accent, #fff)); font-size: 11px; font-weight: var(--v2-weight-regular, 400); padding: 6px 8px; border-radius: var(--v2-radius-sm, 5px); z-index: var(--v2-z-toast, 70); }',
      '.v2-kbd-hint:hover .v2-kbd-hint__tip, .v2-kbd-hint:focus .v2-kbd-hint__tip, .v2-kbd-hint:focus-visible .v2-kbd-hint__tip { display: block; }',
      '.v2-kbd-hint__tip kbd { display: inline-flex; align-items: center; justify-content: center; border: 1px solid rgba(255,255,255,.35); border-radius: 3px; padding: 0 4px; font: inherit; font-variant-numeric: tabular-nums; }',
      // round 4: components.css (t-66) is the source of record for .v2-icon
      // sizing, but v2.html never links it (verified: grepped v2.html for
      // "components.css" — zero matches; components.js loads as a script
      // module, its CSS sibling does not) — the icon() helper's returned
      // <svg class="v2-icon"> was rendering unsized (browser-default
      // intrinsic box) everywhere in the whole v2 tranche, not just here.
      // Every OTHER module in this codebase already carries its own
      // self-injected <style> (this function is that pattern) rather than
      // depending on an external stylesheet link, so the in-scope fix is
      // the same pattern, not a v2.html edit this mission does not own: a
      // local fallback rule, matching components.css's own values exactly,
      // scoped to this file's own injected sheet.
      '.v2-icon { display: inline-block; width: var(--v2-icon-size-sm, 14px); height: var(--v2-icon-size-sm, 14px); vertical-align: -0.15em; color: currentColor; flex: none; }'
    ].join('\n');
    document.head.appendChild(style);
  }
})();

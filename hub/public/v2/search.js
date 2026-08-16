// v2/search.js — t-73 (goal: t-53), t-55 item i7.
// Own only this file. Search across missions (title + body, client-side
// over already-fetched window.BureauV2.state) and the brain (fetch each
// file on demand via GET /api/knowledge and grep its content client-side —
// v1 scope per i7's own item body: this stops scaling once the brain is
// much bigger, a hub-side search endpoint is a future follow-on). No new
// hub endpoint, no external requests.
//
// SCOPE NOTE on the IA's own aspiration (v2.html §1: "#v2-palette ... i7
// search results render inside it"): read t-65/palette.js (already built,
// in review) before writing this file. It owns #v2-palette exclusively and
// rebuilds that mount's ENTIRE innerHTML on every open AND on every single
// keystroke (buildShell()/renderResults() — see its own header comment on
// why: an earlier version that rebuilt the input itself broke mid-typing
// focus). It exposes no hook, event, or sub-region for a sibling to inject
// into, and re-injecting content into a node another module wholesale
// replaces every keystroke would either be invisible half the time or
// require fighting its render cycle — worse than the "never reach into
// another module's DOM" rule this contract already warns against. Rather
// than a fragile MutationObserver race against a per-keystroke rebuild
// (unlike peek-panel.js's occasional wholesale re-render, which t-69/
// batch-verdicts.js safely observes), this module owns a fully separate,
// self-contained surface: its own trigger, its own non-modal panel,
// appended once to document.body, touching no other module's DOM. It does
// not compete with palette.js's quick mission-jump (Cmd/Ctrl+K) — that
// stays the fast id/title jump; this is the deeper title+body+brain search
// the mission itself asks for, reachable by its own affordance.
//
// t-89: the 🔎 trigger-button emoji prefix (below) is swapped for t-66's
// vendored 'search' icon — an exact name/shape match, unlike this file's
// own ✕ close-button glyph, left as-is: rendered (checked live, not just
// by codepoint), ✕ (U+2715) is a plain monochrome glyph, not a colorful
// emoji, same register as a plain arrow character — not what this
// mission's emoji-as-icon sweep targets.
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

  var TEXT_EXT = /\.(md|txt|json|csv)$/i;

  function init() {
    var V2 = window.BureauV2;
    injectStyle();

    var esc = function (s) {
      return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; });
    };

    var mode = 'missions'; // 'missions' | 'brain'
    var brainFiles = null; // cached file list, fetched once per panel open
    var brainSearchToken = 0; // guards against a stale async response landing after a newer query
    var panel, trigger, input, modeMissionsBtn, modeBrainBtn, resultsEl, statusEl;

    buildTrigger();
    buildPanel();

    document.addEventListener('keydown', function (e) {
      if (panel.hidden) return;
      if (e.key === 'Escape') close();
    });
    document.addEventListener('click', function (e) {
      if (panel.hidden) return;
      if (panel.contains(e.target) || trigger.contains(e.target)) return;
      close();
    });

    function open() {
      panel.hidden = false;
      input.value = '';
      input.focus();
      renderMissions('');
    }
    function close() { panel.hidden = true; }

    function buildTrigger() {
      trigger = document.createElement('button');
      trigger.type = 'button';
      trigger.className = 'v2-search-trigger';
      trigger.setAttribute('aria-label', 'Search missions and brain');
      trigger.innerHTML = icon('search') + ' <span class="v2-search-trigger__label">Search everything</span>';
      trigger.addEventListener('click', function () { panel.hidden ? open() : close(); });
      document.body.appendChild(trigger);
    }

    function buildPanel() {
      panel = document.createElement('div');
      panel.className = 'v2-search-panel';
      panel.hidden = true;
      panel.setAttribute('role', 'dialog');
      panel.setAttribute('aria-modal', 'false');
      panel.setAttribute('aria-label', 'Search missions and brain');
      panel.innerHTML =
        '<div class="v2-search-panel__head">' +
        '<input class="v2-search-panel__input" placeholder="Search mission titles/body, or brain files…" autocomplete="off">' +
        '<button type="button" class="v2-search-panel__close" aria-label="Close search">✕</button>' +
        '</div>' +
        '<div class="v2-search-panel__modes">' +
        '<button type="button" class="v2-search-panel__mode v2-search-panel__mode--active" data-mode="missions">Missions</button>' +
        '<button type="button" class="v2-search-panel__mode" data-mode="brain">Brain</button>' +
        '</div>' +
        '<div class="v2-search-panel__status" hidden></div>' +
        '<div class="v2-search-panel__results"></div>';
      document.body.appendChild(panel);

      input = panel.querySelector('.v2-search-panel__input');
      modeMissionsBtn = panel.querySelector('[data-mode="missions"]');
      modeBrainBtn = panel.querySelector('[data-mode="brain"]');
      resultsEl = panel.querySelector('.v2-search-panel__results');
      statusEl = panel.querySelector('.v2-search-panel__status');

      panel.querySelector('.v2-search-panel__close').addEventListener('click', close);
      modeMissionsBtn.addEventListener('click', function () { setMode('missions'); });
      modeBrainBtn.addEventListener('click', function () { setMode('brain'); });

      // Missions: instant, live, client-side over already-fetched state —
      // no debounce needed, no network call per keystroke.
      // Brain: debounced (each query fetches every text file's content on
      // demand; firing that per keystroke would hammer the hub for no
      // benefit on a query that isn't finished yet).
      var brainDebounce = null;
      input.addEventListener('input', function () {
        if (mode === 'missions') { renderMissions(input.value); return; }
        clearTimeout(brainDebounce);
        brainDebounce = setTimeout(function () { renderBrain(input.value); }, 400);
      });
    }

    function setMode(next) {
      mode = next;
      modeMissionsBtn.classList.toggle('v2-search-panel__mode--active', mode === 'missions');
      modeBrainBtn.classList.toggle('v2-search-panel__mode--active', mode === 'brain');
      if (mode === 'missions') renderMissions(input.value);
      else renderBrain(input.value);
    }

    function projLabel(state, id) {
      var p = (state.projects || []).find(function (pj) { return (typeof pj === 'string' ? pj : pj.id) === id; });
      if (!p) return id;
      return typeof p === 'string' ? p : (p.label || id);
    }

    // ---- missions: title + body substring match over live state --------
    function renderMissions(query) {
      setStatus(null);
      var q = query.trim().toLowerCase();
      var state = V2.state || { tasks: [], projects: [] };
      var tasks = state.tasks || [];
      var matches = !q ? [] : tasks.filter(function (t) {
        return (t.title || '').toLowerCase().indexOf(q) !== -1 || (t.body || '').toLowerCase().indexOf(q) !== -1;
      }).slice(0, 30);

      if (!q) { resultsEl.innerHTML = '<div class="v2-empty">Type to filter missions by title or body.</div>'; return; }
      resultsEl.innerHTML = matches.length ? matches.map(function (t) {
        var bodySnippet = snippet(t.body || '', q);
        return '<div class="v2-search-result" data-id="' + esc(t.id) + '">' +
          '<div class="v2-search-result__head"><span class="v2-search-result__id">' + esc(t.id) + '</span>' +
          '<span class="v2-search-result__title">' + esc(t.title) + '</span></div>' +
          '<div class="v2-search-result__meta">' + esc(t.status) + (t.project ? ' · ' + esc(projLabel(state, t.project)) : '') + '</div>' +
          (bodySnippet ? '<div class="v2-search-result__snippet">' + highlight(esc(bodySnippet), q) + '</div>' : '') +
          '</div>';
      }).join('') : '<div class="v2-empty">No missions match “' + esc(query) + '”.</div>';

      resultsEl.querySelectorAll('.v2-search-result').forEach(function (row) {
        row.addEventListener('click', function () {
          V2.emit('v2:mission:open', { id: row.getAttribute('data-id') });
          close();
        });
      });
    }

    // ---- brain: fetch file list once, grep each text file's content -----
    function renderBrain(query) {
      var q = query.trim();
      if (!q) { setStatus(null); resultsEl.innerHTML = '<div class="v2-empty">Type to search brain file contents.</div>'; return; }
      var token = ++brainSearchToken;
      setStatus('Searching the brain…');
      resultsEl.innerHTML = '';

      var listPromise = brainFiles ? Promise.resolve(brainFiles) : V2.api('/api/knowledge?dir=').then(function (r) {
        brainFiles = (r && r.files) || [];
        return brainFiles;
      });

      listPromise.then(function (files) {
        if (token !== brainSearchToken) return; // a newer query superseded this one
        var candidates = files.filter(function (f) { return TEXT_EXT.test(f); });
        var qLower = q.toLowerCase();
        var fetches = candidates.map(function (f) {
          return V2.api('/api/knowledge?file=' + encodeURIComponent(f)).then(function (r) {
            var content = r && typeof r.content === 'string' ? r.content : '';
            var lines = content.split('\n');
            var hits = [];
            for (var i = 0; i < lines.length && hits.length < 3; i++) {
              if (lines[i].toLowerCase().indexOf(qLower) !== -1) hits.push({ n: i + 1, text: lines[i].trim().slice(0, 200) });
            }
            return hits.length ? { file: f, hits: hits } : null;
          }).catch(function () { return null; });
        });
        return Promise.all(fetches);
      }).then(function (results) {
        if (!results || token !== brainSearchToken) return;
        var hits = results.filter(Boolean).slice(0, 20);
        setStatus(null);
        resultsEl.innerHTML = hits.length ? hits.map(function (r) {
          return '<div class="v2-search-result" data-file="' + esc(r.file) + '">' +
            '<div class="v2-search-result__head"><span class="v2-search-result__title">' + esc(r.file) + '</span></div>' +
            r.hits.map(function (h) {
              return '<div class="v2-search-result__snippet"><span class="v2-search-result__line">L' + h.n + '</span> ' + highlight(esc(h.text), q) + '</div>';
            }).join('') +
            '</div>';
        }).join('') : '<div class="v2-empty">No brain files match “' + esc(q) + '”.</div>';
        resultsEl.querySelectorAll('.v2-search-result').forEach(function (row) {
          row.addEventListener('click', function () {
            V2.emit('v2:brain:open', { file: row.getAttribute('data-file') });
            close();
          });
        });
      });
    }

    function setStatus(msg) {
      if (msg) { statusEl.hidden = false; statusEl.textContent = msg; }
      else { statusEl.hidden = true; statusEl.textContent = ''; }
    }

    function snippet(text, q) {
      var idx = text.toLowerCase().indexOf(q);
      if (idx === -1) return '';
      var start = Math.max(0, idx - 40);
      return (start > 0 ? '…' : '') + text.slice(start, idx + q.length + 60);
    }
    function highlight(escapedText, q) {
      if (!q) return escapedText;
      var re = new RegExp('(' + q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + ')', 'ig');
      return escapedText.replace(re, '<mark class="v2-search-mark">$1</mark>');
    }
  }

  function injectStyle() {
    if (document.getElementById('v2-search-style')) return;
    var style = document.createElement('style');
    style.id = 'v2-search-style';
    style.textContent = [
      '.v2-search-trigger { position: fixed; left: var(--v2-space-3, 12px); bottom: var(--v2-space-3, 12px); z-index: 44; display: flex; align-items: center; gap: var(--v2-space-2, 6px); font: inherit; font-size: var(--v2-font-size-xs, 12px); padding: var(--v2-space-2, 6px) var(--v2-space-4, 10px); border: 1px solid var(--v2-color-border, var(--v2-hairline, rgba(128,128,128,.3))); border-radius: var(--v2-radius-sm, 6px); background: var(--v2-color-surface, var(--v2-surface, #fff)); color: var(--v2-color-text-secondary, var(--v2-ink-2, inherit)); cursor: pointer; }',
      '.v2-search-trigger:hover { border-color: var(--v2-color-border-strong, var(--v2-hairline, rgba(128,128,128,.5))); }',
      '.v2-search-panel { position: fixed; left: 50%; top: 10vh; transform: translateX(-50%); width: min(560px, 92vw); max-height: 76vh; display: flex; flex-direction: column; background: var(--v2-color-surface, var(--v2-surface, #fff)); border: 1px solid var(--v2-color-border, var(--v2-hairline, rgba(128,128,128,.3))); border-radius: var(--v2-radius-sm, 8px); box-shadow: 0 8px 28px rgba(0,0,0,.18); z-index: 50; padding: var(--v2-space-5, 14px); }',
      '@media (max-width: 720px) { .v2-search-panel { top: 0; left: 0; transform: none; width: 100%; max-height: 100%; height: 100%; border-radius: 0; } }',
      '.v2-search-panel__head { display: flex; align-items: center; gap: var(--v2-space-4, 8px); }',
      '.v2-search-panel__input { flex: 1; font: inherit; font-size: var(--v2-font-size-base, 13px); padding: var(--v2-space-4, 8px); border: 1px solid var(--v2-color-border, var(--v2-hairline, rgba(128,128,128,.3))); border-radius: var(--v2-radius-sm, 6px); background: var(--v2-color-bg, var(--v2-bg, transparent)); color: var(--v2-color-text-primary, var(--v2-ink, inherit)); }',
      '.v2-search-panel__close { border: none; background: transparent; color: var(--v2-color-text-muted, var(--v2-muted, #999)); font-size: 16px; cursor: pointer; flex: 0 0 auto; }',
      '.v2-search-panel__modes { display: flex; gap: var(--v2-space-3, 6px); margin-top: var(--v2-space-4, 8px); }',
      '.v2-search-panel__mode { font: inherit; font-size: var(--v2-font-size-xs, 11px); padding: 2px var(--v2-space-4, 8px); border-radius: var(--v2-radius-sm, 5px); border: 1px solid var(--v2-color-border, var(--v2-hairline, rgba(128,128,128,.3))); background: transparent; color: var(--v2-color-text-secondary, var(--v2-ink-2, inherit)); cursor: pointer; }',
      '.v2-search-panel__mode--active { border-color: var(--v2-color-accent, var(--v2-accent, #3f6fe0)); color: var(--v2-color-accent, var(--v2-accent, #3f6fe0)); }',
      '.v2-search-panel__status { margin-top: var(--v2-space-3, 8px); font-size: var(--v2-font-size-xs, 12px); color: var(--v2-color-text-muted, var(--v2-muted, #999)); }',
      '.v2-search-panel__results { margin-top: var(--v2-space-4, 8px); overflow-y: auto; flex: 1 1 auto; }',
      '.v2-search-result { padding: var(--v2-space-4, 8px); border-radius: var(--v2-radius-sm, 5px); cursor: pointer; font-size: var(--v2-font-size-sm, 12px); border-bottom: 1px solid var(--v2-color-border, var(--v2-hairline, rgba(128,128,128,.15))); }',
      '.v2-search-result:hover { background: var(--v2-color-row-selected-bg, rgba(63,111,224,.08)); }',
      '.v2-search-result__head { display: flex; align-items: baseline; gap: var(--v2-space-4, 8px); }',
      '.v2-search-result__id { color: var(--v2-color-text-muted, var(--v2-muted, #999)); font-variant-numeric: tabular-nums; flex: 0 0 auto; }',
      '.v2-search-result__title { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-weight: var(--v2-weight-medium, 600); }',
      '.v2-search-result__meta { color: var(--v2-color-text-muted, var(--v2-muted, #999)); font-size: var(--v2-font-size-xs, 11px); margin-top: 2px; }',
      '.v2-search-result__snippet { color: var(--v2-color-text-secondary, var(--v2-ink-2, inherit)); font-size: var(--v2-font-size-xs, 11.5px); margin-top: var(--v2-space-2, 4px); overflow-wrap: break-word; }',
      '.v2-search-result__line { color: var(--v2-color-text-muted, var(--v2-muted, #999)); font-variant-numeric: tabular-nums; margin-right: var(--v2-space-2, 4px); }',
      '.v2-search-mark { background: var(--v2-color-accent-soft, rgba(63,111,224,.25)); color: inherit; border-radius: 2px; }'
    ].join('\n');
    document.head.appendChild(style);
  }
})();

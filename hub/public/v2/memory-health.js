// v2/memory-health.js (M5, drift checks): the memory health block from
// GET /api/memory/health as one quiet line in the left rail, right above the
// brain card. The glyph and the word carry the status (circle-check for ok,
// circle-alert for attention); the color only repeats them. A click unfolds
// the reasons and the lists in place.
//
// Refreshed on brain writes and mission changes from the shared SSE bus, at
// most once every few seconds, and on the shell's 60s poll.
//
// Composition pattern (same as office-mini.js): builds its own card,
// touches no other module's DOM.
import { icon } from './components.js';

(function () {
  'use strict';

  var EVERY_MS = 5000;
  var EVENTS = ['task.created', 'task.claimed', 'task.done', 'task.failed', 'task.review', 'task.approved', 'task.applied',
    'task.blocked', 'task.requeued', 'task.updated', 'knowledge.written', 'journal.captured',
    'project.renamed', 'project.created', 'project.deleted'];

  function ready(cb) {
    if (window.BureauV2 && window.BureauV2.state) return cb();
    var off = window.BureauV2 ? window.BureauV2.on('v2:ready', function () { off(); cb(); }) : null;
    if (!window.BureauV2) {
      document.addEventListener('DOMContentLoaded', function poll() {
        if (window.BureauV2) { ready(cb); } else { setTimeout(poll, 50); }
      });
    }
  }

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; });
  }
  function plural(n, word) { return n + ' ' + word + (n === 1 ? '' : 's'); }

  ready(init);

  function init() {
    var V2 = window.BureauV2;
    var brain = document.getElementById('v2-brain-entry');
    if (!brain) return;
    injectStyle();

    var card = document.createElement('section');
    card.className = 'v2-card v2-memory';
    card.id = 'v2-memory-health';
    card.setAttribute('aria-label', 'Memory health');
    card.innerHTML =
      '<h2 class="v2-region-title">Memory</h2>' +
      '<button type="button" class="v2-memory__line" aria-expanded="false" aria-controls="v2-memory-detail">Loading…</button>' +
      '<div class="v2-memory__detail" id="v2-memory-detail" hidden></div>';
    brain.insertAdjacentElement('beforebegin', card);

    var line = card.querySelector('.v2-memory__line');
    var detail = card.querySelector('.v2-memory__detail');
    var health = null, timer = null, last = 0;

    line.addEventListener('click', function () {
      detail.hidden = !detail.hidden;
      line.setAttribute('aria-expanded', String(!detail.hidden));
      if (!detail.hidden) renderDetail();
    });

    function load() {
      last = Date.now();
      V2.api('/api/memory/health').then(function (h) {
        if (!h || !h.status) return;
        health = h;
        renderLine();
        if (!detail.hidden) renderDetail();
      }).catch(function () { /* the next event or poll tries again */ });
    }
    function soon() {
      if (timer) return;
      timer = setTimeout(function () { timer = null; load(); }, Math.max(0, EVERY_MS - (Date.now() - last)));
    }

    function renderLine() {
      var h = health;
      var waiting = h.approved_unapplied.reduce(function (n, m) { return n + m.items.length; }, 0);
      card.classList.toggle('v2-memory--attention', h.status !== 'ok');
      line.innerHTML =
        '<span class="v2-memory__glyph" aria-hidden="true">' + icon(h.status === 'ok' ? 'circle-check' : 'circle-alert') + '</span>' +
        '<span><b>' + esc(h.status) + '</b> · ' + plural(h.lint.errors, 'lint error') + ' · ' +
        h.journal.invalid.length + ' unreadable · ' + waiting + ' waiting to apply · ' + h.stale.count + ' stale</span>';
    }

    function list(rows, empty) {
      return rows.length ? '<ul>' + rows.map(function (r) { return '<li>' + r + '</li>'; }).join('') + '</ul>' : '<p>' + empty + '</p>';
    }
    function renderDetail() {
      var h = health;
      if (!h) return;
      var p = h.provenance;
      var counts = function (o) { return Object.keys(o).map(function (k) { return esc(k) + ' ' + o[k]; }).join(', ') || 'none'; };
      detail.innerHTML =
        '<h3>Reasons</h3>' + list(h.reasons.map(esc), 'Nothing calls for attention.') +
        '<h3>Lint</h3><p>' + h.lint.errors + ' errors, ' + h.lint.warnings + ' warnings</p>' + list(h.lint.messages.map(esc), '') +
        '<h3>Journal, last ' + h.journal.days + ' days</h3><p>' + h.journal.records + ' records · by kind: ' + counts(h.journal.by_kind) + ' · by author: ' + counts(h.journal.by_author) + '</p>' +
        list(h.journal.invalid.map(function (b) { return esc(b.file) + ':' + b.line + ' ' + esc(b.errors.map(function (e) { return e.code; }).join(', ')); }), 'No unreadable blocks.') +
        '<h3>Approved, not applied</h3>' + list(h.approved_unapplied.map(function (m) {
          return '<a href="#" data-mission="' + esc(m.id) + '">' + esc(m.id) + '</a> ' + esc(m.items.join(', ')) + ' · waiting ' + Math.floor(m.waiting_hours) + 'h' + (m.overdue ? ' (over 48h)' : '');
        }), 'Nothing waiting.') +
        '<h3>Stale</h3><p>' + h.stale.count + ' past their window, ' + h.stale.undated + ' undated</p>' +
        list(h.stale.claims.map(function (c) { return esc(c.file) + ':' + c.line + ' ' + esc(c.volatility) + ', verified ' + esc(c.verified); }), '') +
        '<h3>Contradictions</h3>' + list(h.contradictions.map(function (c) { return esc(c.id || '(no id)') + ' contradicts ' + esc(c.contradicts); }), 'None open.') +
        '<h3>Provenance</h3><p>' + p.claims + ' curated claims · ' + p.own + ' own source · ' + p.file + ' file source · ' + p.none + ' none' +
        (p.sourced_pct === null ? '' : ' · ' + p.sourced_pct + '% sourced') + '</p>' +
        '<h3>Reads</h3><p>Not tracked yet.</p>';
    }
    detail.addEventListener('click', function (e) {
      var a = e.target.closest('a[data-mission]');
      if (!a) return;
      e.preventDefault();
      V2.emit('v2:mission:open', { id: a.getAttribute('data-mission') });
    });

    EVENTS.forEach(function (t) { V2.on(t, soon); });
    setInterval(soon, 60000);
    load();
  }

  function injectStyle() {
    if (document.getElementById('v2-memory-style')) return;
    var style = document.createElement('style');
    style.id = 'v2-memory-style';
    style.textContent = [
      '.v2-memory__line { display: flex; align-items: flex-start; gap: var(--v2-space-2, 6px); width: 100%; padding: 0; border: none; background: transparent; text-align: left; cursor: pointer; font: inherit; font-size: 12px; line-height: 1.45; color: var(--v2-color-text-secondary); }',
      '.v2-memory__line:hover b { color: var(--v2-color-text-primary); }',
      '.v2-memory__line:focus-visible { outline: 2px solid var(--v2-color-focus-ring); outline-offset: 2px; border-radius: 4px; }',
      '.v2-memory__line b { font-weight: 600; color: var(--v2-color-text-primary); }',
      '.v2-memory__glyph { flex: none; display: inline-flex; padding-top: 1px; color: var(--v2-color-status-on-track); }',
      '.v2-memory__glyph svg { width: 14px; height: 14px; }',
      '.v2-memory--attention .v2-memory__glyph { color: var(--v2-color-status-at-risk); }',
      '.v2-memory__detail { margin-top: var(--v2-space-3, 8px); font-size: 12px; color: var(--v2-color-text-secondary); max-height: 50vh; overflow-y: auto; overflow-wrap: anywhere; }',
      '.v2-memory__detail h3 { margin: var(--v2-space-3, 8px) 0 2px; font-size: 11px; font-weight: 600; color: var(--v2-color-text-muted); text-transform: uppercase; letter-spacing: .04em; }',
      '.v2-memory__detail p { margin: 0 0 2px; }',
      '.v2-memory__detail ul { margin: 0 0 2px; padding-left: 16px; }',
      '.v2-memory__detail a { color: var(--v2-color-accent); }',
    ].join('\n');
    document.head.appendChild(style);
  }
})();

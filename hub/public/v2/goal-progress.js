// v2/goal-progress.js — t-70 (goal: t-53). Owns #v2-goal-progress only.
// Builds t-55 item i4: a dedicated view for any mission titled "goal: ...",
// its full child list grouped by status, and — for perpetual-mode goals —
// a chronological trail of what each tranche/cycle shipped, parsed from
// the goal's own log notes. Read-only, no new hub endpoint: every render
// comes straight out of window.BureauV2.state.tasks (already fetched by
// v2.html's own refresh()/SSE loop — the acceptance's own "already-fetched
// /api/tasks" wording), never a dedicated fetch.
//
// Triggers, per t-62's own documented contract (v2.html's top-of-file
// comment, "Cross-module UI events" section):
//   'v2:goal-progress:open' { id } — the primary, tested path: peek-
//     panel.js's own "Open goal/cycle progress →" button, wired and
//     working since t-64.
//   'v2:mission:open' { id }       — the same event board.js/needs-me-
//     now.js/search.js use to open any mission; t-62's contract says
//     "goal-progress.js opens #v2-goal-progress instead, when the
//     mission title matches /^goal:/i — same event, the listener
//     decides which surface." Listened to here for that forward
//     compatibility (no current sibling module renders #v2-goals goal
//     cards yet, so this path is currently unexercised in practice, but
//     it's the documented contract and costs nothing to honor).
//
// COORDINATION GAP, logged rather than fixed by touching peek-panel.js
// (out of this mission's scope, "own only goal-progress.js"): peek-
// panel.js's own openPanel() has no goal-type check and opens itself
// unconditionally for every mission id, including goals. So opening a
// goal mission via the shared 'v2:mission:open' event today opens BOTH
// #v2-peek-panel and #v2-goal-progress at once. v2.html's own CSS
// already gives peek-panel a higher z-index (42) than this panel (41),
// so the two don't visually fight — peek-panel simply wins and this
// panel's content sits hidden behind it, not a clean single-surface
// hand-off. Not a regression this mission introduces (the documented IA
// already anticipated the z-index ordering); flagging for whoever next
// gives peek-panel.js a goal-type check, or builds the #v2-goals card
// list that will make this path load-bearing.
(function () {
  'use strict';

  function ready(cb) {
    if (window.BureauV2) return cb();
    document.addEventListener('DOMContentLoaded', function poll() {
      if (window.BureauV2) cb(); else setTimeout(poll, 50);
    });
  }

  ready(init);

  var STATUS_ORDER = ['blocked', 'review', 'in_progress', 'claimed', 'queued', 'done', 'failed'];
  var CYCLE_RE = /^cycle\s+\d+\s*:/i;
  var GOAL_TITLE_RE = /^goal:/i;
  var GOAL_BODY_RE = /goal:\s*(t-\d+)/i;
  var PERPETUAL_RE = /##\s*mode:\s*perpetual/i;

  function init() {
    var V2 = window.BureauV2;
    var panel = V2.mounts.goalProgress;
    if (!panel) return;
    injectStyle();

    var esc = function (s) {
      return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; });
    };

    var currentId = null; // the goal currently shown, or null when closed
    var pendingId = null; // a goal we were asked to open before state was ready

    function findTask(id) {
      return ((V2.state && V2.state.tasks) || []).find(function (x) { return x.id === id; });
    }

    function isGoal(t) { return t && GOAL_TITLE_RE.test(t.title || ''); }

    function closePanel() { panel.hidden = true; currentId = null; }

    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape' && !panel.hidden) closePanel();
    });

    function open(id) {
      panel.hidden = false;
      var t = findTask(id);
      if (!t) {
        panel.innerHTML = '<div class="v2-empty">Loading…</div>';
        pendingId = id;
        currentId = null;
        return;
      }
      pendingId = null;
      currentId = id;
      render(t);
    }

    V2.on('v2:goal-progress:open', function (detail) {
      if (detail && detail.id) open(detail.id);
    });

    V2.on('v2:mission:open', function (detail) {
      if (!detail || !detail.id) return;
      var t = findTask(detail.id);
      if (t && isGoal(t)) open(detail.id);
    });

    // Live refresh: re-render on every state snapshot (SSE-driven, per
    // v2.html's own refresh() -> emit('v2:state', ...)) so a child
    // mission's status change, or a fresh 'cycle N:' log note, shows up
    // without needing to reopen the panel — same "no full reload" spirit
    // the rest of this tranche follows.
    V2.on('v2:state', function () {
      if (pendingId) { var id = pendingId; var t = findTask(id); if (t) { pendingId = null; currentId = id; render(t); } return; }
      if (!panel.hidden && currentId) {
        var cur = findTask(currentId);
        if (cur) render(cur);
      }
    });

    function statusGroups(children) {
      var buckets = {};
      children.forEach(function (c) { (buckets[c.status] = buckets[c.status] || []).push(c); });
      var known = STATUS_ORDER.filter(function (s) { return buckets[s]; });
      var extra = Object.keys(buckets).filter(function (s) { return STATUS_ORDER.indexOf(s) === -1; });
      return known.concat(extra).map(function (s) { return { status: s, items: buckets[s] }; });
    }

    function childRow(c) {
      return '<div class="v2-gp__row" data-open="' + esc(c.id) + '" role="button" tabindex="0">' +
        '<span class="v2-gp__id tnum">' + esc(c.id) + '</span>' +
        '<span class="v2-gp__row-title">' + (isGoal(c) ? '🎯 ' : '') + esc(c.title) + '</span>' +
        '<span class="v2-gp__row-meta">' + esc(c.status) + (c.assignee ? ' · ' + esc(c.assignee) : '') + '</span>' +
        '</div>';
    }

    function cycleTrail(log) {
      var entries = (log || []).filter(function (l) { return CYCLE_RE.test((l.note || '').trim()); });
      if (!entries.length) return '';
      return '<div class="v2-gp__section-head">Tranche / cycle trail <span class="tnum">' + entries.length + '</span></div>' +
        '<div class="v2-gp__trail">' + entries.map(function (l) {
          return '<div class="v2-gp__trail-row"><span class="v2-gp__ts tnum">' + esc((l.ts || '').slice(5, 16).replace('T', ' ')) + '</span>' +
            '<div class="v2-gp__trail-note">' + esc(l.note) + '</div></div>';
        }).join('') + '</div>';
    }

    function render(goal) {
      var state = V2.state || { tasks: [] };
      var children = (state.tasks || []).filter(function (o) {
        var m = GOAL_BODY_RE.exec(o.body || '');
        return m && m[1] === goal.id;
      });
      var groups = statusGroups(children);
      var perpetual = PERPETUAL_RE.test(goal.body || '');

      var html = '<button type="button" class="v2-gp__close" id="v2-gp-close" aria-label="Close">✕</button>' +
        '<h3 class="v2-gp__title">🎯 ' + esc(goal.title) + '</h3>' +
        '<div class="v2-gp__meta">' + esc(goal.id) + ' · ' +
        '<span class="tnum">' + children.length + '</span> child mission' + (children.length === 1 ? '' : 's') +
        (perpetual ? ' · <span class="v2-gp__badge">perpetual</span>' : '') +
        '</div>';

      html += children.length
        ? groups.map(function (g) {
            return '<div class="v2-gp__section-head">' + esc(g.status) + ' <span class="tnum">' + g.items.length + '</span></div>' +
              '<div class="v2-gp__list">' + g.items.map(childRow).join('') + '</div>';
          }).join('')
        : '<div class="v2-empty">No child missions filed yet.</div>';

      if (perpetual) html += cycleTrail(goal.log);

      panel.innerHTML = html;

      var closeBtn = document.getElementById('v2-gp-close');
      if (closeBtn) closeBtn.addEventListener('click', closePanel);

      panel.querySelectorAll('.v2-gp__row').forEach(function (row) {
        var openChild = function () { V2.emit('v2:mission:open', { id: row.getAttribute('data-open') }); };
        row.addEventListener('click', openChild);
        row.addEventListener('keydown', function (e) { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openChild(); } });
      });
    }
  }

  function injectStyle() {
    if (document.getElementById('v2-goal-progress-style')) return;
    var style = document.createElement('style');
    style.id = 'v2-goal-progress-style';
    style.textContent = [
      '.v2-gp__close { position: absolute; top: var(--v2-space-3, 12px); right: var(--v2-space-3, 12px); border: none; background: transparent; color: var(--v2-ink-2, #888); font-size: 16px; cursor: pointer; }',
      '.v2-gp__title { margin: 0 var(--v2-space-5, 24px) var(--v2-space-1, 4px) 0; font-size: 15px; }',
      '.v2-gp__meta { color: var(--v2-ink-2, #888); font-size: 12px; margin-bottom: var(--v2-space-3, 12px); font-variant-numeric: tabular-nums; }',
      '.v2-gp__badge { display: inline-block; padding: 1px 6px; border-radius: var(--v2-radius, 6px); border: 1px solid var(--v2-hairline, rgba(128,128,128,.3)); font-weight: 600; }',
      '.v2-gp__section-head { font-size: 11.5px; font-weight: 600; text-transform: uppercase; letter-spacing: .02em; color: var(--v2-ink-2, #888); margin: var(--v2-space-3, 12px) 0 var(--v2-space-1, 4px); }',
      '.v2-gp__list { display: flex; flex-direction: column; gap: 1px; }',
      '.v2-gp__row { display: flex; align-items: center; gap: var(--v2-space-2, 8px); padding: var(--v2-space-2, 8px); border: 1px solid var(--v2-hairline, rgba(128,128,128,.2)); border-radius: var(--v2-radius, 6px); cursor: pointer; background: var(--v2-bg, transparent); }',
      '.v2-gp__row:hover, .v2-gp__row:focus { border-color: var(--v2-accent, #3f6fe0); outline: none; }',
      '.v2-gp__id { color: var(--v2-ink-2, #888); font-size: 11px; flex: none; }',
      '.v2-gp__row-title { font-size: 12.5px; flex: 1; }',
      '.v2-gp__row-meta { color: var(--v2-muted, #999); font-size: 11px; flex: none; }',
      '.v2-gp__trail { display: flex; flex-direction: column; gap: var(--v2-space-2, 8px); }',
      '.v2-gp__trail-row { border-left: 2px solid var(--v2-accent, #3f6fe0); padding-left: var(--v2-space-2, 8px); }',
      '.v2-gp__ts { color: var(--v2-muted, #999); font-size: 11px; display: block; margin-bottom: 2px; }',
      '.v2-gp__trail-note { font-size: 12.5px; white-space: pre-wrap; }',
      '.v2-empty { color: var(--v2-muted, #999); font-size: 12.5px; padding: var(--v2-space-3, 12px) 0; }'
    ].join('\n');
    document.head.appendChild(style);
  }
})();

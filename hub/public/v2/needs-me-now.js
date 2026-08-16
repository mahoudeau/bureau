// v2/needs-me-now.js — t-68 (goal: t-53). Owns #v2-needs-me-now only.
// Builds t-55 item i1, with i8 folded in per i8's own item body: rather
// than a separate stats-strip mission, the one number i8 argued actually
// drives a boss action (oldest-thing-waiting) lives here as the default
// sort on the review/blocked groups below. The rest of i8 (a full
// activity-insights strip) stays backlog, unbuilt by design — not an
// oversight, see this file's closing note on the mission.
//
// Pure client-side aggregation over data already fetched: review-status
// missions (split critic-gate vs boss-gate, matching the glyph convention
// board.js already uses), blocked-status missions (awaiting an answer),
// and messages addressed to the boss (GET /api/messages?for=boss, filtered
// client-side to strictly to === 'boss' — the endpoint's own forAgent
// filter also matches broadcasts and messages FROM boss, which are not
// "addressed to the boss"). No new hub endpoint.
//
// Per the mission body: this file ships PLAIN, UNSTYLED DOM using only
// v2--prefixed class hooks — no injected <style> block, no hand-rolled
// visual language. Composition (components.css et al., once landed)
// picks up the styling; this file's job is correct structure and
// behavior only. Do not add a <style> tag here even if the result looks
// bare in the meantime — that bareness is intentional at this stage.
(function () {
  'use strict';

  // NOTE: window.BureauV2 is assigned in v2.html BEFORE the token gate is
  // passed (boot() runs after it, not before) — a bare `if (window.BureauV2)`
  // check fires while .state is still null and .token is still ''. That's
  // harmless for a module that only registers listeners on init, but this
  // file calls the network immediately (refreshMessages() below), so it
  // must also wait for .state (set only once boot()'s first refresh()
  // succeeds), with 'v2:ready' as the fallback signal if init() runs before
  // that first fetch resolves. Modules that stay listener-only on init can
  // get away with the simpler check; this one can't.
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
    var mount = V2.mounts.needsMeNow;
    if (!mount) return;

    var esc = function (s) {
      return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; });
    };

    var sortOldestFirst = true; // default per the mission's own acceptance line
    var messages = [];

    function projLabel(state, id) {
      var p = (state.projects || []).find(function (pj) { return (typeof pj === 'string' ? pj : pj.id) === id; });
      if (!p) return id;
      return typeof p === 'string' ? p : (p.label || id);
    }

    function sortByCreated(list) {
      var sorted = list.slice().sort(function (a, b) { return a.created_at.localeCompare(b.created_at); });
      return sortOldestFirst ? sorted : sorted.reverse();
    }

    function missionRow(t, state) {
      return '<div class="v2-list__row v2-needs-me-now__row" data-open="' + esc(t.id) + '">' +
        '<span class="v2-list__row-title">' + esc(t.title) + '</span>' +
        '<span class="v2-list__row-meta">' + esc(t.id) + ' · P' + t.priority +
        (t.project ? ' · ' + esc(projLabel(state, t.project)) : '') +
        (t.assignee ? ' · ' + esc(t.assignee) : '') +
        '</span></div>';
    }

    function messageRow(m) {
      var openAttr = m.task_id ? ' data-open="' + esc(m.task_id) + '"' : '';
      return '<div class="v2-list__row v2-needs-me-now__row"' + openAttr + '>' +
        '<span class="v2-list__row-title">' + esc(m.body) + '</span>' +
        '<span class="v2-list__row-meta">from ' + esc(m.from) + ' · ' + esc((m.ts || '').slice(0, 16).replace('T', ' ')) + (m.task_id ? ' · ' + esc(m.task_id) : '') + '</span></div>';
    }

    function group(key, title, rowsHtml, count) {
      return '<section class="v2-needs-me-now__group" data-group="' + key + '">' +
        '<h3 class="v2-needs-me-now__group-title">' + esc(title) + ' · ' + count + '</h3>' +
        '<div class="v2-list">' + (rowsHtml || '<div class="v2-empty">Nothing here.</div>') + '</div>' +
        '</section>';
    }

    function render() {
      var state = V2.state;
      if (!state) return;
      var tasks = state.tasks || [];

      var reviewCritic = sortByCreated(tasks.filter(function (t) { return t.status === 'review' && t.gate === 'critic'; }));
      var reviewBoss = sortByCreated(tasks.filter(function (t) { return t.status === 'review' && t.gate !== 'critic'; }));
      var blocked = sortByCreated(tasks.filter(function (t) { return t.status === 'blocked'; }));
      var toBoss = sortOldestFirst ? messages.slice() : messages.slice().reverse();

      var total = reviewCritic.length + reviewBoss.length + blocked.length + toBoss.length;

      mount.innerHTML =
        '<div class="v2-needs-me-now__toolbar">' +
        '<span class="v2-needs-me-now__total">' + total + ' waiting on you</span>' +
        '<button type="button" class="v2-needs-me-now__sort-toggle" id="v2-nmn-sort">' + (sortOldestFirst ? 'Oldest first' : 'Newest first') + '</button>' +
        '</div>' +
        (total === 0
          ? '<div class="v2-empty">Nothing waiting on you.</div>'
          : group('review-critic', '👀 Review · critic', reviewCritic.map(function (t) { return missionRow(t, state); }).join(''), reviewCritic.length) +
          group('review-boss', '👀 Review · boss', reviewBoss.map(function (t) { return missionRow(t, state); }).join(''), reviewBoss.length) +
          group('blocked', '⏸ Blocked, awaiting an answer', blocked.map(function (t) { return missionRow(t, state); }).join(''), blocked.length) +
          group('messages', '✉️ Messages to boss', toBoss.map(messageRow).join(''), toBoss.length));

      var sortBtn = document.getElementById('v2-nmn-sort');
      if (sortBtn) sortBtn.addEventListener('click', function () { sortOldestFirst = !sortOldestFirst; render(); });
      mount.querySelectorAll('[data-open]').forEach(function (el) {
        el.addEventListener('click', function () { V2.emit('v2:mission:open', { id: el.getAttribute('data-open') }); });
      });
    }

    function refreshMessages() {
      V2.api('/api/messages?for=boss').then(function (r) {
        if (!r || !r.messages) return;
        messages = r.messages.filter(function (m) { return m.to === 'boss'; });
        render();
      });
    }

    render();
    refreshMessages();
    V2.on('v2:state', render);
    V2.on('message.posted', refreshMessages);
  }
})();

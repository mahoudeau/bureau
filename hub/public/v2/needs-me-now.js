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
//
// t-89: the 👀/✉️ emoji section-header prefixes (below) are swapped for
// t-66's vendored icon set. Neither has an exact-name match in that set
// (no "eye" icon; no "mail"/"envelope" icon) — picked closest available
// semantic register instead of leaving true emoji in place or inventing
// a new icon (components.js is out of this mission's scope to extend):
// "flag" for the review groups (same needs-attention register
// components.js's own STATUS_HUES already uses flag for), "message-
// square" for the messages-to-boss group (a literal message icon).
// The blocked group's own ⏸ prefix is left as-is, deliberately: rendered
// (checked live, not just by codepoint), it's a plain monochrome glyph,
// not a colorful emoji — U+23F8 has no default emoji presentation and no
// variation selector forcing one here, same register as a plain "x" or
// arrow character, not what this mission's emoji-as-icon sweep targets.
import { icon } from './components.js';

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
      // t-89: title is NOT esc()'d — every call site below passes a fixed
      // string literal (never state/user data), and two of them now embed
      // icon()'s own raw SVG markup rather than plain text (the emoji-swap
      // this mission makes). esc()'ing it, as this used to do
      // unconditionally, was always redundant for a hardcoded literal and
      // would now HTML-entity-escape the SVG tags into visible text
      // instead of rendering an icon. If a future caller ever needs to
      // pass real user/state-derived text here, that caller must esc() it
      // itself before calling group() — this function no longer does it.
      return '<section class="v2-needs-me-now__group" data-group="' + key + '">' +
        '<h3 class="v2-needs-me-now__group-title">' + title + ' · ' + count + '</h3>' +
        '<div class="v2-list">' + (rowsHtml || '<div class="v2-empty">Nothing here.</div>') + '</div>' +
        '</section>';
    }

    // t-162: the total used to be reviewCritic + reviewBoss + blocked + toBoss
    // — every review, every blocked mission, every message ever sent to
    // boss, unconditionally. Boss's own report (screenshot: 1+0+4+15=20,
    // "Boss technically has nothing to do now"): the badge was counting
    // things that don't actually need HIM. Three separate over-counts,
    // fixed independently below — none of them invents new backend state,
    // each reads only what's already on the task/message.
    //
    // (1) Review · critic doesn't need the boss — per docs/protocol.md's
    // own two-tier gate design, a critic-gate review is the CRITIC's job
    // ("only the boss or the lead agent set critic" implies critic-gate
    // exists precisely so routine work does NOT queue on the boss). Kept
    // visible for context (the boss can still look), just not counted.
    //
    // (2) A `blocked` mission is not always blocked ON THE BOSS — this
    // codebase's own convention (bureau-process.md / this shift's own
    // t-143/t-158) is "set status blocked with a note starting 'waiting
    // on:'" for BOTH "waiting on a human answer" and "waiting on a
    // sibling mission to finish," with no structured field distinguishing
    // the two. blockedOnMission() below reads the mission's own most
    // recent log note (the one written in the same PATCH that set
    // status=blocked, per that convention) for a `waiting on: t-N`
    // reference, and treats it as NOT the boss's problem only when that
    // referenced task still exists and is still open — the moment the
    // dependency closes, the same mission (unchanged) starts counting
    // again on its own next render, no re-classification needed. A block
    // with no such reference (a genuine human question, external-access
    // wall, etc.) still counts, unchanged from before.
    //
    // (3) Messages to boss have no read/unread state anywhere in this
    // hub's data model (checked: the store has no such field, and adding
    // one is a real backend change out of this display-only mission's
    // scope) — but a message already rang the boss's Discord in real time
    // per protocol.md ("it rings his Discord"); re-presenting the SAME
    // notification forever in a persistent "still waiting" badge conflates
    // "was notified once" with "still needs an action," which is exactly
    // the miscount this mission reports. Uncounted, kept visible as a
    // reference list (so nothing about total message volume is hidden),
    // relabeled so its own header no longer implies it's part of the tally.
    function blockedOnMission(t, tasksById) {
      var log = t.log || [];
      var last = log.length ? log[log.length - 1] : null;
      var m = last && /waiting on:\s*(t-\d+)/i.exec(last.note || '');
      if (!m) return false; // no mission reference at all -> a real human-facing block
      var ref = tasksById[m[1]];
      // Unknown/deleted id: can't confirm the dependency is still open, so
      // don't silently drop it from the boss's count — safer to over-count
      // by one than to hide something that might genuinely need him.
      if (!ref) return false;
      return ref.status !== 'done' && ref.status !== 'failed' && ref.status !== 'discarded';
    }

    function render() {
      var state = V2.state;
      if (!state) return;
      var tasks = state.tasks || [];
      var tasksById = {};
      tasks.forEach(function (t) { tasksById[t.id] = t; });

      var reviewCritic = sortByCreated(tasks.filter(function (t) { return t.status === 'review' && t.gate === 'critic'; }));
      var reviewBoss = sortByCreated(tasks.filter(function (t) { return t.status === 'review' && t.gate !== 'critic'; }));
      var blockedAll = sortByCreated(tasks.filter(function (t) { return t.status === 'blocked'; }));
      var blockedOnBoss = blockedAll.filter(function (t) { return !blockedOnMission(t, tasksById); });
      var blockedOnWork = blockedAll.filter(function (t) { return blockedOnMission(t, tasksById); });
      var toBoss = sortOldestFirst ? messages.slice() : messages.slice().reverse();

      // Only the two genuinely boss-actionable groups count toward the
      // headline number now: a boss-gate review (needs his own click, per
      // protocol.md's "moves out... only when agent is human") and a block
      // that isn't waiting on another mission to close first.
      var total = reviewBoss.length + blockedOnBoss.length;

      mount.innerHTML =
        '<div class="v2-needs-me-now__toolbar">' +
        '<span class="v2-needs-me-now__total">' + total + ' waiting on you</span>' +
        '<button type="button" class="v2-needs-me-now__sort-toggle" id="v2-nmn-sort">' + (sortOldestFirst ? 'Oldest first' : 'Newest first') + '</button>' +
        '</div>' +
        (total === 0 && !reviewCritic.length && !blockedOnWork.length && !toBoss.length
          ? '<div class="v2-empty">Nothing waiting on you.</div>'
          : group('review-boss', icon('flag') + ' Review · boss', reviewBoss.map(function (t) { return missionRow(t, state); }).join(''), reviewBoss.length) +
          group('blocked', '⏸ Blocked, awaiting your answer', blockedOnBoss.map(function (t) { return missionRow(t, state); }).join(''), blockedOnBoss.length) +
          group('review-critic', icon('flag') + ' Review · critic (not yours to act on)', reviewCritic.map(function (t) { return missionRow(t, state); }).join(''), reviewCritic.length) +
          group('blocked-other', '⏸ Blocked on other work (not yours to act on)', blockedOnWork.map(function (t) { return missionRow(t, state); }).join(''), blockedOnWork.length) +
          group('messages', icon('message-square') + ' Recent messages to boss (already delivered)', toBoss.map(messageRow).join(''), toBoss.length));

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

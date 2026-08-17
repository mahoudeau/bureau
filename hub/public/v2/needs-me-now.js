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
//
// t-163 (boss-filed, gate:boss): "Messages to boss" dumped every message
// ever addressed to the boss, full body text, unpaginated, no read state
// — boss's own words, "a huge list", asking for inbox treatment. This
// mission's own scope is the messages group ONLY (the review/blocked
// groups are unaffected, unclaimed here) — filed under project "Test" by
// what reads like a UI mis-click while looking at the wrong project view
// (its content is unambiguously about this file's own messages group,
// and "Test" carries no repo to build against), noted on the mission log
// rather than silently reassigned (the hub's PATCH /api/tasks/:id has no
// project field to reassign it through).
//
// WHO/WHAT/WHEN/TYPE/ACTION, the mission's own open question on what to
// summarize:
//   - who: m.from (unchanged)
//   - when: m.ts (unchanged, same slice/format as before)
//   - what: the body, now TRUNCATED to one line (~100 chars) rather than
//     dumped in full — full text was exactly what made the list feel
//     huge; click to read the rest (see ACTION)
//   - type: implicit in whether a task_id is attached (shown in the meta
//     line, unchanged) — a message tied to a mission's own thread reads
//     differently from a free-standing one, not worth a second explicit
//     label on top of the id already shown
//   - action: rendered as a trailing chevron, the row's own affordance —
//     chevron-right on task-linked messages (click opens that mission,
//     existing behavior, unchanged) vs chevron-down/-up on free-standing
//     ones (click expands/collapses full text in place, since there is
//     nowhere else for a message with no task_id to "open" to)
//
// READ STATE: no hub-side field for this (messages have no read flag in
// the protocol) — tracked client-side in localStorage, keyed by message
// id, boss's own browser only. This is a display convenience, not a
// synced feature; a second device starts fresh. Read is set on click
// (open OR expand, either counts as "seen"). The group header shows
// unread/total; the OVERALL "N waiting on you" total (below) still sums
// every message ever sent to boss, unaffected by read state or the
// recent-only slice — narrowing what is SHOWN must not silently shrink
// what the total counts as outstanding, that redefinition (if wanted at
// all) is t-162's own separate, already-claimed scope, not folded in
// here to avoid two missions racing the same total-count line.
//
// RECENT-ONLY DEFAULT: only the most recent N (by actual timestamp, not
// by the oldest/newest DISPLAY toggle already on this panel — that toggle
// only reorders whatever's currently visible) are shown by default; a
// "Show all" control reveals the rest. Kept as a per-group control (not
// wired into the existing sort-toggle) since the mission body scopes this
// to messages only — review/blocked groups aren't sized to need it.
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

    // t-163: read state persisted client-side only (see file header note).
    var READ_KEY = 'bureauV2.nmn.readMessageIds';
    function loadReadIds() {
      try {
        var raw = window.localStorage.getItem(READ_KEY);
        var arr = raw ? JSON.parse(raw) : [];
        var set = {};
        arr.forEach(function (id) { set[id] = true; });
        return set;
      } catch (e) { return {}; } // storage unavailable/corrupt - read-state is a nice-to-have, fail to "nothing read" rather than throw
    }
    function saveReadIds(set) {
      try { window.localStorage.setItem(READ_KEY, JSON.stringify(Object.keys(set))); } catch (e) { /* quota/unavailable - drop silently, same posture as loadReadIds */ }
    }
    var readIds = loadReadIds();
    function markRead(id) {
      if (!id || readIds[id]) return false;
      readIds[id] = true;
      saveReadIds(readIds);
      return true;
    }

    var expandedIds = {}; // in-memory only - expand/collapse doesn't need to survive reload
    var RECENT_MESSAGE_LIMIT = 5;
    var showAllMessages = false; // recent-only by default, per this mission's own ask

    function truncate(s, n) {
      s = String(s == null ? '' : s);
      if (s.length <= n) return s;
      return s.slice(0, n).replace(/\s+\S*$/, '') + '…';
    }

    // Recent = the N chronologically newest messages, independent of the
    // oldest/newest DISPLAY toggle (that toggle only reorders whatever's
    // already selected to show) - sort ascending by ts first so "recent"
    // means the same thing regardless of the array's own arrival order.
    function visibleMessages() {
      var asc = messages.slice().sort(function (a, b) { return (a.ts || '').localeCompare(b.ts || ''); });
      var base = showAllMessages ? asc : asc.slice(-RECENT_MESSAGE_LIMIT);
      return sortOldestFirst ? base : base.slice().reverse();
    }

    function projLabel(state, id) {
      var p = (state.projects || []).find(function (pj) { return (typeof pj === 'string' ? pj : pj.id) === id; });
      if (!p) return id;
      return typeof p === 'string' ? p : (p.label || id);
    }

    function sortByCreated(list) {
      var sorted = list.slice().sort(function (a, b) { return a.created_at.localeCompare(b.created_at); });
      return sortOldestFirst ? sorted : sorted.reverse();
    }

    // t-225: role="button" tabindex="0" gives every row a keyboard stop (the
    // row previously had NO focus path at all, separate from the tap-target
    // floor below); the matching keydown handler lives beside the click
    // handler this row's data-open is wired to, in render()'s event-binding
    // block. The title+meta pair is wrapped in its own .v2-list__row-body
    // span so organisms.css can stack them as a column while the row itself
    // stays a horizontal flex (dot/icon siblings sit beside that column,
    // not inside it) — a markup change bundled into this same fix rather
    // than a separate mission, since the keyboard attributes already touch
    // this line.
    function missionRow(t, state) {
      return '<div class="v2-list__row v2-needs-me-now__row" data-open="' + esc(t.id) + '" role="button" tabindex="0">' +
        '<span class="v2-list__row-body">' +
        '<span class="v2-list__row-title">' + esc(t.title) + '</span>' +
        '<span class="v2-list__row-meta">' + esc(t.id) + ' · P' + t.priority +
        (t.project ? ' · ' + esc(projLabel(state, t.project)) : '') +
        (t.assignee ? ' · ' + esc(t.assignee) : '') +
        '</span></span></div>';
    }

    function messageRow(m) {
      var isRead = !!readIds[m.id];
      var isExpanded = !!expandedIds[m.id];
      var hasTask = !!m.task_id;
      var bodyText = isExpanded ? m.body : truncate(m.body, 100);
      // action affordance, per-row: task-linked messages open that mission
      // (existing behavior, unchanged); free-standing ones have nowhere
      // else to "open" to, so they expand/collapse in place instead.
      var actionIcon = hasTask
        ? icon('chevron-right', 'v2-needs-me-now__row-action')
        : icon(isExpanded ? 'chevron-up' : 'chevron-down', 'v2-needs-me-now__row-action');
      var toggleAttrs = (hasTask ? ' data-open="' + esc(m.task_id) + '"' : ' data-toggle-msg="' + esc(m.id) + '"') +
        (m.id ? ' data-msg-id="' + esc(m.id) + '"' : '');
      // t-225: same role/tabindex addition as missionRow, plus the
      // .v2-list__row-body wrapper so the unread dot (leading) and action
      // chevron (trailing) sit beside the stacked title+meta column instead
      // of inside it.
      return '<div class="v2-list__row v2-needs-me-now__row v2-needs-me-now__msg-row' + (isRead ? '' : ' v2-needs-me-now__msg-row--unread') + '"' + toggleAttrs + ' role="button" tabindex="0">' +
        (isRead ? '' : '<span class="v2-needs-me-now__unread-dot" aria-hidden="true"></span>') +
        '<span class="v2-list__row-body">' +
        '<span class="v2-list__row-title">' + esc(bodyText) + '</span>' +
        '<span class="v2-list__row-meta">from ' + esc(m.from) + ' · ' + esc((m.ts || '').slice(0, 16).replace('T', ' ')) + (hasTask ? ' · ' + esc(m.task_id) : '') + '</span>' +
        '</span>' +
        actionIcon +
        '</div>';
    }

    function group(key, title, rowsHtml, count, extraHtml) {
      // t-89: title is NOT esc()'d — every call site below passes a fixed
      // string literal (never state/user data), and two of them now embed
      // icon()'s own raw SVG markup rather than plain text (the emoji-swap
      // this mission makes). esc()'ing it, as this used to do
      // unconditionally, was always redundant for a hardcoded literal and
      // would now HTML-entity-escape the SVG tags into visible text
      // instead of rendering an icon. If a future caller ever needs to
      // pass real user/state-derived text here, that caller must esc() it
      // itself before calling group() — this function no longer does it.
      // count (t-163): still plain text interpolated as-is; the messages
      // call site below now passes a composed "N unread · M total" string
      // instead of a bare number - group() doesn't care, it only ever
      // concatenates whatever it's given.
      // extraHtml (t-163): optional markup appended after the row list,
      // inside the section - used by the messages group for its "Show
      // all"/"Show recent" control. Omitted (undefined) elsewhere, so the
      // review/blocked groups render exactly as before.
      return '<section class="v2-needs-me-now__group" data-group="' + key + '">' +
        '<h3 class="v2-needs-me-now__group-title">' + title + ' · ' + count + '</h3>' +
        '<div class="v2-list">' + (rowsHtml || '<div class="v2-empty">Nothing here.</div>') + '</div>' +
        (extraHtml || '') +
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
      var toBoss = visibleMessages(); // t-163: recent-only slice (or all, if toggled), display-ordered

      // t-162: only the two genuinely boss-actionable groups count toward
      // the headline number: a boss-gate review (needs his own click, per
      // protocol.md's "moves out... only when agent is human") and a block
      // that isn't waiting on another mission to close first. t-163's
      // recent-only message slice is a DISPLAY narrowing and messages never
      // touch this sum at all.
      var total = reviewBoss.length + blockedOnBoss.length;

      var unreadMessages = messages.filter(function (m) { return !readIds[m.id]; }).length;
      var messagesCount = unreadMessages + ' unread · ' + messages.length + ' total';
      var messagesToggleHtml = messages.length > RECENT_MESSAGE_LIMIT
        ? '<button type="button" class="v2-needs-me-now__messages-toggle" id="v2-nmn-messages-toggle">' +
          (showAllMessages ? 'Show recent only' : 'Show all ' + messages.length) +
          '</button>'
        : '';

      mount.innerHTML =
        '<div class="v2-needs-me-now__toolbar">' +
        '<span class="v2-needs-me-now__total">' + total + ' waiting on you</span>' +
        // t-150 (goal: t-53): v2-hit44 (components.css) — a pre-existing,
        // purely functional class hook (zero visible style, an invisible
        // centered 44px tap zone), not the "hand-rolled visual language"
        // this file's own header comment rules out. Its only neighbor is
        // the plain-text total span to its left, so the grown zone has
        // nothing clickable to collide with.
        '<button type="button" class="v2-needs-me-now__sort-toggle v2-hit44" id="v2-nmn-sort">' + (sortOldestFirst ? 'Oldest first' : 'Newest first') + '</button>' +
        '</div>' +
        (total === 0 && !reviewCritic.length && !blockedOnWork.length && !toBoss.length
          ? '<div class="v2-empty">Nothing waiting on you.</div>'
          : group('review-boss', icon('flag') + ' Review · boss', reviewBoss.map(function (t) { return missionRow(t, state); }).join(''), reviewBoss.length) +
          group('blocked', '⏸ Blocked, awaiting your answer', blockedOnBoss.map(function (t) { return missionRow(t, state); }).join(''), blockedOnBoss.length) +
          group('review-critic', icon('flag') + ' Review · critic (not yours to act on)', reviewCritic.map(function (t) { return missionRow(t, state); }).join(''), reviewCritic.length) +
          group('blocked-other', '⏸ Blocked on other work (not yours to act on)', blockedOnWork.map(function (t) { return missionRow(t, state); }).join(''), blockedOnWork.length) +
          group('messages', icon('message-square') + ' Messages to boss (already delivered)', toBoss.map(messageRow).join(''), messagesCount, messagesToggleHtml));

      var sortBtn = document.getElementById('v2-nmn-sort');
      if (sortBtn) sortBtn.addEventListener('click', function () { sortOldestFirst = !sortOldestFirst; render(); });
      var msgToggleBtn = document.getElementById('v2-nmn-messages-toggle');
      if (msgToggleBtn) msgToggleBtn.addEventListener('click', function () { showAllMessages = !showAllMessages; render(); });
      // t-225: rows carry role="button" tabindex="0" (above) but that alone
      // gives no keyboard ACTIVATION path — a focused div ignores Enter/
      // Space by default, unlike a real <button>. Each handler below is
      // named so both the click and keydown listeners call the identical
      // function instead of duplicating the body (and silently drifting).
      mount.querySelectorAll('[data-open]').forEach(function (el) {
        function open() {
          var msgId = el.getAttribute('data-msg-id');
          var changed = msgId ? markRead(msgId) : false;
          V2.emit('v2:mission:open', { id: el.getAttribute('data-open') });
          if (changed) render(); // re-render so the unread dot/count reflect the click even though we're navigating away
        }
        el.addEventListener('click', open);
        el.addEventListener('keydown', function (e) {
          // Space also scrolls the page on a plain div by default (it isn't
          // a real <button>, which suppresses that natively) - preventDefault
          // on both keys, not just to stop double-activation.
          if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); open(); }
        });
      });
      mount.querySelectorAll('[data-toggle-msg]').forEach(function (el) {
        function toggle() {
          var id = el.getAttribute('data-toggle-msg');
          expandedIds[id] = !expandedIds[id];
          markRead(id);
          render();
        }
        el.addEventListener('click', toggle);
        el.addEventListener('keydown', function (e) {
          if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggle(); }
        });
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

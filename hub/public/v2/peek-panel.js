// v2/peek-panel.js — t-64 (goal: t-53). Owns #v2-peek-panel. A slide-in
// panel, never a modal (no backdrop, no <dialog>, no prompt()): the board
// stays visible and interactive underneath, per the PURE LINEAR bar.
//
// Listens: 'v2:mission:open' { id } — the single door every mission-detail
// affordance across v2 opens through (board.js cards today; needs-me-now.js,
// search.js and the palette are expected to reuse the same event).
//
// Ports every i11-baseline mission-detail function: log, artifacts (inline
// brain images, linked external URLs), the itemized-review Accept/Reject/
// Later-plus-comment mechanic, Approve/Send-back (note required on
// send-back), the blocked-mission answer-and-requeue flow (note required),
// the failed-mission re-queue action.
//
// Extension point for i2 (t-65, keyboard.js): every item row carries
// data-item-index; number keys + a/r/l are that mission's concern, not
// built here.
// Extension point for i4 (t-70, goal-progress.js): goal-titled missions get
// an inline children-progress line (baseline, unchanged) PLUS a button that
// emits 'v2:goal-progress:open' { id } — new event, documented here since
// t-70 doesn't exist yet; this panel keeps opening normally for goal
// missions too so nothing regresses in the meantime.
//
// t-93 round 2: meta-row icons + LOG/ITEMIZED-REVIEW callout boxes,
// converging on the approved t-58 sample's peek-panel anatomy (a critic
// pass on round 1 grepped this file directly and found zero icon() calls
// anywhere in the meta-row path, unlike needs-me-now.js which already
// imports icon() the same way media.js does for its own MEDIA section —
// this file just hadn't been touched since t-64 first built it).
//
// t-93 round 4: the round-2 fix added icons but never restructured the
// meta line itself, and a round-3 critic pass diffed this file directly
// against the sample's own renderT58()/openPeek() source (not a
// screenshot) and found three real structural gaps: (1) the meta line was
// one crammed ' · '-joined string, not the sample's six stacked rows with
// a real status pill; (2) the close button had no header wrapper and
// could overlap a long title; (3) MEDIA rendered last (trailing-appended
// by media.js, which had been asking for a real extension hook since it
// was written — see its own header comment) instead of body->Media->Log->
// Itemized-review->Artifacts. This round fixes all three: real stacked
// `.v2-panel__row`s with a colored status pill, a `.v2-panel__head` row
// (id + close button) separate from the `<h2>` title below it, and a
// genuine `V2.peekPanel.registerSection(slot, renderFn)` hook (slot
// 'after-body' is the only slot today — the one the sample's own order
// needs) that media.js now uses instead of its MutationObserver/trailing-
// append workaround.
import { icon, idBadge } from './components.js';

(function () {
  'use strict';

  // Same status->hue mapping board.js's task-card left-border already
  // uses (t-93 round 3), so a mission's status reads the same color in
  // the board and in its own peek panel — one status language, not two.
  var STATUS_META = {
    queued: { label: 'queued', glyph: 'circle', colorVar: '--v2-color-text-muted' },
    claimed: { label: 'working', glyph: 'circle-dot', colorVar: '--v2-color-status-at-risk' },
    in_progress: { label: 'working', glyph: 'circle-dot', colorVar: '--v2-color-status-at-risk' },
    blocked: { label: 'blocked', glyph: 'circle-alert', colorVar: '--v2-color-status-bug' },
    review: { label: 'review', glyph: 'clock', colorVar: '--v2-color-status-in-progress' },
    done: { label: 'done', glyph: 'circle-check', colorVar: '--v2-color-status-done' },
    failed: { label: 'failed', glyph: 'circle-x', colorVar: '--v2-color-status-bug' },
    discarded: { label: 'discarded', glyph: 'circle-x', colorVar: '--v2-color-text-muted' }
  };

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

    // t-93 round 4: the extension hook media.js's own header comment has
    // asked for since it was written. One named slot today ('after-body',
    // where the sample's own MEDIA section sits) — add slots here as more
    // sections need a real position instead of a trailing append. A
    // section renderFn receives the task and returns an HTML string (or
    // '' / null to render nothing this open); render() below calls every
    // registered fn for a slot, in registration order, every time it
    // rebuilds the panel body.
    var sections = { 'after-body': [] };
    var lastTask = null; // the task render() last drew, for refreshSections()
    // window.BureauV2 is Object.frozen (v2.html boot()) — cannot gain or
    // reassign a top-level key, so `peekPanel` ships as an empty mutable
    // object in the frozen literal and this file fills in ITS properties
    // (freeze is shallow; the nested object is untouched by it).
    V2.peekPanel.registerSection = function (slot, renderFn) {
      if (!sections[slot]) sections[slot] = [];
      sections[slot].push(renderFn);
    };
    // A registered section's own data often arrives async (media.js: one
    // fetch per mission open) after this file's own render() has already
    // drawn once. Calling this re-runs render() against the SAME task, so
    // a section whose renderFn now has data present gets drawn on the
    // next pass — the section owner decides when to call this (on its own
    // fetch resolving, or a live-update event), not this file guessing
    // when someone else's async data might be ready.
    V2.peekPanel.refreshSections = function () {
      if (lastTask && !panel.hidden) render(lastTask);
    };
    function renderSlot(slot, t) {
      return (sections[slot] || []).map(function (fn) {
        try { return fn(t) || ''; } catch (e) { return ''; }
      }).join('');
    }

    var esc = function (s) {
      return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; });
    };
    var currentId = null;

    V2.on('v2:mission:open', function (detail) {
      if (!detail || !detail.id) return;
      currentId = detail.id;
      openPanel(detail.id);
    });

    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape' && !panel.hidden) closePanel();
    });

    function closePanel() { panel.hidden = true; currentId = null; lastTask = null; }

    // t-110 (goal: t-53): a discarded mission's closing note sometimes names
    // the replacement it was re-scoped into (protocol.md's terminal-status
    // doctrine: "duplicates, and missions re-scoped into a better-cut
    // replacement (the closing note names the replacement)"). Scan the log
    // newest-first so the most recent naming wins if more than one exists.
    function findReplacement(t) {
      var re = /(?:replaced by|re-cut as)[^.\n]{0,40}?(t-\d+)/i;
      var log = t.log || [];
      for (var i = log.length - 1; i >= 0; i--) {
        var m = re.exec(log[i].note || '');
        if (m) return m[1];
      }
      return null;
    }

    function projLabel(state, id) {
      var p = (state.projects || []).find(function (pj) { return (typeof pj === 'string' ? pj : pj.id) === id; });
      if (!p) return id;
      return typeof p === 'string' ? p : (p.label || id);
    }

    function artImg(a) {
      var m = String(a.url || a.label || '').match(/([\w./-]+\.(?:png|jpe?g|gif))/i);
      if (m && !/^https?:/i.test(m[1])) return m[1];
      var m2 = String(a.url || '').match(/[?&]file=([\w./%-]+\.(?:png|jpe?g|gif))/i);
      return m2 && m2[1];
    }

    function renderArtifacts(t) {
      return (t.artifacts || []).map(function (a) {
        var img = artImg(a);
        if (img) {
          return '<figure class="v2-panel__artifact"><img src="/api/knowledge?file=' + encodeURIComponent(decodeURIComponent(img)) + '&raw=1&token=' + encodeURIComponent(V2.token) + '" alt="' + esc(a.label || img) + '" loading="lazy">' +
            '<figcaption>📎 ' + esc(a.label || img) + ' · by ' + esc(a.by) + '</figcaption></figure>';
        }
        var linkable = a.url && /^https?:\/\//i.test(a.url);
        return '<div class="v2-panel__logrow">📎 ' + (linkable ? '<a href="' + esc(a.url) + '" target="_blank" rel="noopener">' + esc(a.label || a.url) + '</a>' : esc(a.label || a.url || '')) + ' <span class="v2-panel__ts">by ' + esc(a.by) + '</span></div>';
      }).join('');
    }

    function renderLog(t) {
      return (t.log || []).map(function (l) {
        return '<div class="v2-panel__logrow"><span class="v2-panel__ts">' + esc(l.ts.slice(5, 16).replace('T', ' ')) + '</span><b>' + esc(l.by) + '</b> ' + esc(l.note) + '</div>';
      }).join('') || '<div class="v2-empty">No log yet.</div>';
    }

    function itemRow(it, idx, editable) {
      var head = '<div class="v2-panel__item" data-item-index="' + idx + '" data-item-id="' + esc(it.id) + '">' +
        '<b>' + esc(it.id) + ' · ' + esc(it.title) + '</b>' +
        (it.body ? '<pre class="v2-panel__item-body">' + esc(it.body) + '</pre>' : '');
      if (!editable) {
        return head + '<span class="v2-panel__ts">' + esc(it.verdict) + (it.comment ? ': ' + esc(it.comment) : '') + '</span></div>';
      }
      return head +
        // t-115: .v2-hit44 (components.css) on each radio — closes t-111
        // finding #2's "itemized-verdict radio buttons (13x13px)" line.
        '<label><input class="v2-hit44" type="radio" name="v_' + esc(it.id) + '" value="approved"' + (it.verdict === 'approved' ? ' checked' : '') + '> Accept</label>' +
        '<label><input class="v2-hit44" type="radio" name="v_' + esc(it.id) + '" value="rejected"' + (it.verdict === 'rejected' ? ' checked' : '') + '> Reject</label>' +
        '<label><input class="v2-hit44" type="radio" name="v_' + esc(it.id) + '" value=""' + (it.verdict === 'proposed' ? ' checked' : '') + '> Later</label>' +
        '<input class="v2-panel__item-comment" id="c_' + esc(it.id) + '" placeholder="Comment (optional)" value="' + esc(it.comment || '') + '">' +
        '</div>';
    }

    function openPanel(id) {
      panel.innerHTML = '<div class="v2-empty">Loading…</div>';
      panel.hidden = false;
      V2.api('/api/tasks/' + id).then(function (r) {
        if (!r || !r.task) { panel.innerHTML = '<div class="v2-empty">Mission not found.</div>'; return; }
        if (currentId !== id) return; // a newer open superseded this fetch
        render(r.task);
      });
    }

    function render(t) {
      lastTask = t;
      var state = V2.state || { projects: [], tasks: [] };
      var isGoal = /^goal:/i.test(t.title);
      var goalKids = null;
      if (isGoal) {
        goalKids = { done: 0, total: 0 };
        (state.tasks || []).forEach(function (o) {
          var m = /goal:\s*(t-\d+)/.exec(o.body || '');
          if (m && m[1] === t.id) { goalKids.total++; if (o.status === 'done') goalKids.done++; }
        });
      }
      var items = (t.items || []).map(function (it, i) { return itemRow(it, i, t.status === 'review'); }).join('');
      var replacementId = t.status === 'discarded' ? findReplacement(t) : null;

      // t-115: .v2-hit44 on every .v2-panel__btn — closes finding #2's
      // "Primary actions Approve/Send back: only 30px tall" line (Approve/
      // Send back are the two named in the finding; Answer & re-queue and
      // Re-queue share the exact same .v2-panel__btn class and 30px height,
      // so leaving them out would make three near-identical buttons behave
      // inconsistently on the same panel — extended to all four for that
      // reason, not scope creep, called out here plainly).
      var reviewActions = t.status === 'review' ? (
        '<div class="v2-panel__actions">' +
        '<input class="v2-panel__note" id="v2-pp-note" placeholder="Note for the agent (optional on approve, required to send back)">' +
        '</div>' +
        '<p class="v2-panel__err" id="v2-pp-err" hidden></p>' +
        '<div class="v2-panel__actions">' +
        '<button type="button" class="v2-panel__btn v2-is-positive v2-hit44" id="v2-pp-approve">✅ Approve</button>' +
        '<button type="button" class="v2-panel__btn v2-panel__btn--ghost v2-hit44" id="v2-pp-sendback">↩️ Send back</button>' +
        '</div>'
      ) : '';
      var blockedActions = t.status === 'blocked' ? (
        '<div class="v2-panel__actions"><input class="v2-panel__note" id="v2-pp-note" placeholder="Your answer to the worker (required)"></div>' +
        '<p class="v2-panel__err" id="v2-pp-err" hidden></p>' +
        '<div class="v2-panel__actions"><button type="button" class="v2-panel__btn v2-hit44" id="v2-pp-answer">💬 Answer &amp; re-queue</button></div>'
      ) : '';
      var failedActions = t.status === 'failed' ? (
        '<div class="v2-panel__actions"><button type="button" class="v2-panel__btn v2-panel__btn--ghost v2-hit44" id="v2-pp-requeue">↩️ Re-queue</button></div>'
      ) : '';

      // t-93 round 4: stacked attribute rows (sample: renderT58()'s six
      // `.attrs .row` divs), not a single ' · '-joined line. Status and
      // priority always render (every mission has both); assignee/project/
      // lease stay conditional (real tasks are often genuinely missing
      // them, unlike the sample's one fixed fully-populated demo mission —
      // matching row STRUCTURE, not forcing empty rows sample's fixed data
      // never had to omit). Gate always renders — every mission carries a
      // gate value (boss default per docs/protocol.md), so unlike
      // assignee/lease this one is never truly absent.
      var sm = STATUS_META[t.status] || STATUS_META.queued;
      var rows = [
        '<div class="v2-panel__row"><span class="v2-panel__row-k">' + icon(sm.glyph, 'v2-icon--xs') + '</span>' +
          '<span class="v2-panel__row-v"><span class="v2-panel__stpill" style="color:var(' + sm.colorVar + ')">' + esc(sm.label) + '</span></span></div>',
        '<div class="v2-panel__row"><span class="v2-panel__row-k">' + icon('flag', 'v2-icon--xs') + '</span><span class="v2-panel__row-v v2-tabular-nums">P' + t.priority + '</span></div>',
        t.assignee ? '<div class="v2-panel__row"><span class="v2-panel__row-k">' + icon('user', 'v2-icon--xs') + '</span><span class="v2-panel__row-v">' + esc(t.assignee) + '</span></div>' : '',
        t.project ? '<div class="v2-panel__row"><span class="v2-panel__row-k">' + icon('folder', 'v2-icon--xs') + '</span><span class="v2-panel__row-v">' + esc(projLabel(state, t.project)) + '</span></div>' : '',
        '<div class="v2-panel__row"><span class="v2-panel__row-k">' + icon('circle-check', 'v2-icon--xs') + '</span><span class="v2-panel__row-v">' + esc(t.gate || 'boss') + ' gate</span></div>',
        t.lease_until ? '<div class="v2-panel__row"><span class="v2-panel__row-k">' + icon('clock', 'v2-icon--xs') + '</span><span class="v2-panel__row-v v2-tabular-nums">lease until ' + esc(t.lease_until.slice(11, 16)) + '</span></div>' : ''
      ].join('');

      panel.innerHTML =
        // t-93 round 4: a real `.phead`-style header row (id left, close
        // button right) so the title below it never has to reserve margin
        // to dodge an absolutely-positioned close button — the round-3
        // critic reproduced a real overlap bug on long titles from the old
        // single-button-no-wrapper markup, at both desktop and phone width.
        // t-123: the id itself renders through components.js's idBadge()
        // (its markup/typography, including the vendored JetBrains Mono
        // token once t-112 lands, is that component's own concern) —
        // .v2-panel__id keeps only the flex:1 layout role that pushes the
        // close button right; the font-size/weight/color/tabular-nums it
        // used to carry directly are now idBadge()'s own (near-identical
        // values, see this file's own .v2-panel__id rule below).
        '<div class="v2-panel__head"><span class="v2-panel__id">' + idBadge(t.id).outerHTML + '</span>' +
        // t-115: .v2-hit44 — closes finding #2's "shared panel close
        // button: 30x30px" line (this file's own instance of the pattern;
        // brain-browser.js's and goal-progress.js's own close buttons use
        // different classes, .v2-brain-close/.v2-gp__close, and are out of
        // this mission's stated file scope — flagged in the closing note).
        '<button type="button" class="v2-panel__close v2-hit44" id="v2-pp-close" aria-label="Close">' + icon('x') + '</button></div>' +
        '<h2 class="v2-panel__title">' + (isGoal ? '🎯 ' : '') + esc(t.title) + '</h2>' +
        '<div class="v2-panel__attrs">' + rows + '</div>' +
        (goalKids ? '<div class="v2-panel__meta">' + goalKids.done + '/' + goalKids.total + ' child missions done ' +
          '<button type="button" class="v2-panel__link-btn" id="v2-pp-goal-progress">Open goal/cycle progress →</button></div>' : '') +
        (replacementId ? '<div class="v2-panel__meta">🗄 discarded · ' +
          '<button type="button" class="v2-panel__link-btn" id="v2-pp-replacement">Replaced by ' + esc(replacementId) + ' →</button></div>' : '') +
        (t.body ? '<div class="v2-panel__body">' + esc(t.body) + '</div>' : '') +
        // t-93 round 4: section order now matches the sample exactly —
        // body -> Media -> Log -> Itemized review -> Artifacts. Media
        // renders via the registerSection('after-body') hook (media.js,
        // updated this round to use it instead of a trailing MutationObserver
        // append) instead of always landing last regardless of the sample's
        // own order.
        renderSlot('after-body', t) +
        '<div class="v2-panel__callout"><div class="v2-panel__callout-head">' + icon('clock', 'v2-icon--xs') + ' Log</div><div class="v2-panel__log">' + renderLog(t) + '</div></div>' +
        (items ? '<div class="v2-panel__callout"><div class="v2-panel__callout-head">' + icon('circle-check', 'v2-icon--xs') + ' Itemized review</div>' + items + '</div>' : '') +
        ((t.artifacts || []).length ? '<div class="v2-panel__sechead">' + icon('paperclip', 'v2-icon--xs') + ' Artifacts <span class="v2-tabular-nums">' + t.artifacts.length + '</span></div>' + renderArtifacts(t) : '') +
        reviewActions + blockedActions + failedActions;

      var closeBtn = document.getElementById('v2-pp-close');
      closeBtn.addEventListener('click', closePanel);

      var goalBtn = document.getElementById('v2-pp-goal-progress');
      if (goalBtn) goalBtn.addEventListener('click', function () { V2.emit('v2:goal-progress:open', { id: t.id }); });

      var replacementBtn = document.getElementById('v2-pp-replacement');
      if (replacementBtn) replacementBtn.addEventListener('click', function () { V2.emit('v2:mission:open', { id: replacementId }); });

      function collectVerdicts() {
        var verdicts = [];
        panel.querySelectorAll('input[type=radio]:checked').forEach(function (r) {
          var iid = r.name.slice(2);
          var c = ((document.getElementById('c_' + iid) || {}).value || '').trim();
          if (r.value || c) verdicts.push(Object.assign({ id: iid }, r.value ? { verdict: r.value } : {}, c ? { comment: c } : {}));
        });
        return verdicts;
      }
      function showErr(msg) {
        var el = document.getElementById('v2-pp-err');
        if (!el) return;
        el.textContent = msg; el.hidden = false;
      }
      function submitStatus(status, requireNote, doneDefaultNote) {
        var noteEl = document.getElementById('v2-pp-note');
        var note = noteEl ? noteEl.value.trim() : '';
        if (requireNote && !note) { showErr('A note is required so the agent knows what to change.'); return; }
        var verdicts = collectVerdicts();
        V2.api('/api/tasks/' + t.id, {
          method: 'PATCH',
          body: JSON.stringify(Object.assign({ agent: 'human', status: status, note: note || doneDefaultNote || '' }, verdicts.length ? { verdicts: verdicts } : {}))
        }).then(function (r) {
          if (r && r.error) { showErr(r.error); return; }
          closePanel();
          V2.refresh();
        });
      }
      var approveBtn = document.getElementById('v2-pp-approve');
      if (approveBtn) approveBtn.addEventListener('click', function () { submitStatus('done', false, 'approved'); });
      var sendBackBtn = document.getElementById('v2-pp-sendback');
      if (sendBackBtn) sendBackBtn.addEventListener('click', function () { submitStatus('queued', true); });
      var answerBtn = document.getElementById('v2-pp-answer');
      if (answerBtn) answerBtn.addEventListener('click', function () { submitStatus('queued', true); });
      var requeueBtn = document.getElementById('v2-pp-requeue');
      if (requeueBtn) requeueBtn.addEventListener('click', function () { submitStatus('queued', false); });
    }
  }

  function injectStyle() {
    if (document.getElementById('v2-peek-panel-style')) return;
    var style = document.createElement('style');
    style.id = 'v2-peek-panel-style';
    style.textContent = [
      // t-93 round 4: a real header row (sample: .phead) instead of an
      // absolutely-positioned close button competing with the title for
      // the same corner — the round-3 critic reproduced a genuine overlap
      // on long titles from the old markup, at both desktop and phone
      // width. The id sits where the sample's own .phead .id sits; the
      // close button no longer needs to reserve title margin to dodge it.
      '.v2-panel__head { display: flex; align-items: center; gap: var(--v2-space-3, 8px); margin-bottom: var(--v2-space-3, 10px); }',
      '.v2-panel__id { flex: 1; }', // t-123 (merged since t-136's own round): typography now lives on idBadge()'s own .v2-id-badge (components.css); this rule keeps only the layout role — closes the exact near-match follow-up t-136 had flagged and deferred.
      // t-136: `color`/`display` deleted from the base rule — organisms.css's
      // doubled-class `.v2-panel__close.v2-panel__close` (t-78) already wins
      // both at higher specificity (its own inline-flex + font-size +
      // row-height box also apply, unaffected either way). `border`/
      // `background`/`cursor`/`padding`/`flex` have no organisms.css analog
      // and stay live exactly as before — confirmed via computed-style
      // snapshot. The `:hover` color rule main separately carried is dead
      // for the identical reason: organisms.css's own
      // `.v2-panel__close.v2-panel__close:hover` already sets `color` at
      // the same higher specificity, so this file's hover rule never won —
      // dropped on merge rather than left as a second, newly-discovered
      // instance of the same drift this mission exists to close.
      '.v2-panel__close { border: none; background: transparent; cursor: pointer; padding: 2px; flex: none; }',
      // t-93 round 5: components.css:352 (`.v2-panel__title { flex: 1 1
      // auto; ... }`, t-66) was written for a shared header-row context
      // where .v2-panel__title sits beside .v2-panel__controls in one
      // flex row. This file's own round-4 refactor moved .v2-panel__title
      // out of any such row — it's a direct child of #v2-peek-panel,
      // itself flex-column (components.css) — so the inherited flex-grow
      // now expands the title to fill the column's available vertical
      // space instead of shrinking horizontally, a real regression a
      // round-4 critic pass measured directly (263px tall for one line of
      // text). Explicit `flex: none` here, scoped to this file's own
      // injected style rather than editing components.css (t-66's file,
      // out of scope) — the narrower of the critic's two suggested fixes.
      // t-136: `font-size`/`font-weight` deleted from the rule below —
      // organisms.css's doubled-class `.v2-panel__title.v2-panel__title`
      // (t-78) already wins both (16px/serif/semibold/primary-color live
      // today, not this file's stale 17px). `flex`/`margin`/`line-height`
      // have no organisms.css analog (organisms sets font-family/weight/
      // size/color only) and stay live exactly as before.
      '.v2-panel__title { flex: none; margin: 0 0 var(--v2-space-4, 14px); line-height: 1.3; }',
      // Stacked attribute rows (sample: .attrs .row) replacing the old
      // single ' · '-joined meta line.
      '.v2-panel__attrs { display: flex; flex-direction: column; gap: 1px; margin-bottom: var(--v2-space-5, 16px); }',
      '.v2-panel__row { display: flex; align-items: center; gap: var(--v2-space-3, 8px); padding: var(--v2-space-2, 6px) 2px; font-size: 12.5px; }',
      '.v2-panel__row-k { width: 16px; flex: none; color: var(--v2-color-text-muted, #888); display: flex; align-items: center; justify-content: center; }',
      '.v2-panel__row-v { font-weight: 500; display: flex; align-items: center; gap: 6px; }',
      '.v2-panel__stpill { font-weight: 600; text-transform: capitalize; }',
      '.v2-panel__sechead { font-size: 11px; font-weight: 700; text-transform: uppercase; letter-spacing: .04em; color: var(--v2-color-text-muted, #999); display: flex; align-items: center; gap: var(--v2-space-2, 6px); margin: var(--v2-space-4, 14px) 0 var(--v2-space-2, 8px); }',
      '.v2-panel__meta { color: var(--v2-ink-2); font-size: 12px; margin-bottom: var(--v2-space-2, 8px); font-variant-numeric: tabular-nums; }',
      '.v2-panel__link-btn { border: none; background: transparent; color: var(--v2-accent); cursor: pointer; font: inherit; padding: 0; margin-left: var(--v2-space-2, 8px); }',
      // t-136: `font-size` deleted — organisms.css's doubled-class
      // `.v2-panel__body.v2-panel__body` (t-78) already wins it (12px
      // live today, not this file's stale 13px; organisms also sets
      // line-height/color, neither of which this file ever set).
      // `white-space`/`margin-bottom` have no organisms.css analog and
      // stay live exactly as before.
      '.v2-panel__body { white-space: pre-wrap; margin-bottom: var(--v2-space-3, 12px); }',
      // t-136: .v2-panel__item and its `label` sub-rule deleted whole —
      // molecules.css's doubled-class `.v2-panel__item.v2-panel__item`
      // (t-77, built specifically to win this fight — see that file's own
      // header comment) already wins every property both rules declared
      // (border/border-radius/padding/margin for the base rule,
      // margin-right/font-size for the label rule), each with its own
      // different value; both were fully dead, confirmed via computed-
      // style snapshot before removal.
      '.v2-panel__item-body { white-space: pre-wrap; background: var(--v2-bg); padding: var(--v2-space-2, 8px); border-radius: var(--v2-radius); font-size: 12px; overflow-x: auto; }',
      '.v2-panel__item-comment { width: 100%; box-sizing: border-box; margin-top: var(--v2-space-1, 4px); font: inherit; padding: var(--v2-space-1, 4px) var(--v2-space-2, 8px); border: 1px solid var(--v2-hairline); border-radius: var(--v2-radius); background: var(--v2-bg); color: var(--v2-ink); }',
      '.v2-panel__artifact { margin: var(--v2-space-2, 8px) 0; }',
      // t-136: `border-radius` deleted — organisms.css's doubled-class
      // `.v2-panel__artifact.v2-panel__artifact img` (t-78) already wins it
      // (both resolve to 6px today via different tokens, but organisms'
      // rule is the one actually winning the cascade). Its own `border-
      // color`-only declaration also outranks this rule's border-color,
      // so the --v2-hairline fallback below never renders — stripped per
      // the same drift-floor rule as every other old-namespace fallback in
      // this file, not left as inert dead weight. `max-width` and the
      // border's width/style have no organisms.css analog and stay live.
      '.v2-panel__artifact img { max-width: 100%; border: 1px solid var(--v2-hairline); }',
      // t-136: .v2-panel__artifact figcaption deleted whole — organisms.css's
      // doubled-class `.v2-panel__artifact.v2-panel__artifact figcaption`
      // (t-78) already wins both color and font-size at higher specificity,
      // each with a different value (--v2-color-text-muted/11px live today,
      // not this file's --v2-muted/12px) — fully dead, confirmed via
      // computed-style snapshot before removal.
      // t-136: `font-size` deleted — organisms.css's doubled-class
      // `.v2-panel__logrow.v2-panel__logrow` (t-78) already wins it (11px
      // live today, not this file's stale 12.5px; organisms also sets
      // border-bottom-color and color, longhand-overriding this rule's
      // shorthand border-bottom color component too — the --v2-hairline
      // fallback below is stripped, not removed, since the border's
      // width/style are still this file's own and stay live).
      '.v2-panel__logrow { padding: var(--v2-space-1, 4px) 0; border-bottom: 1px solid var(--v2-hairline); }',
      '.v2-panel__ts { color: var(--v2-muted); font-size: 11px; margin-right: var(--v2-space-1, 4px); font-variant-numeric: tabular-nums; }',
      '.v2-panel__log { margin-top: 0; }',
      // t-93 round 2: callout-box treatment — a distinct light-tinted
      // background block with an iconed uppercase header, converging on
      // the approved t-58 sample's "MEDIA — EVIDENCE PARITY" / "ITEMIZED
      // REVIEW — PATTERN REFERENCE" section anatomy (media.js's own
      // .v2-media already reads close to this register; this is the same
      // treatment generalized for peek-panel.js's own sections).
      // t-136: was `var(--v2-surface-2, var(--v2-bg, rgba(128,128,128,.06)))`
      // — --v2-surface-2 is not defined anywhere (not in tokens.css, not in
      // v2.html's t-87 alias block), so that outer var() always fell
      // through to its own fallback, --v2-bg, which IS unconditionally
      // defined by boot time — collapsed to the one var() reference that
      // ever actually resolves, same drift-floor reasoning as every other
      // fallback stripped in this file.
      '.v2-panel__callout { background: var(--v2-bg); border: 1px solid var(--v2-hairline); border-radius: var(--v2-radius); padding: var(--v2-space-3, 12px); margin: var(--v2-space-3, 12px) 0; }',
      '.v2-panel__callout-head { display: flex; align-items: center; gap: var(--v2-space-2, 6px); font-size: 11px; font-weight: 700; text-transform: uppercase; letter-spacing: .04em; color: var(--v2-muted); margin-bottom: var(--v2-space-2, 8px); }',
      '.v2-panel__actions { display: flex; gap: var(--v2-space-2, 8px); margin-top: var(--v2-space-3, 12px); }',
      // t-136: near-identical in role to components.css's own .v2-input
      // atom, but .v2-input's real box model (row-height-derived height,
      // space-5 padding, --v2-radius-sm, --v2-font-size-sm) genuinely
      // differs in px from what's shipped here today — adopting it would
      // be a real layout change, not a mechanical no-op, so it's flagged
      // as a follow-up (needs its own before/after check) rather than
      // renamed under this mission's no-regression bar. Same reasoning
      // applies to .v2-panel__btn/--ghost below vs components.css's own
      // .v2-btn/--secondary/--ghost.
      '.v2-panel__note { flex: 1; font: inherit; padding: var(--v2-space-2, 8px); border: 1px solid var(--v2-hairline); border-radius: var(--v2-radius); background: var(--v2-bg); color: var(--v2-ink); }',
      '.v2-panel__btn { font: inherit; font-weight: 600; padding: var(--v2-space-2, 8px) var(--v2-space-3, 12px); border: none; border-radius: var(--v2-radius); background: var(--v2-accent); color: var(--v2-on-accent); cursor: pointer; }',
      '.v2-panel__btn--ghost { background: transparent; color: var(--v2-ink); border: 1px solid var(--v2-hairline); }',
      '.v2-panel__err { color: var(--v2-critical); font-size: 12px; margin: var(--v2-space-1, 4px) 0 0; }'
    ].join('\n');
    document.head.appendChild(style);
  }
})();

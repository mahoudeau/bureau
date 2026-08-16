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
import { icon } from './components.js';

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
        '<label><input type="radio" name="v_' + esc(it.id) + '" value="approved"' + (it.verdict === 'approved' ? ' checked' : '') + '> Accept</label>' +
        '<label><input type="radio" name="v_' + esc(it.id) + '" value="rejected"' + (it.verdict === 'rejected' ? ' checked' : '') + '> Reject</label>' +
        '<label><input type="radio" name="v_' + esc(it.id) + '" value=""' + (it.verdict === 'proposed' ? ' checked' : '') + '> Later</label>' +
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

      var reviewActions = t.status === 'review' ? (
        '<div class="v2-panel__actions">' +
        '<input class="v2-panel__note" id="v2-pp-note" placeholder="Note for the agent (optional on approve, required to send back)">' +
        '</div>' +
        '<p class="v2-panel__err" id="v2-pp-err" hidden></p>' +
        '<div class="v2-panel__actions">' +
        '<button type="button" class="v2-panel__btn" id="v2-pp-approve">✅ Approve</button>' +
        '<button type="button" class="v2-panel__btn v2-panel__btn--ghost" id="v2-pp-sendback">↩️ Send back</button>' +
        '</div>'
      ) : '';
      var blockedActions = t.status === 'blocked' ? (
        '<div class="v2-panel__actions"><input class="v2-panel__note" id="v2-pp-note" placeholder="Your answer to the worker (required)"></div>' +
        '<p class="v2-panel__err" id="v2-pp-err" hidden></p>' +
        '<div class="v2-panel__actions"><button type="button" class="v2-panel__btn" id="v2-pp-answer">💬 Answer &amp; re-queue</button></div>'
      ) : '';
      var failedActions = t.status === 'failed' ? (
        '<div class="v2-panel__actions"><button type="button" class="v2-panel__btn v2-panel__btn--ghost" id="v2-pp-requeue">↩️ Re-queue</button></div>'
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
        '<div class="v2-panel__head"><span class="v2-panel__id v2-tabular-nums">' + esc(t.id) + '</span>' +
        '<button type="button" class="v2-panel__close" id="v2-pp-close" aria-label="Close">' + icon('x') + '</button></div>' +
        '<h2 class="v2-panel__title">' + (isGoal ? '🎯 ' : '') + esc(t.title) + '</h2>' +
        '<div class="v2-panel__attrs">' + rows + '</div>' +
        (goalKids ? '<div class="v2-panel__meta">' + goalKids.done + '/' + goalKids.total + ' child missions done ' +
          '<button type="button" class="v2-panel__link-btn" id="v2-pp-goal-progress">Open goal/cycle progress →</button></div>' : '') +
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
      '.v2-panel__id { font-size: 11.5px; color: var(--v2-color-text-muted, #93949c); font-weight: 500; flex: 1; }',
      '.v2-panel__close { border: none; background: transparent; color: var(--v2-color-text-muted, #888); display: flex; cursor: pointer; padding: 2px; flex: none; }',
      '.v2-panel__close:hover { color: var(--v2-color-text-primary, inherit); }',
      '.v2-panel__title { margin: 0 0 var(--v2-space-4, 14px); font-size: 17px; font-weight: 600; line-height: 1.3; }',
      // Stacked attribute rows (sample: .attrs .row) replacing the old
      // single ' · '-joined meta line.
      '.v2-panel__attrs { display: flex; flex-direction: column; gap: 1px; margin-bottom: var(--v2-space-5, 16px); }',
      '.v2-panel__row { display: flex; align-items: center; gap: var(--v2-space-3, 8px); padding: var(--v2-space-2, 6px) 2px; font-size: 12.5px; }',
      '.v2-panel__row-k { width: 16px; flex: none; color: var(--v2-color-text-muted, #888); display: flex; align-items: center; justify-content: center; }',
      '.v2-panel__row-v { font-weight: 500; display: flex; align-items: center; gap: 6px; }',
      '.v2-panel__stpill { font-weight: 600; text-transform: capitalize; }',
      '.v2-panel__sechead { font-size: 11px; font-weight: 700; text-transform: uppercase; letter-spacing: .04em; color: var(--v2-color-text-muted, #999); display: flex; align-items: center; gap: var(--v2-space-2, 6px); margin: var(--v2-space-4, 14px) 0 var(--v2-space-2, 8px); }',
      '.v2-panel__meta { color: var(--v2-ink-2, #888); font-size: 12px; margin-bottom: var(--v2-space-2, 8px); font-variant-numeric: tabular-nums; }',
      '.v2-panel__link-btn { border: none; background: transparent; color: var(--v2-accent, #3f6fe0); cursor: pointer; font: inherit; padding: 0; margin-left: var(--v2-space-2, 8px); }',
      '.v2-panel__body { white-space: pre-wrap; font-size: 13px; margin-bottom: var(--v2-space-3, 12px); }',
      '.v2-panel__item { border: 1px solid var(--v2-hairline, rgba(128,128,128,.3)); border-radius: var(--v2-radius, 6px); padding: var(--v2-space-2, 8px); margin: var(--v2-space-2, 8px) 0; }',
      '.v2-panel__item label { margin-right: var(--v2-space-2, 8px); font-size: 12.5px; }',
      '.v2-panel__item-body { white-space: pre-wrap; background: var(--v2-bg, rgba(128,128,128,.08)); padding: var(--v2-space-2, 8px); border-radius: var(--v2-radius, 6px); font-size: 12px; overflow-x: auto; }',
      '.v2-panel__item-comment { width: 100%; box-sizing: border-box; margin-top: var(--v2-space-1, 4px); font: inherit; padding: var(--v2-space-1, 4px) var(--v2-space-2, 8px); border: 1px solid var(--v2-hairline, rgba(128,128,128,.3)); border-radius: var(--v2-radius, 6px); background: var(--v2-bg, transparent); color: var(--v2-ink, inherit); }',
      '.v2-panel__artifact { margin: var(--v2-space-2, 8px) 0; }',
      '.v2-panel__artifact img { max-width: 100%; border-radius: var(--v2-radius, 6px); border: 1px solid var(--v2-hairline, rgba(128,128,128,.3)); }',
      '.v2-panel__artifact figcaption { color: var(--v2-muted, #999); font-size: 12px; }',
      '.v2-panel__logrow { padding: var(--v2-space-1, 4px) 0; border-bottom: 1px solid var(--v2-hairline, rgba(128,128,128,.2)); font-size: 12.5px; }',
      '.v2-panel__ts { color: var(--v2-muted, #999); font-size: 11px; margin-right: var(--v2-space-1, 4px); font-variant-numeric: tabular-nums; }',
      '.v2-panel__log { margin-top: 0; }',
      // t-93 round 2: callout-box treatment — a distinct light-tinted
      // background block with an iconed uppercase header, converging on
      // the approved t-58 sample's "MEDIA — EVIDENCE PARITY" / "ITEMIZED
      // REVIEW — PATTERN REFERENCE" section anatomy (media.js's own
      // .v2-media already reads close to this register; this is the same
      // treatment generalized for peek-panel.js's own sections).
      '.v2-panel__callout { background: var(--v2-surface-2, var(--v2-bg, rgba(128,128,128,.06))); border: 1px solid var(--v2-hairline, rgba(128,128,128,.2)); border-radius: var(--v2-radius, 6px); padding: var(--v2-space-3, 12px); margin: var(--v2-space-3, 12px) 0; }',
      '.v2-panel__callout-head { display: flex; align-items: center; gap: var(--v2-space-2, 6px); font-size: 11px; font-weight: 700; text-transform: uppercase; letter-spacing: .04em; color: var(--v2-muted, #999); margin-bottom: var(--v2-space-2, 8px); }',
      '.v2-panel__actions { display: flex; gap: var(--v2-space-2, 8px); margin-top: var(--v2-space-3, 12px); }',
      '.v2-panel__note { flex: 1; font: inherit; padding: var(--v2-space-2, 8px); border: 1px solid var(--v2-hairline, rgba(128,128,128,.3)); border-radius: var(--v2-radius, 6px); background: var(--v2-bg, transparent); color: var(--v2-ink, inherit); }',
      '.v2-panel__btn { font: inherit; font-weight: 600; padding: var(--v2-space-2, 8px) var(--v2-space-3, 12px); border: none; border-radius: var(--v2-radius, 6px); background: var(--v2-accent, #3f6fe0); color: var(--v2-on-accent, #fff); cursor: pointer; }',
      '.v2-panel__btn--ghost { background: transparent; color: var(--v2-ink, inherit); border: 1px solid var(--v2-hairline, rgba(128,128,128,.3)); }',
      '.v2-panel__err { color: var(--v2-critical, #c23434); font-size: 12px; margin: var(--v2-space-1, 4px) 0 0; }'
    ].join('\n');
    document.head.appendChild(style);
  }
})();

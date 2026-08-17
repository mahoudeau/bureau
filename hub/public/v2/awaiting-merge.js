// v2/awaiting-merge.js — t-116 (goal: t-53). Owns nothing but its own
// injected DOM; touches no other file, per this mission's own scope.
//
// Closes a legibility gap the boss found directly (relayed via consul's
// note on t-53, 2026-08-16T17:37Z): critic-closed missions park their
// code in an open PR awaiting his merge, but the evidence screenshots
// live in mission Media on /v2 while the merge decision sits on GitHub
// with no evidence attached — from where he actually decides (GitHub),
// he can't see what he's approving. One place on the dashboard: every
// open PR tied to a mission, each showing that mission's evidence
// inline plus a direct PR link, so a ready tranche reads as one
// reviewable moment instead of a scatter of GitHub tabs.
//
// Self-contained surface, same shape search.js (t-73) already uses for
// exactly this reason: its own trigger + its own non-modal panel,
// appended once to document.body, touching no other module's DOM or
// mount points (this surface has no pre-existing mount in v2.html —
// there was nothing to attach to, and the mission's own scope forbids
// editing any other v2/*.js file's logic to add one).
//
// Cross-referencing missions to PRs: the protocol has no dedicated PR
// field (confirmed by reading docs/protocol.md and this repo's own
// mission logs before writing this file — t-109/t-112/etc. all post the
// PR link as a free-form `artifact` entry, `{"label": "PR #N: ...",
// "url": "https://github.com/.../pull/N"}`). Parsed off that existing
// convention rather than inventing hidden state the hub doesn't store,
// per this mission's own instruction.
//
// GitHub PR state: this repo is public, so the unauthenticated GitHub
// REST API (api.github.com, which serves CORS for anonymous GET on
// public-repo endpoints) can confirm a PR is still genuinely open
// (merged/closed PRs are filtered out — a mission whose PR already
// merged is not "awaiting" anything, even if its bureau-side status
// hasn't been flipped to reflect that yet). No token, no client-side
// secret. KNOWN LIMITATION, stated plainly rather than silently
// papered over: this session's own sandboxed dev environment blocks
// outbound headless-browser HTTPS entirely at the network layer
// (confirmed independently in t-111's audit — even a plain
// https://example.com fetch resets the connection; curl through the
// same proxy works fine, so it's a browser/CONNECT-tunnel limitation
// of THIS dev sandbox, not of the GitHub API itself), so the live
// api.github.com call could not be empirically click-tested end to end
// the way every other claim in this mission's closing note was. Coded
// defensively per the acceptance's own instruction — a failed/blocked/
// rate-limited fetch degrades to showing the entry anyway (PR state
// marked "unconfirmed"), never to hiding it or blanking the page,
// which is the fail-safe direction: a boss who can't fully trust one
// row's live state is far better served than one who never sees a
// tranche because a network call quietly ate it.
//
// t-129 (goal: t-53) split: the boss's own complaint — a flat list mixed
// t-59-style round-N branch PRs (mission still looping, not his to
// merge) in with PRs whose missions are genuinely done. This surface
// answers one question, "what's waiting on ME", so it now buckets every
// PR-carrying mission into READY (mission done, or in review at
// gate:boss — his own click is the only thing left) or IN-LOOP (mission
// queued/claimed/in_progress, or in review at gate:critic — still
// mid-loop, not his turn yet). READY renders first and undimmed; IN-LOOP
// renders muted below it. The trigger's count — both the light on-load
// pass and the network-confirmed pass — counts READY rows only, since
// that's the number that answers "how many need me right now".
(function () {
  'use strict';

  var GITHUB_PR_RE = /^https:\/\/github\.com\/([\w.-]+)\/([\w.-]+)\/pull\/(\d+)/;

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
    injectStyle();

    var esc = function (s) {
      return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; });
    };

    var panel, trigger, countEl, bodyEl;
    var prStateCache = {}; // "owner/repo#N" -> 'open' | 'closed' | 'unconfirmed', reused across renders/opens

    buildTrigger();
    buildPanel();

    document.addEventListener('keydown', function (e) {
      if (!panel.hidden && e.key === 'Escape') close();
    });

    function open() { panel.hidden = false; render(); }
    function close() { panel.hidden = true; }

    function buildTrigger() {
      trigger = document.createElement('button');
      trigger.type = 'button';
      trigger.className = 'v2-awaitmerge-trigger';
      trigger.setAttribute('aria-label', 'Missions awaiting merge');
      trigger.innerHTML = '⎇ <span id="v2-awaitmerge-count">0</span> awaiting merge';
      trigger.addEventListener('click', function () { panel.hidden ? open() : close(); });
      document.body.appendChild(trigger);
      countEl = trigger.querySelector('#v2-awaitmerge-count');
    }

    function buildPanel() {
      panel = document.createElement('div');
      panel.className = 'v2-awaitmerge-panel';
      panel.hidden = true;
      panel.setAttribute('role', 'dialog');
      panel.setAttribute('aria-modal', 'false');
      panel.setAttribute('aria-label', 'Missions awaiting merge');
      panel.innerHTML =
        '<div class="v2-awaitmerge-panel__head">' +
        '<strong>Awaiting merge</strong>' +
        '<button type="button" class="v2-awaitmerge-panel__close" aria-label="Close">✕</button>' +
        '</div>' +
        '<div class="v2-awaitmerge-panel__body"></div>';
      document.body.appendChild(panel);
      bodyEl = panel.querySelector('.v2-awaitmerge-panel__body');
      panel.querySelector('.v2-awaitmerge-panel__close').addEventListener('click', close);
    }

    // A mission "carries" a PR if the LAST github.com/.../pull/N link in
    // its own artifacts list matches — last, not first, so a mission
    // whose branch was re-cut into a fresh PR (an old link superseded by
    // a new one, same shape as t-114/t-115 each opening their own PR off
    // a fresh branch) always points at its current one, not a stale one.
    function prLinkFor(task) {
      var arts = task.artifacts || [];
      for (var i = arts.length - 1; i >= 0; i--) {
        var m = GITHUB_PR_RE.exec(String(arts[i].url || ''));
        if (m) return { owner: m[1], repo: m[2], number: m[3], url: arts[i].url };
      }
      return null;
    }

    // READY = the boss's own click is the only thing left standing
    // between this PR and merged: the mission itself is done, or it's
    // sitting in review at gate:boss (already survived the critic loop,
    // promoted to him by the critic/lead, per t-119's own gate rule —
    // never self-promoted by a builder). Everything else with an open PR
    // (queued, claimed, in_progress, blocked, or review at gate:critic —
    // still mid critic-loop per t-53's own judging protocol) is still
    // in the loop: a real open PR, but not his turn yet.
    function isReady(task) {
      return task.status === 'done' || (task.status === 'review' && task.gate === 'boss');
    }

    // Short human label for why a row sits where it sits — shown on
    // IN-LOOP rows so the muted section reads as "still cooking, here's
    // the stage" rather than an unexplained dimming.
    function statusLabel(task) {
      if (task.status === 'review') return 'review · gate ' + (task.gate || '?');
      return String(task.status || 'unknown').replace(/_/g, ' ');
    }

    function artImg(a) {
      var m = String(a.url || a.label || '').match(/([\w./-]+\.(?:png|jpe?g|gif))/i);
      if (m && !/^https?:/i.test(m[1])) return m[1];
      var m2 = String(a.url || '').match(/[?&]file=([\w./%-]+\.(?:png|jpe?g|gif))/i);
      return m2 && m2[1];
    }

    // Reuses media.js's own thumbnail markup/class names (.v2-media__grid/
    // __thumb/__cap) — that file's <style id="v2-media-style"> is always
    // present in the document (media.js loads unconditionally per
    // v2.html's module list, independent of peek-panel state), so no CSS
    // is duplicated here; only the fetch/render logic is, since this
    // mission's own scope forbids editing media.js to export a shared
    // helper ("do not modify any other existing v2/*.js file's own logic").
    function thumbsFor(task) {
      var imgs = (task.artifacts || []).map(artImg).filter(Boolean);
      if (!imgs.length) return '<div class="v2-empty">No evidence attached.</div>';
      return '<div class="v2-media__grid">' + imgs.map(function (img) {
        var src = '/api/knowledge?file=' + encodeURIComponent(decodeURIComponent(img)) + '&raw=1&token=' + encodeURIComponent(V2.token);
        return '<a class="v2-media__thumb" href="' + src + '" target="_blank" rel="noopener">' +
          '<img src="' + src + '" alt="" loading="lazy"></a>';
      }).join('') + '</div>';
    }

    function fetchPrState(pr) {
      var key = pr.owner + '/' + pr.repo + '#' + pr.number;
      if (prStateCache[key]) return Promise.resolve(prStateCache[key]);
      var url = 'https://api.github.com/repos/' + pr.owner + '/' + pr.repo + '/pulls/' + pr.number;
      var controller = typeof AbortController !== 'undefined' ? new AbortController() : null;
      var timeout = controller ? setTimeout(function () { controller.abort(); }, 8000) : null;
      return fetch(url, { headers: { Accept: 'application/vnd.github+json' }, signal: controller ? controller.signal : undefined })
        .then(function (r) {
          if (timeout) clearTimeout(timeout);
          if (!r.ok) return 'unconfirmed'; // rate-limited (403) or any other non-200 — degrade, don't throw
          return r.json();
        })
        .then(function (data) {
          var state = data && typeof data === 'object' && data.state ? data.state : 'unconfirmed';
          prStateCache[key] = state;
          return state;
        })
        .catch(function () {
          if (timeout) clearTimeout(timeout);
          return 'unconfirmed'; // network error, CORS block, abort — never throw into the caller
        });
    }

    function row(task, pr, state, ready) {
      var badge = state === 'open' ? '' : state === 'unconfirmed' ? '<span class="v2-awaitmerge-row__unconfirmed">PR state unconfirmed</span>' : '';
      return '<div class="v2-awaitmerge-row' + (ready ? '' : ' v2-awaitmerge-row--inloop') + '">' +
        '<div class="v2-awaitmerge-row__head">' +
        '<span class="v2-awaitmerge-row__title">' + esc(task.id) + ' · ' + esc(task.title) + '</span>' +
        // t-145 (goal: t-53): .v2-hit44 (components.css) — invisible 44px
        // hit zone around the small "PR #N →" link, same pattern as t-115
        // (closes t-111). Keeps the compact visual, grows only the tap area.
        '<a class="v2-awaitmerge-row__pr v2-hit44" href="' + esc(pr.url) + '" target="_blank" rel="noopener">PR #' + esc(pr.number) + ' →</a>' +
        '</div>' +
        '<div class="v2-awaitmerge-row__meta">' +
        (ready ? '' : '<span class="v2-awaitmerge-row__status">' + esc(statusLabel(task)) + '</span>') +
        badge +
        '</div>' +
        thumbsFor(task) +
        '</div>';
    }

    // A section is only worth its own header once it has rows; an empty
    // READY (or empty IN-LOOP) section renders nothing rather than an
    // empty header, so "one done PR + one looping PR" reads as exactly
    // two labeled blocks, not two-plus-a-hollow-third.
    function section(key, label, rows, ready) {
      if (!rows.length) return '';
      return '<div class="v2-awaitmerge-section v2-awaitmerge-section--' + key + '">' +
        '<div class="v2-awaitmerge-section__head">' + esc(label) +
        ' <span class="v2-awaitmerge-section__count">' + rows.length + '</span></div>' +
        rows.map(function (o) { return row(o.task, o.pr, o.state, ready); }).join('') +
        '</div>';
    }

    // Splits the states-resolved candidate list into READY (rendered
    // first, undimmed) and IN-LOOP (rendered below, muted) — the only
    // classification this file needs, driven off task.status/task.gate,
    // never off PR state (PR state only ever decides in/out of the list
    // at all, per the merged/closed filter above it).
    function bucket(resolved) {
      var readyRows = [], inLoopRows = [];
      resolved.forEach(function (o) { (isReady(o.task) ? readyRows : inLoopRows).push(o); });
      return { ready: readyRows, inLoop: inLoopRows };
    }

    // Trigger count = READY only (t-129's own instruction: the number on
    // the trigger answers "how many need me right now", not "how many
    // PRs exist"). Same open-count-with-unconfirmed-fallback shape the
    // pre-split count used, just scoped to the ready bucket.
    function readyCount(readyRows) {
      var confirmed = readyRows.filter(function (o) { return o.state === 'open'; }).length;
      return confirmed || readyRows.length;
    }

    // t-128 fix, composed with the t-129 split: the trigger count must be
    // the real, network-verified count from page load onward, tracking live
    // updates while the panel stays closed — and per t-129 it counts the
    // READY bucket only. render() always resolves the count on every call;
    // only the panel BODY markup is gated on visibility (rebuilding hidden
    // DOM is wasted work; fetchPrState's cache absorbs the repeat network
    // cost across calls).
    function render() {
      var showBody = !panel.hidden;
      var state = V2.state;
      var tasks = (state && state.tasks) || [];
      var candidates = tasks.map(function (t) {
        var pr = prLinkFor(t);
        return pr ? { task: t, pr: pr } : null;
      }).filter(Boolean);

      if (!candidates.length) {
        countEl.textContent = '0';
        if (showBody) bodyEl.innerHTML = '<div class="v2-empty">Nothing awaiting merge.</div>';
        return;
      }

      if (showBody) bodyEl.innerHTML = '<div class="v2-empty">Checking PR state…</div>';
      return Promise.all(candidates.map(function (c) { return fetchPrState(c.pr); })).then(function (states) {
        // merged/closed PRs are filtered OUT — that mission isn't
        // "awaiting" anything anymore, even if bureau-side status hasn't
        // caught up. 'unconfirmed' (the GitHub call itself failed) stays
        // IN per this file's own fail-safe direction: never hide a real
        // tranche because a network call quietly ate it.
        var open = candidates.map(function (c, i) { return { task: c.task, pr: c.pr, state: states[i] }; })
          .filter(function (o) { return o.state === 'open' || o.state === 'unconfirmed'; });
        var b = bucket(open);
        countEl.textContent = String(readyCount(b.ready));
        // Re-check panel.hidden at resolve time, not just at call time — a
        // slow fetch resolving after the user toggled the panel must not
        // repaint stale rows into a hidden node.
        if (panel.hidden) return; // trigger count stays live even closed
        bodyEl.innerHTML = open.length
          ? section('ready', 'Ready to merge', b.ready, true) + section('inloop', 'Still in the loop', b.inLoop, false)
          : '<div class="v2-empty">Nothing awaiting merge.</div>';
      });
    }

    // Every state refresh — initial load included, and every SSE tick or
    // 60s poll after it — drives the trigger's real READY count, panel open
    // or closed (t-128); a row's mission changing state moves it between
    // READY and IN-LOOP live (t-129). render() skips DOM body work while
    // closed.
    V2.on('v2:state', function () { render(); });
    // Instant light pass before the first network resolve: READY candidates
    // only, same scope as the confirmed count, so the two passes never
    // disagree in kind — only in confidence.
    (function initialCount() {
      var tasks = (V2.state && V2.state.tasks) || [];
      var n = tasks.filter(function (t) { return !!prLinkFor(t) && isReady(t); }).length;
      if (n) countEl.textContent = String(n);
    })();
    render(); // cold-load network-verified count, before the panel is ever opened
  }

  function injectStyle() {
    if (document.getElementById('v2-awaitmerge-style')) return;
    var style = document.createElement('style');
    style.id = 'v2-awaitmerge-style';
    style.textContent = [
      // t-145 (goal: t-53): min-height 44px — the trigger sits alone in the
      // bottom-right thumb zone (no neighboring controls to keep visually
      // compact against), so growing its own box is simpler than the
      // hit44 pseudo-element trick and there's no `position: relative`
      // clash with the `position: fixed` this element needs to stay pinned.
      '.v2-awaitmerge-trigger { position: fixed; right: var(--v2-space-3, 12px); bottom: var(--v2-space-3, 12px); z-index: 44; display: flex; align-items: center; gap: var(--v2-space-2, 6px); font: inherit; font-size: var(--v2-font-size-xs, 12px); font-variant-numeric: tabular-nums; padding: var(--v2-space-2, 6px) var(--v2-space-4, 10px); min-height: 44px; border: 1px solid var(--v2-color-border, var(--v2-hairline, rgba(128,128,128,.3))); border-radius: var(--v2-radius-sm, 6px); background: var(--v2-color-surface, var(--v2-surface, #fff)); color: var(--v2-color-text-secondary, var(--v2-ink-2, inherit)); cursor: pointer; }',
      '.v2-awaitmerge-trigger:hover { border-color: var(--v2-color-border-strong, var(--v2-hairline, rgba(128,128,128,.5))); }',
      '.v2-awaitmerge-panel { position: fixed; right: var(--v2-space-3, 12px); bottom: calc(var(--v2-space-3, 12px) + 40px); width: min(420px, 92vw); max-height: 70vh; display: flex; flex-direction: column; background: var(--v2-color-surface, var(--v2-surface, #fff)); border: 1px solid var(--v2-color-border, var(--v2-hairline, rgba(128,128,128,.3))); border-radius: var(--v2-radius-sm, 8px); box-shadow: 0 8px 28px rgba(0,0,0,.18); z-index: 50; overflow: hidden; }',
      '@media (max-width: 720px) { .v2-awaitmerge-panel { top: 0; left: 0; right: 0; bottom: 0; width: 100%; height: 100%; max-height: 100%; border-radius: 0; } }',
      '.v2-awaitmerge-panel__head { display: flex; align-items: center; justify-content: space-between; padding: var(--v2-space-4, 12px); border-bottom: 1px solid var(--v2-color-border, var(--v2-hairline, rgba(128,128,128,.2))); font-size: var(--v2-font-size-md, 14px); }',
      '.v2-awaitmerge-panel__close { border: none; background: transparent; color: var(--v2-color-text-muted, #888); cursor: pointer; font-size: 14px; }',
      '.v2-awaitmerge-panel__body { overflow-y: auto; padding: var(--v2-space-3, 12px); display: flex; flex-direction: column; gap: var(--v2-space-5, 16px); }',
      // Section header: small caps-weight label + a tabular-numeral count
      // pill. READY gets the done/green accent (it's a positive, "this is
      // for you" signal); IN-LOOP gets the neutral muted text — visually
      // distinct without needing a second color vocabulary.
      '.v2-awaitmerge-section { display: flex; flex-direction: column; gap: var(--v2-space-3, 10px); }',
      '.v2-awaitmerge-section__head { display: flex; align-items: center; gap: var(--v2-space-2, 6px); font-weight: 600; font-size: 11px; letter-spacing: .04em; text-transform: uppercase; }',
      '.v2-awaitmerge-section--ready .v2-awaitmerge-section__head { color: var(--v2-color-status-done, #29a36a); }',
      '.v2-awaitmerge-section--inloop .v2-awaitmerge-section__head { color: var(--v2-color-text-muted, #71727c); }',
      '.v2-awaitmerge-section__count { font-variant-numeric: tabular-nums; font-weight: 600; }',
      '.v2-awaitmerge-row { border: 1px solid var(--v2-color-border, var(--v2-hairline, rgba(128,128,128,.2))); border-radius: var(--v2-radius, 6px); padding: var(--v2-space-3, 10px); }',
      // READY rows: a full-strength left accent so the section reads as
      // "yours to act on" even scanned quickly. IN-LOOP rows: dimmed as a
      // whole (border, text, thumbnails) so the muted section reads as
      // background context, not a second to-do list competing for
      // attention — per t-129's own "visually distinct" instruction.
      '.v2-awaitmerge-section--ready .v2-awaitmerge-row { border-left: 3px solid var(--v2-color-status-done, #29a36a); }',
      '.v2-awaitmerge-row--inloop { opacity: .6; }',
      '.v2-awaitmerge-row--inloop:hover, .v2-awaitmerge-row--inloop:focus-within { opacity: .85; }',
      '.v2-awaitmerge-row__head { display: flex; align-items: baseline; justify-content: space-between; gap: var(--v2-space-2, 8px); margin-bottom: var(--v2-space-2, 6px); }',
      '.v2-awaitmerge-row__title { font-weight: 600; font-size: 13px; overflow-wrap: break-word; }',
      '.v2-awaitmerge-row__pr { flex: none; font-size: 12px; color: var(--v2-color-accent, #3f6fe0); text-decoration: none; white-space: nowrap; }',
      '.v2-awaitmerge-row__pr:hover { text-decoration: underline; }',
      '.v2-awaitmerge-row__meta { display: flex; align-items: center; gap: var(--v2-space-2, 8px); margin-bottom: var(--v2-space-2, 6px); }',
      '.v2-awaitmerge-row__meta:empty { display: none; margin: 0; }',
      '.v2-awaitmerge-row__status { font-size: 11px; font-weight: 600; text-transform: uppercase; letter-spacing: .03em; color: var(--v2-color-text-muted, #71727c); }',
      '.v2-awaitmerge-row__unconfirmed { font-size: 11px; color: var(--v2-color-status-at-risk, #f2a30f); }'
    ].join('\n');
    document.head.appendChild(style);
  }
})();

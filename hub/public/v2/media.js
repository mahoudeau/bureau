// v2/media.js — t-67 (goal: t-53). Owns nothing but its own injected DOM;
// touches no other file. Builds t-53's bar-mandated MEDIA section: the
// mission's current-round visual evidence inside the peek panel (t-64),
// clearly separated from stale older-round history, re-rendering live as
// the loop turns — "evidence parity: what the boss sees is always the
// round being judged."
//
// t-93 round 4: peek-panel.js now exposes the real extension hook this
// file's header comment had been asking for since t-67 first wrote it —
// `window.BureauV2.peekPanel.registerSection('after-body', renderFn)`.
// This module registers there instead of its old MutationObserver +
// trailing-append workaround: peek-panel.js calls every registered
// 'after-body' renderFn INLINE, in the sample's own body->Media->Log->
// Itemized-review->Artifacts order, every time it rebuilds the panel —
// so this module no longer needs to detect and out-race peek-panel's own
// innerHTML replace. registerSection's renderFn signature is synchronous
// (returns an HTML string), but this module's own data arrives async (a
// fetch per mission open) — reconciled below by registering a renderFn
// that reads from this module's own currentArtifacts cache (already
// fetched by the existing v2:mission:open handler) and re-triggering a
// panel-level re-render via V2.refresh()-adjacent state once that fetch
// resolves, the same re-render-on-data-arrival shape the old code already
// had, just without the DOM-mutation detection step.
//
// Known follow-on for whoever next owns peek-panel.js: its own
// renderArtifacts() already inline-figures every image artifact,
// undifferentiated by round — this module's curated, round-aware MEDIA
// section is additive on top of that, not a replacement (this mission's
// scope is media.js only), so a mission carrying real evidence currently
// shows its images twice: once flat in the existing artifact list, once
// curated here. Flagging plainly rather than quietly living with a
// visual duplication a reader might mistake for a bug in this file.
//
// t-89: the 📷 emoji section-header prefix (below) is swapped for t-66's
// vendored icon set — no "camera"/"image" shape exists in that set
// (components.js is out of this mission's scope to extend), so this
// picks the closest available semantic match, "paperclip" (attachment/
// evidence register), the same kind of best-available-match call t-65
// made swapping its own placeholder glyphs for icon('command') etc.
import { icon } from './components.js';

(function () {
  'use strict';

  // t-93 round 4: waits for BOTH window.BureauV2 (the usual gate) AND
  // peek-panel.js's own registerSection hook to exist — module load order
  // is a committed contract in v2.html (§ "do not reorder") and this
  // file's own <script> tag loads BEFORE peek-panel.js's, so on a cold
  // load this file's init() can genuinely run before peek-panel.js's own
  // ready(init) has attached registerSection to V2.peekPanel. Polling the
  // compound condition (rather than a one-shot check-and-bail) makes this
  // correct regardless of which of the two ready-polls actually resolves
  // first, without needing to reorder anything.
  function ready(cb) {
    if (window.BureauV2 && window.BureauV2.peekPanel && window.BureauV2.peekPanel.registerSection) return cb();
    document.addEventListener('DOMContentLoaded', function poll() {
      if (window.BureauV2 && window.BureauV2.peekPanel && window.BureauV2.peekPanel.registerSection) cb();
      else setTimeout(poll, 50);
    });
  }

  ready(init);

  // a round's screenshots land together in one upload burst (observed
  // directly on live missions: every stable-path image in a round is
  // attached within seconds of the others) — anything inside this window
  // of the single newest image timestamp counts as "the current round";
  // anything older is history. Generous on purpose: a slow multi-step
  // upload should still read as one round, not fragment into several.
  var ROUND_WINDOW_MS = 10 * 60 * 1000;

  function init() {
    var V2 = window.BureauV2;
    var panel = V2.mounts.peekPanel;
    if (!panel) return;
    if (!V2.peekPanel || !V2.peekPanel.registerSection) return; // peek-panel.js (t-64) missing its section hook; nothing to attach to
    injectStyle();

    var esc = function (s) {
      return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; });
    };

    var currentId = null;
    var currentArtifacts = null; // null = not yet fetched for currentId

    // Registered once. peek-panel.js calls this synchronously, inline, at
    // the sample's own body->Media->Log->Itemized-review->Artifacts
    // position, every time it rebuilds the panel — including once from
    // its OWN openPanel() fetch (before this module's fetch below has
    // necessarily resolved, in which case this returns '' and the section
    // is simply absent until the re-render triggered once it does).
    V2.peekPanel.registerSection('after-body', function (t) {
      if (t.id !== currentId || currentArtifacts === null) return '';
      return renderSectionHtml(currentArtifacts);
    });

    V2.on('v2:mission:open', function (detail) {
      if (!detail || !detail.id) return;
      currentId = detail.id;
      currentArtifacts = null;
      V2.api('/api/tasks/' + detail.id).then(function (r) {
        if (!r || !r.task || currentId !== detail.id) return; // superseded by a newer open
        currentArtifacts = r.task.artifacts || [];
        if (V2.peekPanel.refreshSections) V2.peekPanel.refreshSections();
      });
    });

    // Live updates without a reload: hub/server.js broadcasts the FULL
    // updated task (artifacts included) on every PATCH /api/tasks/:id,
    // status change or not — an artifact-only attach (no status field)
    // broadcasts as 'task.updated'; a status change broadcasts under the
    // matching named event instead. Subscribe to all of them.
    ['task.updated', 'task.done', 'task.failed', 'task.review', 'task.blocked', 'task.requeued'].forEach(function (evt) {
      V2.on(evt, function (payload) {
        if (!payload || payload.id !== currentId) return;
        currentArtifacts = payload.artifacts || [];
        if (V2.peekPanel.refreshSections) V2.peekPanel.refreshSections();
      });
    });

    function artImg(a) {
      var m = String(a.url || a.label || '').match(/([\w./-]+\.(?:png|jpe?g|gif))/i);
      if (m && !/^https?:/i.test(m[1])) return m[1];
      var m2 = String(a.url || '').match(/[?&]file=([\w./%-]+\.(?:png|jpe?g|gif))/i);
      return m2 && m2[1];
    }

    function classify(artifacts) {
      var imgs = (artifacts || []).map(function (a) {
        var img = artImg(a);
        if (!img) return null;
        var ts = Date.parse(a.ts);
        return { a: a, img: img, ts: isNaN(ts) ? 0 : ts };
      }).filter(Boolean);
      if (!imgs.length) return null;
      imgs.sort(function (x, y) { return y.ts - x.ts; }); // newest first
      var latestTs = imgs[0].ts;
      var current = [], seen = {};
      imgs.forEach(function (it) {
        if (latestTs - it.ts <= ROUND_WINDOW_MS) { current.push(it); seen[it.img] = true; }
      });
      // history: the newest surviving entry per URL not already claimed by
      // the current round — a stable path re-uploaded every round would
      // otherwise show the SAME (now-overwritten-to-current) pixels under
      // several stale timestamps, which is misleading, not history.
      var byUrl = {};
      imgs.forEach(function (it) {
        if (seen[it.img]) return;
        if (!byUrl[it.img] || byUrl[it.img].ts < it.ts) byUrl[it.img] = it;
      });
      var history = Object.keys(byUrl).map(function (k) { return byUrl[k]; })
        .sort(function (x, y) { return y.ts - x.ts; });
      return { current: current, history: history };
    }

    function thumb(it) {
      var src = '/api/knowledge?file=' + encodeURIComponent(decodeURIComponent(it.img)) + '&raw=1&token=' + encodeURIComponent(V2.token);
      var when = it.a.ts ? esc(it.a.ts.slice(5, 16).replace('T', ' ')) : '';
      return '<a class="v2-media__thumb" href="' + src + '" target="_blank" rel="noopener" title="' + esc(it.a.label || it.img) + '">' +
        '<img src="' + src + '" alt="' + esc(it.a.label || it.img) + '" loading="lazy">' +
        '<span class="v2-media__cap">' + esc(it.a.label || it.img) + (when ? ' · ' + when : '') + '</span>' +
        '</a>';
    }

    // Returns an HTML string (no DOM writes of its own — peek-panel.js
    // concatenates this into its own innerHTML rebuild, at the position
    // its render() decides, per the registerSection contract). Wrapped in
    // the same `.v2-panel__callout` box Log/Itemized-review already use
    // (t-93 round 2/4), matching the sample's own visually-set-apart
    // treatment for MEDIA even though the sample's fixed demo never
    // renders a real thumbnail grid inside it.
    function renderSectionHtml(artifacts) {
      var groups = classify(artifacts);
      var head = '<div class="v2-panel__callout-head">' + icon('paperclip', 'v2-icon--xs') + ' Media' + (groups ? ' <span class="v2-tabular-nums">' + groups.current.length + '</span>' : '') + '</div>';

      if (!groups) {
        return '<div class="v2-panel__callout">' + head + '<div class="v2-empty">No visual evidence attached yet.</div></div>';
      }

      var html = head;
      html += groups.current.length
        ? '<div class="v2-media__grid">' + groups.current.map(thumb).join('') + '</div>'
        : '<div class="v2-empty">No current-round evidence — only older history below.</div>';

      if (groups.history.length) {
        html += '<details class="v2-media__history">' +
          '<summary>History (' + groups.history.length + ' older)</summary>' +
          '<div class="v2-media__grid v2-media__grid--history">' + groups.history.map(thumb).join('') + '</div>' +
          '</details>';
      }

      return '<div class="v2-panel__callout">' + html + '</div>';
    }
  }

  function injectStyle() {
    if (document.getElementById('v2-media-style')) return;
    var style = document.createElement('style');
    style.id = 'v2-media-style';
    style.textContent = [
      // t-93 round 4: the section head/wrapper is now peek-panel.js's own
      // `.v2-panel__callout`/`.v2-panel__callout-head` (registerSection
      // renders inline into that file's own markup) — only the grid/thumb
      // styling below is still this file's own.
      '.v2-media__grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(96px, 1fr)); gap: var(--v2-space-2, 8px); }',
      '.v2-media__thumb { display: block; text-decoration: none; color: inherit; border: 1px solid var(--v2-hairline, rgba(128,128,128,.3)); border-radius: var(--v2-radius, 6px); overflow: hidden; background: var(--v2-bg, rgba(128,128,128,.06)); }',
      '.v2-media__thumb img { display: block; width: 100%; height: 64px; object-fit: cover; background: rgba(128,128,128,.15); }',
      '.v2-media__cap { display: block; font-size: 10.5px; color: var(--v2-muted, #999); padding: var(--v2-space-1, 4px) var(--v2-space-1, 4px); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }',
      '.v2-media__history { margin-top: var(--v2-space-3, 12px); }',
      '.v2-media__history summary { cursor: pointer; font-size: 11.5px; color: var(--v2-muted, #999); margin-bottom: var(--v2-space-2, 8px); }',
      '.v2-media__grid--history .v2-media__thumb { opacity: .7; }',
      '@media (max-width: 480px) { .v2-media__grid { grid-template-columns: repeat(auto-fill, minmax(76px, 1fr)); } .v2-media__thumb img { height: 52px; } }'
    ].join('\n');
    document.head.appendChild(style);
  }
})();

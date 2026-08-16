// v2/media.js — t-67 (goal: t-53). Owns nothing but its own injected DOM;
// touches no other file. Builds t-53's bar-mandated MEDIA section: the
// mission's current-round visual evidence inside the peek panel (t-64),
// clearly separated from stale older-round history, re-rendering live as
// the loop turns — "evidence parity: what the boss sees is always the
// round being judged."
//
// COORDINATION GAP, logged here per this mission's own instruction rather
// than by editing peek-panel.js: t-64's peek-panel.js does not (yet)
// expose a documented extension point (e.g. a
// `window.BureauV2.peekPanel.registerSection(name, renderFn)` hook). Its
// own header comment documents two narrower, purpose-built extension
// points (data-item-index for t-65, the 'v2:goal-progress:open' event for
// t-70) but nothing generic for "add a section to the panel body." Rather
// than touch peek-panel.js myself (explicitly out of scope per this
// mission's body) or block on a hook that doesn't exist yet, this module
// treats #v2-peek-panel as an append target it can safely add a trailing
// child to, and re-asserts that child via a MutationObserver every time
// peek-panel.js replaces `panel.innerHTML` wholesale (its own render()
// does a full string replace on every open — confirmed by reading the
// file directly, not assumed). This is deliberately observer-based, not
// event-order-based: media.js's own <script> tag loads before
// peek-panel.js's in t-62's fixed module order, so if this module instead
// raced peek-panel.js on the same 'v2:mission:open' event, it would render
// first and immediately get wiped out by peek-panel's own innerHTML
// replace. Observing the DOM mutation itself sidesteps that ordering
// hazard entirely and stays correct even if peek-panel.js's internals
// change later.
//
// Known follow-on for whoever next owns peek-panel.js: its own
// renderArtifacts() already inline-figures every image artifact,
// undifferentiated by round — this module's curated, round-aware MEDIA
// section is additive on top of that, not a replacement (this mission's
// scope is media.js only), so a mission carrying real evidence currently
// shows its images twice: once flat in the existing artifact list, once
// curated here. Flagging plainly rather than quietly living with a
// visual duplication a reader might mistake for a bug in this file.
(function () {
  'use strict';

  function ready(cb) {
    if (window.BureauV2) return cb();
    document.addEventListener('DOMContentLoaded', function poll() {
      if (window.BureauV2) cb(); else setTimeout(poll, 50);
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
    injectStyle();

    var esc = function (s) {
      return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; });
    };

    var currentId = null;
    var currentArtifacts = null; // null = not yet fetched for currentId
    var renderedFor = null;

    // Re-assert the MEDIA section every time peek-panel.js swaps
    // panel.innerHTML (its render() and the "Loading…" placeholder both
    // count as childList mutations).
    var mo = new MutationObserver(function () { tryRender(); });
    mo.observe(panel, { childList: true });

    V2.on('v2:mission:open', function (detail) {
      if (!detail || !detail.id) return;
      currentId = detail.id;
      currentArtifacts = null;
      renderedFor = null;
      V2.api('/api/tasks/' + detail.id).then(function (r) {
        if (!r || !r.task || currentId !== detail.id) return; // superseded by a newer open
        currentArtifacts = r.task.artifacts || [];
        tryRender();
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
        renderedFor = null; // force a re-render even though the panel's own DOM may not have changed
        tryRender();
      });
    });

    function tryRender() {
      if (panel.hidden) return;
      if (!panel.querySelector('.v2-panel__title')) return; // peek-panel still showing "Loading…"
      if (!currentId || currentArtifacts === null) return; // our own fetch hasn't resolved yet
      if (renderedFor === currentId && panel.querySelector('#v2-media-section')) return;
      renderSection(currentId, currentArtifacts);
      renderedFor = currentId;
    }

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

    function renderSection(id, artifacts) {
      var old = panel.querySelector('#v2-media-section');
      if (old) old.remove();

      var groups = classify(artifacts);
      var section = document.createElement('div');
      section.id = 'v2-media-section';
      section.className = 'v2-media';

      if (!groups) {
        section.innerHTML = '<div class="v2-media__head">📷 Media</div><div class="v2-empty">No visual evidence attached yet.</div>';
        panel.appendChild(section);
        return;
      }

      var html = '<div class="v2-media__head">📷 Media <span class="v2-media__count">' + groups.current.length + '</span></div>';
      html += groups.current.length
        ? '<div class="v2-media__grid">' + groups.current.map(thumb).join('') + '</div>'
        : '<div class="v2-empty">No current-round evidence — only older history below.</div>';

      if (groups.history.length) {
        html += '<details class="v2-media__history">' +
          '<summary>History (' + groups.history.length + ' older)</summary>' +
          '<div class="v2-media__grid v2-media__grid--history">' + groups.history.map(thumb).join('') + '</div>' +
          '</details>';
      }

      section.innerHTML = html;
      panel.appendChild(section);
    }
  }

  function injectStyle() {
    if (document.getElementById('v2-media-style')) return;
    var style = document.createElement('style');
    style.id = 'v2-media-style';
    style.textContent = [
      '.v2-media { margin-top: var(--v2-space-4, 16px); padding-top: var(--v2-space-3, 12px); border-top: 1px solid var(--v2-hairline, rgba(128,128,128,.2)); }',
      '.v2-media__head { font-size: 12px; font-weight: 600; color: var(--v2-ink-2, #888); margin-bottom: var(--v2-space-2, 8px); display: flex; align-items: center; gap: var(--v2-space-1, 4px); }',
      '.v2-media__count { font-variant-numeric: tabular-nums; color: var(--v2-muted, #999); font-weight: 400; }',
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

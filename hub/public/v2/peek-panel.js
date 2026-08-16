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
(function () {
  'use strict';

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

    function closePanel() { panel.hidden = true; currentId = null; }

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

      panel.innerHTML =
        '<button type="button" class="v2-panel__close" id="v2-pp-close" aria-label="Close">✕</button>' +
        '<h3 class="v2-panel__title">' + (isGoal ? '🎯 ' : '') + esc(t.title) + '</h3>' +
        '<div class="v2-panel__meta">' + esc(t.id) + ' · ' + esc(t.status) + ' · P' + t.priority +
        (t.assignee ? ' · ' + esc(t.assignee) : '') +
        (t.project ? ' · ' + esc(projLabel(state, t.project)) : '') +
        (t.gate === 'critic' ? ' · 🧪 critic gate' : '') +
        (t.lease_until ? ' · lease until ' + esc(t.lease_until.slice(11, 16)) : '') +
        '</div>' +
        (goalKids ? '<div class="v2-panel__meta">' + goalKids.done + '/' + goalKids.total + ' child missions done ' +
          '<button type="button" class="v2-panel__link-btn" id="v2-pp-goal-progress">Open goal/cycle progress →</button></div>' : '') +
        (replacementId ? '<div class="v2-panel__meta">🗄 discarded · ' +
          '<button type="button" class="v2-panel__link-btn" id="v2-pp-replacement">Replaced by ' + esc(replacementId) + ' →</button></div>' : '') +
        (t.body ? '<div class="v2-panel__body">' + esc(t.body) + '</div>' : '') +
        items +
        renderArtifacts(t) +
        '<div class="v2-panel__log">' + renderLog(t) + '</div>' +
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
      '.v2-panel__close { position: absolute; top: var(--v2-space-3, 12px); right: var(--v2-space-3, 12px); border: none; background: transparent; color: var(--v2-ink-2, #888); font-size: 16px; cursor: pointer; }',
      '.v2-panel__title { margin: 0 var(--v2-space-5, 24px) var(--v2-space-1, 4px) 0; font-size: 15px; }',
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
      '.v2-panel__log { margin-top: var(--v2-space-2, 8px); }',
      '.v2-panel__actions { display: flex; gap: var(--v2-space-2, 8px); margin-top: var(--v2-space-3, 12px); }',
      '.v2-panel__note { flex: 1; font: inherit; padding: var(--v2-space-2, 8px); border: 1px solid var(--v2-hairline, rgba(128,128,128,.3)); border-radius: var(--v2-radius, 6px); background: var(--v2-bg, transparent); color: var(--v2-ink, inherit); }',
      '.v2-panel__btn { font: inherit; font-weight: 600; padding: var(--v2-space-2, 8px) var(--v2-space-3, 12px); border: none; border-radius: var(--v2-radius, 6px); background: var(--v2-accent, #3f6fe0); color: var(--v2-on-accent, #fff); cursor: pointer; }',
      '.v2-panel__btn--ghost { background: transparent; color: var(--v2-ink, inherit); border: 1px solid var(--v2-hairline, rgba(128,128,128,.3)); }',
      '.v2-panel__err { color: var(--v2-critical, #c23434); font-size: 12px; margin: var(--v2-space-1, 4px) 0 0; }'
    ].join('\n');
    document.head.appendChild(style);
  }
})();

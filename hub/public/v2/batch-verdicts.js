// v2/batch-verdicts.js — t-69 (goal: t-53), t-55 item i3.
// Owns #v2-batch-bar only. Listens to board.js's 'v2:batch:selection'
// {ids} and applies one verdict (approve / send back) to every selected
// review mission in a client-side PATCH loop — the SAME per-mission call
// the peek panel already uses, no new hub endpoint.
//
// Also covers the mission's other named context — "several items inside
// one open mission" — by watching #v2-peek-panel for its item rows
// (peek-panel.js owns that file; this module never edits it, only reads
// its already-stable markup: `.v2-panel__item[data-item-id]`) and adding
// its own checkbox + inline batch-apply control alongside them.
//
// Composes existing primitives only: every color/spacing/type value below
// reads var(--v2-...) with the same neutral inline fallback pattern
// board.js/peek-panel.js already use (tokens.css/t-63 repaints them; the
// real visual language is components.css/t-66's, once a sibling module
// wires these markup shapes into those classes — this file does not
// invent its own look).
//
// Eligibility (mandatory per t-55 i3's cost analysis — "the real risk is
// rubber-stamping"): a mission is INELIGIBLE for batch and forces
// one-at-a-time handling when either is true —
//   - "unread items": it carries itemized-review items (task.items) with
//     any item still verdict:"proposed" — those need individual judgment,
//     a blanket mission-level verdict would blow past them unseen.
//   - "critic flag": task.gate === "critic" — the same signal board.js
//     already surfaces per-card (🧪 critic vs 👤 boss); critic-gate
//     missions have already been through independent review-loop scrutiny
//     the boss hasn't personally read yet, so they stay one-at-a-time by
//     default rather than folding into a blanket sweep.
// Both checks run against the LIVE task record at confirm time, not a
// snapshot taken when the checkbox was ticked — a mission that flips into
// either condition after selection drops out of the batch automatically.
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
    var bar = V2.mounts.batchBar;
    if (!bar) return; // shell contract missing; nothing to do

    injectStyle();

    var esc = function (s) {
      return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; });
    };

    // ---- board-level batch (the acceptance-tested path) ------------------
    var selection = []; // ids, as last reported by board.js
    var confirmOpen = false;
    var busy = false;

    V2.on('v2:batch:selection', function (detail) {
      selection = (detail && detail.ids) || [];
      confirmOpen = false;
      renderBar();
    });
    V2.on('v2:state', function () { if (selection.length) renderBar(); });

    function taskById(id) {
      var tasks = (V2.state && V2.state.tasks) || [];
      for (var i = 0; i < tasks.length; i++) if (tasks[i].id === id) return tasks[i];
      return null;
    }
    function ineligibleReason(t) {
      if (!t) return 'no longer on the board';
      if (t.status !== 'review') return 'left the review column';
      if (t.gate === 'critic') return 'critic gate';
      if (Array.isArray(t.items) && t.items.some(function (it) { return it.verdict === 'proposed'; })) return 'has unread items';
      return null;
    }

    function renderBar() {
      if (!selection.length) { bar.hidden = true; bar.innerHTML = ''; return; }
      bar.hidden = false;
      var rows = selection.map(function (id) { return { id: id, t: taskById(id), reason: ineligibleReason(taskById(id)) }; });
      var eligible = rows.filter(function (r) { return !r.reason; });
      var ineligible = rows.filter(function (r) { return r.reason; });

      if (!confirmOpen) {
        var blocked = ineligible.length
          ? '<span class="v2-batch-bar__blocked">' + ineligible.length + ' need individual review (' +
            ineligible.slice(0, 3).map(function (r) { return esc(r.id) + ': ' + esc(r.reason); }).join(', ') +
            (ineligible.length > 3 ? '…' : '') + ')</span>'
          : '';
        var canBatch = eligible.length >= 2 && ineligible.length === 0;
        bar.innerHTML =
          '<span class="v2-batch-bar__count">' + selection.length + ' selected</span>' +
          blocked +
          (canBatch
            ? '<button type="button" class="v2-batch-bar__btn" id="v2-batch-review">Review &amp; apply →</button>'
            : (eligible.length === 1 && !ineligible.length ? '<span class="v2-batch-bar__hint">select one more to batch</span>' : '')) +
          '<button type="button" class="v2-batch-bar__btn v2-batch-bar__btn--ghost" id="v2-batch-dismiss">Dismiss</button>';
        var reviewBtn = document.getElementById('v2-batch-review');
        if (reviewBtn) reviewBtn.addEventListener('click', function () { confirmOpen = true; renderBar(); });
        document.getElementById('v2-batch-dismiss').addEventListener('click', function () { selection = []; renderBar(); });
        return;
      }

      // ---- mandatory review-before-confirm list: titles, not just a count,
      // gated by a tap-friendly checkbox (phone-usable, no keyboard needed) --
      var list = eligible.map(function (r) {
        return '<li class="v2-batch-confirm__item">' + esc(r.id) + ' · ' + esc(r.t.title) + '</li>';
      }).join('');
      bar.innerHTML =
        '<div class="v2-batch-confirm">' +
        '<div class="v2-batch-confirm__title">Apply one verdict to ' + eligible.length + ' missions</div>' +
        '<ul class="v2-batch-confirm__list">' + list + '</ul>' +
        '<label class="v2-batch-confirm__ack"><input type="checkbox" id="v2-batch-ack"> I’ve reviewed these ' + eligible.length + ' titles</label>' +
        '<input class="v2-batch-confirm__note" id="v2-batch-note" placeholder="Note (optional on approve, required to send back)">' +
        '<p class="v2-batch-confirm__err" id="v2-batch-err" hidden></p>' +
        '<div class="v2-batch-confirm__actions">' +
        '<button type="button" class="v2-batch-bar__btn" id="v2-batch-approve" disabled>✅ Approve all</button>' +
        '<button type="button" class="v2-batch-bar__btn v2-batch-bar__btn--ghost" id="v2-batch-sendback" disabled>↩️ Send back all</button>' +
        '<button type="button" class="v2-batch-bar__btn v2-batch-bar__btn--ghost" id="v2-batch-cancel">Cancel</button>' +
        '</div></div>';

      var ack = document.getElementById('v2-batch-ack');
      var approveBtn = document.getElementById('v2-batch-approve');
      var sendbackBtn = document.getElementById('v2-batch-sendback');
      ack.addEventListener('change', function () {
        approveBtn.disabled = !ack.checked || busy;
        sendbackBtn.disabled = !ack.checked || busy;
      });
      document.getElementById('v2-batch-cancel').addEventListener('click', function () { confirmOpen = false; renderBar(); });
      approveBtn.addEventListener('click', function () { applyBatch(eligible.map(function (r) { return r.id; }), 'done', false); });
      sendbackBtn.addEventListener('click', function () { applyBatch(eligible.map(function (r) { return r.id; }), 'queued', true); });
    }

    function applyBatch(ids, status, requireNote) {
      if (busy) return;
      var noteEl = document.getElementById('v2-batch-note');
      var note = noteEl ? noteEl.value.trim() : '';
      if (requireNote && !note) {
        var err = document.getElementById('v2-batch-err');
        if (err) { err.textContent = 'A note is required so every agent knows what to change.'; err.hidden = false; }
        return;
      }
      busy = true;
      renderBusy();
      var results = { ok: 0, fail: 0 };
      var calls = ids.map(function (id) {
        return V2.api('/api/tasks/' + id, {
          method: 'PATCH',
          body: JSON.stringify({ agent: 'human', status: status, note: note || (status === 'done' ? 'approved (batch)' : '') })
        }).then(function (r) {
          if (r && r.error) results.fail++; else results.ok++;
        }).catch(function () { results.fail++; });
      });
      Promise.all(calls).then(function () {
        busy = false;
        toast(results.fail
          ? results.ok + ' applied, ' + results.fail + ' failed — check those individually'
          : status + ': applied to ' + results.ok + ' missions');
        selection = [];
        confirmOpen = false;
        V2.refresh();
        renderBar();
      });
    }

    function renderBusy() {
      ['v2-batch-approve', 'v2-batch-sendback', 'v2-batch-cancel'].forEach(function (id) {
        var el = document.getElementById(id);
        if (el) el.disabled = true;
      });
    }

    function toast(msg) {
      var toasts = V2.mounts.toasts;
      if (!toasts) return;
      var el = document.createElement('div');
      el.className = 'v2-toast';
      el.textContent = msg;
      toasts.appendChild(el);
      setTimeout(function () { el.remove(); }, 4000);
    }

    // ---- item-level batch: "several items inside one open mission" ------
    // peek-panel.js re-renders #v2-peek-panel wholesale (panel.innerHTML =
    // ...) on every open and on every verdict submit; a MutationObserver on
    // that mount is the only way to react without touching that file, per
    // the bus/mounts contract ("never reach into another module's DOM").
    // Checkboxes are added ALONGSIDE peek-panel's own per-item radios —
    // this module never removes or replaces that markup, only augments it.
    var panel = V2.mounts.peekPanel;
    if (panel) {
      var itemSelection = new Set();
      // peek-panel.js replaces panel.innerHTML wholesale on every open/
      // re-render — a real childList mutation this module needs to react
      // to (fresh item rows, reset selection). But THIS module's own writes
      // (injecting checkboxes, inserting/removing the item batch bar) are
      // ALSO childList mutations on the same node, which would otherwise
      // re-trigger the same handler and immediately wipe out what was just
      // rendered. Pause observation around every self-inflicted write so
      // only peek-panel.js's own re-renders are treated as "the panel
      // changed under us".
      var obs = new MutationObserver(function () { syncItemCheckboxes(); });
      function withObserverPaused(fn) {
        obs.disconnect();
        fn();
        obs.observe(panel, { childList: true, subtree: false });
      }
      obs.observe(panel, { childList: true, subtree: false });

      function syncItemCheckboxes() {
        withObserverPaused(function () {
          itemSelection.clear();
          removeItemBarRaw();
          var rows = panel.querySelectorAll('.v2-panel__item[data-item-id]');
          rows.forEach(function (row) {
            if (row.querySelector('.v2-batch-item-select')) return; // already wired this render
            var cb = document.createElement('input');
            cb.type = 'checkbox';
            cb.className = 'v2-batch-item-select';
            cb.setAttribute('aria-label', 'Select ' + row.getAttribute('data-item-id') + ' for batch verdict');
            cb.addEventListener('change', function () {
              var iid = row.getAttribute('data-item-id');
              if (cb.checked) itemSelection.add(iid); else itemSelection.delete(iid);
              renderItemBar();
            });
            row.insertBefore(cb, row.firstChild);
          });
        });
      }

      function removeItemBarRaw() {
        var existing = panel.querySelector('.v2-batch-item-bar');
        if (existing) existing.remove();
      }

      function renderItemBar() {
        withObserverPaused(function () { renderItemBarRaw(); });
      }

      function renderItemBarRaw() {
        removeItemBarRaw();
        if (itemSelection.size < 2) return;
        var missionId = null;
        var missionIdMatch = panel.querySelector('.v2-panel__meta');
        if (missionIdMatch) missionId = (missionIdMatch.textContent || '').split(' ')[0];
        var el = document.createElement('div');
        el.className = 'v2-batch-item-bar';
        el.innerHTML =
          '<span class="v2-batch-bar__count">' + itemSelection.size + ' items selected</span>' +
          '<label class="v2-batch-confirm__ack"><input type="checkbox" id="v2-batch-item-ack"> I’ve reviewed these ' + itemSelection.size + ' items</label>' +
          '<button type="button" class="v2-batch-bar__btn" id="v2-batch-item-approve" disabled>✅ Accept all</button>' +
          '<button type="button" class="v2-batch-bar__btn v2-batch-bar__btn--ghost" id="v2-batch-item-reject" disabled>✖ Reject all</button>';
        // Anchor at the end of the item list, inline in the panel — never a
        // modal/overlay, matches the mission's own phone-usable requirement.
        var lastItem = panel.querySelectorAll('.v2-panel__item[data-item-id]');
        var anchor = lastItem.length ? lastItem[lastItem.length - 1] : panel.firstChild;
        anchor.parentNode.insertBefore(el, anchor.nextSibling);

        var ack = document.getElementById('v2-batch-item-ack');
        var acceptBtn = document.getElementById('v2-batch-item-approve');
        var rejectBtn = document.getElementById('v2-batch-item-reject');
        ack.addEventListener('change', function () { acceptBtn.disabled = rejectBtn.disabled = !ack.checked; });
        acceptBtn.addEventListener('click', function () { applyItemBatch(missionId, 'approved'); });
        rejectBtn.addEventListener('click', function () { applyItemBatch(missionId, 'rejected'); });
      }

      function applyItemBatch(missionId, verdict) {
        if (!missionId) return;
        var verdicts = Array.from(itemSelection).map(function (id) { return { id: id, verdict: verdict }; });
        V2.api('/api/tasks/' + missionId, {
          method: 'PATCH',
          body: JSON.stringify({ agent: 'human', verdicts: verdicts })
        }).then(function (r) {
          if (r && r.error) { toast(r.error); return; }
          toast(verdict + ': applied to ' + verdicts.length + ' items');
          itemSelection.clear();
          V2.emit('v2:mission:open', { id: missionId }); // re-open to reflect the new verdicts
        });
      }
    }
  }

  function injectStyle() {
    if (document.getElementById('v2-batch-verdicts-style')) return;
    var style = document.createElement('style');
    style.id = 'v2-batch-verdicts-style';
    style.textContent = [
      '.v2-batch-bar__count { font-weight: 600; font-variant-numeric: tabular-nums; }',
      '.v2-batch-bar__blocked { color: var(--v2-warning, #f2b40e); font-size: 11.5px; }',
      '.v2-batch-bar__hint { color: var(--v2-muted, #999); font-size: 11.5px; }',
      '.v2-batch-bar__btn { font: inherit; font-weight: 600; padding: var(--v2-space-1, 4px) var(--v2-space-3, 12px); border: none; border-radius: var(--v2-radius, 6px); background: var(--v2-accent, #3f6fe0); color: var(--v2-on-accent, #fff); cursor: pointer; }',
      '.v2-batch-bar__btn:disabled { opacity: .5; cursor: not-allowed; }',
      '.v2-batch-bar__btn--ghost { background: transparent; color: inherit; border: 1px solid rgba(255,255,255,.35); }',
      '.v2-batch-confirm { display: flex; flex-direction: column; gap: var(--v2-space-2, 8px); min-width: 260px; max-width: min(420px, 90vw); }',
      '.v2-batch-confirm__title { font-weight: 600; }',
      '.v2-batch-confirm__list { margin: 0; padding-left: 1.1em; max-height: 140px; overflow-y: auto; font-size: 12px; }',
      '.v2-batch-confirm__item { padding: 2px 0; }',
      '.v2-batch-confirm__ack { display: flex; align-items: center; gap: var(--v2-space-2, 8px); font-size: 12.5px; }',
      '.v2-batch-confirm__ack input { width: 18px; height: 18px; }', // tap target, phone-usable
      '.v2-batch-confirm__note { font: inherit; padding: var(--v2-space-2, 8px); border: 1px solid rgba(255,255,255,.3); border-radius: var(--v2-radius, 6px); background: transparent; color: inherit; }',
      '.v2-batch-confirm__err { color: var(--v2-critical, #f16565); font-size: 12px; margin: 0; }',
      '.v2-batch-confirm__actions { display: flex; gap: var(--v2-space-2, 8px); flex-wrap: wrap; }',
      '.v2-batch-item-bar { display: flex; align-items: center; gap: var(--v2-space-2, 8px); flex-wrap: wrap; padding: var(--v2-space-2, 8px); margin: var(--v2-space-2, 8px) 0; border: 1px solid var(--v2-hairline, rgba(128,128,128,.3)); border-radius: var(--v2-radius, 6px); background: var(--v2-surface, transparent); }',
      '.v2-panel__item { position: relative; }',
      '.v2-batch-item-select { width: 18px; height: 18px; float: right; margin-left: var(--v2-space-2, 8px); }' // tap target, phone-usable
    ].join('\n');
    document.head.appendChild(style);
  }
})();

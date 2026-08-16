// v2/board.js — t-64 (goal: t-53). Owns #v2-agents-rail, #v2-projects-rail
// and #v2-board. Reads window.BureauV2 (contract: v2.html top comment,
// section 2) exclusively — no own SSE/fetch-auth plumbing.
//
// Ports every i11-baseline function living in this surface:
//   - live agent cards
//   - project list (read-only here: label/entity/repo/capacity/counts +
//     click-to-filter; INLINE EDITING belongs to project-edit.js, i10 —
//     out of scope for this file, see t-64's body)
//   - board columns from live task data
//   - a minimal title-only quick-add (project + priority), the "today's
//     function" baseline — the richer goal form (destination + bar +
//     reference uploads) is NOT ported here; it needs a home in
//     quick-add.js/templates.js (t-72, i6). Flagged in the mission log.
// Plus the one approved visual change, i9: claimed + in_progress render
// as a single merged "Working" column.
// Plus the origin of i3 (batch verdicts): a checkbox per review-column
// card, selection broadcast on 'v2:batch:selection' for batch-verdicts.js
// (t-69) to consume — this file does not apply verdicts itself.
//
// Emits (see v2.html contract for the full list this file participates in):
//   'v2:mission:open'      { id }   — any board card, single source for
//                                     "open detail" across the whole app.
//   'v2:batch:selection'   { ids }  — every time the review-column
//                                     checkbox selection changes.
//
// No modals, no prompt()/confirm()/alert() — validation and errors render
// inline. No hardcoded hex colors: every visual value reads var(--v2-...)
// (declared as placeholders in v2.html §5; tokens.css/t-63 repaints them).
(function () {
  'use strict';

  function ready(cb) {
    if (window.BureauV2 && window.BureauV2.state) return cb();
    var off = window.BureauV2 ? window.BureauV2.on('v2:ready', function () { off(); cb(); }) : null;
    if (!window.BureauV2) {
      // v2.html hasn't finished booting (still at the token gate) — wait for it.
      document.addEventListener('DOMContentLoaded', function poll() {
        if (window.BureauV2) { ready(cb); } else { setTimeout(poll, 50); }
      });
    }
  }

  ready(init);

  function init() {
    var V2 = window.BureauV2;
    var mounts = V2.mounts;
    if (!mounts.agentsRail || !mounts.projectsRail || !mounts.board) return; // shell contract missing; nothing to do

    injectStyle();

    var projectFilter = null;
    var selectedReviewIds = new Set();
    var archiveOpen = false; // t-110: off by default — discarded stays out of the six live columns until toggled

    // ---- board toolbar: quick-add trigger + active-filter chip (built once) ----
    mounts.board.innerHTML =
      '<div class="v2-board__toolbar">' +
      '<button type="button" class="v2-board__quickadd-btn" id="v2-qa-trigger">+ Quick add</button>' +
      // t-110: discarded (fixtures/duplicates/re-scope tombstones, per
      // protocol.md's terminal-status doctrine) never renders in the six
      // live columns — but the count stays visible here even while the
      // toggle is off, so the number itself is never hidden, only the
      // list. Phone-usable: same tap-target treatment as the quick-add
      // button next to it, no hover-only affordance.
      '<button type="button" class="v2-board__archive-toggle" id="v2-archive-toggle" aria-pressed="false">🗄 <span id="v2-archive-count">0</span> archived</button>' +
      '<span class="v2-board__filter-chip" id="v2-board-filter-chip" hidden></span>' +
      '</div>' +
      '<form class="v2-quickadd" id="v2-quickadd-form" hidden>' +
      '<input class="v2-quickadd__title" id="v2-qa-title" placeholder="New mission for the team…" required>' +
      '<select class="v2-quickadd__project" id="v2-qa-project"></select>' +
      '<select class="v2-quickadd__prio" id="v2-qa-prio"><option value="1">P1</option><option value="2">P2</option><option value="3" selected>P3</option></select>' +
      '<button type="submit" class="v2-quickadd__submit">Add</button>' +
      '<p class="v2-quickadd__err" id="v2-qa-err" hidden></p>' +
      '</form>' +
      '<div class="v2-board__columns" id="v2-board-columns"></div>';

    var columnsEl = document.getElementById('v2-board-columns');
    var qaTrigger = document.getElementById('v2-qa-trigger');
    var qaForm = document.getElementById('v2-quickadd-form');
    var qaTitle = document.getElementById('v2-qa-title');
    var qaProject = document.getElementById('v2-qa-project');
    var qaPrio = document.getElementById('v2-qa-prio');
    var qaErr = document.getElementById('v2-qa-err');
    var filterChip = document.getElementById('v2-board-filter-chip');
    var archiveToggle = document.getElementById('v2-archive-toggle');
    var archiveCountEl = document.getElementById('v2-archive-count');

    qaTrigger.addEventListener('click', function () {
      qaForm.hidden = !qaForm.hidden;
      if (!qaForm.hidden) qaTitle.focus();
    });
    archiveToggle.addEventListener('click', function () {
      archiveOpen = !archiveOpen;
      archiveToggle.setAttribute('aria-pressed', String(archiveOpen));
      render();
    });
    qaForm.addEventListener('submit', function (e) {
      e.preventDefault();
      var title = qaTitle.value.trim();
      qaErr.hidden = true;
      if (!title) { qaErr.textContent = 'A mission needs a title.'; qaErr.hidden = false; return; }
      var project = qaProject.value || 'general';
      V2.api('/api/tasks', {
        method: 'POST',
        body: JSON.stringify({ title: title, project: project, priority: +qaPrio.value, created_by: 'human' })
      }).then(function (r) {
        if (r && r.error) { qaErr.textContent = r.error; qaErr.hidden = false; return; }
        qaTitle.value = '';
        qaForm.hidden = true;
        V2.refresh();
      });
    });

    function projLabel(state, id) {
      var p = (state.projects || []).find(function (pj) { return (typeof pj === 'string' ? pj : pj.id) === id; });
      if (!p) return id;
      return typeof p === 'string' ? p : (p.label || id);
    }

    function agentStatus(a) {
      var mins = (Date.now() - new Date(a.last_seen)) / 60000;
      return mins < 5 ? 'active' : mins < 60 ? 'idle' : 'offline';
    }
    function ago(iso) {
      var s = (Date.now() - new Date(iso)) / 1000;
      return s < 60 ? Math.floor(s) + 's' : s < 3600 ? Math.floor(s / 60) + 'm' : s < 86400 ? Math.floor(s / 3600) + 'h' : Math.floor(s / 86400) + 'd';
    }
    var esc = window.BureauV2Esc || function (s) {
      return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; });
    };

    function renderAgents(state) {
      var agents = state.agents || [];
      mounts.agentsRail.querySelector('.v2-region-title') && null; // title stays static markup in v2.html
      var body = agents.length ? agents.map(function (a) {
        var st = agentStatus(a);
        // Sub-agent fleet (t-109, goal: t-60; ports t-80's already-verified
        // index.html pattern onto this rail). Live only, per the same rule
        // t-80 shipped — a stale fleet reads as a lie, so it's gated on the
        // SAME `active` status (heartbeat <5min) the roster badge already
        // uses, and disappears entirely the moment the parent goes
        // idle/offline, same v2:state re-render, no separate liveness check.
        var fleet = st === 'active' && Array.isArray(a.sub_agents) ? a.sub_agents : [];
        var fleetBadge = fleet.length ? ' <span class="v2-badge v2-badge--fleet">🧵 ' + fleet.length + '</span>' : '';
        var fleetFoldout = fleet.length
          ? '<details class="v2-fleet"><summary>' + fleet.length + ' sub-agent' + (fleet.length === 1 ? '' : 's') + '</summary>' +
            fleet.map(function (s) { return '<div class="v2-fleet__subagent">' + esc(s.label) + (s.activity ? ' · ' + esc(s.activity) : '') + '</div>'; }).join('') +
            '</details>'
          : '';
        return '<div class="v2-agent-card">' +
          '<div class="v2-agent-card__name">' + esc(a.name) + '<span class="v2-badge v2-badge--' + st + '"><span class="v2-badge__dot"></span>' + st + '</span>' + fleetBadge + '</div>' +
          '<div class="v2-agent-card__meta">' + esc(a.kind) + (a.activity ? ' · ' + esc(a.activity) : '') + ' · seen ' + ago(a.last_seen) + ' ago' + (a.note ? ' · ' + esc(a.note) : '') + '</div>' +
          fleetFoldout +
          '</div>';
      }).join('') : '<div class="v2-empty">No agents yet.</div>';
      setRegionBody(mounts.agentsRail, body);
    }

    function renderProjects(state) {
      // t-86: an in-progress inline edit (project-edit.js) lives entirely
      // inside a row this function is about to innerHTML-replace. Rather
      // than diff-patch the list (a bigger change than this mission's own
      // narrow scope calls for), skip the WHOLE rebuild for one cycle
      // whenever any row is mid-edit — project-edit.js marks its row
      // data-editing="true" for exactly this check, and clears it on
      // confirm/cancel. The next v2:state event after the edit ends
      // rebuilds normally and picks up the fresh value. This is the fix
      // for the root cause t-74 hit: any unrelated v2:state refresh
      // (another agent's heartbeat, a message, a task update) used to
      // wipe an in-progress prompt()-free edit mid-keystroke.
      if (mounts.projectsRail.querySelector('[data-editing="true"]')) return;

      var byProj = {};
      (state.projects || []).forEach(function (pj) {
        var id = typeof pj === 'string' ? pj : pj && pj.id;
        if (id) byProj[id] = { queued: 0, active: 0, review: 0, closed: 0, meta: (typeof pj === 'object' ? pj : {}) };
      });
      (state.tasks || []).forEach(function (t) {
        var b = t.project && byProj[t.project];
        if (!b) return;
        if (t.status === 'queued') b.queued++;
        else if (t.status === 'review') b.review++;
        else if (t.status === 'done' || t.status === 'failed') b.closed++;
        else b.active++;
      });
      if (projectFilter && !byProj[projectFilter]) projectFilter = null;
      var ids = Object.keys(byProj).sort();

      // quick-add project select, kept in sync with the registry
      var keep = projectFilter || qaProject.value || 'general';
      qaProject.innerHTML = ids.map(function (id) {
        return '<option value="' + esc(id) + '"' + (id === keep ? ' selected' : '') + '>' + esc(projLabel(state, id)) + '</option>';
      }).join('');

      if (projectFilter) {
        filterChip.hidden = false;
        filterChip.innerHTML = esc(projLabel(state, projectFilter)) + ' <button type="button" class="v2-board__filter-clear" id="v2-board-filter-clear" aria-label="Clear filter">✕</button>';
        document.getElementById('v2-board-filter-clear').addEventListener('click', function () { projectFilter = null; render(); });
      } else {
        filterChip.hidden = true; filterChip.innerHTML = '';
      }

      // t-86: per-field data-field hooks for project-edit.js (i10) to bind
      // inline edit UI to, replacing prompt(). All four fields render
      // UNCONDITIONALLY now (entity/repo used to render only when already
      // set, capacity was folded into the opaque counts string, repo
      // wasn't rendered at all) — an editable field needs a stable DOM
      // node to attach to even when its value is empty. Empty entity/repo
      // render as an empty span with a data-empty="true" flag project-edit.js
      // can use for its own "empty" placeholder styling/text, since this
      // file renders no visible placeholder copy itself (out of scope —
      // board.js owns structure/hooks only, per this mission's own
      // instruction not to touch anything beyond the project-card path).
      var body = ids.length ? ids.map(function (id) {
        var b = byProj[id];
        var pj = b.meta || {};
        return '<div class="v2-project-row' + (projectFilter === id ? ' v2-project-row--active' : '') + '" data-project="' + esc(id) + '">' +
          '<span class="v2-project-row__name" data-field="label">' + esc(projLabel(state, id)) + '</span>' +
          '<span class="v2-project-row__entity" data-field="entity"' + (pj.entity ? '' : ' data-empty="true"') + ' title="entity (scope wall)">' + (pj.entity ? '@' + esc(pj.entity) : '') + '</span>' +
          '<span class="v2-project-row__repo" data-field="repo"' + (pj.repo ? '' : ' data-empty="true"') + ' title="repo (clone URL)">' + (pj.repo ? esc(pj.repo) : '') + '</span>' +
          '<span class="v2-project-row__cap" data-field="capacity" title="capacity (parallel desks)">🪑<span class="v2-project-row__cap-n">' + (pj.capacity || 1) + '</span></span>' +
          '<span class="v2-project-row__counts">' + b.queued + 'q · ' + b.active + 'w · ' + b.review + 'r · ' + b.closed + '✓</span>' +
          '</div>';
      }).join('') : '<div class="v2-empty">No projects yet.</div>';
      setRegionBody(mounts.projectsRail, body);
      mounts.projectsRail.querySelectorAll('.v2-project-row').forEach(function (row) {
        row.addEventListener('click', function () {
          var id = row.getAttribute('data-project');
          projectFilter = (projectFilter !== id) ? id : null;
          render();
        });
      });
    }

    var V2_COLS = [
      ['queued', 'Queued'],
      ['working', 'Working'],
      ['blocked', '⏸ Blocked'],
      ['review', '👀 Review'],
      ['done', '✅ Done'],
      ['failed', '❌ Failed']
    ];
    function statusOf(col, t) { return col === 'working' ? (t.status === 'claimed' || t.status === 'in_progress') : t.status === col; }

    function taskCard(t, key, goalKids) {
      var isGoal = /^goal:/i.test(t.title);
      var isDiscarded = t.status === 'discarded';
      var kids = isGoal ? goalKids[t.id] : null;
      var checkbox = key === 'review'
        ? '<input type="checkbox" class="v2-task-card__select" data-id="' + esc(t.id) + '" ' + (selectedReviewIds.has(t.id) ? 'checked' : '') + ' aria-label="Select ' + esc(t.id) + ' for batch verdict">'
        : '';
      return '<div class="v2-task-card v2-task-card--' + esc(t.status) + '" data-id="' + esc(t.id) + '">' +
        checkbox +
        '<div class="v2-task-card__body" data-open="' + esc(t.id) + '">' +
        // t-110: glyph + text, never color alone, per the Bar's own "status is
        // glyph + color" register rule — deliberately NOT relying only on the
        // border-left-color system (molecules.css/t-77 already flattens
        // .v2-task-card's border to 1px solid transparent at rest via a
        // higher-specificity doubled-class rule, so a color-only signal here
        // would be invisible in the live app for EVERY status, not just this
        // one; a glyph+label survives that regardless of border cascade).
        '<div class="v2-task-card__title">' + (isGoal ? '🎯 ' : '') + (isDiscarded ? '🗄 ' : '') + esc(t.title) + '</div>' +
        '<div class="v2-task-card__meta">' + (isDiscarded ? '🗄 archived · ' : '') + esc(t.id) + ' · P' + t.priority +
        (t.assignee ? ' · ' + esc(t.assignee) : '') +
        (t.project ? ' · ' + esc(t.project) : '') +
        (kids ? ' · ' + kids.done + '/' + kids.total + ' missions' : '') +
        (t.reserved_for ? ' · 🔒 ' + esc(t.reserved_for) : '') +
        (t.status === 'review' ? (t.gate === 'critic' ? ' · 🧪 critic' : ' · 👤 boss') : '') +
        '</div></div></div>';
    }

    function renderBoard(state) {
      var all = state.tasks || [];
      var visible = projectFilter ? all.filter(function (t) { return t.project === projectFilter; }) : all;
      var goalKids = {};
      all.forEach(function (t) {
        var m = /goal:\s*(t-\d+)/.exec(t.body || '');
        if (m) { var g = goalKids[m[1]] = goalKids[m[1]] || { done: 0, total: 0 }; g.total++; if (t.status === 'done') g.done++; }
      });
      columnsEl.innerHTML = V2_COLS.map(function (col) {
        var key = col[0], label = col[1];
        var ts = visible.filter(function (t) { return statusOf(key, t); })
          .sort(function (a, b) { return a.priority - b.priority || b.created_at.localeCompare(a.created_at); });
        var shown = key === 'done' ? ts.slice(0, 8) : ts;
        var cards = shown.map(function (t) { return taskCard(t, key, goalKids); }).join('');
        return '<div class="v2-board__column"><h3 class="v2-board__column-title">' + esc(label) + ' · ' + ts.length + '</h3>' + (cards || '<div class="v2-empty">Nothing here.</div>') + '</div>';
      }).join('');

      // t-110: discarded (fixtures, duplicates, re-scope tombstones — protocol.md's
      // terminal-status doctrine) never occupies one of the six live columns above,
      // matching current daily-view behavior. Its count stays visible on the toggle
      // itself regardless of toggle state (never hidden, only the list is); the list
      // renders as its own clearly-labeled strip, distinct from Failed at a glance
      // (dashed muted border via .v2-task-card--discarded, not the solid critical-red
      // Failed uses), only while the toggle is on.
      var discarded = visible.filter(function (t) { return t.status === 'discarded'; })
        .sort(function (a, b) { return b.created_at.localeCompare(a.created_at); });
      archiveCountEl.textContent = String(discarded.length);
      var archiveEl = document.getElementById('v2-board-archive');
      if (archiveEl) archiveEl.remove();
      if (archiveOpen) {
        var strip = document.createElement('div');
        strip.className = 'v2-board__archive';
        strip.id = 'v2-board-archive';
        strip.innerHTML = '<h3 class="v2-board__column-title">🗄 Archived · ' + discarded.length + '</h3>' +
          (discarded.length ? discarded.map(function (t) { return taskCard(t, 'discarded', goalKids); }).join('') : '<div class="v2-empty">Nothing archived.</div>');
        columnsEl.parentNode.insertBefore(strip, columnsEl.nextSibling);
      }

      var openTargets = columnsEl.querySelectorAll('[data-open]');
      var archiveEl2 = document.getElementById('v2-board-archive');
      if (archiveEl2) openTargets = Array.prototype.concat.call(Array.prototype.slice.call(openTargets), Array.prototype.slice.call(archiveEl2.querySelectorAll('[data-open]')));
      Array.prototype.forEach.call(openTargets, function (el) {
        el.addEventListener('click', function () { V2.emit('v2:mission:open', { id: el.getAttribute('data-open') }); });
      });
      columnsEl.querySelectorAll('.v2-task-card__select').forEach(function (cb) {
        cb.addEventListener('click', function (e) { e.stopPropagation(); });
        cb.addEventListener('change', function () {
          var id = cb.getAttribute('data-id');
          if (cb.checked) selectedReviewIds.add(id); else selectedReviewIds.delete(id);
          V2.emit('v2:batch:selection', { ids: Array.from(selectedReviewIds) });
        });
      });
    }

    function setRegionBody(mount, html) {
      var existing = mount.querySelector('.v2-region-body');
      if (existing) { existing.innerHTML = html; return; }
      var div = document.createElement('div');
      div.className = 'v2-region-body';
      div.innerHTML = html;
      mount.appendChild(div);
    }

    function render() {
      var state = V2.state;
      if (!state) return;
      renderAgents(state);
      renderProjects(state);
      renderBoard(state);
    }

    render();
    V2.on('v2:state', render);
  }

  function injectStyle() {
    if (document.getElementById('v2-board-style')) return;
    var style = document.createElement('style');
    style.id = 'v2-board-style';
    style.textContent = [
      '.v2-region-body { display: contents; }',
      '.v2-agent-card { padding: var(--v2-space-2, 8px) 0; border-bottom: 1px solid var(--v2-hairline, rgba(128,128,128,.2)); }',
      '.v2-agent-card:last-child { border-bottom: none; }',
      '.v2-agent-card__name { font-weight: 600; display: flex; align-items: center; gap: var(--v2-space-2, 8px); }',
      '.v2-agent-card__meta { color: var(--v2-ink-2, #888); font-size: 12px; margin-top: 2px; }',
      '.v2-badge { display: inline-flex; align-items: center; gap: 5px; font-size: 11px; padding: 1px 8px; border: 1px solid var(--v2-border, rgba(128,128,128,.3)); border-radius: 999px; color: var(--v2-ink-2, #888); }',
      '.v2-badge__dot { width: 7px; height: 7px; border-radius: 50%; background: var(--v2-muted, #999); display: inline-block; }',
      '.v2-badge--active .v2-badge__dot { background: var(--v2-good, #17845a); }',
      '.v2-badge--idle .v2-badge__dot { background: var(--v2-warning, #b5790a); }',
      '.v2-badge--offline .v2-badge__dot { background: var(--v2-muted, #999); }',
      // Sub-agent fleets (t-109, goal: t-60). The count badge reuses the
      // existing .v2-badge shell (same precedent t-80 set on index.html)
      // but carries no dot of its own — a fleet is not a roster agent with
      // a heartbeat history. The fold-out rows below go further: plain
      // text at the .v2-task-card__meta scale, muted only, no accent, no
      // badge-pill shape — that visual language specifically means "this
      // has its own heartbeat history," which is exactly untrue of a
      // sub-agent, so it is withheld by construction, not by convention.
      '.v2-badge--fleet { color: var(--v2-ink-2, #888); }',
      '.v2-fleet { margin-top: 4px; }',
      '.v2-fleet summary { cursor: pointer; font-size: 11px; color: var(--v2-muted, #999); list-style: none; }',
      '.v2-fleet summary::-webkit-details-marker { display: none; }',
      '.v2-fleet summary::before { content: "▸ "; }',
      '.v2-fleet[open] summary::before { content: "▾ "; }',
      '.v2-fleet__subagent { padding: 3px 0 3px 14px; font-size: 11px; color: var(--v2-muted, #999); border-bottom: 1px solid var(--v2-hairline, rgba(128,128,128,.2)); }',
      '.v2-fleet__subagent:last-child { border-bottom: none; }',
      '.v2-project-row { display: flex; align-items: baseline; gap: var(--v2-space-2, 8px); padding: var(--v2-space-1, 4px) 0; border-bottom: 1px solid var(--v2-hairline, rgba(128,128,128,.2)); font-size: 13px; cursor: pointer; }',
      '.v2-project-row:last-child { border-bottom: none; }',
      '.v2-project-row__name { font-weight: 600; }',
      '.v2-project-row--active .v2-project-row__name { color: var(--v2-accent, #3f6fe0); }',
      '.v2-project-row__entity { color: var(--v2-muted, #999); font-size: 11px; }',
      '.v2-project-row__counts { color: var(--v2-ink-2, #888); font-size: 11.5px; margin-left: auto; font-variant-numeric: tabular-nums; }',
      '.v2-board__toolbar { display: flex; align-items: center; gap: var(--v2-space-2, 8px); margin-bottom: var(--v2-space-2, 8px); }',
      '.v2-board__quickadd-btn { font: inherit; font-weight: 600; padding: var(--v2-space-1, 4px) var(--v2-space-2, 8px); border: 1px solid var(--v2-hairline, rgba(128,128,128,.3)); border-radius: var(--v2-radius, 6px); background: var(--v2-surface, transparent); color: var(--v2-ink, inherit); cursor: pointer; }',
      // t-110: archive toggle — same tap-target treatment as the quick-add
      // button beside it (phone-usable, no hover-only affordance). The
      // count text lives INSIDE the button itself so it is visible whether
      // the toggle is on or off — only the list below is gated by state.
      '.v2-board__archive-toggle { font: inherit; font-weight: 600; padding: var(--v2-space-1, 4px) var(--v2-space-2, 8px); border: 1px solid var(--v2-hairline, rgba(128,128,128,.3)); border-radius: var(--v2-radius, 6px); background: var(--v2-surface, transparent); color: var(--v2-ink-2, #888); cursor: pointer; font-variant-numeric: tabular-nums; }',
      '.v2-board__archive-toggle[aria-pressed="true"] { color: var(--v2-ink, inherit); border-color: var(--v2-accent, #3f6fe0); }',
      // The archived strip sits below the six live columns (not mixed into
      // the grid), full-width, so it reads as a distinct, clearly-labeled
      // zone rather than a 7th equal column competing for the same grid
      // track — legible at 390px without the auto-fit grid squeezing it.
      // grid-column spans every track: this strip is a sibling of both the
      // toolbar and #v2-board-columns inside #v2-board, which is ITSELF a
      // grid (v2.html's own #v2-board rule, separate from board.js's own
      // .v2-board__columns grid one level down) — without this, the strip
      // would land as an ordinary same-row grid item next to the toolbar
      // instead of a full-width band below the six columns.
      '.v2-board__archive { grid-column: 1 / -1; margin-top: var(--v2-space-3, 12px); padding-top: var(--v2-space-3, 12px); border-top: 1px dashed var(--v2-hairline, rgba(128,128,128,.3)); }',
      '.v2-board__filter-chip { font-size: 12px; color: var(--v2-ink-2, #888); display: flex; align-items: center; gap: 4px; }',
      '.v2-board__filter-clear { border: none; background: transparent; color: var(--v2-accent, #3f6fe0); cursor: pointer; font: inherit; }',
      '.v2-quickadd { display: flex; gap: var(--v2-space-2, 8px); margin-bottom: var(--v2-space-3, 12px); flex-wrap: wrap; }',
      '.v2-quickadd__title { flex: 1; min-width: 160px; font: inherit; padding: var(--v2-space-2, 8px); border: 1px solid var(--v2-hairline, rgba(128,128,128,.3)); border-radius: var(--v2-radius, 6px); background: var(--v2-bg, transparent); color: var(--v2-ink, inherit); }',
      '.v2-quickadd__project, .v2-quickadd__prio { font: inherit; padding: var(--v2-space-2, 8px); border: 1px solid var(--v2-hairline, rgba(128,128,128,.3)); border-radius: var(--v2-radius, 6px); background: var(--v2-bg, transparent); color: var(--v2-ink, inherit); }',
      '.v2-quickadd__submit { font: inherit; font-weight: 600; padding: var(--v2-space-2, 8px) var(--v2-space-3, 12px); border: none; border-radius: var(--v2-radius, 6px); background: var(--v2-accent, #3f6fe0); color: var(--v2-on-accent, #fff); cursor: pointer; }',
      '.v2-quickadd__err { color: var(--v2-critical, #c23434); font-size: 12px; margin: var(--v2-space-1, 4px) 0 0; width: 100%; }',
      '.v2-board__columns { display: grid; grid-template-columns: repeat(auto-fit, minmax(180px, 1fr)); gap: var(--v2-space-3, 12px); align-items: start; }',
      '.v2-board__column-title { font-size: 12px; color: var(--v2-ink-2, #888); margin: 0 0 var(--v2-space-2, 8px); font-weight: 600; }',
      '.v2-task-card { background: var(--v2-surface, transparent); border: 1px solid var(--v2-hairline, rgba(128,128,128,.25)); border-left: 3px solid var(--v2-muted, #999); border-radius: var(--v2-radius, 6px); padding: var(--v2-space-2, 8px); margin-bottom: var(--v2-space-2, 8px); display: flex; gap: var(--v2-space-1, 4px); align-items: flex-start; }',
      '.v2-task-card__body { cursor: pointer; flex: 1; min-width: 0; }',
      '.v2-task-card--queued { border-left-color: var(--v2-muted, #999); }',
      '.v2-task-card--claimed, .v2-task-card--in_progress { border-left-color: var(--v2-accent, #3f6fe0); }',
      '.v2-task-card--blocked { border-left-color: var(--v2-serious, #b5540a); }',
      '.v2-task-card--review { border-left-color: var(--v2-warning, #b5790a); }',
      '.v2-task-card--done { border-left-color: var(--v2-good, #17845a); }',
      '.v2-task-card--failed { border-left-color: var(--v2-critical, #c23434); }',
      // Discarded cards: dashed border + reduced opacity, distinguishable
      // from Failed at a glance without inventing a new color token. Molecules.css
      // (t-77) already wins the specificity fight on plain .v2-task-card rules
      // with its own doubled-class .v2-task-card.v2-task-card { border: 1px
      // solid transparent } (documented there as a deliberate technique to
      // beat this exact injected style block) — so a single-class override
      // here would be silently dropped, not just for discarded but for every
      // v2-task-card--* status rule below it. Tripling the class per the same
      // sanctioned technique (0,3,0 beats molecules.css's 0,2,0) is the
      // narrowest way to make discarded's border genuinely render; the
      // primary distinguishing signal is still the glyph+label in taskCard()
      // above, per the Bar's own "glyph + color, never color alone" rule, so
      // this border win is a reinforcement, not the only signal.
      '.v2-task-card.v2-task-card.v2-task-card--discarded { border-style: dashed; border-color: var(--v2-color-border, var(--v2-border, rgba(128,128,128,.4))); opacity: .75; }',
      '.v2-task-card__title { font-weight: 600; font-size: 13px; overflow-wrap: break-word; }',
      '.v2-task-card__meta { font-size: 11.5px; color: var(--v2-ink-2, #888); margin-top: 3px; font-variant-numeric: tabular-nums; }'
    ].join('\n');
    document.head.appendChild(style);
  }
})();

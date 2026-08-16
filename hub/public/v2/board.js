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

    // ---- board toolbar: quick-add trigger + active-filter chip (built once) ----
    mounts.board.innerHTML =
      '<div class="v2-board__toolbar">' +
      '<button type="button" class="v2-board__quickadd-btn" id="v2-qa-trigger">+ Quick add</button>' +
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

    qaTrigger.addEventListener('click', function () {
      qaForm.hidden = !qaForm.hidden;
      if (!qaForm.hidden) qaTitle.focus();
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
        return '<div class="v2-agent-card">' +
          '<div class="v2-agent-card__name">' + esc(a.name) + '<span class="v2-badge v2-badge--' + st + '"><span class="v2-badge__dot"></span>' + st + '</span></div>' +
          '<div class="v2-agent-card__meta">' + esc(a.kind) + (a.activity ? ' · ' + esc(a.activity) : '') + ' · seen ' + ago(a.last_seen) + ' ago' + (a.note ? ' · ' + esc(a.note) : '') + '</div>' +
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
        var cards = shown.map(function (t) {
          var isGoal = /^goal:/i.test(t.title);
          var kids = isGoal ? goalKids[t.id] : null;
          var checkbox = key === 'review'
            ? '<input type="checkbox" class="v2-task-card__select" data-id="' + esc(t.id) + '" ' + (selectedReviewIds.has(t.id) ? 'checked' : '') + ' aria-label="Select ' + esc(t.id) + ' for batch verdict">'
            : '';
          return '<div class="v2-task-card v2-task-card--' + esc(t.status) + '" data-id="' + esc(t.id) + '">' +
            checkbox +
            '<div class="v2-task-card__body" data-open="' + esc(t.id) + '">' +
            '<div class="v2-task-card__title">' + (isGoal ? '🎯 ' : '') + esc(t.title) + '</div>' +
            '<div class="v2-task-card__meta">' + esc(t.id) + ' · P' + t.priority +
            (t.assignee ? ' · ' + esc(t.assignee) : '') +
            (t.project ? ' · ' + esc(t.project) : '') +
            (kids ? ' · ' + kids.done + '/' + kids.total + ' missions' : '') +
            (t.reserved_for ? ' · 🔒 ' + esc(t.reserved_for) : '') +
            (t.status === 'review' ? (t.gate === 'critic' ? ' · 🧪 critic' : ' · 👤 boss') : '') +
            '</div></div></div>';
        }).join('');
        return '<div class="v2-board__column"><h3 class="v2-board__column-title">' + esc(label) + ' · ' + ts.length + '</h3>' + (cards || '<div class="v2-empty">Nothing here.</div>') + '</div>';
      }).join('');

      columnsEl.querySelectorAll('[data-open]').forEach(function (el) {
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
      '.v2-project-row { display: flex; align-items: baseline; gap: var(--v2-space-2, 8px); padding: var(--v2-space-1, 4px) 0; border-bottom: 1px solid var(--v2-hairline, rgba(128,128,128,.2)); font-size: 13px; cursor: pointer; }',
      '.v2-project-row:last-child { border-bottom: none; }',
      '.v2-project-row__name { font-weight: 600; }',
      '.v2-project-row--active .v2-project-row__name { color: var(--v2-accent, #3f6fe0); }',
      '.v2-project-row__entity { color: var(--v2-muted, #999); font-size: 11px; }',
      '.v2-project-row__counts { color: var(--v2-ink-2, #888); font-size: 11.5px; margin-left: auto; font-variant-numeric: tabular-nums; }',
      '.v2-board__toolbar { display: flex; align-items: center; gap: var(--v2-space-2, 8px); margin-bottom: var(--v2-space-2, 8px); }',
      '.v2-board__quickadd-btn { font: inherit; font-weight: 600; padding: var(--v2-space-1, 4px) var(--v2-space-2, 8px); border: 1px solid var(--v2-hairline, rgba(128,128,128,.3)); border-radius: var(--v2-radius, 6px); background: var(--v2-surface, transparent); color: var(--v2-ink, inherit); cursor: pointer; }',
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
      '.v2-task-card__title { font-weight: 600; font-size: 13px; overflow-wrap: break-word; }',
      '.v2-task-card__meta { font-size: 11.5px; color: var(--v2-ink-2, #888); margin-top: 3px; font-variant-numeric: tabular-nums; }'
    ].join('\n');
    document.head.appendChild(style);
  }
})();

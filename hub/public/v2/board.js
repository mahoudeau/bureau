// v2/board.js — t-64 (goal: t-53). Owns #v2-agents-rail, #v2-projects-rail,
// #v2-brain-entry (its live "recent" list — brain-browser.js owns the full
// panel that opens on click, t-93) and #v2-board. Reads window.BureauV2
// (contract: v2.html top comment, section 2) exclusively — no own
// SSE/fetch-auth plumbing.
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
// t-93 round 3: converges board-card anatomy and the Brain rail on the
// approved t-58 sample (id/avatar top row, chips row with a goal flag chip
// + colored project-dot chip + priority chip; a real "Brain · recent" list
// off state.knowledge.recent instead of a static "Browse the knowledge
// tree →" line). Also fixes t-90 finding (a) at its root in setRegionBody()
// itself (see that function) instead of only in the two rails it was
// originally spotted in — brainEntry uses the exact same first-render path
// and would have hit the identical bug the moment it got live content.
//
// Emits (see v2.html contract for the full list this file participates in):
//   'v2:mission:open'      { id }   — any board card, single source for
//                                     "open detail" across the whole app.
//   'v2:batch:selection'   { ids }  — every time the review-column
//                                     checkbox selection changes.
//
// No modals, no prompt()/confirm()/alert() — validation and errors render
// inline. No hardcoded hex colors: every visual value reads var(--v2-...)
// (tokens.css/t-63; project-dot colors are the one deliberate exception,
// same as the sample's own PCOLORS — a categorical per-project palette
// isn't a semantic token, see projColor() below).
import { icon } from './components.js';

(function () {
  'use strict';

  // Categorical per-project accent, ported verbatim from the approved
  // sample (t-58-v2-sample.html.txt, PCOLORS) — assigned by each project's
  // index in the registry, same as the sample, so the dot on a board card
  // matches the dot in the sidebar's own project row for the same project.
  var PCOLORS = ['#5e6ad2', '#f2a30f', '#8b5cf6', '#29a36a', '#eb5757', '#93949c', '#f16565', '#6c6d76'];
  function projColor(state, id) {
    var ids = (state.projects || []).map(function (p) { return typeof p === 'string' ? p : p && p.id; });
    var i = ids.indexOf(id);
    return PCOLORS[(i < 0 ? 0 : i) % PCOLORS.length];
  }

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
    function initials(name) { return (name || '?').slice(0, 2).toUpperCase(); }

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
          // Chips: goal (flag) + project (colored dot) + priority, the
          // sample's own three (t-58-v2-sample.html.txt, .card .chips).
          // Everything the sample's narrow demo data never needed to show
          // — assignee reservation, gate, goal children progress — rides
          // as additional chips in the SAME visual language instead of
          // being dropped; this is a chrome convergence, not a feature cut.
          var chips = '' +
            (isGoal ? '<span class="v2-mchip v2-mchip--goal">' + icon('flag', 'v2-icon--xs') + 'Goal</span>' : '') +
            (t.project ? '<span class="v2-mchip"><span class="v2-mchip__dot" style="background:' + projColor(state, t.project) + '"></span>' + esc(t.project) + '</span>' : '') +
            '<span class="v2-mchip v2-tabular-nums">P' + t.priority + '</span>' +
            (kids ? '<span class="v2-mchip v2-tabular-nums">' + icon('git-branch', 'v2-icon--xs') + kids.done + '/' + kids.total + '</span>' : '') +
            (t.reserved_for ? '<span class="v2-mchip">' + icon('user', 'v2-icon--xs') + esc(t.reserved_for) + '</span>' : '') +
            (t.status === 'review' ? '<span class="v2-mchip">' + icon('tag', 'v2-icon--xs') + (t.gate === 'critic' ? 'critic' : 'boss') + '</span>' : '');
          return '<div class="v2-task-card v2-task-card--' + esc(t.status) + '" data-id="' + esc(t.id) + '">' +
            checkbox +
            '<div class="v2-task-card__body" data-open="' + esc(t.id) + '">' +
            '<div class="v2-task-card__top">' +
            '<span class="v2-task-card__id v2-tabular-nums">' + esc(t.id) + '</span><span class="v2-task-card__sp"></span>' +
            (t.assignee ? '<span class="v2-avatar" title="' + esc(t.assignee) + '">' + esc(initials(t.assignee)) + '</span>' : '') +
            '</div>' +
            '<div class="v2-task-card__title">' + esc(t.title) + '</div>' +
            '<div class="v2-task-card__chips">' + chips + '</div>' +
            '</div></div>';
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
      if (!existing) {
        // t-90 finding (a), fixed at the root: the first render for ANY
        // mount using this helper never finds a `.v2-region-body` (only
        // v2.html's static initial markup — a `.v2-empty` "Loading…"/
        // placeholder line — exists yet), so the old code appended a new
        // body div and left that placeholder sitting above it forever.
        // Drop any stray `.v2-empty` DIRECT children before mounting the
        // real body, once, here — every current and future caller of this
        // helper (agents rail, projects rail, and now the Brain rail) is
        // fixed by construction instead of needing its own one-off patch.
        Array.prototype.slice.call(mount.children).forEach(function (child) {
          if (child.classList && child.classList.contains('v2-empty')) child.remove();
        });
        existing = document.createElement('div');
        existing.className = 'v2-region-body';
        mount.appendChild(existing);
      }
      existing.innerHTML = html;
    }

    function timeShort(iso) {
      // Matches the approved sample's own timeShort() granularity (MM-DD
      // HH:MM) but works from git's `--date=iso` format (knowledge.js's
      // recentCommits), not the mission-log ISO-8601 the sample assumed.
      var d = new Date(iso);
      if (isNaN(d)) return '';
      function pad(n) { return String(n).padStart(2, '0'); }
      return pad(d.getMonth() + 1) + '-' + pad(d.getDate()) + ' ' + pad(d.getHours()) + ':' + pad(d.getMinutes());
    }

    function renderBrainRecent(state) {
      var commits = (state.knowledge && state.knowledge.recent) || [];
      var body = commits.length
        ? commits.slice(0, 6).map(function (c) {
            return '<div class="v2-commit-row">' +
              '<span class="v2-commit-row__ts v2-tabular-nums">' + esc(timeShort(c.date)) + '</span>' +
              '<span class="v2-commit-row__who">' + esc(c.author) + '</span>' +
              '<span class="v2-commit-row__msg">' + esc(c.message) + '</span>' +
              '</div>';
          }).join('')
        : '<div class="v2-empty">No brain activity yet.</div>';
      setRegionBody(mounts.brainEntry, body);
    }

    function render() {
      var state = V2.state;
      if (!state) return;
      renderAgents(state);
      renderProjects(state);
      renderBrainRecent(state);
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
      '.v2-board__filter-chip { font-size: 12px; color: var(--v2-ink-2, #888); display: flex; align-items: center; gap: 4px; }',
      '.v2-board__filter-clear { border: none; background: transparent; color: var(--v2-accent, #3f6fe0); cursor: pointer; font: inherit; }',
      '.v2-quickadd { display: flex; gap: var(--v2-space-2, 8px); margin-bottom: var(--v2-space-3, 12px); flex-wrap: wrap; }',
      '.v2-quickadd__title { flex: 1; min-width: 160px; font: inherit; padding: var(--v2-space-2, 8px); border: 1px solid var(--v2-hairline, rgba(128,128,128,.3)); border-radius: var(--v2-radius, 6px); background: var(--v2-bg, transparent); color: var(--v2-ink, inherit); }',
      '.v2-quickadd__project, .v2-quickadd__prio { font: inherit; padding: var(--v2-space-2, 8px); border: 1px solid var(--v2-hairline, rgba(128,128,128,.3)); border-radius: var(--v2-radius, 6px); background: var(--v2-bg, transparent); color: var(--v2-ink, inherit); }',
      '.v2-quickadd__submit { font: inherit; font-weight: 600; padding: var(--v2-space-2, 8px) var(--v2-space-3, 12px); border: none; border-radius: var(--v2-radius, 6px); background: var(--v2-accent, #3f6fe0); color: var(--v2-on-accent, #fff); cursor: pointer; }',
      '.v2-quickadd__err { color: var(--v2-critical, #c23434); font-size: 12px; margin: var(--v2-space-1, 4px) 0 0; width: 100%; }',
      '.v2-board__columns { display: grid; grid-template-columns: repeat(auto-fit, minmax(180px, 1fr)); gap: var(--v2-space-3, 12px); align-items: start; }',
      '.v2-board__column-title { font-size: 12px; color: var(--v2-ink-2, #888); margin: 0 0 var(--v2-space-2, 8px); font-weight: 600; }',
      /* t-93 round 3: card anatomy converged on the approved sample
         (t-58-v2-sample.html.txt: .card/.chips/.mchip/.avatar) — a bordered
         card (border appears on hover, matching the sample's own
         `.card:hover{border-color:var(--border)}`), an id+avatar top row,
         a clamped title, and a chip row (goal flag / colored project dot /
         priority, plus this file's own extra fields folded into the same
         chip language rather than dropped). These rules read the REAL
         tokens.css custom properties (--v2-color-*, --v2-radius-*,
         --v2-space-*) — the surrounding pre-existing rules in this file
         were written against placeholder names (--v2-surface, --v2-ink,
         --v2-hairline, --v2-radius…) that tokens.css never actually
         defines, so they have silently run on hardcoded fallback values
         only, un-themed, since t-64. Left AS-IS here (a file-wide token-
         name audit is a bigger change than this round\'s two named gaps),
         flagged plainly on the mission log rather than silently ignored
         or silently fixed out of scope. */
      '.v2-task-card { background: var(--v2-color-surface, transparent); border: 1px solid transparent; border-left: 3px solid var(--v2-color-text-muted, #999); border-radius: var(--v2-radius-sm, 6px); padding: var(--v2-space-4, 8px) var(--v2-space-5, 10px); margin-bottom: var(--v2-space-3, 6px); display: flex; gap: var(--v2-space-2, 4px); align-items: flex-start; }',
      '.v2-task-card:hover { border-color: var(--v2-color-border, rgba(128,128,128,.25)); background: var(--v2-color-surface-raised, rgba(128,128,128,.06)); }',
      '.v2-task-card__body { cursor: pointer; flex: 1; min-width: 0; }',
      '.v2-task-card--queued { border-left-color: var(--v2-color-text-muted, #999); }',
      '.v2-task-card--claimed, .v2-task-card--in_progress { border-left-color: var(--v2-color-status-at-risk, #f2a30f); }',
      '.v2-task-card--blocked { border-left-color: var(--v2-color-status-bug, #eb5757); }',
      '.v2-task-card--review { border-left-color: var(--v2-color-status-in-progress, #8b5cf6); }',
      '.v2-task-card--done { border-left-color: var(--v2-color-status-done, #29a36a); }',
      '.v2-task-card--failed { border-left-color: var(--v2-color-status-bug, #eb5757); }',
      '.v2-task-card__top { display: flex; align-items: center; gap: var(--v2-space-2, 4px); margin-bottom: var(--v2-space-3, 6px); }',
      '.v2-task-card__id { font-size: 11px; color: var(--v2-color-text-muted, #93949c); font-weight: 500; font-variant-numeric: tabular-nums; }',
      '.v2-task-card__sp { flex: 1; }',
      '.v2-avatar { width: 18px; height: 18px; border-radius: 50%; background: var(--v2-color-surface-raised, #f4f4f6); border: 1px solid var(--v2-color-border, rgba(128,128,128,.2)); display: flex; align-items: center; justify-content: center; font-size: 9px; font-weight: 600; color: var(--v2-color-text-secondary, #62636c); flex: none; }',
      '.v2-task-card__title { font-weight: 450; font-size: 12.5px; line-height: 1.4; color: var(--v2-color-text-primary, inherit); overflow-wrap: break-word; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; margin-bottom: var(--v2-space-3, 6px); }',
      '.v2-task-card__chips { display: flex; align-items: center; gap: var(--v2-space-3, 6px); flex-wrap: wrap; }',
      '.v2-mchip { display: inline-flex; align-items: center; gap: 4px; font-size: 11px; color: var(--v2-color-text-secondary, #62636c); }',
      '.v2-mchip__dot { width: 6px; height: 6px; border-radius: 50%; flex: none; }',
      '.v2-mchip--goal { color: var(--v2-color-status-bug, #eb5757); font-weight: 600; }',
      /* Brain · recent (t-93 round 3) — same commit-row anatomy as the
         sample, fed from the real state.knowledge.recent (git log over the
         brain repo), not a placeholder link. */
      '.v2-commit-row { padding: var(--v2-space-2, 4px) 0; font-size: 11.5px; display: block; }',
      '.v2-commit-row__ts { color: var(--v2-color-text-muted, #93949c); font-size: 10.5px; margin-right: 5px; }',
      '.v2-commit-row__who { font-weight: 600; margin-right: 4px; }',
      '.v2-commit-row__msg { color: var(--v2-color-text-secondary, #62636c); display: block; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }'
    ].join('\n');
    document.head.appendChild(style);
  }
})();

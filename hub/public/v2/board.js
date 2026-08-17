// v2/board.js — t-64 (goal: t-53). Owns #v2-agents-rail, #v2-projects-rail,
// #v2-brain-entry (its live "recent" list — brain-browser.js owns the full
// panel that opens on click, t-93) and #v2-board. Reads window.BureauV2
// (contract: v2.html top comment, section 2) exclusively — no own
// SSE/fetch-auth plumbing.
//
// Ports every i11-baseline function living in this surface:
//   - live agent cards
//   - project list (read-only here: label/entity/repo/capacity/open-count +
//     click-to-filter; INLINE EDITING belongs to project-edit.js, i10 —
//     out of scope for this file, see t-64's body). t-133 (goal: t-53):
//     rebuilt the row per the boss's "not clean, raw clone URL in the row"
//     report — repo is now a host-derived icon (repoIconName() below) with
//     a hover/focus tooltip and a real link, entity/capacity/open-mission-
//     count render as quiet .v2-project-row__chip pills (crop-ux-labels-
//     chips grammar) instead of the old 4-way "3q · 2w · 1r · 5✓" string.
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

  // t-133 (goal: t-53): host-agnostic by construction — the ONLY hostname
  // that maps to the branded "github" glyph is an exact 'github.com'
  // (bare or www.-prefixed); every other host (gitlab.com, bitbucket.org,
  // a self-hosted gitea/forgejo instance, anything) falls through to the
  // generic "git-branch" glyph already used elsewhere in this app. A
  // malformed/unparseable repo string (new URL() throws) degrades to the
  // generic glyph too rather than a broken icon or a thrown render error.
  function repoIconName(url) {
    try {
      var host = new URL(url).hostname.replace(/^www\./, '').toLowerCase();
      return host === 'github.com' ? 'github' : 'git-branch';
    } catch (e) {
      return 'git-branch';
    }
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
      // inline edit UI to, replacing prompt(). label/entity/capacity render
      // UNCONDITIONALLY (an editable field needs a stable DOM node to
      // attach to even when its value is empty); empty entity renders as
      // an empty span with a data-empty="true" flag project-edit.js's own
      // CSS turns into a "—" placeholder, since this file renders no
      // visible placeholder copy itself (out of scope — board.js owns
      // structure/hooks only, per this mission's own instruction not to
      // touch anything beyond the project-card path).
      //
      // t-133 (goal: t-53): repo keeps its own data-field="repo" hook (the
      // CRUD contract survives) but its VIEW state is no longer plain
      // text — see repoIconName() below and the .v2-repo-link/-editbtn
      // styles in injectStyle() for the interaction split this required.
      //
      // t-136 send-back on t-133 (goal: t-53): at the REAL 240px rail width
      // (208px content once .v2-card's padding is subtracted), name +
      // chips + repo icon do not reliably fit one line — the critic caught
      // .v2-project-row__chips wrapping INTERNALLY (flex-wrap:wrap) while
      // its siblings didn't, which orphaned the trailing open-count chip
      // onto its own dangling second line, and separately a long label
      // with no wrap rule of its own broke mid-word. Fix: chips+repo now
      // share one wrapper, .v2-project-row__meta, so they travel and wrap
      // TOGETHER as a single unit (never split from each other) — see the
      // .v2-project-row__meta/-chips (now nowrap) rules in injectStyle()
      // for the mechanics.
      //
      // Round 4 (moneta's fresh reproduction on this same send-back): the
      // outer row's own flex-wrap:wrap (see that rule's comment) was the
      // actual remaining cause of short, ordinary labels ("Job Hunt",
      // "Trace Bingo") breaking onto a second line — fixed there. Turning
      // that off alone reduced every row to one line but at a real
      // readability cost (capacity/count as full bordered pills, on top of
      // entity's own, left __name only enough shrink budget for ~4-5
      // legible characters) — exactly the "give the mutable part shrink
      // priority" gap this send-back names. capacity and open-count move
      // from .v2-project-row__chip (bordered pill — entity's own register,
      // kept there since entity is the one genuinely optional/categorical
      // fact) to .v2-mchip, the SAME plain icon+text register this file
      // already uses for task-card meta above — reclaims the pill's
      // border+padding on both, verified live: every real project label in
      // this app's registry (Bureau, Job Hunt, Trace Bingo, General, Ziip,
      // Allmiibo Sync, Dungeon Storyteller, Jobs platform, Test) now
      // renders in full on one line at the true 240px rail width; only a
      // deliberately long stress-test name still ellipsizes.
      var body = ids.length ? ids.map(function (id) {
        var b = byProj[id];
        var pj = b.meta || {};
        var openCount = b.queued + b.active + b.review;
        var repoHost = pj.repo ? repoIconName(pj.repo) : null;
        return '<div class="v2-project-row' + (projectFilter === id ? ' v2-project-row--active' : '') + '" data-project="' + esc(id) + '">' +
          '<span class="v2-project-row__name" data-field="label" title="' + esc(projLabel(state, id)) + '">' + esc(projLabel(state, id)) + '</span>' +
          '<span class="v2-project-row__meta">' +
            '<span class="v2-project-row__chips">' +
              '<span class="v2-project-row__chip" data-field="entity"' + (pj.entity ? '' : ' data-empty="true"') + ' title="entity (scope wall)' + (pj.entity ? ': @' + esc(pj.entity) : '') + '"><span class="v2-project-row__chip-dot"></span>' + (pj.entity ? esc('@' + pj.entity) : '') + '</span>' +
              '<span class="v2-mchip v2-tabular-nums" data-field="capacity" title="capacity (parallel desks)">' + icon('monitor', 'v2-icon--xs') + (pj.capacity || 1) + '</span>' +
              '<span class="v2-mchip v2-tabular-nums" title="' + openCount + ' open mission' + (openCount === 1 ? '' : 's') + ' (queued, working or in review)">' + icon('circle-dot', 'v2-icon--xs') + openCount + '</span>' +
            '</span>' +
            '<span class="v2-project-row__repo" data-field="repo"' + (pj.repo ? '' : ' data-empty="true"') + '>' + (pj.repo ?
              '<a class="v2-repo-link v2-hit44" href="' + esc(pj.repo) + '" target="_blank" rel="noopener noreferrer" title="' + esc(pj.repo) + '" aria-label="Open repository (' + esc(pj.repo) + ') in a new tab">' +
                icon(repoHost, 'v2-icon--xs') +
                '<span class="v2-repo-link__tip">' + esc(pj.repo) + '</span>' +
              '</a>' +
              '<button type="button" class="v2-repo-editbtn v2-hit44" aria-label="Edit repository URL" title="Edit repository URL">' + icon('square-pen', 'v2-icon--xs') + '</button>'
              : '') + '</span>' +
          '</span>' +
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
        '<div class="v2-task-card__title">' + esc(t.title) + '</div>' +
        '<div class="v2-task-card__meta">' + (isDiscarded ? 'archived · ' : '') + (isGoal ? 'goal · ' : '') + esc(t.id) + ' · P' + t.priority +
        (t.assignee ? ' · ' + esc(t.assignee) : '') +
        (t.project ? ' · ' + esc(t.project) : '') +
        (kids ? ' · ' + kids.done + '/' + kids.total + ' missions' : '') +
        (t.reserved_for ? ' · reserved: ' + esc(t.reserved_for) : '') +
        (t.status === 'review' ? (t.gate === 'critic' ? ' · critic gate' : ' · boss gate') : '') +
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
        var cards = shown.map(function (t) {
          var isGoal = /^goal:/i.test(t.title);
          var kids = isGoal ? goalKids[t.id] : null;
          // t-115 (goal: t-53): .v2-hit44 (components.css) — closes t-111
          // finding #2's "batch-verdicts per-card selection checkbox
          // (board.js): 13x13px" line, the highest-frequency tap in the
          // review flow (one per card, every time the boss triages review).
          var checkbox = key === 'review'
            ? '<input type="checkbox" class="v2-task-card__select v2-hit44" data-id="' + esc(t.id) + '" ' + (selectedReviewIds.has(t.id) ? 'checked' : '') + ' aria-label="Select ' + esc(t.id) + ' for batch verdict">'
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
        strip.innerHTML = '<h3 class="v2-board__column-title">Archived · ' + discarded.length + '</h3>' +
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
      // t-133 round-1 critic send-back: crop-ux-sidebar-item.png (one of
      // this mission's own named judging crops) shows a filled rounded
      // background highlight on the hovered/active row — the shipped row
      // had zero background change on either state (text-color-only,
      // confirmed shipped-and-flagged, pre-existing but this mission
      // cites the crop so it owns closing it). Horizontal padding +
      // matching negative margin is the same [data-field] technique this
      // file's own project-edit.js already uses (padding 2px 4px / margin
      // -2px -4px) — the highlight can extend to the row's true edge-to-
      // edge width without shifting where the name/chips/repo content
      // actually sits relative to the "PROJECTS" header above it.
      // Round 4 (post moneta's fresh reproduction, this send-back):
      // flex-wrap:wrap HERE — on the OUTER row, wrapping name against meta
      // — is the actual root cause of "Job Hunt"/"Trace Bingo" (short,
      // ordinary labels) rendering as two physical lines. It predates the
      // __meta unification below (originally added to stop the open-count
      // chip orphaning from its sibling chips onto its own line) but that
      // orphaning bug is now independently closed by __meta being ONE
      // flex:none item the chips/repo travel and wrap together inside —
      // the outer row never needed to wrap for that anymore, it was just
      // never turned back off. With it on, ANY row whose name+meta combined
      // width exceeds the ~234px rail lets the two top-level children
      // split onto separate lines UNCONDITIONALLY, before __name's own
      // flex:1/min-width:0/ellipsis rule ever gets a chance to shrink+
      // truncate instead — exactly backwards from "the mutable part (meta)
      // should give ground before the name does" (this send-back's own
      // wording). nowrap here restores that ordering: the row's only two
      // children stay on one line always, __meta keeps its fixed intrinsic
      // width (flex:none), and every byte of unavoidable overflow lands on
      // __name's own shrink+ellipsis instead of a line-break. Verified live
      // (real hub + Playwright): "Job Hunt", "Trace Bingo", "Bureau",
      // "Ziip", "General" all render one line at the true 234px rail width
      // now; only a deliberately 49-char stress-test label still
      // ellipsizes, which is the textbook fallback, not the bug.
      '.v2-project-row { display: flex; align-items: center; flex-wrap: nowrap; gap: var(--v2-space-2, 8px); padding: var(--v2-space-1, 4px) var(--v2-space-2, 8px); margin: 0 calc(-1 * var(--v2-space-2, 8px)); border-radius: var(--v2-radius-sm, 6px); border-bottom: 1px solid var(--v2-hairline, rgba(128,128,128,.2)); font-size: 13px; cursor: pointer; }',
      '.v2-project-row:last-child { border-bottom: none; }',
      // Hover: same token .v2-task-card:hover already reads elsewhere in
      // this file, so a hovered row and a hovered board card carry the
      // identical "raised surface" register. (A field's own [data-field]
      // hover highlight, already using this same surface-raised token at
      // a smaller scope, becomes visually redundant while its row is also
      // hovered — accepted: the crop only asks for the row-level state,
      // and the field stays separately clickable either way.)
      '.v2-project-row:hover { background: var(--v2-color-surface-raised, rgba(128,128,128,.08)); }',
      // Active (the current board filter) needs its OWN tint, not the
      // existing --v2-color-accent-soft token .v2-card.v2-is-selected
      // uses: that token is calibrated for plain-ink text sitting on top
      // of it, but this row's active state ALSO recolors its own text to
      // --v2-color-accent (pre-existing, one line below) — accent-on-
      // accent-soft measures 4.15:1 in light mode, under the 4.5:1 AA
      // floor every round of this mission has held to (verified: the
      // plain-white 4.70:1 baseline this text already ran had almost no
      // headroom to begin with). --v2-row-active-tint below is a locally
      // scoped percentage (2% light / 6% dark, both re-measured to clear
      // 4.5:1 with margin: 4.59:1 / 4.71:1) mixed against the SAME accent
      // hue so it still reads as "accent-tinted", just faint enough that
      // accent text stays legible on top of it. Same three-block theming
      // shape tokens.css itself uses (bare :root, dark media guarded by
      // :not([data-theme="light"]), explicit [data-theme="dark"] override)
      // so an explicit toggle still wins over system preference — kept
      // local to this file rather than added to tokens.css since it is a
      // one-component-specific value, not a reusable design token.
      ':root { --v2-row-active-tint: 2%; }',
      '@media (prefers-color-scheme: dark) { :root:not([data-theme="light"]) { --v2-row-active-tint: 6%; } }',
      ':root[data-theme="dark"] { --v2-row-active-tint: 6%; }',
      // Verified-live bug (reproduced, not read off the diff): `.v2-project-
      // row--active` is one class selector (specificity 0,1,0,0); the
      // `:hover` rule two lines up is one class + one pseudo-class (0,2,0,0)
      // — HIGHER, so it silently wins whenever the active row is also
      // hovered, regardless of source order. That is the ordinary case, not
      // an edge one: a user's mouse is still resting on the row right after
      // the click that made it active. Reproduced with a live click (mouse
      // left in place, not moved away): background fell back to the plain
      // surface-raised gray while the text stayed accent-colored, measuring
      // 4.28:1 — under the 4.5:1 floor this exact round's own commit
      // message claims to hold (its 4.59:1 number was measured with the
      // mouse moved away first, the one path that doesn't hit this).
      // `.v2-project-row.v2-project-row--active` (two classes) matches
      // :hover's specificity and sits later in source, so it wins ties —
      // re-verified: active+hovered now measures the same as active-alone.
      '.v2-project-row.v2-project-row--active { background: color-mix(in srgb, var(--v2-color-accent, #5e6ad2) var(--v2-row-active-tint, 2%), transparent); }',
      // t-136 send-back on t-133: the name is a real flex item now, not
      // implicitly full-width — min-width:0 lets it actually shrink inside
      // the row instead of forcing the row wider than its 240px rail, and
      // the nowrap/ellipsis trio truncates a too-long label with "…"
      // instead of the old bug (wrapping its own text mid-word once the
      // meta group below no longer had room beside it).
      //
      // Round 3 tried `flex-basis: 0%` here to force meta onto line 1 by
      // starving __name's hypothetical size during flex-wrap's line-
      // packing pass — it DID make every row physically one line, but at
      // a cost worse than the bug it closed: a name only gets whatever
      // width meta leaves behind, so ordinary labels like "Acme Corp" or
      // "No Repo Project With A Genuinely Long Label" rendered as "Acm…"
      // / "No Re…" — 3-4 legible characters. Confirmed by screenshot, not
      // asserted. That fails "rows read clean" (this mission's own
      // Acceptance line, and the actual boss complaint this mission was
      // filed to fix) far more visibly than a tidy second line ever did.
      // Reverted to `flex: 1 1 auto`: the browser's real content width
      // decides whether name+meta share line 1 (most short/medium names
      // still do, especially after round 3's genuinely good tightening of
      // meta's own footprint below) or meta cleanly wraps to its own full
      // line — never at the cost of truncating the name itself. The send-
      // back's "reads as ONE line" was about entity+capacity+open-count+
      // repo never splitting from EACH OTHER (the actual orphaning bug) —
      // satisfied either way — not a mandate to sacrifice the label.
      '.v2-project-row__name { font-weight: 600; flex: 1 1 auto; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }',
      '.v2-project-row--active .v2-project-row__name { color: var(--v2-accent, #3f6fe0); }',
      // t-136 send-back on t-133: chips + repo used to be two independent
      // flex children of .v2-project-row, free to end up on different
      // lines from each other — that is exactly how the open-count chip
      // orphaned alone onto a dangling second line while the repo icon
      // stayed elsewhere. .v2-project-row__meta wraps both as ONE flex
      // item so they travel and (if the name doesn't fit beside them)
      // wrap together, never apart; margin-left:auto pins the whole
      // group to the row's trailing edge (name's own doc comment above
      // covers the other half of this same fix).
      '.v2-project-row__meta { display: flex; align-items: center; gap: 6px; flex: none; min-width: 0; margin-left: auto; }',
      // t-133 (goal: t-53): entity/capacity/open-count as quiet pill chips
      // — crop-ux-labels-chips.png's own grammar (hairline 1px border,
      // pill radius, leading dot-or-glyph, tight padding, small muted
      // type), scoped to this row rather than reusing .v2-mchip (the
      // board-card chip already converged/judged borderless in t-93 — a
      // different, already-settled component this mission has no reason
      // to touch). [data-field]:hover's highlight (project-edit.js's own
      // generic rule) still applies for free since these stay data-field
      // elements.
      //
      // flex-wrap is NOWRAP here (t-136 send-back on t-133; used to be
      // wrap) — three chips at their real rendered width (~150-190px,
      // capped per-chip below) comfortably fit the meta group's own line
      // at the true 208px rail content width, so letting them wrap
      // individually only ever produced the orphaning bug above. See the
      // [data-editing] escape hatch below for the one case (inline-edit
      // widening a chip) where wrap needs to come back temporarily.
      // Round 3: gap trimmed 6px -> 4px — every px reclaimed here goes
      // straight to __name's shrink budget above, the actual scarce
      // resource in a 3-chip+repo row at the real 208px content width.
      '.v2-project-row__chips { display: flex; align-items: center; gap: 4px; flex-wrap: nowrap; }',
      // Inner-critic catch before parking (concurrent round on this same
      // send-back): entity is free text up to the server's own 40-char
      // validated max (hub/lib/store.js) — plain `white-space: nowrap`
      // with no cap let a long entity slug render a ~260px-wide chip
      // inside this ~240px rail, overflowing past its right edge (a real
      // regression the old plain <span> — no nowrap — never had). Capped
      // + ellipsized here; the field's own title attribute (set above, in
      // renderProjects()) now carries the real value so a native hover
      // tooltip still discloses the full text when it truncates, the
      // same "value visible on hover, not lost" principle the repo
      // icon's own tooltip already applies. 140px also fits well inside
      // this rule's own nowrap meta/chips budget above.
      // Round 3: padding trimmed 8px -> 6px horizontal, same reclaim
      // rationale as the gap above — still the crop's own hairline-pill
      // grammar, just its tighter end.
      '.v2-project-row__chip { display: inline-flex; align-items: center; gap: 4px; font-size: 11px; line-height: 1; padding: 3px 6px; border-radius: var(--v2-radius-full, 999px); border: 1px solid var(--v2-color-border, var(--v2-hairline, rgba(128,128,128,.3))); color: var(--v2-color-text-secondary, var(--v2-muted, #999)); white-space: nowrap; max-width: 140px; overflow: hidden; text-overflow: ellipsis; }',
      '.v2-project-row__chip-dot { width: 5px; height: 5px; border-radius: 50%; background: currentColor; opacity: .55; flex: none; }',
      // Empty entity already gets its "—" placeholder from project-edit.js's
      // shared `[data-field][data-empty="true"]::before` rule; the dot
      // above is a value marker and reads as visual noise stacked right
      // next to that dash when there is no value to mark.
      '.v2-project-row__chip[data-empty="true"] .v2-project-row__chip-dot { display: none; }',
      // t-136 send-back on t-133: inline-editing entity or capacity swaps
      // that chip for project-edit.js's wider .v2-pedit widget (input +
      // ok/cancel); at the real 208px content width that can outgrow the
      // now-nowrap meta/chips groups. board.js already flags the row
      // data-editing="true" for the duration (project-edit.js's own
      // contract, board.js skips its rebuild while the flag is set), so
      // this is a safe, temporary widening: wrap comes back only while a
      // field in THIS row is actually being edited, closing the same
      // horizontal-overflow risk t-114 fixed for the row as a whole
      // without giving up the tidy one-line rest-state above.
      '.v2-project-row[data-editing="true"] .v2-project-row__meta, .v2-project-row[data-editing="true"] .v2-project-row__chips { flex-wrap: wrap; }',
      // Repo: icon-only view (host-derived glyph + hover/focus tooltip +
      // real link) plus a quiet, row-hover-revealed edit affordance —
      // replaces the old raw-clone-URL text entirely (the boss's own
      // "not clean" report). Sits at the trailing end of .v2-project-row__meta
      // (t-136 send-back: margin-left:auto moved to the meta group itself,
      // so it pins with the chips it now always travels with, not alone).
      // Round 3: `position: relative` anchors the edit button below, now
      // taken OUT of flow — it sat in-flow-but-invisible (opacity:0) here,
      // which still reserved its full 22px+gap at rest, silently eating
      // into the row's one-line budget for a control nobody could see.
      // "No chrome at rest" should mean no LAYOUT footprint at rest too.
      '.v2-project-row__repo { display: inline-flex; align-items: center; flex: none; min-height: 20px; position: relative; }',
      '.v2-repo-link { display: inline-flex; align-items: center; justify-content: center; width: 22px; height: 22px; border-radius: var(--v2-radius-xs, 4px); color: var(--v2-color-text-secondary, var(--v2-muted, #999)); position: relative; }',
      '.v2-repo-link:hover, .v2-repo-link:focus-visible { background: var(--v2-color-surface-raised, rgba(128,128,128,.12)); color: var(--v2-color-text-primary, inherit); }',
      '.v2-repo-link:focus-visible, .v2-repo-editbtn:focus-visible { outline: none; box-shadow: 0 0 0 2px var(--v2-color-focus-ring, rgba(63,111,224,.4)); }',
      // Tooltip: the SAME dark-chip register as keyboard.js's .v2-kbd-hint
      // (STUDY-lead.md: "shortcuts are taught, not chrome" — this is that
      // rule applied to a data value instead of a shortcut). Hover AND
      // focus-visible both reveal it, so Tab-to-the-link is a real,
      // screenshottable "reachable some way at 390px" path for anyone who
      // can't hover; a real <a href> with no click-hijacking JS also gets
      // a native long-press preview/context menu on touch for free (not
      // independently screenshot-able from a headless run, but structural
      // by construction — there is no onclick here to race a long-press).
      //
      // Inner-critic catch before parking: keyboard.js's own .v2-kbd-hint__tip
      // (the pattern this was copied from) reads its dark background off
      // --v2-color-text-primary, a THEME-RELATIVE token (#1a1a1f in light,
      // #edeef0 in dark) while its text stays the theme-INVARIANT
      // --v2-color-text-on-accent (#fff both modes) — correct by accident
      // in light mode, but in dark mode that is white text on a #edeef0
      // near-white background, 1.16:1, illegible. The chip is deliberately
      // "always dark regardless of theme" (the comment above says so) so
      // it has no business reading a theme-relative token for either
      // channel — fixed literals instead, matching the ORIGINAL fallback
      // values that were already sitting unused in the var()'s second
      // argument. Out of scope to fix keyboard.js's own copy of this same
      // bug here (different mission's file); flagging it in the mission
      // log instead.
      // Round 5 (t-133): viewport clamp. The repo icon sits at the right edge
      // of the narrow left project rail, so a right:0-anchored tooltip grows
      // LEFTWARD and, for URLs past ~40 chars, clips off the left viewport edge
      // (measured: the engineering-platform-modernization repo tooltip landed at
      // left:-193px at 1440w). Fix: on desktop anchor left:0 so it grows RIGHT
      // into the wide main pane, always on-screen (icon-left + 60vw stays well
      // inside the viewport at every desktop width). The phone override below
      // keeps the original right:0 (there the row is full-width, the icon sits
      // near the right edge, and 60vw grows left without clipping — verified).
      // The <a>'s native title= is the always-clamped browser-positioned
      // fallback in both registers.
      '.v2-repo-link__tip { display: none; position: absolute; bottom: 100%; left: 0; right: auto; margin-bottom: 6px; white-space: nowrap; max-width: 60vw; overflow: hidden; text-overflow: ellipsis; background: #17181a; color: #fff; font-size: 11px; font-weight: var(--v2-weight-regular, 400); padding: 6px 8px; border-radius: var(--v2-radius-sm, 5px); z-index: var(--v2-z-toast, 70); }',
      '@media (max-width: 720px) { .v2-repo-link__tip { left: auto; right: 0; } }',
      '.v2-repo-link:hover .v2-repo-link__tip, .v2-repo-link:focus .v2-repo-link__tip, .v2-repo-link:focus-visible .v2-repo-link__tip { display: block; }',
      // Round 3: absolutely positioned off .v2-project-row__repo's
      // trailing edge (`right: 100%` = flush against the link's left
      // side) instead of sitting in-flow — a hidden (opacity:0) control
      // has no business claiming the row's scarce one-line width budget
      // at rest. pointer-events:none while hidden so the invisible
      // overlap can't steal a click meant for whatever sits under it.
      '.v2-repo-editbtn { display: inline-flex; align-items: center; justify-content: center; width: 22px; height: 22px; border: none; border-radius: var(--v2-radius-xs, 4px); background: transparent; color: var(--v2-color-text-secondary, var(--v2-muted, #999)); cursor: pointer; opacity: 0; position: absolute; right: 100%; top: 50%; transform: translateY(-50%); margin-right: 2px; pointer-events: none; }',
      // No chrome at rest (bar rule): the edit affordance only appears
      // once you're already looking at this field, on hover OR keyboard
      // focus. See the (hover:none) rule below for the touch fallback —
      // without SOME baseline visibility there, this control would be
      // reachable-by-luck only, which fails the parity law's "operable,
      // not merely visible" bar for a real (if secondary) CRUD action.
      '.v2-project-row__repo:hover .v2-repo-editbtn, .v2-project-row__repo:focus-within .v2-repo-editbtn { opacity: 1; pointer-events: auto; }',
      '.v2-repo-editbtn:hover, .v2-repo-editbtn:focus-visible { background: var(--v2-color-surface-raised, rgba(128,128,128,.12)); color: var(--v2-color-text-primary, inherit); }',
      // (hover: none): touch has no hidden-affordance concept, so the edit
      // button goes back to a normal in-flow sibling (position: static
      // overrides the absolute rule above) — baseline-visible — PLUS a
      // wider gap between the two icons — each carries a 44px .v2-hit44
      // halo (components.css/t-115) centered on a 22px glyph; at a tight
      // gap those halos overlap in the middle and a touch tap landing
      // there would resolve to whichever sibling paints last (DOM order),
      // silently stealing taps meant for the link. 24px keeps both halos'
      // centers >=44px apart (11+24+11) so they never overlap — verified
      // empirically below, not just math. This is the ONLY mode where the
      // edit button reserves row width at rest — touch devices already
      // get the data-editing escape hatch above for overflow safety, so
      // the reclaimed desktop budget this round is fighting for does not
      // apply here.
      '@media (hover: none) { .v2-repo-editbtn { opacity: .55; position: static; transform: none; margin-right: 0; pointer-events: auto; } .v2-project-row__repo { gap: 24px; } }',
      // t-114 (goal: t-53): closes t-111's finding #1 (HIGH, parity
      // violation) — entering inline edit (project-edit.js swapping a
      // field for a wider .v2-pedit widget) used to shove other fields off
      // the right edge of a 390px viewport, forcing real page-level
      // horizontal scroll. That's now handled by the [data-editing="true"]
      // escape hatch above (wraps __meta/__chips internally, temporarily,
      // only while a field in this row is actually being edited) rather
      // than by the outer row wrapping — round 4 turned the outer row's
      // own flex-wrap back to nowrap (see that rule's own comment: it was
      // the actual cause of ordinary short labels breaking onto two
      // lines, not a fix this query still depends on). This query now only
      // needs to left-align the meta group at phone width — at the much
      // wider phone rail (full viewport, not 240px) flush-right would
      // leave an odd, purely cosmetic gap between name and meta that the
      // desktop rail's tightness never has room for.
      '@media (max-width: 720px) { .v2-project-row__meta { margin-left: 0; } }',
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
      '.v2-commit-row__msg { color: var(--v2-color-text-secondary, #62636c); display: block; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }',
      // Discarded cards (t-110): dashed border + reduced opacity, distinguishable
      // from Failed at a glance without a new color token. Tripled class beats
      // molecules.css's doubled-class border reset (its documented technique),
      // so the dashed border genuinely renders; the word "archived" on the card
      // stays the primary signal per the glyph+label-never-color-alone rule.
      '.v2-task-card.v2-task-card.v2-task-card--discarded { border-style: dashed; border-color: var(--v2-color-border, rgba(128,128,128,.4)); opacity: .75; }',
      // Meta line used by the archive-strip cards (taskCard).
      '.v2-task-card__meta { font-size: 11.5px; color: var(--v2-color-text-secondary, #62636c); margin-top: 3px; font-variant-numeric: tabular-nums; }'
    ].join('\n');
    document.head.appendChild(style);
  }
})();

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
import { icon, avatar, chip, idBadge } from './components.js';

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

    // t-264 (boss report): the single click-to-filter project id becomes a
    // SET — the toolbar filter control adds/removes projects and resets;
    // the rail rows toggle membership. Empty set = no filter (everything).
    var projectFilters = new Set();
    // t-264: per-project settings mode (the row cog). Rows in this set
    // render data-settings="true": their fields become project-edit.js
    // inline edits and the row click no longer toggles the filter. Kept
    // here (not as DOM state) so renderProjects' full rebuilds preserve it.
    var settingsOpen = new Set();
    var filterMenuOpen = false;
    var selectedReviewIds = new Set();
    var archiveOpen = false; // t-110: off by default — discarded stays out of the six live columns until toggled

    // ---- board toolbar: quick-add trigger + archive toggle + filter (built once) ----
    // t-264: the toolbar speaks the design system now — .v2-btn atoms
    // (components.css) instead of the bespoke one-off button rules this
    // file used to carry, same register t-240 gave the side-rail chrome.
    mounts.board.innerHTML =
      '<div class="v2-board__toolbar">' +
      '<button type="button" class="v2-btn v2-btn--secondary" id="v2-qa-trigger">' + icon('plus') + '<span>Quick add</span></button>' +
      // t-110: discarded (fixtures/duplicates/re-scope tombstones, per
      // protocol.md's terminal-status doctrine) never renders in the six
      // live columns — but the count stays visible here even while the
      // toggle is off, so the number itself is never hidden, only the
      // list. Phone-usable: real buttons, no hover-only affordance.
      '<button type="button" class="v2-btn v2-btn--ghost" id="v2-archive-toggle" aria-pressed="false">' + icon('folder') + '<span><span id="v2-archive-count" class="v2-tabular-nums">0</span> archived</span></button>' +
      // t-264: the filter control — a ghost button opening a checkbox menu
      // of the registry, active projects rendered as removable chips
      // beside it, plus a reset. Non-modal, closes on outside click.
      '<span class="v2-board__filterwrap" id="v2-filter-wrap">' +
      '<button type="button" class="v2-btn v2-btn--ghost" id="v2-filter-btn" aria-haspopup="true" aria-expanded="false">' + icon('filter') + '<span>Filter</span></button>' +
      '<div class="v2-filter-menu" id="v2-filter-menu" hidden></div>' +
      '</span>' +
      '<span class="v2-board__filter-chips" id="v2-filter-chips"></span>' +
      '</div>' +
      '<form class="v2-quickadd" id="v2-quickadd-form" hidden>' +
      '<input class="v2-quickadd__title" id="v2-qa-title" placeholder="New mission for the team…" required>' +
      '<select class="v2-quickadd__project" id="v2-qa-project"></select>' +
      '<select class="v2-quickadd__prio" id="v2-qa-prio"><option value="1">P1</option><option value="2">P2</option><option value="3" selected>P3</option></select>' +
      '<button type="submit" class="v2-quickadd__submit">Add</button>' +
      '<p class="v2-quickadd__err" id="v2-qa-err" hidden></p>' +
      '</form>' +
      '<div class="v2-swim" id="v2-board-columns"></div>';

    var columnsEl = document.getElementById('v2-board-columns');
    var qaTrigger = document.getElementById('v2-qa-trigger');
    var qaForm = document.getElementById('v2-quickadd-form');
    var qaTitle = document.getElementById('v2-qa-title');
    var qaProject = document.getElementById('v2-qa-project');
    var qaPrio = document.getElementById('v2-qa-prio');
    var qaErr = document.getElementById('v2-qa-err');
    var filterBtn = document.getElementById('v2-filter-btn');
    var filterMenu = document.getElementById('v2-filter-menu');
    var filterChips = document.getElementById('v2-filter-chips');
    var archiveToggle = document.getElementById('v2-archive-toggle');
    var archiveCountEl = document.getElementById('v2-archive-count');

    qaTrigger.addEventListener('click', function () {
      qaForm.hidden = !qaForm.hidden;
      if (!qaForm.hidden) qaTitle.focus();
    });
    filterBtn.addEventListener('click', function () {
      filterMenuOpen = !filterMenuOpen;
      renderFilterUI(V2.state);
    });
    // Outside click closes the menu — non-modal, same light-dismiss
    // convention as the app's other floating surfaces.
    document.addEventListener('click', function (e) {
      if (filterMenuOpen && !e.target.closest('#v2-filter-wrap')) {
        filterMenuOpen = false;
        renderFilterUI(V2.state);
      }
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
    // Fleet sub-agent labels are short phrases ("inner critic round 4",
    // "variant B of t-131"), not single names — first-letter-of-first-two-
    // WORDS reads as a sane monogram ("IC", "VB"); initials()'s own
    // first-two-CHARACTERS rule would give "IN"/"VA" instead, which reads
    // as noise on a label that's already a phrase.
    function fleetInitials(label) {
      var words = (label || '?').trim().split(/\s+/);
      return (words[0][0] + (words[1] ? words[1][0] : '')).toUpperCase();
    }

    // ---- roster: team vs visitors, quiet role, liveness glyph, nested
    // fleet (t-131, goal: t-53 — "the agent rail becomes a team roster",
    // boss order 2026-08-17) --------------------------------------------
    //
    // Liveness is its own small hue+glyph pairing, not STATUS_HUES
    // (components.js) — that map is mission-status semantics (bug/at-risk/
    // done); an agent's aliveness is a different axis, so it borrows the
    // on-track green for "alive right now" and the two neutral text tones
    // for the quieter tiers, rather than overloading a mission-shaped hue.
    // Round 3 (inner critic): idle and offline both drew the same hollow
    // "circle" glyph, differing only by color/dimming — for a 3-tier
    // liveness axis where 2 of 3 tiers are visually identical shapes, the
    // glyph does no work over half the time. offline gets its own shape
    // (clock — already-vendored ICON, reads as "time has passed" for
    // free) so all three tiers are shape-distinct, not just color-tinted.
    // Round N (critic gap): offline's glyph carried --v2-color-text-muted,
    // which alone (before the row's own opacity was compounding it further,
    // fixed separately in components.css) still measured a hair under the
    // 3:1 WCAG 1.4.11 non-text-contrast floor in light mode (2.92:1). Shape
    // (clock vs circle) is already what tells idle and offline apart per
    // round 3's own fix above — color no longer has to carry that
    // distinction too, so offline reuses idle's own already-AA-clear
    // text-secondary instead of the marginal muted token.
    var LIVENESS = {
      active: { colorVar: '--v2-color-status-on-track', glyph: 'circle-dot', label: 'Active' },
      idle: { colorVar: '--v2-color-text-secondary', glyph: 'circle', label: 'Idle' },
      offline: { colorVar: '--v2-color-text-secondary', glyph: 'clock', label: 'Offline' }
    };

    // Role is a UI-only presentation label (mission body: "kind stays a
    // free string in the protocol"). protocol.md's own kind values are
    // runtime shapes (cowork/claude-code/demo/dummy/other/human), not
    // roles — the only place a role signal actually lives in the live hub
    // today is capabilities[] (m-121's gate mechanism reads "critic"/
    // "lead" literally there; sol's librarian work carries ['curation',
    // 'librarian']; consul's outward-liaison/counsel work carries
    // ['counsel', ...]). Reads capabilities first; "Builder" is the
    // default for every other real team member.
    //
    // t-131 round 3 (moneta, reopened twice, independently reconfirmed):
    // the literal caps.indexOf('lead') check is unreachable for the REAL
    // live lead — ummon's actual capabilities are ['planning',
    // 'decomposition'], no 'lead' string anywhere (checked against
    // /api/state, not a hand-picked fixture) — it fell through to
    // "Builder" every time, contradicting the mission's own explicit ask
    // for a reachable Lead label. Not fixed by hardcoding the agent name
    // (that breaks the moment a different agent takes over planning/
    // decomposition) — extended with the SAME compound-capability
    // heuristic the Critic branch below already uses for moneta (who
    // carries no literal 'critic' string either, just review+
    // verification): planning+decomposition is what "the lead" actually
    // does in this protocol, same relationship as review+verification to
    // "the critic".
    function roleLabel(a) {
      var caps = a.capabilities || [];
      if (caps.indexOf('lead') !== -1 || (caps.indexOf('planning') !== -1 && caps.indexOf('decomposition') !== -1)) return 'Lead';
      if (caps.indexOf('critic') !== -1 || (caps.indexOf('review') !== -1 && caps.indexOf('verification') !== -1)) return 'Critic';
      if (caps.indexOf('librarian') !== -1 || caps.indexOf('curation') !== -1) return 'Librarian';
      if (caps.indexOf('counsel') !== -1) return 'Envoy';
      return 'Builder';
    }

    // Visitors: fixture/probe/demo registrations that are not "who works
    // here" — kept out of the main roster per the mission's own permitted
    // heuristic ("whatever heuristic the builder justifies from the
    // data"). Two signals, both keyed off what a NON-team registration
    // looks like, never off the absence of a positive signal:
    //   (1) kind dummy/demo/other — the hub's own non-team runtime kinds
    //       (store.js:93 also defaults a kind-less registration to 'other',
    //       so a bare probe with no kind at all is caught here too), vs a
    //       real team member's cowork/claude-code/sdk/human kind.
    //   (2) a capabilities[] drawn ENTIRELY from a small known fixture-
    //       signal set (curl — dummy-agent.sh's literal capability; test;
    //       throwaway-verification), i.e. a probe that declared only its
    //       throwaway tags.
    //
    // t-131 (moneta, 00:54:56 send-back): the earlier `if (!caps.length)
    // return true` rule was an acceptance-contradicting bug. A real team
    // agent's normal state immediately after first registration is zero
    // capabilities (store.js upsertAgent defaults capabilities:[]), and a
    // team registration carries no capabilities at all unless it passes
    // some — e.g. dummy-agent.sh's own `{"name":"shifty","kind":"cowork"}`,
    // and every genuine newhire before it reports caps. Treating "no caps
    // yet" as evidence of not-a-team-member swept those real cowork/human
    // agents into the collapsed Visitors group — the exact opposite of the
    // mission's "the main rail shows only the team." Absence of caps is
    // absence of a role signal, never proof of visitor-hood; the junk case
    // must be recognised by a positive non-team signal (kind, or an all-
    // fixture capabilities set), so that rule is gone.
    var FIXTURE_CAPS = { curl: 1, test: 1, 'throwaway-verification': 1 };
    function isVisitor(a) {
      if (a.kind === 'dummy' || a.kind === 'demo' || a.kind === 'other') return true;
      var caps = a.capabilities || [];
      return caps.length > 0 && caps.every(function (c) { return FIXTURE_CAPS[c]; });
    }

    function rosterAvatar(a, size) {
      // Round 3 (inner critic, fresh-eyes): isAgent:true renders the SAME
      // generic monitor-icon "Agent" pill for every row regardless of
      // `content` — components.js's avatar() ignores its own content arg
      // on that branch by design (STUDY's "agents get a tag, not a
      // different UI" rule, aimed at a DIFFERENT surface: a one-off
      // assignee indicator elsewhere, where the name is already written
      // right next to it). On a roster, the avatar IS the per-row
      // identity anchor the mission body itself asks for ("initials
      // avatar... name, a quiet role") — every row rendering an identical
      // pill defeats "reads as a team, not a registration dump" before
      // you even get to the name. Plain initials avatar for every roster
      // row; "agent-ness" is already conveyed by the row's own role chip.
      return avatar(initials(a.name), { size: size || 'sm' }).outerHTML;
    }

    function rosterRow(a, opts) {
      opts = opts || {};
      var st = agentStatus(a);
      var live = LIVENESS[st];
      var activityText = esc(a.activity || (st === 'offline' ? 'offline' : 'idle'));
      var title = esc(a.kind + (a.note ? ' · ' + a.note : '') + ' · seen ' + ago(a.last_seen) + ' ago');
      // Two lines per row (name+role on top, activity below) — not one
      // packed line: round 1 tried avatar+name+role+activity on a single
      // line and the rail's real width (~230px) crushed the name down to
      // 1-2 characters, which fails the whole point of a roster ("who
      // works here" is unreadable if the name is the field that gives).
      // Name gets the top line to itself (minus the quiet role chip,
      // which is short and pinned right); activity gets its own line so
      // neither ever fights the name for space.
      // No tabindex: the row carries no click/keyboard action (parity with
      // the old .v2-agent-card, which was display-only too) — a focusable
      // stop with nothing bound to it is worse a11y than no stop at all.
      // The hover highlight stays purely as a scannability/craft cue
      // (crop-ux-sidebar-item.png's own rounded row treatment), not a
      // promise of interactivity.
      return '<div class="v2-roster-row' + (st === 'offline' ? ' v2-roster-row--muted' : '') + '" data-agent="' + esc(a.name) + '" title="' + title + '">' +
        rosterAvatar(a) +
        '<div class="v2-roster-row__main">' +
        '<div class="v2-roster-row__top">' +
        '<span class="v2-roster-row__name">' + esc(a.name) + '</span>' +
        (opts.showRole !== false ? chip(roleLabel(a), 'role').outerHTML : '') +
        '</div>' +
        '<div class="v2-roster-row__activity">' +
        '<span class="v2-status-glyph v2-status-glyph--xs" style="color:var(' + live.colorVar + ')" title="' + live.label + '">' + icon(live.glyph) + '</span>' +
        activityText + '</div>' +
        '</div>' +
        '</div>';
    }

    function fleetRows(a) {
      // Live only (t-109's own rule, unchanged): a stale fleet reads as a
      // lie, so it's gated on the SAME `active` heartbeat tier the roster
      // row's own liveness glyph uses, and disappears the moment the
      // parent goes idle/offline — no separate liveness check to drift.
      var st = agentStatus(a);
      var fleet = st === 'active' && Array.isArray(a.sub_agents) ? a.sub_agents : [];
      if (!fleet.length) return '';
      return '<div class="v2-roster-fleet">' +
        fleet.map(function (s) {
          return '<div class="v2-roster-fleet__row">' +
            '<span class="v2-avatar v2-avatar--xs">' + esc(fleetInitials(s.label)) + '</span>' +
            '<span class="v2-roster-fleet__label">' + esc(s.label) + '</span>' +
            (s.activity ? '<span class="v2-roster-fleet__activity">' + esc(s.activity) + '</span>' : '') +
            '</div>';
        }).join('') +
        '</div>';
    }

    function renderAgents(state) {
      var agents = state.agents || [];
      var team = agents.filter(function (a) { return !isVisitor(a); });
      var visitors = agents.filter(isVisitor);

      // Active first, then idle, then offline — each tier by recency
      // descending, tiers never interleaved (boss order: "idle for days
      // sit muted at the bottom, never interleaved with the live team").
      var TIER = { active: 0, idle: 1, offline: 2 };
      team.sort(function (x, y) {
        var rx = TIER[agentStatus(x)], ry = TIER[agentStatus(y)];
        if (rx !== ry) return rx - ry;
        return new Date(y.last_seen) - new Date(x.last_seen);
      });

      var teamHtml = team.map(function (a) { return rosterRow(a) + fleetRows(a); }).join('');
      var visitorsHtml = visitors.length
        ? '<details class="v2-roster-visitors"><summary>Visitors <span class="v2-tabular-nums">(' + visitors.length + ')</span></summary>' +
          visitors.map(function (a) { return rosterRow(a, { showRole: false }); }).join('') +
          '</details>'
        : '';

      var body = (team.length ? teamHtml : '<div class="v2-empty">No agents yet.</div>') + visitorsHtml;
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
      // Prune filters and settings state for projects gone from the registry.
      Array.from(projectFilters).forEach(function (id) { if (!byProj[id]) projectFilters.delete(id); });
      Array.from(settingsOpen).forEach(function (id) { if (!byProj[id]) settingsOpen.delete(id); });
      var ids = Object.keys(byProj).sort();

      // quick-add project select, kept in sync with the registry
      var keep = qaProject.value || (projectFilters.size ? Array.from(projectFilters)[0] : 'general');
      qaProject.innerHTML = ids.map(function (id) {
        return '<option value="' + esc(id) + '"' + (id === keep ? ' selected' : '') + '>' + esc(projLabel(state, id)) + '</option>';
      }).join('');

      renderFilterUI(state);

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
        var inSettings = settingsOpen.has(id);
        return '<div class="v2-project-row' + (projectFilters.has(id) ? ' v2-project-row--active' : '') + '"' + (inSettings ? ' data-settings="true"' : '') + ' data-project="' + esc(id) + '">' +
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
          // t-264 (boss report: "clicking on name renames it instead of
          // selecting it"): every edit affordance now lives behind this
          // cog. It toggles the row's settings mode; project-edit.js only
          // begins a field edit while the row carries data-settings="true".
          '<button type="button" class="v2-icon-btn v2-project-row__cog v2-hit44" aria-label="Project settings (' + esc(projLabel(state, id)) + ')" aria-expanded="' + inSettings + '" title="Project settings: rename, entity, repo, capacity">' + icon('settings') + '</button>' +
          '</div>';
      }).join('') : '<div class="v2-empty">No projects yet.</div>';
      setRegionBody(mounts.projectsRail, body);
      mounts.projectsRail.querySelectorAll('.v2-project-row').forEach(function (row) {
        row.addEventListener('click', function (e) {
          var id = row.getAttribute('data-project');
          // The cog toggles settings mode and never touches the filter.
          if (e.target.closest('.v2-project-row__cog')) {
            if (settingsOpen.has(id)) settingsOpen.delete(id); else settingsOpen.add(id);
            render();
            return;
          }
          // In settings mode the row's fields are edit targets
          // (project-edit.js); a click that reaches here (row padding,
          // non-field gaps) does nothing rather than surprise-toggling
          // the filter mid-edit.
          if (row.getAttribute('data-settings') === 'true') return;
          if (projectFilters.has(id)) projectFilters.delete(id); else projectFilters.add(id);
          render();
        });
      });
    }

    // t-264: the toolbar filter control — button state, removable chips,
    // and the checkbox menu. Rebuilt on every render (cheap, and the menu's
    // checkboxes must track the registry and the live set).
    function renderFilterUI(state) {
      if (!state) return;
      var ids = (state.projects || []).map(function (p) { return typeof p === 'string' ? p : p && p.id; }).filter(Boolean).sort();
      filterBtn.setAttribute('aria-expanded', String(filterMenuOpen));
      filterBtn.classList.toggle('v2-is-filter-active', projectFilters.size > 0);
      filterBtn.querySelector('span').textContent = projectFilters.size ? 'Filter · ' + projectFilters.size : 'Filter';

      filterChips.innerHTML = Array.from(projectFilters).sort().map(function (id) {
        return '<span class="v2-chip v2-fchip"><span class="v2-mchip__dot" style="background:' + projColor(state, id) + '"></span>' + esc(projLabel(state, id)) +
          '<button type="button" class="v2-fchip__x" data-funset="' + esc(id) + '" aria-label="Stop filtering on ' + esc(projLabel(state, id)) + '">' + icon('x') + '</button></span>';
      }).join('');
      filterChips.querySelectorAll('[data-funset]').forEach(function (btn) {
        btn.addEventListener('click', function () {
          projectFilters.delete(btn.getAttribute('data-funset'));
          render();
        });
      });

      filterMenu.hidden = !filterMenuOpen;
      if (!filterMenuOpen) { filterMenu.innerHTML = ''; return; }
      filterMenu.innerHTML = ids.map(function (id) {
        return '<label class="v2-filter-menu__item">' +
          '<input type="checkbox" data-fproj="' + esc(id) + '"' + (projectFilters.has(id) ? ' checked' : '') + '>' +
          '<span class="v2-mchip__dot" style="background:' + projColor(state, id) + '"></span>' +
          '<span class="v2-filter-menu__label">' + esc(projLabel(state, id)) + '</span>' +
          '</label>';
      }).join('') +
        '<div class="v2-filter-menu__foot"><button type="button" class="v2-btn v2-btn--ghost" id="v2-filter-reset"' + (projectFilters.size ? '' : ' disabled') + '>Reset</button></div>';
      filterMenu.querySelectorAll('[data-fproj]').forEach(function (cb) {
        cb.addEventListener('change', function () {
          var id = cb.getAttribute('data-fproj');
          if (cb.checked) projectFilters.add(id); else projectFilters.delete(id);
          render();
        });
      });
      var reset = document.getElementById('v2-filter-reset');
      if (reset) reset.addEventListener('click', function () {
        projectFilters.clear();
        render();
      });
    }

    // t-167: the board is a Linear-style stack of status SWIMLANES, not the
    // six side-by-side Kanban columns it used to be (the boss's own report:
    // "a lot of wasted space and multiple rows... rethink the order/
    // disposition of columns, this is main view"). Each group is a full-
    // width band with a collapsible header (glyph + label + count) and dense
    // single-line rows. Order rethought: live work first (Working/Review/
    // Blocked/Queued), terminal states (Done/Failed) last and collapsed by
    // default so they never dominate the fold. `glyph` is a lucide status
    // ring (components.js); `tone`/the group key drives color via the SAME
    // status token the old card border-left used, so the signal stays
    // consistent with the rest of the app (glyph + color + label, never
    // color alone — the register rule t-110 established).
    var V2_GROUPS = [
      { key: 'working', label: 'Working', glyph: 'circle-dot' },
      // t-167 round 3 (critic gap): Working and Review used to share
      // circle-dot, distinguished only by color (amber vs purple) — this
      // codebase's own t-110 rule is glyph+color, never color alone, and the
      // Linear reference gives every status a distinct glyph SHAPE. `clock`
      // reads correctly for "awaiting a look" and is visually unmistakable
      // from Working's dot at 15px.
      { key: 'review', label: 'Review', glyph: 'clock' },
      { key: 'blocked', label: 'Blocked', glyph: 'circle-alert' },
      { key: 'queued', label: 'Queued', glyph: 'circle' },
      { key: 'done', label: 'Done', glyph: 'circle-check', collapsed: true },
      { key: 'failed', label: 'Failed', glyph: 'circle-x', collapsed: true }
    ];
    var DISCARDED_GROUP = { key: 'discarded', label: 'Archived', glyph: 'circle', collapsed: true };
    function statusOf(key, t) { return key === 'working' ? (t.status === 'claimed' || t.status === 'in_progress') : t.status === key; }

    // Per-group collapse state, persisted client-side so a fold survives a
    // reload (messages carry no such flag; this is a display convenience,
    // never synced task state). First visit seeds from each group's own
    // `collapsed` default (Done/Failed/Archived start folded).
    var COLLAPSE_KEY = 'v2.board.collapsed';
    var collapsed = (function () {
      try { var v = JSON.parse(localStorage.getItem(COLLAPSE_KEY)); if (Array.isArray(v)) return new Set(v); } catch (e) {}
      return new Set(V2_GROUPS.concat(DISCARDED_GROUP).filter(function (g) { return g.collapsed; }).map(function (g) { return g.key; }));
    })();
    function saveCollapsed() { try { localStorage.setItem(COLLAPSE_KEY, JSON.stringify(Array.from(collapsed))); } catch (e) {} }

    // One dense row. Anatomy (single line, ~32px): [review checkbox] · status
    // glyph · id badge · title (ellipsized, grows) · chips (goal/project/
    // priority/kids/reserved/gate, the sample's chip language) · assignee
    // avatar. Row click opens the mission (v2:mission:open, the one app-wide
    // "open detail" event); the review checkbox drives batch selection.
    function swimRow(state, t, group, goalKids) {
      var isGoal = /^goal:/i.test(t.title);
      var kids = isGoal ? goalKids[t.id] : null;
      var checkbox = group.key === 'review'
        ? '<input type="checkbox" class="v2-task-card__select v2-hit44 v2-swim__select" data-id="' + esc(t.id) + '" ' + (selectedReviewIds.has(t.id) ? 'checked' : '') + ' aria-label="Select ' + esc(t.id) + ' for batch verdict">'
        : '';
      var chips = '' +
        (isGoal ? '<span class="v2-mchip v2-mchip--goal">' + icon('flag', 'v2-icon--xs') + 'Goal</span>' : '') +
        (t.project ? '<span class="v2-mchip"><span class="v2-mchip__dot" style="background:' + projColor(state, t.project) + '"></span>' + esc(t.project) + '</span>' : '') +
        '<span class="v2-mchip v2-tabular-nums">P' + t.priority + '</span>' +
        (kids ? '<span class="v2-mchip v2-tabular-nums">' + icon('git-branch', 'v2-icon--xs') + kids.done + '/' + kids.total + '</span>' : '') +
        (t.reserved_for ? '<span class="v2-mchip">' + icon('user', 'v2-icon--xs') + esc(t.reserved_for) + '</span>' : '') +
        (t.status === 'review' ? '<span class="v2-mchip">' + icon('tag', 'v2-icon--xs') + (t.gate === 'critic' ? 'critic' : 'boss') + '</span>' : '');
      return '<div class="v2-swim__row' + (selectedReviewIds.has(t.id) ? ' is-selected' : '') + '" data-open="' + esc(t.id) + '" role="button" tabindex="0" title="' + esc(t.title) + '">' +
        checkbox +
        '<span class="v2-swim__glyph v2-swim__glyph--' + esc(group.key) + '" aria-hidden="true">' + icon(group.glyph) + '</span>' +
        idBadge(t.id).outerHTML +
        '<span class="v2-swim__title">' + esc(t.title) + '</span>' +
        '<span class="v2-swim__chips">' + chips + '</span>' +
        // t-131's merge deleted the legacy bare `.v2-avatar { width:18px }`
        // rule from injectStyle (below); sizing now comes only from
        // components.css's tokenized --xs/--sm/--md modifiers, so every call
        // site must name its own size or render width-less.
        (t.assignee ? '<span class="v2-avatar v2-avatar--sm" title="' + esc(t.assignee) + '">' + esc(initials(t.assignee)) + '</span>' : '') +
        '</div>';
    }

    // One collapsible band. Empty non-archive groups are dropped entirely
    // (Linear's default, and the direct fix for the "wasted space" report) —
    // a status with nothing in it costs zero vertical space instead of an
    // empty column.
    function swimGroup(state, group, ts, goalKids) {
      var isCol = collapsed.has(group.key);
      var cap = group.key === 'done' ? 12 : 0;
      var shown = cap ? ts.slice(0, cap) : ts;
      var rows = shown.map(function (t) { return swimRow(state, t, group, goalKids); }).join('');
      var more = ts.length > shown.length ? '<div class="v2-swim__more">+ ' + (ts.length - shown.length) + ' more</div>' : '';
      return '<section class="v2-swim__group v2-swim__group--' + group.key + (isCol ? ' is-collapsed' : '') + '" data-status="' + group.key + '">' +
        '<div class="v2-swim__head" role="button" tabindex="0" aria-expanded="' + (isCol ? 'false' : 'true') + '" data-toggle="' + group.key + '">' +
        '<span class="v2-swim__caret" aria-hidden="true">' + icon(isCol ? 'chevron-right' : 'chevron-down') + '</span>' +
        '<span class="v2-swim__glyph v2-swim__glyph--' + group.key + '" aria-hidden="true">' + icon(group.glyph) + '</span>' +
        '<span class="v2-swim__label">' + esc(group.label) + '</span>' +
        '<span class="v2-swim__count v2-tabular-nums">' + ts.length + '</span>' +
        '</div>' +
        '<div class="v2-swim__rows">' + (rows || '<div class="v2-swim__more">Nothing here.</div>') + more + '</div>' +
        '</section>';
    }

    function renderBoard(state) {
      var all = state.tasks || [];
      var visible = projectFilters.size ? all.filter(function (t) { return projectFilters.has(t.project); }) : all;
      var goalKids = {};
      all.forEach(function (t) {
        var m = /goal:\s*(t-\d+)/.exec(t.body || '');
        if (m) { var g = goalKids[m[1]] = goalKids[m[1]] || { done: 0, total: 0 }; g.total++; if (t.status === 'done') g.done++; }
      });
      function byPrio(a, b) { return a.priority - b.priority || b.created_at.localeCompare(a.created_at); }

      // Live status bands. An empty band renders nothing at all — the direct
      // answer to the "wasted space" report: only groups that hold work take
      // vertical room.
      var html = V2_GROUPS.map(function (g) {
        var ts = visible.filter(function (t) { return statusOf(g.key, t); }).sort(byPrio);
        return ts.length ? swimGroup(state, g, ts, goalKids) : '';
      }).join('');

      // Discarded (fixtures, duplicates, re-scope tombstones — protocol.md's
      // terminal-status doctrine) never renders in the live bands. Its count
      // stays on the toolbar toggle regardless of state; the band itself only
      // renders while the toggle is on, as one more swimlane at the bottom.
      var discarded = visible.filter(function (t) { return t.status === 'discarded'; })
        .sort(function (a, b) { return b.created_at.localeCompare(a.created_at); });
      archiveCountEl.textContent = String(discarded.length);
      if (archiveOpen) html += swimGroup(state, DISCARDED_GROUP, discarded, goalKids);

      columnsEl.innerHTML = html || '<div class="v2-empty">Nothing on the board' + (projectFilters.size ? ' for this filter' : '') + '.</div>';

      // Row → open mission (click or keyboard). The checkbox is a child of the
      // row, so its own click is stopped from bubbling into an open.
      function openFrom(el) { V2.emit('v2:mission:open', { id: el.getAttribute('data-open') }); }
      columnsEl.querySelectorAll('[data-open]').forEach(function (el) {
        el.addEventListener('click', function () { openFrom(el); });
        el.addEventListener('keydown', function (e) {
          if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openFrom(el); }
        });
      });
      columnsEl.querySelectorAll('.v2-task-card__select').forEach(function (cb) {
        cb.addEventListener('click', function (e) { e.stopPropagation(); });
        cb.addEventListener('keydown', function (e) { e.stopPropagation(); });
        cb.addEventListener('change', function () {
          var id = cb.getAttribute('data-id');
          if (cb.checked) selectedReviewIds.add(id); else selectedReviewIds.delete(id);
          var row = cb.closest('.v2-swim__row');
          if (row) row.classList.toggle('is-selected', cb.checked);
          V2.emit('v2:batch:selection', { ids: Array.from(selectedReviewIds) });
        });
      });

      // Group header → collapse/expand (in place, no full re-render, so
      // scroll and unrelated regions are untouched). State persists.
      columnsEl.querySelectorAll('[data-toggle]').forEach(function (head) {
        function toggle() {
          var key = head.getAttribute('data-toggle');
          var section = head.closest('.v2-swim__group');
          var nowCol = !collapsed.has(key);
          if (nowCol) collapsed.add(key); else collapsed.delete(key);
          saveCollapsed();
          if (section) section.classList.toggle('is-collapsed', nowCol);
          head.setAttribute('aria-expanded', String(!nowCol));
          var caret = head.querySelector('.v2-swim__caret');
          if (caret) caret.innerHTML = icon(nowCol ? 'chevron-right' : 'chevron-down');
        }
        head.addEventListener('click', toggle);
        head.addEventListener('keydown', function (e) {
          if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggle(); }
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
      // Agent roster row/fleet/visitors styling now lives in components.css
      // (t-131, goal: t-53) — the atom-owning file, not this inline block;
      // superseded the old flat .v2-agent-card/.v2-badge/.v2-fleet rules
      // that read as a raw registration dump.
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
      '.v2-project-row { display: flex; align-items: center; flex-wrap: nowrap; gap: var(--v2-space-2, 8px); padding: var(--v2-space-1, 4px) var(--v2-space-2, 8px); margin: 0 calc(-1 * var(--v2-space-2, 8px)); border-radius: var(--v2-radius-sm, 6px); border-bottom: 1px solid var(--v2-hairline); font-size: 13px; cursor: pointer; }',
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
      // t-266/t-278: the light-family third themes (retro, now gb-*) are excluded from the dark media value
      // the same way tokens.css's own dark block now excludes it.
      '@media (prefers-color-scheme: dark) { :root:not([data-theme="light"]):not([data-theme^="gb-"]) { --v2-row-active-tint: 6%; } }',
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
      '.v2-project-row--active .v2-project-row__name { color: var(--v2-accent); }',
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
      '.v2-project-row__chip { display: inline-flex; align-items: center; gap: 4px; font-size: 11px; line-height: 1; padding: 3px 6px; border-radius: var(--v2-radius-full, 999px); border: 1px solid var(--v2-color-border, var(--v2-hairline)); color: var(--v2-color-text-secondary, var(--v2-muted)); white-space: nowrap; max-width: 140px; overflow: hidden; text-overflow: ellipsis; }',
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
      // t-264: the row cog — always visible (no hover-only affordance,
      // t-53's own mechanical floor) but quiet until hovered or open.
      '.v2-project-row__cog { flex: none; width: 22px; height: 22px; color: var(--v2-color-text-muted, #999); opacity: .55; }',
      '.v2-project-row:hover .v2-project-row__cog, .v2-project-row__cog:focus-visible { opacity: 1; }',
      '.v2-project-row__cog[aria-expanded="true"] { opacity: 1; color: var(--v2-color-accent); }',
      '.v2-project-row__cog .v2-icon { width: 13px; height: 13px; }',
      // Settings mode: the row reads as an open editing surface — raised
      // background, wrap allowed so every field stays reachable, and the
      // empty-value placeholders ("—") only exist HERE, where clicking
      // them is how a first entity/repo gets added. Outside settings mode
      // an empty entity chip or repo slot renders nothing at all (the
      // boss's "big — before and after icons" report).
      '.v2-project-row[data-settings="true"] { background: var(--v2-color-surface-raised, rgba(128,128,128,.06)); flex-wrap: wrap; }',
      '.v2-project-row[data-settings="true"] .v2-project-row__meta, .v2-project-row[data-settings="true"] .v2-project-row__chips { flex-wrap: wrap; }',
      '.v2-project-row:not([data-settings="true"]) [data-field][data-empty="true"] { display: none; }',
      // The pencil next to the repo link is an edit affordance — settings
      // mode only; the link itself stays a plain link in both modes.
      '.v2-project-row:not([data-settings="true"]) .v2-repo-editbtn { display: none; }',
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
      '.v2-repo-link { display: inline-flex; align-items: center; justify-content: center; width: 22px; height: 22px; border-radius: var(--v2-radius-xs, 4px); color: var(--v2-color-text-secondary, var(--v2-muted)); position: relative; }',
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
      '.v2-repo-editbtn { display: inline-flex; align-items: center; justify-content: center; width: 22px; height: 22px; border: none; border-radius: var(--v2-radius-xs, 4px); background: transparent; color: var(--v2-color-text-secondary, var(--v2-muted)); cursor: pointer; opacity: 0; position: absolute; right: 100%; top: 50%; transform: translateY(-50%); margin-right: 2px; pointer-events: none; }',
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
      '.v2-board__toolbar { display: flex; align-items: center; gap: var(--v2-space-2, 8px); margin-bottom: var(--v2-space-2, 8px); flex-wrap: wrap; }',
      // t-264: toolbar buttons are .v2-btn atoms (components.css owns their
      // look); this file only styles the states the atoms don't know about.
      // The archive count stays INSIDE the button (t-110: the number is
      // never hidden, only the list is gated by state).
      '#v2-archive-toggle[aria-pressed="true"] { color: var(--v2-color-accent); }',
      '#v2-filter-btn.v2-is-filter-active { color: var(--v2-color-accent); }',
      // Filter control: wrapper anchors the dropdown; chips are removable
      // pills in the same hairline-pill grammar as the project-row chips.
      '.v2-board__filterwrap { position: relative; display: inline-flex; }',
      // The menu is a floating surface — it reads the SAME overlay tokens
      // the palette molecule reads (shadow-overlay, radius-md, z-toast),
      // never its own hardcoded shadow, so light/dark elevation stays one
      // system-wide voice.
      '.v2-filter-menu { position: absolute; top: 100%; left: 0; margin-top: 4px; min-width: 220px; max-height: 320px; overflow-y: auto; background: var(--v2-color-bg, #fff); border: 1px solid var(--v2-color-border, var(--v2-hairline)); border-radius: var(--v2-radius-md, 8px); box-shadow: var(--v2-shadow-overlay, 0 8px 24px rgba(0,0,0,.14)); padding: var(--v2-space-2, 8px); z-index: var(--v2-z-toast, 70); }',
      '.v2-filter-menu__item { display: flex; align-items: center; gap: var(--v2-space-3, 8px); padding: var(--v2-space-2, 6px) var(--v2-space-2, 8px); border-radius: var(--v2-radius-xs, 4px); font-size: 13px; cursor: pointer; min-height: 32px; }',
      '.v2-filter-menu__item:hover { background: var(--v2-color-surface-raised, rgba(128,128,128,.08)); }',
      '.v2-filter-menu__item input { margin: 0; flex: none; }',
      '.v2-filter-menu__label { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }',
      '.v2-filter-menu__foot { border-top: 1px solid var(--v2-color-border, var(--v2-hairline)); margin-top: var(--v2-space-2, 6px); padding-top: var(--v2-space-2, 6px); display: flex; justify-content: flex-end; }',
      '.v2-board__filter-chips { display: inline-flex; align-items: center; gap: 4px; flex-wrap: wrap; }',
      // Filter chips are the .v2-chip ATOM (components.css owns box,
      // border, radius, height); this modifier only resets the tag
      // typography to sentence case — the same axes .v2-chip--role resets,
      // for the same reason (a project name next to controls reads as
      // plain text, not an uppercase mono tag) — and tightens the trailing
      // padding so the × sits inside the pill.
      '.v2-fchip { gap: 5px; font-family: inherit; font-weight: var(--v2-weight-regular, 400); text-transform: none; letter-spacing: normal; font-size: var(--v2-font-size-xs, 11px); padding-right: var(--v2-space-2, 4px); }',
      '.v2-fchip__x { display: inline-flex; align-items: center; justify-content: center; width: 18px; height: 18px; border: none; border-radius: 50%; background: transparent; color: inherit; cursor: pointer; padding: 0; }',
      '.v2-fchip__x:hover { background: var(--v2-color-surface-raised, rgba(128,128,128,.12)); color: var(--v2-color-text-primary, inherit); }',
      '.v2-fchip__x .v2-icon { width: 12px; height: 12px; }',
      // Tap-target floor at phone width (t-53 mechanical floors) — same
      // override organisms.css gives the desk tray's .v2-btn atoms. The
      // row cog needs no rule: it carries .v2-hit44's 44px halo.
      '@media (max-width: 720px) { .v2-board__toolbar .v2-btn { min-height: 44px; } .v2-filter-menu__item { min-height: 44px; } .v2-fchip { min-height: 32px; } .v2-fchip__x { width: 28px; height: 28px; } }',
      // Phone: the filter button sits toward the right of a narrow
      // viewport, so a left-anchored 220px menu clips off-screen — anchor
      // right and clamp instead (same viewport-clamp move as the repo
      // tooltip's own phone override above).
      '@media (max-width: 720px) { .v2-filter-menu { left: auto; right: 0; max-width: calc(100vw - 32px); } }',
      '.v2-quickadd { display: flex; gap: var(--v2-space-2, 8px); margin-bottom: var(--v2-space-3, 12px); flex-wrap: wrap; }',
      '.v2-quickadd__title { flex: 1; min-width: 160px; font: inherit; padding: var(--v2-space-2, 8px); border: 1px solid var(--v2-hairline); border-radius: var(--v2-radius); background: var(--v2-bg); color: var(--v2-ink); }',
      '.v2-quickadd__project, .v2-quickadd__prio { font: inherit; padding: var(--v2-space-2, 8px); border: 1px solid var(--v2-hairline); border-radius: var(--v2-radius); background: var(--v2-bg); color: var(--v2-ink); }',
      '.v2-quickadd__submit { font: inherit; font-weight: 600; padding: var(--v2-space-2, 8px) var(--v2-space-3, 12px); border: none; border-radius: var(--v2-radius); background: var(--v2-accent); color: var(--v2-on-accent); cursor: pointer; }',
      '.v2-quickadd__err { color: var(--v2-critical); font-size: 12px; margin: var(--v2-space-1, 4px) 0 0; width: 100%; }',
      // t-167: the board is a vertical stack of status swimlanes, not a
      // Kanban grid. #v2-board is declared `display:grid` (auto-fit columns)
      // in v2.html's own <style>; this file's stylesheet is appended to
      // <head> AFTER that inline block, so an equal-specificity `#v2-board`
      // rule here wins on source order and flips the whole surface to block
      // flow — keeping the redesign a single-file change with no v2.html edit
      // (and no drift on that repeatedly-contested file).
      '#v2-board { display: block; }',
      // t-167 round 2 (critic send-back): Linear's issue list is ONE
      // continuous flat surface — bands are separated only by the header
      // strip's own hairline, never by a boxed card. No group border,
      // radius, overflow-clip or inter-band gap here; the header tint plus
      // the row-level hairlines below carry all the separation.
      '.v2-swim { display: flex; flex-direction: column; }',
      '.v2-swim__group { background: transparent; }',
      '.v2-swim__head { display: flex; align-items: center; gap: var(--v2-space-3, 6px); padding: var(--v2-space-3, 6px) var(--v2-space-4, 8px); cursor: pointer; user-select: none; background: var(--v2-color-surface-raised, rgba(128,128,128,.05)); border-bottom: 1px solid var(--v2-color-border, rgba(128,128,128,.1)); }',
      '.v2-swim__group.is-collapsed .v2-swim__head { border-bottom-color: transparent; }',
      '.v2-swim__head:hover { background: var(--v2-color-border, rgba(128,128,128,.08)); }',
      '.v2-swim__head:focus-visible { outline: 2px solid var(--v2-color-focus-ring, rgba(94,106,210,.4)); outline-offset: -2px; }',
      '.v2-swim__caret { display: inline-flex; flex: none; color: var(--v2-color-text-muted, #999); }',
      '.v2-swim__caret .v2-icon { width: 15px; height: 15px; }',
      '.v2-swim__label { font-weight: 600; font-size: 13px; color: var(--v2-color-text-primary, inherit); }',
      '.v2-swim__count { color: var(--v2-color-text-muted, #999); font-size: 12px; }',
      '.v2-swim__group.is-collapsed .v2-swim__rows { display: none; }',
      // A dense single-line row. Row height ~32px; title ellipsizes so the
      // row never wraps to a second line (the "multiple rows" complaint).
      '.v2-swim__row { display: flex; align-items: center; gap: var(--v2-space-3, 6px); padding: var(--v2-space-2, 4px) var(--v2-space-4, 8px); min-height: 32px; cursor: pointer; border-bottom: 1px solid var(--v2-color-border, rgba(128,128,128,.06)); }',
      '.v2-swim__row:last-child { border-bottom: none; }',
      '.v2-swim__row:hover { background: var(--v2-color-surface-raised, rgba(128,128,128,.05)); }',
      '.v2-swim__row:focus-visible { outline: 2px solid var(--v2-color-focus-ring, rgba(94,106,210,.4)); outline-offset: -2px; }',
      '.v2-swim__row.is-selected { background: var(--v2-color-row-selected-bg, rgba(94,106,210,.1)); }',
      '.v2-swim__select { flex: none; margin: 0; }',
      // Status glyph — color mapping identical to the old card border-left,
      // so the signal is unchanged from the rest of the app.
      '.v2-swim__glyph { display: inline-flex; flex: none; }',
      '.v2-swim__glyph .v2-icon { width: 15px; height: 15px; }',
      '.v2-swim__glyph--queued { color: var(--v2-color-text-muted, #999); }',
      '.v2-swim__glyph--working { color: var(--v2-color-status-at-risk, #f2a30f); }',
      '.v2-swim__glyph--blocked { color: var(--v2-color-status-bug, #eb5757); }',
      '.v2-swim__glyph--review { color: var(--v2-color-status-in-progress, #8b5cf6); }',
      '.v2-swim__glyph--done { color: var(--v2-color-status-done, #29a36a); }',
      '.v2-swim__glyph--failed { color: var(--v2-color-status-bug, #eb5757); }',
      '.v2-swim__glyph--discarded { color: var(--v2-color-text-muted, #999); }',
      '.v2-swim__title { flex: 1; min-width: 0; font-size: 13px; color: var(--v2-color-text-primary, inherit); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }',
      '.v2-swim__chips { display: flex; align-items: center; gap: var(--v2-space-4, 8px); flex: none; }',
      '.v2-swim__more { padding: var(--v2-space-2, 4px) var(--v2-space-4, 8px); font-size: 11.5px; color: var(--v2-color-text-muted, #999); }',
      // On a phone the chip cluster is the first thing to sacrifice — the id,
      // status glyph, title and avatar carry the row; project/priority/gate
      // chips hide below the phone breakpoint so the row stays one clean line.
      '@media (max-width: 720px) { .v2-swim__chips { display: none; } }',
      // t-167: the multi-line card anatomy (t-93's converged .v2-task-card /
      // __top / __title / __chips) is retired with the Kanban board it lived
      // in — the swimlane row above replaces it. .v2-mchip* is kept verbatim:
      // the row reuses it. molecules.css still carries a
      // `.v2-task-card.v2-task-card` doubled-class rule that now matches
      // nothing on this surface (board.js no longer emits .v2-task-card);
      // that dead rule is left for the design-system pass (t-139) rather
      // than reached into from here. NOT re-declaring a bare `.v2-avatar`
      // rule here — t-131's merge already deleted the legacy bare-avatar
      // sizing rule from this file on main (components.css's tokenized
      // --xs/--sm/--md modifiers are the one source of truth now); every
      // call site in this file (swimRow's assignee avatar, fleetRows') names
      // its own size modifier instead.
      '.v2-mchip { display: inline-flex; align-items: center; gap: 4px; font-size: 11px; color: var(--v2-color-text-secondary, #62636c); white-space: nowrap; }',
      '.v2-mchip__dot { width: 6px; height: 6px; border-radius: 50%; flex: none; }',
      '.v2-mchip--goal { color: var(--v2-color-status-bug, #eb5757); font-weight: 600; }',
      /* Brain · recent (t-93 round 3) — same commit-row anatomy as the
         sample, fed from the real state.knowledge.recent (git log over the
         brain repo), not a placeholder link. */
      '.v2-commit-row { padding: var(--v2-space-2, 4px) 0; font-size: 11.5px; display: block; }',
      '.v2-commit-row__ts { color: var(--v2-color-text-muted, #71727c); font-size: 10.5px; margin-right: 5px; }',
      '.v2-commit-row__who { font-weight: 600; margin-right: 4px; }',
      '.v2-commit-row__msg { color: var(--v2-color-text-secondary, #62636c); display: block; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }',
      // Archived swimlane (t-167): the discarded band reads as muted — the
      // whole group is dimmed and its own "Archived" label plus the muted
      // status glyph carry the signal, no per-row border treatment needed
      // now that discarded rows share the one row anatomy (t-110's dashed
      // card rule retired with the cards themselves).
      '.v2-swim__group--discarded { opacity: .72; }'
    ].join('\n');
    document.head.appendChild(style);
  }
})();

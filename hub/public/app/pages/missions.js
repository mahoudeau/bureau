// The board. Columns by lane, or a row of them per project. Filters live in the
// URL so a view can be linked. Repaints are keyed, so the live feed never costs
// you your scroll or your place.

import { h, fill, on } from '../dom.js';
import * as store from '../store.js';
import { LANES, STATUSES, statusLane, statusWord, swatch } from '../status.js';
import { emptyState, relativeTime } from '../ui.js';
import { byPriority, evidenceOf, goalChildren, isGoal, lastTouched, projectIds, projectLabel, undecided } from '../desk/model.js';
import { keyed } from '../desk/keyed.js';
import { keep, missionHref, remember } from '../desk/parts.js';

const DONE_CAP = 8;
// Discarded has the Archive toggle, as a list of tombstones shouldn't be a chip.
const CHIP_STATUSES = Object.keys(STATUSES).filter((s) => s !== 'discarded');

const listParam = (query, name) => (query.get(name) || '').split(',').filter(Boolean);

function closedOrder(a, b) {
  return String(lastTouched(b)).localeCompare(String(lastTouched(a)));
}

function card(t, state) {
  const open = undecided(t).length;
  const pinned = t.status === 'approved' ? (t.items || []).filter((it) => it.verdict === 'approved' && it.payload) : [];
  const kids = isGoal(t) ? goalChildren(state.tasks, t.id) : [];
  const shots = evidenceOf(t.artifacts).current.length;
  return h('a', { class: 'om-card work-card', href: missionHref(t.id), title: `${t.id}: ${t.title}` },
    h('span', { class: 'work-card-top' },
      swatch(t.status),
      h('span', { class: 'work-card-id om-strong' }, t.id),
      h('span', { class: 'work-card-word om-meta' }, statusWord(t.status)),
      h('span', { class: 'om-grow' }),
      t.priority === 1 ? h('span', { class: 'om-tag om-tag-solid', title: 'Priority 1' }, 'P1') : null,
      t.priority === 2 ? h('span', { class: 'om-tag', title: 'Priority 2' }, 'P2') : null,
      h('span', { class: 'om-meta' }, relativeTime(t.created_at))),
    h('span', { class: 'work-card-title' }, t.title),
    h('span', { class: 'work-card-meta om-meta' },
      isGoal(t) ? h('span', { class: 'om-tag' }, 'Goal') : null,
      h('span', { class: 'om-clip' }, projectLabel(state, t.project)),
      t.assignee ? h('span', { class: 'om-clip om-strong' }, t.assignee) : null,
      t.reserved_for && !t.assignee ? h('span', { class: 'om-clip' }, `for ${t.reserved_for}`) : null,
      t.status === 'review' ? h('span', { class: t.gate === 'critic' ? 'om-tag' : 'om-tag om-tag-solid' }, t.gate === 'critic' ? 'Critic' : 'Boss') : null,
      open ? h('span', { class: 'om-tag' }, `${open} to rule`) : null,
      shots ? h('span', { class: 'work-card-count' }, `${shots} img`) : null,
      kids.length ? h('span', { class: 'work-card-count' }, `${kids.filter((k) => k.status === 'done').length}/${kids.length}`) : null,
      pinned.length ? h('span', { class: 'work-card-count' }, `applied ${pinned.filter((it) => it.applied_at).length}/${pinned.length}`) : null));
}

const cardSig = (t, state) => [t.title, t.status, t.gate, t.priority, t.project, t.assignee, t.reserved_for, undecided(t).length,
  relativeTime(t.created_at), evidenceOf(t.artifacts).current.length, projectLabel(state, t.project),
  isGoal(t) ? goalChildren(state.tasks, t.id).map((k) => k.status) : 0,
  t.status === 'approved' ? (t.items || []).map((it) => it.applied_at || '') : 0];

export async function render(ctx) {
  ctx.title('Missions');
  await store.ready();

  const collapsed = new Set(remember('boardCollapsed', []));
  let showAllDone = false;

  const q = ctx.query;
  const filters = {
    projects: new Set(listParam(q, 'project')),
    statuses: new Set(listParam(q, 'status').filter((s) => CHIP_STATUSES.includes(s))),
    archive: q.get('archive') === '1',
    group: q.get('group') === 'project' ? 'project' : 'status',
  };

  function syncUrl() {
    ctx.setQuery({
      project: [...filters.projects].sort().join(',') || null,
      status: [...filters.statuses].join(',') || null,
      archive: filters.archive ? '1' : null,
      group: filters.group === 'project' ? 'project' : null,
    });
  }

  function toggleCollapse(key) {
    if (collapsed.has(key)) collapsed.delete(key); else collapsed.add(key);
    keep('boardCollapsed', [...collapsed]);
    paint(store.getState());
  }

  // ---- Toolbar ----

  const projectBtn = h('button', { type: 'button', class: 'om-btn', 'aria-haspopup': 'true', 'aria-expanded': 'false' });
  const projectMenu = h('div', { class: 'work-menu', hidden: true });
  const projectWrap = h('div', { class: 'work-menu-wrap' }, projectBtn, projectMenu);
  const projectChips = h('div', { class: 'om-chips work-picked' });

  function setMenu(open) {
    projectMenu.hidden = !open;
    projectBtn.setAttribute('aria-expanded', String(open));
    if (open) paintMenu(store.getState());
  }
  projectBtn.addEventListener('click', () => setMenu(projectMenu.hidden));
  ctx.onCleanup(on(document, 'click', (e) => {
    if (!projectMenu.hidden && !projectWrap.contains(e.target)) setMenu(false);
  }));
  ctx.onCleanup(on(document, 'keydown', (e) => {
    if (e.key === 'Escape' && !projectMenu.hidden) {
      setMenu(false);
      projectBtn.focus();
    }
  }));

  function setProject(id, on_) {
    if (on_) filters.projects.add(id); else filters.projects.delete(id);
    syncUrl();
    paint(store.getState());
  }

  function paintMenu(state) {
    const ids = projectIds(state);
    const boxes = ids.map((id) => h('label', { class: 'om-check work-menu-item' },
      h('input', { type: 'checkbox', checked: filters.projects.has(id), onChange: (e) => setProject(id, e.target.checked) }),
      h('span', { class: 'om-clip' }, projectLabel(state, id))));
    fill(projectMenu, boxes.length ? boxes : h('p', { class: 'om-meta' }, 'No projects yet.'),
      h('div', { class: 'work-menu-foot' },
        h('button', {
          type: 'button',
          class: 'om-btn om-btn-ghost',
          disabled: !filters.projects.size,
          onClick() {
            filters.projects.clear();
            syncUrl();
            paint(store.getState());
          },
        }, 'All projects')));
  }

  const statusChips = h('div', { class: 'om-chips', role: 'group', 'aria-label': 'Filter by status' },
    CHIP_STATUSES.map((s) => h('button', {
      type: 'button',
      class: 'om-chip',
      dataset: { status: s },
      'aria-pressed': String(filters.statuses.has(s)),
      onClick(e) {
        if (filters.statuses.has(s)) filters.statuses.delete(s); else filters.statuses.add(s);
        e.currentTarget.setAttribute('aria-pressed', String(filters.statuses.has(s)));
        syncUrl();
        paint(store.getState());
      },
    }, swatch(s), statusWord(s))));

  const segStatus = h('button', { type: 'button' }, 'Status');
  const segProject = h('button', { type: 'button' }, 'Project');
  const group = h('div', { class: 'om-seg', role: 'group', 'aria-label': 'Group by' }, segStatus, segProject);
  const setGroup = (value) => {
    filters.group = value;
    syncUrl();
    paint(store.getState());
  };
  segStatus.addEventListener('click', () => setGroup('status'));
  segProject.addEventListener('click', () => setGroup('project'));

  const archiveBtn = h('button', {
    type: 'button',
    class: 'om-btn',
    onClick() {
      filters.archive = !filters.archive;
      syncUrl();
      paint(store.getState());
    },
  });

  const newLink = h('a', { class: 'om-btn om-btn-primary work-new-link', href: '/missions/new' }, 'New mission');

  const board = h('div', { class: 'work-board' });
  const empty = h('div', { hidden: true });
  const page = h('div', { class: 'app-page work-page work-board-page' },
    h('div', { class: 'work-board-head' },
      h('h1', { class: 'om-display om-h2' }, 'Missions'),
      h('div', { class: 'work-toolbar' },
        projectWrap,
        h('span', { class: 'work-toolbar-label om-label' }, 'Group'), group,
        archiveBtn,
        newLink)),
    h('div', { class: 'work-filters' }, statusChips, projectChips),
    empty, board);

  // ---- Lanes ----

  function laneFor(key, label, dither, scope) {
    const collapseKey = `${scope}:${key}`;
    const headCount = h('span', { class: 'work-lane-count' });
    const button = h('button', { type: 'button', class: 'work-lane-head', onClick: () => toggleCollapse(collapseKey) },
      h('span', { class: 'work-lane-word om-label' }, label), headCount, h('span', { class: 'work-caret', 'aria-hidden': 'true' }));
    const cards = h('div', { class: 'work-cards' });
    const foot = h('div', { class: 'work-lane-foot' });
    const band = h('div', { class: `app-strip ${dither}`, 'aria-hidden': 'true' });
    const body = h('div', { class: 'work-lane-body' }, cards, foot);
    const el = h('section', { class: 'work-lane', dataset: { lane: key }, 'aria-label': label }, band, button, body);
    el.paintLane = (tasks, state) => {
      const isClosed = key === 'closed';
      const done = isClosed ? tasks.filter((t) => t.status === 'done') : [];
      const capped = isClosed && done.length > DONE_CAP && !showAllDone;
      const keep_ = capped ? new Set(done.slice(0, DONE_CAP).map((t) => t.id)) : null;
      const shown = capped ? tasks.filter((t) => t.status !== 'done' || keep_.has(t.id)) : tasks;
      headCount.textContent = String(tasks.length);
      const isCollapsed = collapsed.has(collapseKey);
      el.classList.toggle('is-collapsed', isCollapsed);
      button.setAttribute('aria-expanded', String(!isCollapsed));
      body.hidden = isCollapsed;
      keyed(cards, shown, { key: (t) => t.id, sig: (t) => cardSig(t, state), create: (t) => card(t, state) });
      if (isClosed && done.length > DONE_CAP) {
        fill(foot, h('button', {
          type: 'button',
          class: 'om-btn om-btn-ghost',
          onClick() {
            showAllDone = !showAllDone;
            paint(store.getState());
          },
        }, showAllDone ? 'Show fewer' : `Show all ${done.length} done`));
      } else if (!tasks.length) {
        fill(foot, h('p', { class: 'work-lane-none om-meta' }, 'Nothing here.'));
      } else {
        foot.replaceChildren();
      }
    };
    return el;
  }

  function lanesOf(tasks) {
    const groups = new Map(LANES.map((l) => [l.key, []]));
    for (const t of tasks) {
      const lane = statusLane(t.status);
      if (groups.has(lane)) groups.get(lane).push(t);
    }
    for (const [key, list] of groups) list.sort(key === 'closed' ? closedOrder : byPriority);
    return groups;
  }

  // One set of lane columns. Which lanes exist never changes, so the nodes stay.
  function paintLanes(host, tasks, state, scope) {
    if (!host.laneNodes) {
      host.laneNodes = LANES.map((l) => laneFor(l.key, l.word, l.dither, scope));
      fill(host, host.laneNodes);
    }
    const groups = lanesOf(tasks);
    LANES.forEach((l, i) => host.laneNodes[i].paintLane(groups.get(l.key), state));
  }

  function projectRow(p) {
    const lanes = h('div', { class: 'work-lanes' });
    const count = h('span', { class: 'work-lane-count' });
    const head = h('button', { type: 'button', class: 'work-swim-head', onClick: () => toggleCollapse(`swim:${p.id}`) },
      h('span', { class: 'om-label' }, p.label), count, h('span', { class: 'work-caret', 'aria-hidden': 'true' }));
    const el = h('section', { class: 'work-swim', dataset: { project: p.id }, 'aria-label': p.label }, head, lanes);
    el.paintRow = (next, state) => {
      count.textContent = String(next.tasks.length);
      const closed = collapsed.has(`swim:${next.id}`);
      el.classList.toggle('is-collapsed', closed);
      head.setAttribute('aria-expanded', String(!closed));
      lanes.hidden = closed;
      paintLanes(lanes, next.tasks, state, `swim-${next.id}`);
    };
    return el;
  }

  let mode = null;
  let columns = null;
  let swims = null;

  function paint(state) {
    if (!state) return;
    const all = state.tasks || [];
    const known = new Set(projectIds(state));
    const archived = all.filter((t) => t.status === 'discarded' && (!filters.projects.size || filters.projects.has(t.project)));
    const visible = all.filter((t) => {
      if (filters.projects.size && !filters.projects.has(t.project)) return false;
      if (t.status === 'discarded') return filters.archive;
      if (filters.statuses.size && !filters.statuses.has(t.status)) return false;
      return true;
    });

    const n = filters.projects.size;
    projectBtn.textContent = n ? `${n} project${n === 1 ? '' : 's'}` : 'All projects';
    projectBtn.setAttribute('aria-pressed', String(!!n));
    if (!projectMenu.hidden) paintMenu(state);
    fill(projectChips, [...filters.projects].sort().map((id) => h('button', {
      type: 'button',
      class: 'om-chip',
      'aria-pressed': 'true',
      'aria-label': `Stop filtering on ${projectLabel(state, id)}`,
      title: known.has(id) ? 'Remove this filter' : 'This project is gone. Remove this filter',
      onClick: () => setProject(id, false),
    }, projectLabel(state, id), h('span', { 'aria-hidden': 'true' }, ' x'))));

    segStatus.setAttribute('aria-pressed', String(filters.group === 'status'));
    segProject.setAttribute('aria-pressed', String(filters.group === 'project'));
    archiveBtn.textContent = `Archive ${archived.length}`;
    archiveBtn.setAttribute('aria-pressed', String(filters.archive));
    archiveBtn.classList.toggle('om-btn-primary', filters.archive);
    newLink.setAttribute('href', n === 1 ? `/missions/new?project=${encodeURIComponent([...filters.projects][0])}` : '/missions/new');

    if (mode !== filters.group) {
      mode = filters.group;
      columns = h('div', { class: 'work-lanes' });
      swims = h('div', { class: 'work-swims' });
      fill(board, mode === 'status' ? columns : swims);
    }
    if (mode === 'status') {
      paintLanes(columns, visible, state, 'lane');
    } else {
      const byProject = new Map();
      for (const t of visible) {
        if (!byProject.has(t.project)) byProject.set(t.project, []);
        byProject.get(t.project).push(t);
      }
      const rows = [...byProject.entries()].map(([id, tasks]) => ({ id, label: projectLabel(state, id), tasks }))
        .sort((a, b) => a.label.localeCompare(b.label));
      keyed(swims, rows, { key: (r) => r.id, sig: (r) => [r.label], create: projectRow })
        .forEach((el, i) => el.paintRow(rows[i], state));
    }

    const nothing = !visible.length;
    empty.hidden = !nothing;
    board.hidden = nothing;
    if (nothing && !empty.children.length) {
      const filtered = filters.projects.size || filters.statuses.size;
      fill(empty, emptyState(filtered ? 'Nothing matches these filters' : 'No missions yet', null,
        filtered
          ? h('button', {
            type: 'button',
            class: 'om-btn',
            onClick() {
              filters.projects.clear();
              filters.statuses.clear();
              statusChips.querySelectorAll('.om-chip').forEach((c) => c.setAttribute('aria-pressed', 'false'));
              syncUrl();
              paint(store.getState());
            },
          }, 'Clear filters')
          : h('a', { class: 'om-btn om-btn-primary', href: '/missions/new' }, 'New mission')));
    } else if (!nothing) {
      empty.replaceChildren();
    }
  }

  ctx.onCleanup(store.subscribe(paint));
  return page;
}

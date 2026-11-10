// The command palette. Cmd/Ctrl+K, or the search button. The only overlay in the
// app. Jump to a page, a project or a mission, search the brain, or make a
// mission from what you typed.
//
// Enter opens the highlighted row, and the top result starts highlighted. Making
// a mission is its own row: Enter on it when it's highlighted, or Cmd/Ctrl+Enter
// from anywhere. It only starts highlighted when nothing matches, and never while
// the brain is still answering, so a search can't file a mission by accident.

import * as api from './api.js';
import * as store from './store.js';
import { fill, h } from './dom.js';
import { onSearch } from './layout.js';
import { navigate } from './router.js';
import { getTheme, setTheme, THEMES } from './theme.js';
import { toast } from './ui.js';
import { plainText, slugify } from './markdown.js';
import { swatch, statusWord } from './status.js';

const PROJECT_KEY = 'bureau_palette_project';
const DEBOUNCE_MS = 180;
const MAX_MISSIONS = 5;
const MAX_BRAIN = 8;
const isMac = /mac|iphone|ipad/i.test(navigator.platform);

const PAGES = [
  ['Desk', '/'],
  ['Missions', '/missions'],
  ['Goals', '/goals'],
  ['Brain', '/brain'],
  ['Agents', '/agents'],
  ['Office', '/office'],
  ['Projects', '/projects'],
  ['Activity', '/activity'],
  ['Settings', '/settings'],
];

let session = null; // the open palette's closures, or null

const remembered = () => {
  try { return localStorage.getItem(PROJECT_KEY) || ''; } catch { return ''; }
};
const remember = (id) => {
  try { localStorage.setItem(PROJECT_KEY, id); } catch { /* it just won't stick */ }
};

// The project you seem to be in: from the URL, then the last one used.
function currentProject(projects) {
  const path = location.pathname;
  const state = store.getState();
  let id = null;
  const m = /^\/(?:brain\/projects|projects)\/([^/]+)/.exec(path) || null;
  if (m) {
    try { id = decodeURIComponent(m[1]); } catch { id = m[1]; }
  }
  const mission = /^\/missions\/(t-\d+)/.exec(path);
  if (mission && state) {
    const task = (state.tasks || []).find((t) => t.id === mission[1]);
    if (task) id = task.project;
  }
  const has = (x) => projects.some((p) => p.id === x);
  if (id && has(id)) return id;
  if (has(remembered())) return remembered();
  if (has('general')) return 'general';
  return projects.length ? projects[0].id : '';
}

function matchMissions(tasks, q) {
  const needle = q.toLowerCase();
  const words = needle.split(/\s+/).filter(Boolean);
  const scored = [];
  for (const t of tasks) {
    const id = String(t.id).toLowerCase();
    const title = String(t.title || '').toLowerCase();
    let score = 0;
    if (id === needle) score = 100;
    else if (id.startsWith(needle)) score = 60;
    else if (title.startsWith(needle)) score = 50;
    else if (title.includes(needle)) score = 40;
    else if (words.length && words.every((w) => title.includes(w))) score = 30;
    if (!score) continue;
    if (t.status === 'discarded') score -= 20;
    scored.push({ t, score });
  }
  scored.sort((a, b) => b.score - a.score || String(b.t.id).localeCompare(String(a.t.id), undefined, { numeric: true }));
  return { list: scored.slice(0, MAX_MISSIONS).map((x) => x.t), total: scored.length };
}

const contains = (text, q) => text.toLowerCase().includes(q.toLowerCase());

// The text with each place it matches what you typed marked, so you can see
// why a row is there.
function marked(text, q) {
  const s = String(text);
  const needles = [q.trim(), ...q.trim().split(/\s+/)].filter((w) => w.length).map((w) => w.toLowerCase());
  const lower = s.toLowerCase();
  const hits = [];
  for (const n of needles) {
    let at = lower.indexOf(n);
    while (at !== -1 && n) {
      hits.push([at, at + n.length]);
      at = lower.indexOf(n, at + n.length);
    }
    if (hits.length && n === needles[0]) break; // the whole query matched, that's enough
  }
  if (!hits.length) return s;
  hits.sort((a, b) => a[0] - b[0]);
  const out = [];
  let from = 0;
  for (const [a, b] of hits) {
    if (a < from) continue;
    if (a > from) out.push(s.slice(from, a));
    out.push(h('b', { class: 'pal-hit' }, s.slice(a, b)));
    from = b;
  }
  if (from < s.length) out.push(s.slice(from));
  return out;
}

const icon = (name) => h('i', { class: `om-icon om-i-${name}`, 'aria-hidden': 'true' });

function open(initial = '') {
  if (session) {
    session.focusInput();
    if (initial) session.setQuery(initial);
    return;
  }
  if (!api.getToken() || location.pathname === '/sign-in') return;
  store.start(); // a public page hasn't started it

  const previous = document.activeElement;
  const appRoot = document.getElementById('app');
  let query = '';
  let selectedKey = null;
  let picked = false; // true once you chose a row, so results landing don't move it
  let lastPointer = null;
  let rows = [];
  let brain = { state: 'idle', results: [], q: '', scope: null };
  let controller = null;
  let timer = null;
  let busy = false;
  let wantedProject = '';

  const stateNow = () => store.getState() || {};
  const projects = () => stateNow().projects || [];

  // ---- what's on offer ----

  const projectRow = (p) => ({
    key: `project:${p.id}`,
    icon: 'folder',
    title: p.label || p.id,
    meta: p.id,
    run: () => go(`/projects/${encodeURIComponent(p.id)}`),
  });
  const pageRow = ([label, href]) => ({ key: `page:${href}`, icon: 'arrow-right', title: label, meta: href, run: () => go(href) });
  const missionRow = (t) => ({
    key: `mission:${t.id}`,
    status: t.status,
    id: t.id,
    title: t.title || t.id,
    meta: statusWord(t.status),
    run: () => go(`/missions/${t.id}`),
  });
  const themeRow = (name) => ({
    key: `theme:${name}`,
    icon: 'eye',
    title: `Theme: ${name}`,
    meta: getTheme() === name ? 'current' : '',
    run: () => { setTheme(name); close(); },
  });

  function brainRows() {
    if (brain.state === 'loading') return [{ key: 'brain:wait', still: true, title: 'Searching the brain', wait: true }];
    if (brain.state === 'error') return [{ key: 'brain:error', still: true, title: "Couldn't search the brain.", meta: brain.message }];
    if (brain.state === 'done' && !brain.results.length) return [{ key: 'brain:none', still: true, title: 'Nothing in the brain matches.' }];
    return brain.results.slice(0, MAX_BRAIN).map((r, i) => ({
      key: `brain:${r.file}:${r.line}:${i}`,
      icon: 'file',
      title: r.section ? `${baseName(r.file)} / ${r.section}` : baseName(r.file),
      sub: plainText(r.text).slice(0, 140),
      meta: r.file.includes('/') ? r.file.slice(0, r.file.lastIndexOf('/')) : '',
      run: () => go(`/brain/${r.file.split('/').map(encodeURIComponent).join('/')}${r.claim ? `#${r.claim}` : r.section ? `#${slugify(r.section)}` : ''}`),
    }));
  }

  function groups() {
    const q = query.trim();
    if (!q) {
      return [
        { label: 'Go to', rows: PAGES.map(pageRow) },
        { label: 'New', rows: [
          { key: 'new:mission', icon: 'plus', maker: true, title: 'New mission', meta: '/missions/new', run: () => go('/missions/new') },
          { key: 'new:goal', icon: 'plus', maker: true, title: 'New goal', meta: '/goals/new', run: () => go('/goals/new') },
          { key: 'new:project', icon: 'plus', maker: true, title: 'New project', meta: '/projects', run: () => go('/projects') },
        ] },
        { label: 'Theme', rows: THEMES.map(themeRow) },
      ];
    }

    const matched = matchMissions(stateNow().tasks || [], q);
    const missions = matched.list;
    const pages = PAGES.filter(([label]) => contains(label, q));
    const projs = projects().filter((p) => contains(p.id, q) || contains(p.label || '', q));
    const lower = q.toLowerCase();
    const exactMission = missions.find((t) => String(t.id).toLowerCase() === lower);
    const exactPage = pages.find(([label]) => label.toLowerCase() === lower);
    const exactProject = projs.find((p) => p.id.toLowerCase() === lower || String(p.label || '').toLowerCase() === lower);

    const project = wantedProject;
    const create = {
      label: 'Create',
      rows: [{
        key: 'create',
        icon: 'plus',
        maker: true,
        title: 'New mission',
        query: q,
        meta: project ? `in ${project}` : '',
        run: () => createMission(q, project),
      }],
    };
    const moreMissions = matched.total - missions.length;
    const found = [
      { label: 'Missions', count: matched.total, rows: [
        ...missions.map(missionRow),
        ...(moreMissions > 0 ? [{ key: 'missions:more', still: true, title: `${moreMissions} more match. Type more to narrow it.` }] : []),
      ] },
      { label: 'Pages', rows: pages.map(pageRow) },
      { label: 'Projects', rows: projs.map(projectRow) },
    ];
    const brainGroup = q.length >= 2 ? [{
      label: brain.scope && brain.scope.project ? `Brain, ${brain.scope.project} and global` : 'Brain, global',
      rows: brainRows(),
    }] : [];
    const themes = THEMES.filter((name) => contains(`theme ${name} ${name === 'ink' ? 'dark' : name === 'paper' ? 'light' : ''}`, q));
    const more = {
      label: 'More',
      rows: [
        { key: 'create:project', icon: 'plus', maker: true, title: 'New project', query: q, run: () => createProject(q) },
        { key: 'create:goal', icon: 'plus', maker: true, title: 'New goal', query: q, run: () => go(`/goals/new?title=${encodeURIComponent(q)}`) },
        ...themes.map(themeRow),
      ],
    };
    // What you typed exactly goes first, so Enter opens it. With local matches,
    // Create sits right under them; with none, under whatever the brain finds.
    const exact = exactMission ? found[0] : exactPage ? found[1] : exactProject ? found[2] : null;
    const local = exact ? [exact, ...found.filter((g) => g !== exact)] : found;
    const hasLocal = local.some((g) => g.rows.length);
    const ordered = hasLocal
      ? [...local, create, ...brainGroup, more]
      : [...brainGroup, create, more];
    return ordered.filter((g) => g.rows.length);
  }

  // The row that starts highlighted: the top result. Create only when there are
  // none, and nothing at all while the brain might still add one.
  function defaultKey() {
    const top = rows.find((r) => !r.still && !r.maker);
    if (top) return top.key;
    if (brain.state === 'loading') return null;
    const create = rows.find((r) => r.key === 'create');
    return create ? create.key : null;
  }

  const baseName = (file) => file.slice(file.lastIndexOf('/') + 1).replace(/\.md$/, '');

  // ---- actions ----

  function go(href) {
    close();
    navigate(href);
  }

  function fail(message) {
    fill(error, message);
    error.hidden = false;
  }

  async function createMission(title, project) {
    if (busy) return;
    if (!project) { fail('Make a project first.'); return; }
    busy = true;
    try {
      const r = await api.post('/api/tasks', { title, project, created_by: 'human' });
      const id = r && r.task && r.task.id;
      remember(project);
      close();
      toast(h('span', null, id ? h('a', { class: 'om-link', href: `/missions/${id}` }, id) : 'Mission', ` created in ${project}.`));
    } catch (e) {
      busy = false;
      fail(e.message || "Couldn't make the mission.");
    }
  }

  async function createProject(label) {
    if (busy) return;
    busy = true;
    try {
      const r = await api.post('/api/projects', { label });
      const id = r && r.project && r.project.id;
      close();
      toast(h('span', null, 'Project ', h('a', { class: 'om-link', href: `/projects/${encodeURIComponent(id)}` }, id), ' created.'));
    } catch (e) {
      busy = false;
      fail(e.message || "Couldn't make the project.");
    }
  }

  // ---- the brain, asked once typing stops ----

  function askBrain() {
    clearTimeout(timer);
    if (controller) controller.abort();
    controller = null;
    const q = query.trim();
    if (q.length < 2) {
      brain = { state: 'idle', results: [], q: '', scope: null };
      return;
    }
    brain = { ...brain, state: 'loading' };
    timer = setTimeout(() => {
      const mine = new AbortController();
      controller = mine;
      const project = searchProject();
      const search = (withProject) => api.get(`/api/knowledge/search?q=${encodeURIComponent(q)}&k=${MAX_BRAIN}${withProject ? `&project=${encodeURIComponent(withProject)}` : ''}`, { signal: mine.signal });
      // A project this token can't search falls back to the global brain.
      search(project).catch((e) => {
        if (project && e.status === 403) return search(null);
        throw e;
      }).then((r) => {
        if (mine !== controller) return;
        brain = { state: 'done', results: (r && r.results) || [], q, scope: r && r.scope };
        paint();
      }).catch((e) => {
        if (mine !== controller || api.isAbort(e)) return;
        brain = { state: 'error', results: [], q, scope: null, message: e.message };
        paint();
      });
    }, DEBOUNCE_MS);
  }

  function searchProject() {
    const m = /^\/brain\/projects\/([^/]+)/.exec(location.pathname);
    if (!m) return wantedProject || null;
    try { return decodeURIComponent(m[1]); } catch { return m[1]; }
  }

  // ---- the page itself ----

  const list = h('div', { class: 'pal-list', id: 'pal-list', role: 'listbox', 'aria-label': 'Results' });
  const input = h('input', {
    class: 'om-palette-input',
    type: 'text',
    role: 'combobox',
    'aria-expanded': 'true',
    'aria-controls': 'pal-list',
    'aria-autocomplete': 'list',
    'aria-label': 'Search, or type a mission title',
    placeholder: 'Search, or type a mission title',
    autocomplete: 'off',
    autocapitalize: 'off',
    spellcheck: 'false',
    onInput() {
      query = input.value;
      selectedKey = null;
      picked = false;
      error.hidden = true;
      askBrain();
      paint();
    },
  });
  const error = h('p', { class: 'pal-error', role: 'alert', hidden: true });
  const projectSelect = h('select', {
    class: 'om-select om-input-sm pal-project',
    'aria-label': 'Project for a new mission',
    onChange() {
      wantedProject = projectSelect.value;
      remember(wantedProject);
      if (query.trim().length >= 2) askBrain();
      paint();
    },
  });
  const hint = h('span', { class: 'om-data-s pal-hint' });
  const closeBtn = h('button', { type: 'button', class: 'om-btn om-btn-ghost om-btn-sm pal-close', 'aria-label': 'Close', onClick: () => close() }, h('span', { class: 'om-kbd' }, 'Esc'));

  const dialog = h('div', { class: 'om-dialog om-palette', role: 'dialog', 'aria-modal': 'true', 'aria-label': 'Command palette' },
    h('div', { class: 'pal-search' }, icon('search'), input),
    list,
    error,
    h('div', { class: 'pal-foot' },
      h('label', { class: 'pal-project-label' }, h('span', { class: 'om-label' }, 'Project'), h('span', { class: 'om-select-wrap' }, projectSelect)),
      hint,
      closeBtn));
  const scrim = h('div', {
    class: 'om-scrim pal-scrim',
    onMousedown(e) { if (e.target === scrim) close(); },
  }, dialog);

  function fillProjects() {
    const list2 = projects();
    wantedProject = wantedProject || currentProject(list2);
    fill(projectSelect, list2.map((p) => h('option', { value: p.id, selected: p.id === wantedProject }, p.label || p.id)));
    projectSelect.disabled = !list2.length;
  }

  function selectedIndex() {
    const i = rows.findIndex((r) => r.key === selectedKey && !r.still);
    return i;
  }

  function markSelected() {
    const nodes = list.querySelectorAll('[role="option"]');
    let active = null;
    nodes.forEach((node) => {
      const on = node.dataset.key === selectedKey;
      node.setAttribute('aria-selected', String(on));
      if (on) active = node;
    });
    if (active) {
      input.setAttribute('aria-activedescendant', active.id);
      active.scrollIntoView({ block: 'nearest' });
    } else {
      input.removeAttribute('aria-activedescendant');
    }
    hint.textContent = hintFor();
  }

  function hintFor() {
    const row = rows[selectedIndex()];
    const direct = rows.some((r) => r.key === 'create') ? ` ${isMac ? 'Cmd' : 'Ctrl'}+Enter makes a mission.` : '';
    if (!row) return brain.state === 'loading' ? `Searching.${direct}` : 'Esc closes';
    if (row.key === 'create') return 'Enter makes this mission.';
    return `Enter opens. Arrows move.${direct}`;
  }

  function paint() {
    const made = groups();
    rows = made.flatMap((g) => g.rows);
    if (!picked || !rows.some((r) => r.key === selectedKey && !r.still)) {
      picked = false;
      selectedKey = defaultKey();
    }
    let n = 0;
    const q = query.trim();
    fill(list, made.map((g, gi) => {
      const labelId = `pal-g${gi}`;
      const live = g.rows.filter((r) => !r.still).length;
      const count = g.count !== undefined ? g.count : live;
      return h('div', { role: 'group', 'aria-labelledby': labelId, class: 'pal-group' },
        h('div', { class: 'om-label pal-group-label', id: labelId },
          h('span', null, g.label),
          q && count > 1 ? h('span', { class: 'pal-group-count' }, String(count)) : null),
        g.rows.map((r) => {
          const id = `pal-o${n++}`;
          if (r.still) {
            return h('div', { class: 'pal-still', role: 'presentation' },
              r.wait ? h('div', { class: 'om-wait' }) : null,
              h('span', { class: 'om-data-s' }, r.title));
          }
          const lead = r.status ? swatch(r.status) : r.icon ? icon(r.icon) : null;
          return h('div', {
            class: ['om-row', 'pal-row', r.maker && 'pal-maker'],
            id,
            role: 'option',
            'aria-selected': 'false',
            dataset: { key: r.key },
            onClick: () => run(r),
            onMousemove(e) {
              // A repaint under a resting pointer also fires this. Only a real
              // move counts as choosing a row.
              const at = `${e.screenX},${e.screenY}`;
              if (at === lastPointer) return;
              const first = lastPointer === null;
              lastPointer = at;
              if (first || selectedKey === r.key) return;
              selectedKey = r.key;
              picked = true;
              markSelected();
            },
          },
          h('span', { class: 'pal-lead' }, lead),
          r.id ? h('span', { class: 'om-row-id' }, r.maker || !q ? r.id : marked(r.id, q)) : null,
          h('span', { class: 'pal-main' },
            h('span', { class: 'pal-title' },
              r.maker || !q ? r.title : marked(r.title, q),
              r.query ? [' ', h('span', { class: 'pal-query' }, `"${r.query}"`)] : null),
            r.sub ? h('span', { class: 'pal-sub' }, r.sub) : null),
          r.meta ? h('span', { class: 'pal-meta' }, r.meta) : null);
        }));
    }));
    markSelected();
  }

  function run(row) {
    error.hidden = true;
    row.run();
  }

  function move(delta) {
    const live = rows.filter((r) => !r.still);
    if (!live.length) return;
    const at = live.findIndex((r) => r.key === selectedKey);
    const next = at === -1 ? 0 : (at + delta + live.length) % live.length;
    selectedKey = live[next].key;
    picked = true;
    markSelected();
  }

  function trapTab(e) {
    const focusable = [input, projectSelect, closeBtn].filter((el) => !el.disabled);
    const at = focusable.indexOf(document.activeElement);
    e.preventDefault();
    const next = at === -1 ? 0 : (at + (e.shiftKey ? -1 : 1) + focusable.length) % focusable.length;
    focusable[next].focus();
  }

  function onKey(e) {
    if (e.isComposing) return;
    if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      close();
    } else if (e.key === 'Tab') {
      trapTab(e);
    } else if (document.activeElement === input || document.activeElement === document.body) {
      if (e.key === 'ArrowDown') { e.preventDefault(); move(1); }
      else if (e.key === 'ArrowUp') { e.preventDefault(); move(-1); }
      else if (e.key === 'Enter') {
        e.preventDefault();
        const row = rows.find((r) => r.key === (e.metaKey || e.ctrlKey ? 'create' : selectedKey));
        if (row) run(row);
      }
    }
  }

  function close() {
    if (!session) return;
    session = null;
    clearTimeout(timer);
    if (controller) controller.abort();
    document.removeEventListener('keydown', onKey, true);
    off();
    scrim.remove();
    if (appRoot) appRoot.inert = false;
    document.documentElement.classList.remove('pal-open');
    if (previous && previous.isConnected && previous !== document.body) previous.focus({ preventScroll: true });
    else {
      const main = document.getElementById('main');
      if (main) main.focus({ preventScroll: true });
    }
  }

  const off = store.subscribe(() => {
    if (!session) return;
    const before = projectSelect.options.length;
    if (before !== projects().length) fillProjects();
    paint();
  });

  session = {
    close,
    focusInput: () => { input.focus(); input.select(); },
    setQuery(text) {
      input.value = text;
      query = text;
      selectedKey = null;
      picked = false;
      askBrain();
      paint();
    },
  };

  if (appRoot) appRoot.inert = true;
  document.documentElement.classList.add('pal-open');
  document.body.append(scrim);
  document.addEventListener('keydown', onKey, true);
  fillProjects();
  if (initial) session.setQuery(initial);
  else paint();
  input.focus();
  if (initial) input.select();
}

export const openPalette = open;

export function closePalette() {
  if (session) session.close();
}

onSearch(() => open());

window.addEventListener('keydown', (e) => {
  if (e.key.toLowerCase() !== 'k' || e.shiftKey || e.altKey || e.isComposing) return;
  // Ctrl+K on a Mac is kill-line in every text field, so it's left alone there.
  if (isMac ? !(e.metaKey && !e.ctrlKey) : !(e.ctrlKey && !e.metaKey)) return;
  if (session) {
    e.preventDefault();
    session.close();
    return;
  }
  if (!api.getToken() || location.pathname === '/sign-in') return;
  e.preventDefault();
  open();
});

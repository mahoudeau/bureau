// The project table, and where a new project starts. Set up once, then left
// alone, which is why none of this is on the Desk.

import { h } from '../dom.js';
import * as api from '../api.js';
import * as store from '../store.js';
import { emptyState } from '../ui.js';
import { field, isClosed, livePainter, message, pageHead, refusal, table } from '../setup/kit.js';
import { approvalWord } from '../setup/approval.js';

function createForm(ctx, close) {
  const label = h('input', { class: 'om-input', required: true, autocomplete: 'off' });
  const id = h('input', { class: 'om-input', autocomplete: 'off', spellcheck: 'false' });
  const entity = h('input', { class: 'om-input', autocomplete: 'off', spellcheck: 'false' });
  const repo = h('input', { class: 'om-input', type: 'url', autocomplete: 'off', spellcheck: 'false', placeholder: 'https://github.com/you/repo.git' });
  const error = message();
  const submit = h('button', { type: 'submit', class: 'om-btn om-btn-primary' }, 'Create project');

  async function send(e) {
    e.preventDefault();
    error.clear();
    const name = label.value.trim();
    if (!name) {
      error.say('A project needs a label.');
      return;
    }
    const body = { label: name };
    if (id.value.trim()) body.id = id.value.trim();
    if (entity.value.trim()) body.entity = entity.value.trim();
    if (repo.value.trim()) body.repo = repo.value.trim();
    submit.disabled = true;
    try {
      const out = await api.post('/api/projects', body, { signal: ctx.signal });
      await store.refresh().catch(() => {});
      ctx.navigate(`/projects/${encodeURIComponent(out.project.id)}`);
    } catch (err) {
      if (api.isAbort(err)) return;
      error.say(refusal(err));
      submit.disabled = false;
    }
  }

  const form = h('form', { class: 'set-form om-panel', novalidate: true, onSubmit: send },
    h('h2', { class: 'om-label' }, 'New project'),
    field('Label', label),
    field('Id', id, 'Letters, digits, dot, dash, underscore. Made from the label if you leave it empty. Missions and the brain folder use it.'),
    field('Entity', entity, 'Optional. The scope wall this project sits behind.'),
    field('Repo', repo, 'Optional. The https clone URL.'),
    error.el,
    h('div', { class: 'om-row' },
      submit,
      h('button', { type: 'button', class: 'om-btn om-btn-ghost', onClick: close }, 'Cancel')));
  setTimeout(() => label.focus(), 0);
  return form;
}

function build(state, settings) {
  const projects = state.projects || [];
  if (!projects.length) {
    return h('div', null, emptyState('No projects yet', 'A project groups missions, sets how many run at once, and decides who approves them.'));
  }
  const open = {};
  for (const t of state.tasks) if (t.project && !isClosed(t)) open[t.project] = (open[t.project] || 0) + 1;
  return h('div', null, table([
    {
      label: 'Name',
      cell: (p) => h('span', { class: 'set-pname' },
        h('a', { class: 'om-link om-strong', href: `/projects/${encodeURIComponent(p.id)}`, dataset: { k: p.id } }, p.label || p.id),
        p.label && p.label !== p.id ? h('span', { class: 'om-meta' }, p.id) : null),
    },
    { label: 'Entity', cell: (p) => p.entity || '' },
    { label: 'Open', cell: (p) => String(open[p.id] || 0) },
    { label: 'Capacity', cell: (p) => String(p.capacity || 1) },
    { label: 'Approval', cell: (p) => (settings ? approvalWord(settings, p.id) : '') },
  ], projects));
}

export async function render(ctx) {
  let state = await store.ready();
  let settings = null;
  try {
    settings = (await api.get('/api/settings', { signal: ctx.signal })).settings;
  } catch (err) {
    if (api.isAbort(err)) throw err;
    /* the table still works without the approval column's words */
  }

  const list = h('div');
  const painter = livePainter(list, () => build(state, settings));
  painter.paint();
  ctx.onCleanup(store.subscribe((next) => { state = next; painter.paint(); }));
  ctx.onCleanup(painter.stop);

  const slot = h('div');
  const button = h('a', { class: 'om-btn om-btn-primary', href: '/projects?new=1', onClick: openForm }, 'New project');

  function closeForm() {
    slot.replaceChildren();
    button.hidden = false;
    ctx.setQuery({ new: null });
  }
  function showForm() {
    slot.replaceChildren(createForm(ctx, closeForm));
    button.hidden = true;
  }
  function openForm(e) {
    e.preventDefault();
    ctx.setQuery({ new: '1' });
    showForm();
  }
  if (ctx.query.get('new')) showForm();

  return h('div', { class: 'app-page set-page' }, pageHead('Projects', button), slot, list);
}

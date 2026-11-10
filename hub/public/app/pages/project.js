// One project: its fields behind an explicit Save, its missions, and the two
// things that can't be undone by accident.

import { h } from '../dom.js';
import * as api from '../api.js';
import * as store from '../store.js';
import { confirmButton, emptyState, toast } from '../ui.js';
import { byStatus, crumbs, field, isClosed, livePainter, message, missionRow, pageHead, refusal, section } from '../setup/kit.js';
import { projectSelect } from '../setup/approval.js';

const CLOSED_SHOWN = 8;

// A clone URL, as something a person would write down.
function tidyRepo(url) {
  try {
    const u = new URL(url);
    const path = u.pathname.replace(/^\/|\.git$|\/$/g, '');
    return u.hostname === 'github.com' ? path : `${u.hostname}/${path}`;
  } catch {
    return url;
  }
}

function repoField(project) {
  const input = h('input', { class: 'om-input', type: 'url', autocomplete: 'off', spellcheck: 'false', placeholder: 'https://github.com/you/repo.git', 'aria-labelledby': 'repo-label', value: project.repo || '' });
  const editing = h('div', { hidden: !!project.repo }, input);
  const link = h('div', { class: 'om-cluster om-cluster-3', hidden: !project.repo },
    project.repo ? h('a', { class: 'om-link', href: project.repo, target: '_blank', rel: 'noopener noreferrer' }, tidyRepo(project.repo)) : null,
    h('button', {
      type: 'button',
      class: 'om-btn',
      onClick() {
        link.hidden = true;
        editing.hidden = false;
        input.focus();
      },
    }, 'Change'));
  return {
    el: h('div', { class: 'om-field' },
      h('span', { class: 'om-label', id: 'repo-label' }, 'Repo'),
      link, editing,
      h('p', { class: 'om-meta set-hint' }, 'The https clone URL. Empty clears it.')),
    value: () => input.value.trim(),
    input,
  };
}

function missions(state, id, showAll, onShowAll) {
  const inProject = state.tasks.filter((t) => t.project === id);
  const open = inProject.filter((t) => !isClosed(t)).sort(byStatus);
  const closed = inProject.filter(isClosed).sort(byStatus);
  const closedShown = showAll ? closed : closed.slice(0, CLOSED_SHOWN);
  if (!inProject.length) {
    return h('div', null, emptyState('No missions in this project', null, h('a', { class: 'om-link', href: '/missions/new' }, 'New mission')));
  }
  return h('div', { class: 'set-sections' },
    open.length ? section('Open missions', String(open.length), h('div', { class: 'om-list set-flush' }, open.map((t) => missionRow(t)))) : null,
    closed.length ? section('Closed missions', String(closed.length),
      h('div', { class: 'om-list set-flush' }, closedShown.map((t) => missionRow(t))),
      closed.length > closedShown.length
        ? h('button', { type: 'button', class: 'om-btn', dataset: { k: 'all' }, onClick: onShowAll }, `Show all ${closed.length}`)
        : null) : null);
}

function renameForm(ctx, state, project) {
  const input = h('input', { class: 'om-input', autocomplete: 'off', spellcheck: 'false', value: project.id });
  const error = message();
  const hint = h('p', { class: 'om-meta set-hint' });
  const plain = 'Missions, tokens and the brain folder move with it. Links to the old id stop working.';
  hint.textContent = plain;

  const button = confirmButton('Rename id', async () => {
    error.clear();
    const to = input.value.trim();
    try {
      await api.post('/api/projects/rename', { from: project.id, to }, { signal: ctx.signal });
    } catch (err) {
      if (api.isAbort(err)) return;
      error.say(refusal(err));
      return;
    }
    await store.refresh().catch(() => {});
    toast(`Now ${to}`);
    ctx.navigate(`/projects/${encodeURIComponent(to)}`, { replace: true });
  }, { title: `Rename ${project.id}?`, body: 'Missions, tokens and the brain folder move to the new id. Links to the old id stop working.', confirmLabel: 'Rename' });

  const sync = () => {
    const to = input.value.trim();
    button.disabled = !to || to === project.id;
    hint.textContent = (state.projects || []).some((p) => p.id === to && p.id !== project.id)
      ? `${to} already exists. Renaming merges this project into it.`
      : plain;
  };
  input.addEventListener('input', sync);
  sync();

  return h('div', { class: 'om-field' },
    h('label', { class: 'om-label', for: 'rename-id' }, 'Rename id'),
    h('div', { class: 'set-inline' }, Object.assign(input, { id: 'rename-id' }), button),
    hint, error.el);
}

function deleteForm(ctx, project) {
  const error = message();
  const button = confirmButton('Delete project', async () => {
    error.clear();
    try {
      await api.del(`/api/projects/${encodeURIComponent(project.id)}`, { signal: ctx.signal });
    } catch (err) {
      if (api.isAbort(err)) return;
      error.say(refusal(err));
      return;
    }
    await store.refresh().catch(() => {});
    toast(`Deleted ${project.id}`);
    ctx.navigate('/projects', { replace: true });
  }, { title: `Delete ${project.id}?`, body: 'Closed missions keep its id, and its brain folder stays.', confirmLabel: 'Delete' });

  return h('div', { class: 'om-field' },
    h('span', { class: 'om-label' }, 'Delete'),
    h('p', { class: 'om-meta set-hint' }, 'Refused while the project has open missions. Closed missions keep its id, and its brain folder stays.'),
    h('div', null, button),
    error.el);
}

export async function render(ctx) {
  let state = await store.ready();
  const id = ctx.params.id;
  const find = () => (state.projects || []).find((p) => p.id === id);
  if (!find()) {
    await store.refresh().then((next) => { state = next; }).catch(() => {});
  }
  const found = find();
  if (!found) {
    return h('div', { class: 'app-page set-page' },
      crumbs(['Projects', '/projects'], [id]),
      emptyState('No such project', `${id} isn't on this hub, or it's outside what this token can see.`,
        h('a', { class: 'om-link', href: '/projects' }, 'All projects')));
  }
  ctx.title(found.label || found.id);

  const settings = (await api.get('/api/settings', { signal: ctx.signal })).settings;

  let project = found;
  const heading = pageHead(project.label || project.id);

  const label = h('input', { class: 'om-input', required: true, autocomplete: 'off', value: project.label || '' });
  const entity = h('input', { class: 'om-input', autocomplete: 'off', spellcheck: 'false', value: project.entity || '' });
  const capacity = h('input', { class: 'om-input', type: 'number', min: 1, max: 9, inputmode: 'numeric', value: String(project.capacity || 1) });
  const approval = projectSelect(settings, id);
  const repo = repoField(project);
  const error = message();
  const save = h('button', { type: 'submit', class: 'om-btn om-btn-primary' }, 'Save');
  let approvalNow = approval.value;

  async function send(e) {
    e.preventDefault();
    error.clear();
    const name = label.value.trim();
    const cap = Number(capacity.value);
    if (!name) { error.say('A project needs a label.'); return; }
    if (!Number.isInteger(cap) || cap < 1 || cap > 9) { error.say('Capacity is a whole number from 1 to 9.'); return; }

    const body = {};
    if (name !== (project.label || '')) body.label = name;
    if (entity.value.trim() !== (project.entity || '')) body.entity = entity.value.trim();
    if (cap !== (project.capacity || 1)) body.capacity = cap;
    if (repo.value() !== (project.repo || '')) body.repo = repo.value();
    const approvalChanged = approval.value !== approvalNow;
    if (!Object.keys(body).length && !approvalChanged) {
      toast('Nothing to save');
      return;
    }

    save.disabled = true;
    try {
      if (Object.keys(body).length) {
        const out = await api.patch(`/api/projects/${encodeURIComponent(id)}`, body, { signal: ctx.signal });
        project = out.project;
      }
      if (approvalChanged) {
        await api.patch('/api/settings', { projects: { [id]: { approval: approval.value || null } } }, { signal: ctx.signal });
        approvalNow = approval.value;
      }
      await store.refresh().catch(() => {});
      toast('Saved');
      ctx.reload();
    } catch (err) {
      if (api.isAbort(err)) return;
      error.say(refusal(err));
      save.disabled = false;
    }
  }

  const form = h('form', { class: 'set-form', novalidate: true, onSubmit: send },
    field('Label', label),
    field('Entity', entity, 'The scope wall this project sits behind. Empty clears it.'),
    repo.el,
    h('div', { class: 'set-pair' },
      field('Capacity', capacity, 'How many missions run at once, 1 to 9.'),
      field('Approval policy', approval, 'Who can close its boss-gate missions.')),
    error.el,
    h('div', null, save));

  let showAll = false;
  const list = h('div');
  const painter = livePainter(list, () => missions(state, id, showAll, () => { showAll = true; painter.paint(); }));
  painter.paint();
  ctx.onCleanup(store.subscribe((next) => { state = next; painter.paint(); }));
  ctx.onCleanup(painter.stop);

  return h('div', { class: 'app-page set-page' },
    crumbs(['Projects', '/projects'], [id]),
    heading,
    h('div', { class: 'set-split' },
      h('div', { class: 'set-sections' },
        section('Project', project.id, form),
        h('section', { class: 'set-section set-danger' },
          h('div', { class: 'om-bar' }, h('h2', { class: 'om-label' }, 'Danger')),
          renameForm(ctx, state, project),
          deleteForm(ctx, project))),
      list));
}

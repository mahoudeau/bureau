// File a goal: a `goal:` mission the lead decomposes. Reference files go into
// the project's references/ in the brain first, and the bar lists them.

import { h, fill } from '../dom.js';
import * as api from '../api.js';
import * as store from '../store.js';
import { emptyState } from '../ui.js';
import { crumbs, field, message, pageHead } from '../setup/kit.js';

const MAX_BYTES = 5 * 1024 * 1024;
const ACCEPT = '.png,.jpg,.jpeg,.gif,.svg,.pdf';

const safeName = (name) => name.replace(/[^\w.\- ]+/g, '_');

function size(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function base64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result).split(',')[1] || '');
    reader.onerror = () => reject(new Error(`Couldn't read ${file.name}.`));
    reader.readAsDataURL(file);
  });
}

function goalBody({ destination, bar, loops }) {
  const lines = bar.map((l) => `- ${l}`).join('\n');
  return `${destination}${bar.length ? `\n\n## Bar\n${lines}` : ''}${loops ? `\n\n## Loops: ${loops}` : ''}`;
}

export async function render(ctx) {
  const state = await store.ready();
  const projects = state.projects || [];
  if (!projects.length) {
    return h('div', { class: 'app-page set-page' }, pageHead('New goal'),
      emptyState('No projects yet', 'A goal belongs to a project.', h('a', { class: 'om-btn', href: '/projects' }, 'Projects')));
  }

  const wanted = ctx.query.get('project');
  const chosen = projects.some((p) => p.id === wanted) ? wanted
    : projects.some((p) => p.id === 'general') ? 'general' : projects[0].id;

  const title = h('input', { class: 'om-input', name: 'title', required: true, autocomplete: 'off', value: ctx.query.get('title') || '' });
  const project = h('select', { class: 'om-select', name: 'project' },
    projects.map((p) => h('option', { value: p.id, selected: p.id === chosen }, p.label || p.id)));
  const priority = h('select', { class: 'om-select', name: 'priority' },
    [[1, 'P1'], [2, 'P2'], [3, 'P3']].map(([v, word]) => h('option', { value: v, selected: v === 2 }, word)));
  const loops = h('input', { class: 'om-input', name: 'loops', type: 'number', min: 1, max: 999, inputmode: 'numeric' });
  const destination = h('textarea', { class: 'om-textarea', name: 'destination', rows: 5, required: true });
  const bar = h('textarea', { class: 'om-textarea', name: 'bar', rows: 5 });
  const chosenFiles = h('ul', { class: 'set-files om-meta', hidden: true });
  const files = h('input', {
    class: 'set-file',
    name: 'files',
    type: 'file',
    multiple: true,
    accept: ACCEPT,
    onChange() {
      const list = [...files.files];
      chosenFiles.hidden = !list.length;
      fill(chosenFiles, list.map((f) => h('li', null, `${f.name}, ${size(f.size)}${f.size > MAX_BYTES ? ', over 5 MB' : ''}`)));
    },
  });

  const status = h('p', { class: 'om-meta', role: 'status', hidden: true });
  const error = message();
  const submit = h('button', { type: 'submit', class: 'om-btn om-btn-primary' }, 'File the goal');

  function working(text) {
    status.textContent = text;
    status.hidden = !text;
  }

  async function upload(file, projectId) {
    const path = `projects/${projectId}/references/${safeName(file.name)}`;
    const content = await base64(file);
    await api.post('/api/knowledge', { file: path, content, encoding: 'base64', message: `${projectId}: goal reference ${file.name}` }, { signal: ctx.signal });
    return path;
  }

  async function send(e) {
    e.preventDefault();
    error.clear();
    const name = title.value.trim().replace(/^goal:\s*/i, '');
    const where = destination.value.trim();
    if (!name || !where) {
      error.say('A goal needs a title and a destination.');
      return;
    }
    const picked = [...files.files];
    const big = picked.find((f) => f.size > MAX_BYTES);
    if (big) {
      error.say(`${big.name} is over the 5 MB limit. Drop it over SFTP into projects/${project.value}/references/ and list the path in the bar.`);
      return;
    }

    submit.disabled = true;
    const uploaded = [];
    try {
      for (const [i, file] of picked.entries()) {
        working(`Uploading ${file.name} (${i + 1} of ${picked.length})`);
        uploaded.push(await upload(file, project.value));
      }
      working('Filing the goal');
      const lines = [...bar.value.split('\n').map((l) => l.trim()).filter(Boolean), ...uploaded.map((p) => `${p} (in the brain)`)];
      const out = await api.post('/api/tasks', {
        title: `goal: ${name}`,
        body: goalBody({ destination: where, bar: lines, loops: Number(loops.value) || 0 }),
        project: project.value,
        priority: Number(priority.value),
      }, { signal: ctx.signal });
      await store.refresh().catch(() => {});
      ctx.navigate(`/goals/${encodeURIComponent(out.task.id)}`);
    } catch (err) {
      if (api.isAbort(err)) return;
      working('');
      error.say(uploaded.length ? `${err.message} The files already uploaded stay in the brain.` : err.message);
      submit.disabled = false;
    }
  }

  return h('div', { class: 'app-page set-page' },
    crumbs(['Goals', '/goals'], ['New']),
    pageHead('New goal'),
    h('p', { class: 'set-lead' }, 'The lead breaks this into missions, each with its own acceptance bar. Concrete references beat adjectives.'),
    h('form', { class: 'set-form', novalidate: true, onSubmit: send },
      field('Goal, in one line', title),
      h('div', { class: 'set-trio' },
        field('Project', project),
        field('Priority', priority),
        field('Loops', loops, 'Rounds per mission before the critic brings you the best so far. Empty means until you stop.')),
      field('Destination', destination, 'What does done look like? A stranger should be able to tell.'),
      field('The bar', bar, 'One reference or criterion per line: URLs, brain paths, hard rules.'),
      field('Reference files', files, `PNG, JPG, GIF, SVG or PDF, up to 5 MB each. They go into the project's references/ in the brain. Bigger files go over SFTP into the same folder, with the path listed in the bar.`),
      chosenFiles,
      status,
      error.el,
      h('div', { class: 'om-cluster om-cluster-3' },
        submit,
        h('a', { class: 'om-btn om-btn-ghost', href: '/goals' }, 'Cancel'))));
}

// New mission: title, project, priority, body, templates, and images pasted or
// picked. The quick way is still Cmd-K; this is for when it needs a body.

import { h, fill, on } from '../dom.js';
import * as api from '../api.js';
import * as store from '../store.js';
import { toast } from '../ui.js';
import { projectIds, projectLabel } from '../desk/model.js';
import { keep, missionHref, refusalLine, remember } from '../desk/parts.js';

const TEMPLATES = [
  {
    id: 'content-pr',
    label: 'Content with PR',
    body: [
      'One-line description of what this mission delivers.',
      '',
      '## Acceptance',
      '- Change is committed on a branch (not main), opened as a PR.',
      '- <the specific, checkable thing this content must say or do>',
      '- No unrelated files touched.',
    ].join('\n'),
  },
  {
    id: 'review-only',
    label: 'Review-only knowledge write',
    body: [
      'One-line description of the knowledge change being proposed.',
      '',
      '## Acceptance',
      '- Submitted as a proposal (POST /api/knowledge, or PATCH /api/tasks with items), not self-approved.',
      '- Cites its source (a shift, a mission, a decision) so the reviewer can trace it.',
      '- Parked in review (gate: boss) with the change attached.',
    ].join('\n'),
  },
  {
    id: 'goal-child',
    label: 'Goal child',
    body: [
      'goal: t-<id>',
      '',
      'One-line description of what this child mission delivers toward the goal.',
      '',
      '## Acceptance',
      '- <mechanically checkable criterion 1>',
      '- <mechanically checkable criterion 2>',
      "- Own only the file(s) named here; do not touch sibling missions' files.",
    ].join('\n'),
  },
];

// The hub's own cap on one attachment, 5MB decoded (lib/knowledge.js).
const MAX_ATTACHMENT = 5 * 1024 * 1024;

// Through a canvas: it re-encodes whatever a picker hands back into a format the
// brain accepts, and shrinks until it clears the cap. A crisp screenshot stays
// PNG; anything too big becomes JPEG, which is where the room is.
async function normalizeImage(file) {
  const name = file.name || 'that file';
  if (typeof createImageBitmap !== 'function') return { error: "This browser can't process images. Skip them or use a newer one." };
  const bitmap = await createImageBitmap(file).catch(() => null);
  if (!bitmap || !bitmap.width || !bitmap.height) return { error: `Couldn't read ${name} as an image.` };
  let w = bitmap.width;
  let ht = bitmap.height;
  let mime = /^image\/(png|gif)$/i.test(file.type) && file.size <= MAX_ATTACHMENT ? 'image/png' : 'image/jpeg';
  let quality = 0.92;
  for (let attempt = 0; attempt < 9; attempt++) {
    const canvas = h('canvas', { width: Math.max(1, Math.round(w)), height: Math.max(1, Math.round(ht)) });
    canvas.getContext('2d').drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    const blob = await new Promise((resolve) => { canvas.toBlob(resolve, mime, quality); });
    if (blob && blob.size <= MAX_ATTACHMENT) return { blob, ext: mime === 'image/png' ? 'png' : 'jpg' };
    mime = 'image/jpeg';
    if (quality > 0.4) quality -= 0.12;
    else { w *= 0.75; ht *= 0.75; }
  }
  return { error: `${name} is too large even after shrinking it. Try a smaller one.` };
}

function toBase64(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const text = String(reader.result || '');
      const comma = text.indexOf(',');
      resolve(comma >= 0 ? text.slice(comma + 1) : text);
    };
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });
}

// One at a time: each write is a git commit against a single working tree, and
// parallel ones would race. An image that fails doesn't undo the mission.
async function attachImages(id, project, images) {
  let failed = 0;
  for (let i = 0; i < images.length; i++) {
    const img = images[i];
    const file = `projects/${project}/references/${id}-${i + 1}.${img.ext}`;
    try {
      const content = await toBase64(img.blob);
      await api.post('/api/knowledge', { file, content, mode: 'replace', encoding: 'base64', author: 'human', message: `${id}: image attached on creation` });
      await api.patch(`/api/tasks/${id}`, { agent: 'human', artifact: { label: img.name || `Image ${i + 1}`, url: file } });
    } catch {
      failed++;
    }
  }
  return failed;
}

export async function render(ctx) {
  ctx.title('New mission');
  const state = await store.ready();
  const ids = projectIds(state);
  const wanted = ctx.query.get('project');
  const last = remember('lastProject', null);
  // Never a hardcoded project id: the registry decides what exists.
  const initial = (wanted && ids.includes(wanted) && wanted) || (last && ids.includes(last) && last) || ids[0] || '';

  const images = [];
  let seq = 0;
  let busy = false;

  const refusal = refusalLine();
  const title = h('input', { class: 'om-input', required: true, autocomplete: 'off', placeholder: 'What needs doing', 'aria-describedby': 'work-new-error' });
  const project = h('select', { class: 'om-select' },
    ids.map((id) => h('option', { value: id, selected: id === initial }, projectLabel(state, id))));
  const priority = h('select', { class: 'om-select' },
    h('option', { value: '1' }, 'P1, now'), h('option', { value: '2' }, 'P2, soon'), h('option', { value: '3', selected: true }, 'P3, normal'));
  const body = h('textarea', { class: 'om-textarea work-new-body', rows: 12, placeholder: 'What the builder needs: acceptance, references, anything else. Markdown works.' });

  const thumbs = h('div', { class: 'work-new-thumbs', hidden: true });
  const fileInput = h('input', {
    type: 'file',
    accept: 'image/*',
    multiple: true,
    hidden: true,
    'aria-label': 'Choose images',
    onChange() {
      if (fileInput.files && fileInput.files.length) addImages([...fileInput.files]);
      fileInput.value = '';
    },
  });
  const attach = h('button', { type: 'button', class: 'om-btn', onClick: () => fileInput.click() }, 'Attach images');
  const submit = h('button', { type: 'submit', class: 'om-btn om-btn-primary' }, 'Create mission');

  function paintThumbs() {
    thumbs.hidden = !images.length;
    fill(thumbs, images.map((img) => h('figure', { class: 'work-new-thumb' },
      h('img', { src: img.previewUrl, alt: img.name || 'Pasted image' }),
      h('button', {
        type: 'button',
        class: 'om-btn om-btn-icon',
        'aria-label': `Remove ${img.name || 'pasted image'}`,
        onClick() {
          const at = images.indexOf(img);
          if (at >= 0) images.splice(at, 1);
          URL.revokeObjectURL(img.previewUrl);
          paintThumbs();
        },
      }, 'x'))));
  }

  async function addImages(files) {
    for (const file of files) {
      if (!/^image\//.test(file.type)) {
        refusal.show(`${file.name || 'That file'} is not an image. Skipped.`);
        continue;
      }
      const result = await normalizeImage(file);
      if (result.error) {
        refusal.show(result.error);
        continue;
      }
      refusal.clear();
      images.push({ id: ++seq, blob: result.blob, ext: result.ext, name: file.name, previewUrl: URL.createObjectURL(result.blob) });
    }
    paintThumbs();
  }

  // Only when the clipboard holds an image, so a normal text paste is untouched.
  ctx.onCleanup(on(document, 'paste', (e) => {
    const items = (e.clipboardData && e.clipboardData.items) || [];
    const files = [];
    for (const item of items) {
      if (item.kind === 'file' && /^image\//.test(item.type)) {
        const f = item.getAsFile();
        if (f) files.push(f);
      }
    }
    if (!files.length) return;
    e.preventDefault();
    addImages(files);
  }));
  ctx.onCleanup(() => images.forEach((img) => URL.revokeObjectURL(img.previewUrl)));

  function useTemplate(t) {
    const current = body.value.trim();
    // Writing over something typed would lose it. Writing over a template wouldn't.
    if (current && !TEMPLATES.some((x) => x.body.trim() === current)) body.value = `${body.value.trimEnd()}\n\n${t.body}`;
    else body.value = t.body;
    body.focus();
  }

  async function create(e) {
    if (e) e.preventDefault();
    if (busy) return;
    refusal.clear();
    const text = title.value.trim();
    if (!text) {
      refusal.show('A mission needs a title.');
      title.focus();
      return;
    }
    if (!project.value) {
      refusal.show('There are no projects yet. Make one first.');
      return;
    }
    busy = true;
    submit.disabled = true;
    submit.textContent = images.length ? 'Creating, sending images' : 'Creating';
    try {
      const payload = { title: text, project: project.value, priority: Number(priority.value), created_by: 'human' };
      const bodyText = body.value.trim();
      if (bodyText) payload.body = bodyText;
      const r = await api.post('/api/tasks', payload);
      keep('lastProject', project.value);
      const failed = await attachImages(r.task.id, project.value, images);
      toast(failed
        ? `${r.task.id} created. ${failed} of ${images.length} images didn't attach.`
        : `${r.task.id} created.`);
      store.refresh().catch(() => {});
      ctx.navigate(missionHref(r.task.id));
    } catch (err) {
      if (api.isAbort(err)) return;
      refusal.show(err.message);
      busy = false;
      submit.disabled = false;
      submit.textContent = 'Create mission';
    }
  }

  const form = h('form', {
    class: 'work-new-form',
    novalidate: true,
    onSubmit: create,
    onKeydown(e) {
      if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) create(e);
    },
  },
  h('label', { class: 'om-field' }, h('span', { class: 'om-field-label' }, 'Title'), title),
  h('div', { class: 'work-new-pair' },
    h('label', { class: 'om-field' }, h('span', { class: 'om-field-label' }, 'Project'), h('span', { class: 'om-select-wrap' }, project)),
    h('label', { class: 'om-field' }, h('span', { class: 'om-field-label' }, 'Priority'), h('span', { class: 'om-select-wrap' }, priority))),
  h('div', { class: 'om-field' },
    h('span', { class: 'om-field-label' }, 'Start from'),
    h('div', { class: 'om-chips', role: 'group', 'aria-label': 'Templates' },
      TEMPLATES.map((t) => h('button', { type: 'button', class: 'om-chip', onClick: () => useTemplate(t) }, t.label)))),
  h('label', { class: 'om-field' }, h('span', { class: 'om-field-label' }, 'Body ', h('em', null, '(optional)')), body),
  thumbs,
  h('div', { class: 'work-new-actions' },
    attach, fileInput,
    h('span', { class: 'om-caption work-new-hint' }, 'or paste an image'),
    h('span', { class: 'om-grow' }),
    submit),
  h('div', { id: 'work-new-error' }, refusal.el));

  // The template: a band with the way back, then one sheet in one column.
  const page = h('div', { class: 'work-page work-new' },
    h('div', { class: 'om-band' },
      h('div', { class: 'om-band-inner om-stack om-stack-3' },
        h('nav', { 'aria-label': 'Breadcrumb' },
          h('ol', { class: 'om-crumbs' },
            h('li', null, h('a', { href: '/missions' }, 'Missions')),
            h('li', null, 'New'))),
        h('h1', { class: 'om-display-m' }, 'New mission'))),
    h('div', { class: 'om-ground om-field-ground' },
      h('div', { class: 'om-work-single' },
        h('section', { class: 'om-sheet' }, h('div', { class: 'om-sheet-body' }, form)))));

  requestAnimationFrame(() => title.focus({ preventScroll: true }));
  return page;
}

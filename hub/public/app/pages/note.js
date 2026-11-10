// /brain/<path>: a note as a page, or a folder, or the right sort of nothing.

import * as api from '../api.js';
import { h } from '../dom.js';
import { crumbs, notFound, viewToggle } from '../brain/note-parts.js';
import { errorState, toast } from '../ui.js';
import { parseMarkdown, plainText, renderDocument } from '../markdown.js';
import { baseOf, extOf, listFiles, notesFor, resolverFor, brainHref } from '../brain/data.js';
import { fileBody, rawOf } from '../brain/file-view.js';
import { folderRows, frame, section, summarize } from '../brain/listing.js';
import { buildMargin, factLine } from '../brain/margin.js';

async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}

function copyPathButton(path) {
  return h('button', {
    type: 'button',
    class: 'om-btn',
    async onClick() {
      toast((await copyText(path)) ? 'Path copied.' : `Copy failed. The path is ${path}`);
    },
  }, 'Copy path');
}

async function folderPage(ctx, files, path) {
  ctx.title(path);
  const { rows, folders, files: count } = await folderRows(files, path);
  const label = [folders ? `${folders} folder${folders === 1 ? '' : 's'}` : null, count ? `${count} file${count === 1 ? '' : 's'}` : null].filter(Boolean).join(', ');
  return h('div', { class: 'app-page brain' },
    h('header', { class: 'brain-head' }, crumbs(path), h('span')),
    h('h1', { class: 'om-display om-h1 brain-folder-title' }, baseOf(path)),
    frame(files, path, section(path, label, h('div', { class: 'om-list' }, rows))));
}

// Drop the first heading when it only repeats the title.
function dropRepeatedTitle(doc, title) {
  const first = doc.blocks[0];
  if (!first || first.type !== 'heading' || first.level !== 1) return;
  if (first.text.toLowerCase() !== title.toLowerCase()) return;
  doc.blocks.shift();
  doc.headings = doc.headings.filter((x) => x.id !== first.id);
}

function titleOf(doc, path) {
  if (doc.frontmatter.title) return doc.frontmatter.title;
  const first = doc.blocks[0];
  if (first && first.type === 'heading') return first.text;
  return baseOf(path).replace(/\.md$/i, '');
}

function shell(ctx, path, { title, summary, line, body, raw, margin, tools }) {
  const rawBox = raw === null ? null : h('pre', { class: 'brain-raw', tabindex: '0', hidden: true }, h('code', null, raw));
  const page = h('div', { class: 'brain-page' }, body);
  const setRaw = (on) => {
    page.hidden = on;
    rawBox.hidden = !on;
  };
  const toggle = raw === null ? null : viewToggle(ctx, setRaw);
  const wanted = raw !== null && ctx.query.get('raw') === '1';
  if (wanted) setRaw(true);

  return h('div', { class: 'app-page brain brain-note-page' },
    h('header', { class: 'brain-head' }, crumbs(path), h('div', { class: 'om-row brain-tools' }, toggle, copyPathButton(path), tools)),
    h('div', { class: margin ? 'brain-note' : 'brain-note brain-note-solo' },
      h('article', { class: 'brain-doc' },
        h('header', { class: 'brain-doc-head' },
          h('h1', { class: 'om-display brain-title' }, title),
          summary ? h('p', { class: 'brain-summary' }, summary) : null,
          line),
        page, rawBox),
      margin));
}

async function notePage(ctx, files, path, file) {
  const notes = await notesFor(path);
  if (extOf(path) !== 'md') {
    ctx.title(baseOf(path));
    return shell(ctx, path, { title: baseOf(path), summary: null, line: null, body: fileBody(path, file), raw: ['txt', 'json', 'csv', 'svg'].includes(extOf(path)) ? rawOf(file) : null, margin: null });
  }
  const text = rawOf(file) || '';
  const doc = parseMarkdown(text);
  const title = titleOf(doc, path);
  ctx.title(title);
  dropRepeatedTitle(doc, title);
  const resolver = resolverFor(path, files, notes);
  const body = renderDocument(doc, resolver);
  const summary = doc.frontmatter.summary ? plainText(doc.frontmatter.summary) : null;
  if (!doc.blocks.length) body.append(h('p', { class: 'om-meta' }, 'This note has no body.'));
  return shell(ctx, path, {
    title,
    summary,
    line: factLine(doc),
    body,
    raw: text,
    margin: buildMargin({ doc, path, resolver, notes, ctx }),
  });
}

export async function render(ctx) {
  const path = ctx.params.path.replace(/\/+$/, '');
  ctx.title(path);
  let files;
  try {
    files = await listFiles();
  } catch (e) {
    if (e.name === 'AbortError') throw e;
    return h('div', { class: 'app-page' }, errorState(e.message || "Couldn't read the brain.", () => ctx.reload()));
  }

  if (!files.includes(path)) {
    if (summarize(files, path).folders.size || summarize(files, path).files.length) return folderPage(ctx, files, path);
    if (files.includes(`${path}.md`)) {
      ctx.navigate(`${brainHref(`${path}.md`)}${location.search}${location.hash}`, { replace: true });
      return h('div');
    }
    if (!extOf(path)) {
      ctx.title('Not found');
      return notFound(path);
    }
  }

  try {
    const file = await api.get(`/api/knowledge?file=${encodeURIComponent(path)}`, { signal: ctx.signal });
    return await notePage(ctx, files, path, file || {});
  } catch (e) {
    if (e.name === 'AbortError') throw e;
    if (e.status === 404 || e.status === 400) {
      ctx.title('Not found');
      return notFound(path);
    }
    if (e.status === 403) {
      ctx.title('Out of reach');
      return notFound(path, "This token can't read that note.");
    }
    return h('div', { class: 'app-page' }, errorState(e.message || "Couldn't read that note.", () => ctx.reload()));
  }
}

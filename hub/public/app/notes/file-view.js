// Files in the brain that aren't markdown. Each gets the page it deserves:
// images inline, a PDF behind a button, JSON indented, CSV as a table.

import { h } from '../dom.js';
import { emptyState } from '../ui.js';
import { baseOf, extOf } from './data.js';

const IMAGE = new Set(['png', 'jpg', 'jpeg', 'gif', 'svg']);
const MAX_CSV_ROWS = 2000;

const rawUrl = (path) => globalThis.BureauHub.imageUrl(path);

// One pass, and a quote that never closes ends at the end of the text.
export function parseCsv(text) {
  const rows = [];
  let row = [];
  let cell = '';
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"' && text[i + 1] === '"') { cell += '"'; i++; }
      else if (c === '"') quoted = false;
      else cell += c;
    } else if (c === '"' && cell === '') {
      quoted = true;
    } else if (c === ',') {
      row.push(cell);
      cell = '';
    } else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++;
      row.push(cell);
      cell = '';
      rows.push(row);
      row = [];
      if (rows.length > MAX_CSV_ROWS) return { rows, cut: true };
    } else {
      cell += c;
    }
  }
  if (cell !== '' || row.length) {
    row.push(cell);
    rows.push(row);
  }
  return { rows, cut: false };
}

function csvView(text) {
  const { rows, cut } = parseCsv(text);
  if (!rows.length) return emptyState('Empty file', 'There are no rows in this CSV.');
  const [head, ...body] = rows;
  const shown = body.slice(0, MAX_CSV_ROWS);
  return h('div', { class: 'om-stack' },
    h('div', { class: 'om-table-wrap brain-table-wrap', tabindex: '0' },
      h('table', { class: 'om-table' },
        h('thead', null, h('tr', null, head.map((c) => h('th', { scope: 'col' }, c)))),
        h('tbody', null, shown.map((r) => h('tr', null, r.map((c) => h('td', null, c))))))),
    cut ? h('p', { class: 'om-meta' }, `Showing the first ${MAX_CSV_ROWS} rows. The raw view has the rest.`) : null);
}

function textView(text, ext) {
  let shown = text;
  if (ext === 'json') {
    try { shown = JSON.stringify(JSON.parse(text), null, 2); } catch { /* shown as written */ }
  }
  return h('pre', { class: 'brain-raw', tabindex: '0' }, h('code', null, shown));
}

function downloadLink(path, label) {
  return h('a', { class: 'om-btn', dataset: { secureHref: rawUrl(path) }, target: '_blank', rel: 'noopener', download: baseOf(path) }, label);
}

const sizeOf = (bytes) => (bytes < 1024 ? `${bytes} B` : bytes < 1024 * 1024 ? `${Math.round(bytes / 1024)} KB` : `${(bytes / 1024 / 1024).toFixed(1)} MB`);

// The bytes base64 holds, without decoding them.
const base64Size = (b64) => Math.max(0, Math.floor((b64.length * 3) / 4) - (b64.endsWith('==') ? 2 : b64.endsWith('=') ? 1 : 0));

// file is the hub's answer: { content } or { content_base64 }.
export function fileBody(path, file) {
  const ext = extOf(path);
  if (IMAGE.has(ext)) {
    return h('figure', { class: 'brain-figure' }, h('img', { alt: baseOf(path), dataset: { secureSrc: rawUrl(path) } }));
  }
  if (file.content_base64 !== undefined) {
    const size = sizeOf(base64Size(file.content_base64));
    if (ext === 'pdf') {
      return h('div', { class: 'om-panel om-stack brain-file-card' },
        h('p', { class: 'om-label' }, `PDF, ${size}`),
        h('p', { style: 'margin:0' }, baseOf(path)),
        h('div', { class: 'om-cluster om-cluster-3' }, h('a', { class: 'om-btn om-btn-primary', dataset: { secureHref: rawUrl(path) }, target: '_blank', rel: 'noopener' }, 'Open the PDF'), downloadLink(path, 'Download')));
    }
    return h('div', { class: 'om-panel om-stack brain-file-card' },
      h('p', { class: 'om-label' }, `Binary file, ${size}`),
      h('p', { style: 'margin:0' }, "This one can't be shown here."),
      h('div', null, downloadLink(path, 'Download')));
  }
  const text = file.content === undefined ? '' : String(file.content);
  if (!text) return emptyState('Empty file', 'There is nothing in this file.');
  return ext === 'csv' ? csvView(text) : textView(text, ext);
}

export const rawOf = (file) => (file.content === undefined ? null : String(file.content));

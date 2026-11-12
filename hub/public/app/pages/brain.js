// /brain: what we know, at a glance. Health, compartments, what changed lately,
// and the top of the tree.

import * as api from '../api.js';
import * as store from '../store.js';
import { h } from '../dom.js';
import { emptyState, errorState } from '../ui.js';
import { baseOf, brainHref, gitDate, listFiles, notesFor } from '../notes/data.js';
import { healthLine } from '../notes/health.js';
import { folderRows, frame, layers, row, searchButton, section } from '../notes/listing.js';

// /brain?claim=<id>, the link a claim's source makes. It goes to where the
// claim or the journal record lives.
async function claimLocation(id, signal) {
  if (id.startsWith('j-')) {
    const r = await api.get('/api/journal', { signal });
    const record = ((r && r.records) || []).find((x) => x.id === id);
    return record && record.file ? `${brainHref(record.file)}#${id}` : null;
  }
  const c = await api.get(`/api/knowledge?claim=${encodeURIComponent(id)}`, { signal });
  return c && c.file ? `${brainHref(c.file)}#${id}` : null;
}

function missingClaim(id) {
  return h('div', { class: 'app-page' },
    emptyState('No such record', `${id} isn't in the brain, or this token can't reach it.`, h('a', { class: 'om-link', href: '/brain' }, 'Back to the brain')));
}

// A commit that names a file links to it and shows the note's title. The rest
// are plain rows: the hub gives a message, not a list of files.
function recentRow(c, known, notes) {
  const message = String(c.message);
  const author = c.author === 'human' ? 'boss' : c.author;
  const named = message.split(/\s+/).find((word) => known.has(word.replace(/[:,]$/, '')));
  const file = named ? named.replace(/[:,]$/, '') : null;
  if (!file) return row({ title: message, summary: author, path: c.hash, date: gitDate(c.date) });
  const note = notes.get(file);
  const plain = message === `update ${file}`;
  return row({
    href: brainHref(file),
    title: note && note.title ? note.title : baseOf(file),
    summary: plain ? author : `${author}: ${message}`,
    path: file,
    date: gitDate(c.date),
  });
}

function recentSection(files, state, notes) {
  const commits = (state && state.knowledge && state.knowledge.recent) || [];
  if (!commits.length) return section('Recent changes', null, h('p', { class: 'om-data-s brain-quiet' }, 'Nothing recent to show.'));
  const known = new Set(files);
  return section('Recent changes', `${commits.length} commits`, h('div', { class: 'om-list' }, commits.map((c) => recentRow(c, known, notes))));
}

export async function render(ctx) {
  const claim = ctx.query.get('claim');
  if (claim) {
    try {
      const to = await claimLocation(claim, ctx.signal);
      if (to) { ctx.navigate(to, { replace: true }); return h('div'); }
    } catch (e) {
      if (e.status !== 404 && e.status !== 403) throw e;
    }
    ctx.title(claim);
    return missingClaim(claim);
  }

  ctx.title('Brain');
  let files;
  try {
    files = await listFiles();
  } catch (e) {
    if (e.name === 'AbortError') throw e;
    return h('div', { class: 'app-page' }, errorState(e.message || "Couldn't read the brain.", () => ctx.reload()));
  }

  const head = h('header', { class: 'om-band-main brain-head' },
    h('h1', { class: 'om-display-m' }, 'Brain'),
    searchButton());

  if (!files.length) {
    return layers(head,
      h('section', { class: 'om-sheet' }, emptyState('The brain is empty', 'Nothing has been written yet, or this token reaches none of it.')));
  }

  const state = await store.ready().catch(() => null);
  const [top, notes] = await Promise.all([folderRows(files, ''), notesFor('')]);
  const main = [
    recentSection(files, state, notes),
    section('Everything', `${files.length} files`, h('div', { class: 'om-list' }, top.rows)),
  ];
  return layers([head, healthLine(ctx.onCleanup)], frame(files, '', main));
}

// The frame of /brain and of a folder: compartments on the left, rows on the
// right.

import { h } from '../dom.js';
import { timeTag } from '../ui.js';
import { openPalette } from '../palette.js';
import { baseOf, brainHref, cleanSummary, dateOf, notesFor } from './data.js';

const NOTES_ABOUT = {
  knowledge: 'Curated facts and rules',
  recipes: 'How to do things, step by step',
  projects: 'One folder per stream of work',
  entities: 'Companies and contexts, with their walls',
  agents: 'Who works here',
  journal: 'Raw captures, day by day',
  daily: "The librarian's digests",
  meetings: 'Meeting notes',
  import: 'Staging for imported material',
  archive: 'Digested raw material',
  attic: 'Retired beliefs',
};
const ORDER = Object.keys(NOTES_ABOUT);

export function summarize(files, prefix) {
  const skip = prefix ? prefix.length + 1 : 0;
  const folders = new Map();
  const here = [];
  for (const f of files) {
    if (prefix && !f.startsWith(`${prefix}/`)) continue;
    const rest = f.slice(skip);
    const slash = rest.indexOf('/');
    if (slash === -1) here.push(f);
    else {
      const name = rest.slice(0, slash);
      folders.set(name, (folders.get(name) || 0) + 1);
    }
  }
  return { folders, files: here };
}

function compartments(files, current) {
  const { folders } = summarize(files, '');
  const names = [...folders.keys()].sort((a, b) => {
    const x = ORDER.indexOf(a);
    const y = ORDER.indexOf(b);
    return (x === -1 ? 99 : x) - (y === -1 ? 99 : y) || a.localeCompare(b);
  });
  return h('nav', { class: 'brain-comps', 'aria-label': 'Compartments' },
    h('a', { class: 'brain-comp', href: '/brain', 'aria-current': current ? null : 'page' },
      h('span', null, 'Brain'), h('span', { class: 'brain-count' }, files.length)),
    names.map((name) => h('a', {
      class: 'brain-comp',
      href: brainHref(name),
      'aria-current': current === name || (current && current.startsWith(`${name}/`)) ? 'page' : null,
    }, h('span', null, name), h('span', { class: 'brain-count' }, folders.get(name)))));
}

// A long path breaks after a slash, not in the middle of a name.
const breakable = (path) => String(path || '').split('/').flatMap((part, i, all) => (i < all.length - 1 ? [part, '/', h('wbr')] : [part]));

// A row: left, the words; right, the path and the age.
export function row({ href, title, summary, path, date }) {
  const body = [
    h('span', { class: 'brain-row-main' },
      h('span', { class: 'brain-row-title' }, title),
      summary ? h('span', { class: 'brain-row-summary' }, summary) : null),
    h('span', { class: 'brain-row-path' }, breakable(path)),
    h('span', { class: 'brain-row-age' }, date ? timeTag(date) : ''),
  ];
  return href
    ? h('a', { class: 'om-list-row brain-row', href }, body)
    : h('div', { class: 'om-list-row brain-row brain-row-still' }, body);
}

export function section(label, side, ...content) {
  return h('section', { class: 'brain-section' },
    h('div', { class: 'om-bar' }, h('h2', { class: 'om-label' }, label), side ? h('span', { class: 'om-meta' }, side) : null),
    content);
}

export async function folderRows(files, prefix) {
  const { folders, files: here } = summarize(files, prefix);
  const notes = await notesFor(prefix || '');
  const folderNames = [...folders.keys()].sort((a, b) => a.localeCompare(b));
  const rows = folderNames.map((name) => {
    const path = prefix ? `${prefix}/${name}` : name;
    return row({
      href: brainHref(path),
      title: `${name}/`,
      summary: prefix ? null : NOTES_ABOUT[name] || null,
      path: `${folders.get(name)} ${folders.get(name) === 1 ? 'file' : 'files'}`,
    });
  });
  const newestFirst = /^(journal|daily)(\/|$)/.test(prefix);
  const sorted = [...here].sort((a, b) => (newestFirst ? b.localeCompare(a) : a.localeCompare(b)));
  for (const file of sorted) {
    const note = notes.get(file);
    rows.push(row({
      href: brainHref(file),
      title: note && note.title ? note.title : baseOf(file),
      summary: note ? cleanSummary(note.summary) : null,
      path: file,
      date: dateOf(file, note),
    }));
  }
  return { rows, folders: folderNames.length, files: sorted.length };
}

export function searchButton(query) {
  return h('button', { type: 'button', class: 'om-btn', onClick: () => openPalette(query || '') }, 'Search');
}

export function frame(files, current, main) {
  return h('div', { class: 'brain-frame' }, compartments(files, current), h('div', { class: 'brain-rows' }, main));
}

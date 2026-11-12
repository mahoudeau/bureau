// What the brain pages read from the hub, and how a note's links are resolved.
// Lists are cached for the session and dropped as soon as the brain changes, so
// browsing is instant and never stale for long.

import * as api from '../api.js';
import * as store from '../store.js';
import { parseMarkdown, plainText, slugify } from '../markdown.js';

let filesPromise = null;
const maps = new Map(); // project id or '' -> Promise of map rows
let graph = null; // { here: Map(file -> [sources]), scanned }
let graphBuilding = null;

function forget() {
  filesPromise = null;
  maps.clear();
  graph = null;
  graphBuilding = null;
}

let listening = false;
function listen() {
  if (listening) return;
  listening = true;
  store.subscribeEvents((type) => {
    if (type === 'knowledge.written' || type === 'journal.captured' || type === 'project.renamed' || type === store.RECONNECTED) forget();
  });
}

// Every path this credential may read. The hub filters, so this is the truth.
export function listFiles() {
  listen();
  if (!filesPromise) {
    filesPromise = api.get('/api/knowledge').then((r) => (r && r.files) || []);
    filesPromise.catch(() => { filesPromise = null; });
  }
  return filesPromise;
}

// title, summary, verified, belief per file, for one project's scope or the
// global one. A project this credential can't read just adds nothing.
export function mapRows(project) {
  listen();
  const key = project || '';
  if (!maps.has(key)) {
    const p = api.get(`/api/knowledge/map${project ? `?project=${encodeURIComponent(project)}` : ''}`)
      .then((r) => (r && r.files) || [])
      .catch((e) => {
        maps.delete(key);
        if (e.status === 403) return [];
        throw e;
      });
    maps.set(key, p);
  }
  return maps.get(key);
}

// The project whose map covers this path.
export function projectFor(path, state = store.getState()) {
  const parts = path.split('/');
  if (parts[0] === 'projects' && parts[1]) return parts[1];
  if (parts[0] === 'entities' && parts[1] && state) {
    const p = (state.projects || []).find((x) => x.entity === parts[1]);
    return p ? p.id : null;
  }
  return null;
}

export async function notesFor(path) {
  const project = projectFor(path);
  const lists = await Promise.all([mapRows(null), project ? mapRows(project) : []]);
  const notes = new Map();
  for (const list of lists) for (const row of list) notes.set(row.file, row);
  return notes;
}

export const encodePath = (p) => p.split('/').map(encodeURIComponent).join('/');
export const brainHref = (p) => (p ? `/brain/${encodePath(p)}` : '/brain');
export const dirOf = (p) => (p.includes('/') ? p.slice(0, p.lastIndexOf('/')) : '');
export const baseOf = (p) => p.slice(p.lastIndexOf('/') + 1);
export const extOf = (p) => {
  const base = baseOf(p);
  return base.includes('.') ? base.slice(base.lastIndexOf('.') + 1).toLowerCase() : '';
};

export const cleanSummary = (s) => plainText(s || '');

// A date for a row: the note's verified date, or the date in a journal or
// digest's file name. The hub doesn't give a file's modified time.
export function dateOf(file, note) {
  if (note && note.verified) return note.verified;
  const m = /^(?:journal|daily|meetings)\/(\d{4}-\d{2}-\d{2})/.exec(file);
  return m ? m[1] : null;
}

// "2026-10-21 20:28:23 +0200", which only some browsers parse as written.
export function gitDate(value) {
  const m = /^(\d{4}-\d{2}-\d{2}) (\d{2}:\d{2}:\d{2}) ([+-]\d{2})(\d{2})$/.exec(String(value));
  return m ? `${m[1]}T${m[2]}${m[3]}:${m[4]}` : value;
}

function normalizeJoin(dir, rel) {
  const out = dir ? dir.split('/') : [];
  for (const seg of rel.split('/')) {
    if (seg === '' || seg === '.') continue;
    if (seg === '..') {
      if (!out.length) return null;
      out.pop();
    } else {
      out.push(seg);
    }
  }
  return out.join('/');
}

function decode(s) {
  try { return decodeURIComponent(s); } catch { return s; }
}

function splitTail(href) {
  let cut = href.length;
  for (const c of '?#') {
    const at = href.indexOf(c);
    if (at !== -1 && at < cut) cut = at;
  }
  const rest = href.slice(cut);
  const hash = rest.includes('#') ? rest.slice(rest.indexOf('#')) : '';
  return { path: href.slice(0, cut), hash };
}

const anchorFrom = (hash) => {
  if (!hash || hash === '#') return '';
  const name = decode(hash.slice(1));
  return `#${name[0] === '^' ? name.slice(1) : slugify(name)}`;
};

// Hooks for renderMarkdown, for one note at one path.
export function resolverFor(path, files, notes) {
  const dir = dirOf(path);
  const known = new Set(files);
  const folders = new Set();
  for (const f of files) {
    for (let d = dirOf(f); d && !folders.has(d); d = dirOf(d)) folders.add(d);
  }

  const byBase = new Map();
  for (const f of files) {
    if (!f.endsWith('.md')) continue;
    const base = baseOf(f).slice(0, -3).toLowerCase();
    if (!byBase.has(base)) byBase.set(base, []);
    byBase.get(base).push(f);
  }
  const byTitle = new Map();
  for (const row of notes.values()) {
    const title = String(row.title || '').toLowerCase();
    if (title && !byTitle.has(title)) byTitle.set(title, row.file);
  }

  function nearest(list) {
    const same = list.find((f) => dirOf(f) === dir);
    if (same) return same;
    return [...list].sort((a, b) => a.length - b.length || a.localeCompare(b))[0];
  }

  // A wikilink's target: a path, a path from here, a file's name, a title.
  function findNote(name) {
    const lower = name.toLowerCase();
    const tries = [name, `${name}.md`];
    const local = normalizeJoin(dir, name);
    if (local) tries.push(local, `${local}.md`);
    for (const t of tries) if (known.has(t)) return t;
    const base = baseOf(lower.endsWith('.md') ? lower.slice(0, -3) : lower);
    const named = byBase.get(base);
    if (named) return nearest(named);
    return byTitle.get(lower) || null;
  }

  function wikilink(name) {
    const hashAt = name.indexOf('#');
    const target = (hashAt === -1 ? name : name.slice(0, hashAt)).trim();
    const hash = hashAt === -1 ? '' : name.slice(hashAt);
    if (!target) return { href: anchorFrom(hash) };
    const mission = /^(?:missions\/)?(t-\d+)$/.exec(target);
    if (mission) return { href: `/missions/${mission[1]}` };
    if (/^j-[a-z0-9]{8}$/.test(target)) return { href: `/brain?claim=${target}` };
    const found = findNote(target);
    if (found) return { href: `${brainHref(found)}${anchorFrom(hash)}`, file: found };
    if (folders.has(target)) return { href: brainHref(target) };
    return null;
  }

  function resolveLink(href) {
    if (/^(https?:|mailto:)/i.test(href)) return href;
    if (href[0] === '#') return anchorFrom(href);
    if (href[0] === '/') return href;
    const { path: rel, hash } = splitTail(href);
    const joined = normalizeJoin(dir, decode(rel));
    if (joined === null) return { href: '/brain', broken: true };
    for (const t of [joined, `${joined}.md`]) {
      if (known.has(t)) return { href: `${brainHref(t)}${hash ? anchorFrom(hash) : ''}`, file: t };
    }
    if (folders.has(joined)) return { href: brainHref(joined) };
    return { href: brainHref(joined), broken: true };
  }

  function resolveImage(src) {
    if (/^https?:/i.test(src)) return null;
    const { path: rel } = splitTail(src);
    const hub = globalThis.BureauHub;
    let file;
    if (src[0] === '/') {
      if (src.startsWith('/brain/')) file = decode(rel.slice(7));
      else return null;
    } else {
      file = normalizeJoin(dir, decode(rel));
    }
    return file && hub ? { secure: hub.imageUrl(file) } : null;
  }

  return { wikilink, resolveLink, resolveImage };
}

// Links here. There's no backlink index on the hub, so this reads the notes
// once, a few at a time, and keeps the answer until the brain changes. Journal
// days and the attic stay out, as they do in the map.
const SCANNED = /^(knowledge|recipes|projects|entities|agents)\//;
const POOL = 8;

export const linksHereKnown = () => !!graph;
export function linksHere(path) {
  return graph ? { sources: graph.here.get(path) || [], scanned: graph.scanned } : null;
}

export function buildGraph({ onProgress, signal }) {
  if (graph) return Promise.resolve(graph);
  if (!graphBuilding) graphBuilding = runScan(onProgress).finally(() => { graphBuilding = null; });
  if (!signal) return graphBuilding;
  return Promise.race([graphBuilding, new Promise((_, reject) => {
    signal.addEventListener('abort', () => reject(new DOMException('left the page', 'AbortError')), { once: true });
  })]);
}

async function runScan(onProgress) {
  const files = await listFiles();
  const todo = files.filter((f) => f.endsWith('.md') && SCANNED.test(f));
  const notes = await notesFor('');
  const here = new Map();
  let done = 0;
  let next = 0;
  const work = async () => {
    while (next < todo.length) {
      const file = todo[next++];
      try {
        const r = await api.get(`/api/knowledge?file=${encodeURIComponent(file)}`);
        const doc = parseMarkdown((r && r.content) || '');
        const resolve = resolverFor(file, files, notes);
        const out = new Set();
        for (const link of doc.links) {
          let target = null;
          if (link.kind === 'wikilink') {
            const w = resolve.wikilink(link.target);
            target = w && w.file;
          } else if (link.kind === 'link') {
            const l = resolve.resolveLink(link.href);
            target = l && typeof l === 'object' ? l.file : null;
          }
          if (target && target !== file) out.add(target);
        }
        for (const target of out) {
          if (!here.has(target)) here.set(target, []);
          here.get(target).push(file);
        }
      } catch (e) {
        if (e.status !== 403 && e.status !== 404) throw e;
      }
      done++;
      if (onProgress) onProgress(done, todo.length);
    }
  };
  await Promise.all(Array.from({ length: POOL }, work));
  for (const list of here.values()) list.sort();
  graph = { here, scanned: todo.length };
  return graph;
}

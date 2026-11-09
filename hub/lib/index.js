// lib/index.js: search over the brain, in memory. The files stay the truth;
// this is rebuilt from them at boot and kept current as the hub writes them.
// BM25 over chunks (a section, a claim, a journal record), multiplied by how
// much a compartment can be trusted. No model, no dependency: the same brain
// and the same question give the same answer.
//
// The scope is decided here, not by the caller's manners: a project sees global
// knowledge, its entity's and its own, and nothing from another project.
'use strict';
const path = require('path');
const claims = require('./claims');
const knowledge = require('./knowledge');
const store = require('./store');

const K1 = 1.2, B = 0.75;
const WEIGHT = { curated: 1.5, project: 1.3, state: 1.0, journal: 0.8 };
const DEFAULT_K = 5, MAX_K = 50, PER_FILE = 3;
const PROSE_MIN = 40; // shorter leftovers beside a section's claims are noise

// English and French. Accents are gone by the time a word is looked up here.
const STOP = new Set((
  'a an and are as at be been but by can could did do does done for from had has have how i if in into is it its just me my ' +
  'not no yes ok okay please thanks sure go oui non merci of on or our should so some than that the their them then there these they this to was we were what when where ' +
  'which who why will with would you your about any all also after before use used using get got make need want ' +
  'au aux avec car ce ces cet cette comme comment dans de des dois doit donc du elle elles en es est et etre eu fait faire ' +
  'il ils je la le les leur leurs lui ma mais me mes moi mon ne nos notre nous on ou par pas peut peux plus pour pourquoi ' +
  'qu quand que quel quelle quelles quels qui quoi sa sans se ses si son sont sous suis sur ta te tes toi ton tous tout ' +
  'toute toutes tu un une veux vers vos votre vous'
).split(' '));

function stem(w) {
  if (w.length < 4 || /\d/.test(w)) return w;
  let s = w;
  if (/[sx]$/.test(s) && !/ss$/.test(s)) s = s.slice(0, -1);
  if (s.length >= 6) s = s.replace(/(ement|ation|ing|aient|ait|ant|ent|ons|ez|er|ed|ee)$/, '');
  if (s.length >= 4) s = s.replace(/e$/, '');
  return s;
}

// Words, with identifiers kept whole as well as split: t-245 is one thing to
// look for, and journalFreeText also means free and text.
function tokens(text) {
  const out = [];
  const plain = String(text).normalize('NFD').replace(/\p{M}/gu, '');
  for (const word of plain.match(/[\p{L}\p{N}]+(?:[._/:-][\p{L}\p{N}]+)*/gu) || []) {
    const parts = word.split(/[._/:-]+/).flatMap((p) => p.replace(/([\p{Ll}\p{N}])(\p{Lu})/gu, '$1 $2').split(' '));
    if (parts.length > 1) out.push(word.toLowerCase());
    for (const p of parts) {
      const l = p.toLowerCase();
      if ((l.length < 2 && !/\d/.test(l)) || STOP.has(l)) continue;
      out.push(stem(l));
    }
  }
  return out;
}

// ---- What gets indexed, and who may see it ----
// null: not indexed. attic/ and archive/ stay out so that retired beliefs do
// not come back as context.
function classify(rel) {
  if (!/\.md$/i.test(rel) || rel === 'knowledge/INDEX.md') return null;
  let m;
  if ((m = rel.match(/^(knowledge|recipes)\//))) return { kind: 'curated', compartment: m[1], scope: 'global', weight: WEIGHT.curated };
  if ((m = rel.match(/^entities\/([^/]+)\/(?:(knowledge|recipes)\/|PROFILE\.md$)/i))) return { kind: 'curated', compartment: m[2] || 'profile', scope: 'entity', entity: m[1], weight: WEIGHT.curated };
  if ((m = rel.match(/^projects\/([^/]+)\/(.+)$/))) {
    const base = { scope: 'project', project: m[1] };
    if (m[2] === 'STATE.md') return { ...base, kind: 'state', compartment: 'state', weight: WEIGHT.state };
    if (/^(deliverables|references)\//.test(m[2])) return { ...base, kind: 'map-only', compartment: m[2].split('/')[0], weight: 0 };
    return { ...base, kind: 'project', compartment: /^specs\//.test(m[2]) ? 'spec' : 'project', weight: WEIGHT.project };
  }
  if (/^journal\/\d{4}-\d{2}-\d{2}\.md$/.test(rel)) return { kind: 'journal', compartment: 'journal', scope: 'none', weight: WEIGHT.journal };
  return null;
}

// The caller's chain. general and an unknown project both see global only: one
// holds work from anywhere, and the other is a project we cannot vouch for.
function scopeOf(project) {
  const p = project && store.load().projects.find((x) => x.id === project);
  if (!p) return { project: null, entity: null, resolved: false, chain: ['global'] };
  if (p.id === 'general') return { project: null, entity: null, resolved: true, chain: ['global'] };
  const chain = ['global'];
  if (p.entity) chain.push(`entity:${p.entity}`);
  chain.push(`project:${p.id}`);
  return { project: p.id, entity: p.entity || null, resolved: true, chain };
}
function visible(c, scope) {
  if (c.scope === 'global') return true;
  if (c.scope === 'entity') return !!scope.entity && c.entity === scope.entity;
  if (c.scope === 'project') return !!scope.project && c.project === scope.project;
  return false;
}

// A journal record belongs to its mission's project, else to the project its
// tags name. With neither it is served to nobody until the librarian files it.
function journalProject(c) {
  const s = store.load();
  if (c.fields.mission) {
    const t = s.tasks.find((x) => x.id === c.fields.mission);
    if (t && t.project) return t.project;
  }
  const ids = new Set(s.projects.map((p) => p.id));
  return (c.tags || []).find((t) => ids.has(t)) || null;
}

// ---- Cutting a file into chunks ----
const HEADING_RE = /^(#{1,3}) +(.+?)\s*#*\s*$/;
const FOOTER_RE = /^_.*_$/;
const CLAIM_LINE_RE = /^- \[[A-Za-z0-9_-]+\] /;

function sectionsOf(content) {
  const lines = content.replace(/^﻿/, '').split('\n').map((l) => l.replace(/\r$/, ''));
  let i = 0;
  if (lines[0] === '---') { const end = lines.indexOf('---', 1); if (end !== -1) i = end + 1; }
  const out = [];
  let cur = { heading: null, level: 0, line: i + 1, body: [] }, fence = false;
  for (; i < lines.length; i++) {
    if (/^\s*(```|~~~)/.test(lines[i])) fence = !fence;
    const m = !fence && lines[i].match(HEADING_RE);
    if (m) { out.push(cur); cur = { heading: m[2], level: m[1].length, line: i + 1, body: [] }; }
    else cur.body.push({ n: i + 1, text: lines[i] });
  }
  out.push(cur);
  return out;
}

function makeChunk(rel, info, extra) {
  const text = extra.text;
  return { file: rel, section: extra.section || null, line: extra.line || null, claim: extra.claim || null, kind: info.kind, compartment: info.compartment,
    scope: extra.scope || info.scope, project: extra.project !== undefined ? extra.project : info.project, entity: info.entity, weight: info.weight,
    text, tokens: Math.ceil(Buffer.byteLength(text, 'utf8') / 4), sources: extra.sources || [], verified: extra.verified || null, belief: extra.belief || null,
    volatility: extra.volatility || null, standing: !!extra.standing, contradicts: extra.contradicts || [], index: extra.index };
}

function chunkFile(rel, content, info) {
  const parsed = claims.parseFile(content, { path: rel });
  const front = parsed.frontmatter;
  const title = front.title || '';
  const named = `${path.posix.basename(rel, '.md').replace(/[-_]/g, ' ')} ${title}`;
  const fileMeta = { verified: front.verified, belief: front.belief, volatility: front.volatility };
  const claimsAt = new Map(parsed.claims.map((c) => [c.line, c]));
  const out = [];

  if (info.kind === 'map-only') {
    const body = sectionsOf(content).flatMap((s) => s.body.map((l) => l.text)).filter((l) => l.trim()).slice(0, 12).join(' ');
    const c = makeChunk(rel, info, { text: body.slice(0, 800), ...fileMeta, index: `${named} ${front.summary || ''} ${body}` });
    c.tokens = Math.ceil(Buffer.byteLength(content, 'utf8') / 4);
    return [c];
  }

  if (info.kind === 'journal') {
    if (parsed.format !== '0.3') return [];
    for (const c of parsed.claims) {
      const project = journalProject(c);
      if (!project) continue;
      out.push(makeChunk(rel, info, { text: c.text, line: c.line, claim: c.id, scope: 'project', project, verified: (c.fields.at || '').slice(0, 10),
        sources: c.id ? [c.id] : [], index: `${c.text} ${c.fields.evidence || ''} ${(c.tags || []).join(' ')}` }));
    }
    return out;
  }

  for (const s of sectionsOf(content)) {
    if (s.heading && /^relations$/i.test(s.heading)) continue;
    const label = s.heading && s.level > 1 ? s.heading : null;
    const prose = [];
    for (const l of s.body) {
      const c = claimsAt.get(l.n);
      if (c) {
        if ((c.fields.supersedes || []).length) { /* it stands; what it replaces is dropped below */ }
        out.push(makeChunk(rel, info, { text: c.text, section: label, line: c.line, claim: c.id, sources: c.sources.map((x) => x.ref), verified: c.fields.verified || front.verified,
          belief: c.fields.belief || front.belief, volatility: c.fields.volatility || front.volatility, contradicts: c.fields.contradicts,
          index: `${c.text} ${label || ''} ${label || ''} ${named}` }));
      } else if (l.text.trim() && !FOOTER_RE.test(l.text.trim()) && !/^\s+- /.test(l.text)) {
        prose.push(l.text);
      }
    }
    const text = prose.join('\n').trim();
    const isNow = info.kind === 'state' && label && /^now$/i.test(label);
    if (text.length >= PROSE_MIN || isNow) {
      out.push(makeChunk(rel, info, { text, section: label, line: s.line, ...fileMeta, standing: isNow, index: `${text} ${label || ''} ${label || ''} ${named}` }));
    }
  }
  return out;
}

// ---- The index ----
let chunks = new Map();      // id -> chunk
let byFile = new Map();      // file -> [id]
let postings = new Map();    // term -> Map(id -> term frequency)
let files = new Map();       // file -> one line about it, for the map
let totalLen = 0, nextId = 1, built = false, builtAt = null, commit = undefined;
let superseded = new Set();

function removeFile(rel) {
  files.delete(rel);
  for (const id of byFile.get(rel) || []) {
    const c = chunks.get(id);
    for (const t of c.tf.keys()) {
      const p = postings.get(t);
      p.delete(id);
      if (!p.size) postings.delete(t);
    }
    totalLen -= c.len;
    chunks.delete(id);
  }
  byFile.delete(rel);
}

function addFile(rel) {
  const info = classify(rel);
  if (!info) return;
  const content = knowledge.readKnowledge(rel);
  if (content === null) return;
  const ids = [];
  const made = chunkFile(rel, content, info);
  if (info.kind !== 'journal') {
    const front = claims.parseFile(content, { path: rel }).frontmatter;
    const first = made.length ? made[0].text.split(/(?<=[.!?])\s/)[0].replace(/\s+/g, ' ').slice(0, 200) : '';
    files.set(rel, { file: rel, title: front.title || path.posix.basename(rel, '.md'), summary: front.summary || first, tokens: Math.ceil(Buffer.byteLength(content, 'utf8') / 4),
      compartment: info.compartment, scope: info.scope, project: info.project, entity: info.entity, verified: front.verified || null, belief: front.belief || null });
  }
  for (const c of made) {
    const toks = tokens(c.index);
    delete c.index;
    if (!toks.length) continue;
    const tf = new Map();
    for (const t of toks) tf.set(t, (tf.get(t) || 0) + 1);
    c.tf = tf;
    c.len = toks.length;
    const id = nextId++;
    chunks.set(id, c);
    ids.push(id);
    totalLen += c.len;
    for (const [t, n] of tf) {
      if (!postings.has(t)) postings.set(t, new Map());
      postings.get(t).set(id, n);
    }
  }
  if (ids.length) byFile.set(rel, ids);
}

// A claim named by another claim's supersedes is out of date: never served.
function refreshSuperseded() {
  superseded = new Set();
  for (const f of knowledge.listKnowledge('').filter((x) => classify(x) && !/^journal\//.test(x))) {
    if (!/\.md$/i.test(f)) continue;
    for (const c of claims.parseFile(knowledge.readKnowledge(f) || '', { path: f }).claims) for (const id of c.fields.supersedes || []) superseded.add(id);
  }
}

function build() {
  const t0 = Date.now();
  chunks = new Map(); byFile = new Map(); postings = new Map(); files = new Map(); totalLen = 0; nextId = 1;
  for (const f of knowledge.listKnowledge('')) addFile(f.split(path.sep).join('/'));
  refreshSuperseded();
  built = true;
  builtAt = new Date().toISOString();
  commit = undefined;
  return { files: byFile.size, chunks: chunks.size, terms: postings.size, ms: Date.now() - t0 };
}
function ensure() { if (!built) build(); }
function invalidate() { built = false; }

// A write landed. The event's file field is one path, "a -> b" for a move, or
// a comma list from the intake sweep. Anything unreadable rebuilds on next use.
function touch(field) {
  if (!built) return;
  const written = String(field || '').split(/\s*(?:->|,)\s*/).map((x) => x.trim()).filter(Boolean);
  if (!written.length) return invalidate();
  try {
    for (const f of written) { removeFile(f); addFile(f); }
    refreshSuperseded();
    commit = undefined;
  } catch { invalidate(); }
}

// What the index was built from, for the answer's footer. One git call per
// brain change, not per request.
function stamp() {
  ensure();
  if (commit === undefined) {
    try { commit = (knowledge.recentCommits(1)[0] || {}).hash || null; } catch { commit = null; }
  }
  return { commit, built_at: builtAt };
}

// One line per file the caller may see: its own project first, then the rest
// of the chain. The attic stays out, and journal days are not notes.
function map(project) {
  ensure();
  const scope = scopeOf(project);
  const rank = (f) => (f.scope === 'project' ? 0 : f.scope === 'entity' ? 1 : f.compartment === 'knowledge' ? 2 : 3);
  const rows = [...files.values()].filter((f) => visible(f, scope)).sort((a, b) => rank(a) - rank(b) || a.file.localeCompare(b.file));
  return { scope, files: rows.map(({ scope: _s, project: _p, entity: _e, ...r }) => r) };
}
function fileInfo(rel, scope) {
  ensure();
  const f = files.get(rel);
  return f && visible(f, scope) ? f : null;
}
function findClaim(id, scope) {
  ensure();
  for (const c of chunks.values()) if (c.claim === id) return visible(c, scope) && !superseded.has(id) ? c : null;
  return null;
}

function search(q, { project, k = DEFAULT_K, mapOnly = false } = {}) {
  ensure();
  const scope = scopeOf(project);
  const limit = Math.min(Math.max(1, Number(k) || DEFAULT_K), MAX_K);
  const terms = [...new Set(tokens(q))];
  if (!terms.length) return { scope, results: [], skipped: 'no terms', size: chunks.size };
  const N = chunks.size || 1, avg = totalLen / N || 1;
  const scores = new Map(), matched = new Map(), weights = {};
  for (const t of terms) {
    const p = postings.get(t);
    // A word the brain has never seen weighs the most: it is why a question
    // about something absent covers so little of itself.
    weights[t] = Math.log(1 + (N - (p ? p.size : 0) + 0.5) / ((p ? p.size : 0) + 0.5));
    if (!p) continue;
    const idf = weights[t];
    for (const [id, tf] of p) {
      const c = chunks.get(id);
      if (!visible(c, scope) || (c.claim && superseded.has(c.claim))) continue;
      if (c.kind === 'map-only' && !mapOnly) continue;
      const s = idf * (tf * (K1 + 1)) / (tf + K1 * (1 - B + B * c.len / avg));
      scores.set(id, (scores.get(id) || 0) + s);
      if (!matched.has(id)) matched.set(id, []);
      matched.get(id).push(t);
    }
  }
  const ranked = [...scores].map(([id, s]) => ({ id, score: s * (chunks.get(id).weight || 1) })).sort((a, b) => b.score - a.score || a.id - b.id);
  // Three hits per file at most: one recipe must not crowd out everything else
  const perFile = new Map(), results = [];
  for (const { id, score } of ranked) {
    const c = chunks.get(id);
    const n = perFile.get(c.file) || 0;
    if (n >= PER_FILE) continue;
    perFile.set(c.file, n + 1);
    const total = Object.values(weights).reduce((a, b) => a + b, 0) || 1;
    const covered = matched.get(id).reduce((a, t) => a + weights[t], 0);
    results.push({ file: c.file, section: c.section, line: c.line, claim: c.claim, compartment: c.compartment, kind: c.kind, score: Math.round(score * 100) / 100,
      coverage: Math.round(covered / total * 1000) / 1000, matched: matched.get(id), text: c.text, tokens: c.tokens, sources: c.sources, verified: c.verified, belief: c.belief,
      volatility: c.volatility, contradicts: c.contradicts, standing: c.standing });
    if (results.length >= limit) break;
  }
  return { scope, results, skipped: null, size: chunks.size };
}

// The project's ## Now, whatever the question. Null when it has none.
function standingOf(project) {
  ensure();
  const scope = scopeOf(project);
  if (!scope.project) return null;
  for (const id of byFile.get(`projects/${scope.project}/STATE.md`) || []) {
    const c = chunks.get(id);
    if (c.standing) return c;
  }
  return null;
}

// One section of a file, with its frontmatter. Null when the heading is not
// there; the caller lists what is.
function section(content, heading) {
  const want = String(heading).toLowerCase().trim();
  const parts = sectionsOf(content);
  const at = parts.findIndex((s) => s.heading && s.heading.toLowerCase().includes(want));
  if (at === -1) return null;
  const lines = content.replace(/^﻿/, '').split('\n').map((l) => l.replace(/\r$/, ''));
  const frontEnd = lines[0] === '---' ? lines.indexOf('---', 1) : -1;
  const frontmatter = frontEnd > 0 ? lines.slice(0, frontEnd + 1).join('\n') : '';
  const level = parts[at].level;
  const body = [`${'#'.repeat(level)} ${parts[at].heading}`, ...parts[at].body.map((l) => l.text)];
  for (let i = at + 1; i < parts.length && parts[i].level > level; i++) body.push(`${'#'.repeat(parts[i].level)} ${parts[i].heading}`, ...parts[i].body.map((l) => l.text));
  return { heading: parts[at].heading, frontmatter, content: body.join('\n').trimEnd() };
}
function headingsOf(content) { return sectionsOf(content).filter((s) => s.heading).map((s) => s.heading); }

module.exports = { build, invalidate, touch, search, section, headingsOf, scopeOf, tokens, classify, ensure, map, fileInfo, findClaim, standingOf, stamp };

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
const GLOSSARY = require('./glossary');

// LAB FLAGS (removed in the frozen commit): BUREAU_LAB=a,b,...
const LAB = new Set((process.env.BUREAU_LAB || '').split(',').filter(Boolean));
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
  if (LAB.has('f') && (m = rel.match(/^archive\/projects\/([^/]+)\/.+\.md$/))) return { scope: 'project', project: m[1], kind: 'archive', compartment: 'archive', weight: WEIGHT.state, archived: true };
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
  const named = `${path.posix.basename(rel, '.md').replace(/[-_]/g, ' ')} ${title}${LAB.has('h') && front.summary ? ` ${front.summary}` : ''}`;
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
let gramIndex = null;        // LAB g2
let scopeCache = new Map();  // LAB a
let shadow = new Map();      // LAB g1: chunk hash -> French index text
let archiveChunks = [];      // LAB f

function chunkHash(text) { return require('crypto').createHash('sha256').update(text).digest('hex').slice(0, 16); }
function loadShadow() {
  shadow = new Map();
  if (!LAB.has('g1')) return;
  try { for (const [k, v] of Object.entries(JSON.parse(require('fs').readFileSync(path.join(knowledge.BRAIN_DIR, '.index', 'shadow-fr.json'), 'utf8')))) shadow.set(k, v); }
  catch (e) { console.error('[index] no shadow:', e.message); }
}

function removeFile(rel) {
  files.delete(rel);
  gramIndex = null; scopeCache = new Map();
  archiveChunks = archiveChunks.filter((c) => c.file !== rel);
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
    const sh = LAB.has('g1') ? shadow.get(chunkHash(c.text)) : null;
    const toks = tokens(sh ? `${c.index} ${sh}` : c.index);
    delete c.index;
    if (!toks.length) continue;
    const tf = new Map();
    for (const t of toks) tf.set(t, (tf.get(t) || 0) + 1);
    c.tf = tf;
    c.len = toks.length;
    if (info.kind === 'archive') { archiveChunks.push(c); continue; }
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
  chunks = new Map(); byFile = new Map(); postings = new Map(); files = new Map(); totalLen = 0; nextId = 1; gramIndex = null; scopeCache = new Map(); archiveChunks = [];
  loadShadow();
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
    gramIndex = null;
  } catch { invalidate(); }
}

// LAB a: statistics of what this scope can see.
function scopeStats(scope) {
  const key = scope.chain.join('|');
  let st = scopeCache.get(key);
  if (!st) {
    st = { n: 0, len: 0 };
    for (const c of chunks.values()) if (visible(c, scope)) { st.n++; st.len += c.len; }
    scopeCache.set(key, st);
  }
  return st;
}
function scopedDf(t, scope) {
  const p = postings.get(t);
  if (!p) return 0;
  let n = 0;
  for (const id of p.keys()) if (visible(chunks.get(id), scope)) n++;
  return n;
}

// LAB g2: a query word with no postings, matched to vocabulary by 4-gram Dice.
function grams(t) { const out = new Set(); for (let i = 0; i + 4 <= t.length; i++) out.add(t.slice(i, i + 4)); return out; }
function cognates(t) {
  if (!LAB.has('g2') || t.length < 5 || /\d/.test(t) || postings.has(t)) return [];
  if (!gramIndex) {
    gramIndex = new Map();
    for (const term of postings.keys()) {
      if (term.length < 5 || !/^\p{L}+$/u.test(term)) continue;
      for (const g of grams(term)) { if (!gramIndex.has(g)) gramIndex.set(g, []); gramIndex.get(g).push(term); }
    }
  }
  const gs = grams(t), count = new Map();
  for (const g of gs) for (const term of gramIndex.get(g) || []) count.set(term, (count.get(term) || 0) + 1);
  const scored = [];
  for (const [term, shared] of count) {
    if (shared < 2) continue;
    const dice = 2 * shared / (gs.size + grams(term).size);
    if (dice >= COGNATE_DICE) scored.push({ term, dice });
  }
  return scored.sort((a, b) => b.dice - a.dice || (a.term < b.term ? -1 : 1)).slice(0, COGNATE_MAX).map((x) => x.term);
}
const COGNATE_DICE = 0.6, COGNATE_MAX = 3;

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
// One claim and its evidence, each source resolved: "where does this come
// from" in one call. Its own sources, or the file's when it has none.
function claimDetail(id) {
  ensure();
  let c = null;
  for (const x of chunks.values()) if (x.claim === id) { c = x; break; }
  if (!c) return null;
  const front = claims.parseFile(knowledge.readKnowledge(c.file) || '', { path: c.file }).frontmatter;
  const own = (c.sources || []).filter((s) => s !== id);
  const inherited = own.length ? [] : String(front.source || '').replace(/^\[(?!\[)|(?<!\])\]$/g, '').split(',').map((s) => s.trim().replace(/^\[\[|\]\]$/g, '')).filter(Boolean);
  const refs = own.length ? own : inherited;
  const tasks = store.load().tasks;
  const records = refs.some((r) => /^j-/.test(r)) ? require('./journal').list().records : [];
  const resolve = (ref) => {
    if (/^t-\d+$/.test(ref)) {
      const t = tasks.find((x) => x.id === ref);
      return t ? { ref, type: 'mission', found: true, title: t.title, status: t.status, project: t.project } : { ref, type: 'mission', found: false };
    }
    if (/^j-/.test(ref)) {
      const r = records.find((x) => x.id === ref);
      return r ? { ref, type: 'record', found: true, text: r.text, evidence: r.fields.evidence, by: r.fields.by, at: r.fields.at } : { ref, type: 'record', found: false };
    }
    const target = ref.split('#')[0];
    return { ref, type: 'wikilink', found: knowledge.readKnowledge(/\.md$/.test(target) ? target : `${target}.md`) !== null || [...files.values()].some((f) => f.title === target) };
  };
  return { id, file: c.file, section: c.section, line: c.line, text: c.text, compartment: c.compartment, verified: c.verified, belief: c.belief, volatility: c.volatility,
    evidence: own.length ? 'own' : inherited.length ? 'file' : 'none', sources: refs.map(resolve) };
}

function findClaim(id, scope) {
  ensure();
  for (const c of chunks.values()) if (c.claim === id) return visible(c, scope) && !superseded.has(id) ? c : null;
  return null;
}

// The question as groups of terms: a word and its translations are one group,
// so a translated word counts once toward how much of the question was covered.
const plainText = (s) => String(s).normalize('NFD').replace(/\p{M}/gu, '').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
const WORDS = new Map(), PHRASES = [];
for (const [fr, en] of GLOSSARY) {
  if (fr.includes(' ')) PHRASES.push([` ${plainText(fr)} `, en]);
  else WORDS.set(stem(plainText(fr)), en);
}
function queryGroups(q) {
  const groups = [...new Set(tokens(q))].map((t) => (WORDS.has(t) ? [...new Set([t, ...tokens(WORDS.get(t))])] : [t, ...cognates(t)]));
  const plain = ` ${plainText(q)} `;
  for (const [fr, en] of PHRASES) if (plain.includes(fr)) groups.push([...new Set(tokens(en))]);
  return groups.filter((g) => g.length);
}

function search(q, { project, k = DEFAULT_K, mapOnly = false } = {}) {
  ensure();
  const scope = scopeOf(project);
  const limit = Math.min(Math.max(1, Number(k) || DEFAULT_K), MAX_K);
  const groups = queryGroups(q);
  const terms = [...new Set(groups.flat())];
  if (!terms.length) return { scope, results: [], skipped: 'no terms', size: chunks.size };
  const st = LAB.has('a') || LAB.has('a2') ? scopeStats(scope) : null;
  const N = (st ? st.n : chunks.size) || 1, avg = (st ? st.len : totalLen) / N || 1;
  const scores = new Map(), matched = new Map(), weights = {};
  for (const t of terms) {
    const p = postings.get(t);
    const df = st ? scopedDf(t, scope) : (p ? p.size : 0);
    // A word the brain has never seen weighs the most: it is why a question
    // about something absent covers so little of itself.
    weights[t] = Math.log(1 + (N - df + 0.5) / (df + 0.5));
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
  const dropUnknown = LAB.has('b') || (LAB.has('bf') && isFrench(q));
  const ranked = [...scores].map(([id, s]) => ({ id, score: s * (chunks.get(id).weight || 1) })).sort((a, b) => b.score - a.score || a.id - b.id);
  // Three hits per file at most: one recipe must not crowd out everything else
  const perFile = new Map(), results = [];
  for (const { id, score } of ranked) {
    const c = chunks.get(id);
    const n = perFile.get(c.file) || 0;
    if (n >= (LAB.has('j') && c.kind === 'state' ? 6 : PER_FILE)) continue;
    perFile.set(c.file, n + 1);
    // A group weighs what its rarest term the brain knows weighs. A French
    // word that appears nowhere must not outweigh its English translation.
    const groupWeight = (g, among) => Math.max(0, ...g.filter(among).map((t) => weights[t]));
    const hit = new Set(matched.get(id));
    // LAB c: an unknown word weighs at most what the query's rarest known word weighs.
    const knownMax = Math.max(0, ...groups.map((g) => groupWeight(g, (t) => postings.has(t))));
    const drain = (g) => (dropUnknown ? 0 : LAB.has('c') && N < 620 ? Math.min(groupWeight(g, () => true), knownMax) : groupWeight(g, () => true));
    const total = groups.reduce((a, g) => a + (groupWeight(g, (t) => postings.has(t)) || drain(g)), 0) || 1;
    const covered = groups.reduce((a, g) => a + groupWeight(g, (t) => hit.has(t)), 0);
    results.push({ file: c.file, section: c.section, line: c.line, claim: c.claim, compartment: c.compartment, kind: c.kind, score: Math.round(score * 100) / 100,
      coverage: Math.round(covered / total * 1000) / 1000, matched: matched.get(id), text: c.text, tokens: c.tokens, sources: c.sources, verified: c.verified, belief: c.belief,
      volatility: c.volatility, contradicts: c.contradicts, standing: c.standing });
    if (results.length >= limit) break;
  }
  return { scope, results, skipped: null, size: st && !LAB.has('a2') ? st.n : chunks.size, groups };
}

// LAB f: past notes, only after a miss. A separate small BM25 over archive/.
function searchArchive(q, { project, k = 3 } = {}) {
  ensure();
  if (!LAB.has('f')) return null;
  const scope = scopeOf(project);
  const pool = archiveChunks.filter((c) => visible(c, scope));
  if (!pool.length) return { results: [], size: 0 };
  const groups = queryGroups(q);
  const terms = [...new Set(groups.flat())];
  const N = pool.length, avg = pool.reduce((a, c) => a + c.len, 0) / N || 1;
  const df = (t) => pool.filter((c) => c.tf.has(t)).length;
  const scored = [];
  for (const c of pool) {
    let s = 0;
    const matched = [];
    for (const t of terms) {
      const tf = c.tf.get(t);
      if (!tf) continue;
      const d = df(t);
      s += Math.log(1 + (N - d + 0.5) / (d + 0.5)) * (tf * (K1 + 1)) / (tf + K1 * (1 - B + B * c.len / avg));
      matched.push(t);
    }
    if (s) scored.push({ c, s: s * (c.weight || 1), matched });
  }
  scored.sort((a, b) => b.s - a.s || a.c.file.localeCompare(b.c.file));
  const total = groups.length || 1;
  const hitGroups = (m) => groups.filter((g) => g.some((t) => m.includes(t))).length;
  return { size: N, results: scored.slice(0, k).map(({ c, s, matched }) => ({ file: c.file, section: c.section, line: c.line, claim: c.claim, compartment: 'archive', kind: 'archive', archived: true, score: Math.round(s * 100) / 100,
    coverage: Math.round(hitGroups(matched) / total * 1000) / 1000, matched, text: c.text, tokens: c.tokens, sources: c.sources, verified: c.verified, belief: c.belief, volatility: c.volatility, contradicts: [], standing: false })) };
}

// LAB b variant: a query that reads as French by its function words.
const FR_MARK = new Set('le la les des du est je tu ca quoi pour avec dans qui quel quelle pas mon ma mes une cette sur comment pourquoi vous nous etre peut peux faire au aux en sa son ses leur quand ou'.split(' '));
function isFrench(q) {
  const ws = plainText(q).split(' ');
  return ws.some((w) => FR_MARK.has(w));
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

function chunkDump() { ensure(); const seen = new Map(); for (const c of chunks.values()) if (c.kind !== 'map-only') seen.set(chunkHash(c.text), { hash: chunkHash(c.text), file: c.file, section: c.section, text: c.text }); return [...seen.values()]; }

module.exports = { _cognates: (t) => { ensure(); return cognates(t); }, chunkDump, searchArchive, build, invalidate, touch, search, section, headingsOf, scopeOf, tokens, classify, ensure, map, fileInfo, findClaim, claimDetail, standingOf, stamp };

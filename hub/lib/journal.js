// lib/journal.js: typed capture (Brain Format v0.3, "Journal records").
// JSON in, one long-form claim block written to journal/<yyyy-mm-dd>.md (the
// only stored copy), JSON out. The hub validates, stamps id, by, mission and
// at, and writes through knowledge.writeKnowledge like any brain write.
'use strict';
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { isDeepStrictEqual } = require('util');
const claims = require('./claims');
const knowledge = require('./knowledge');
const store = require('./store');

const CAPTURE_KEYS = ['agent', 'kind', 'text', 'evidence', 'tags', 'confidence', 'mission'];
const STAMPED = ['id', 'by', 'at'];
const CONFIDENCE = ['observed', 'stated', 'inferred'];
const TAG_RE = /^[a-z0-9][a-z0-9-]*$/;
const DAY_FILE_RE = /^journal\/(\d{4}-\d{2}-\d{2})\.md$/;
// \r, \n, and the Unicode line and paragraph separators (U+2028, U+2029)
const LINE_BREAK_RE = new RegExp('[\\r\\n' + String.fromCharCode(0x2028, 0x2029) + ']');
const POINTER = 'capture it with POST /api/journal {agent, kind, text, evidence, tags?, confidence?} (MCP: capture)';

const refuse = (status, code, error) => ({ status, code, error });

// The body as sent: every check runs before anything is written.
function validate(b) {
  if (!b || typeof b !== 'object' || Array.isArray(b)) return refuse(400, 'E_FIELD', 'the body is a JSON object');
  for (const k of Object.keys(b)) {
    if (STAMPED.includes(k)) return refuse(400, 'E_FIELD', `${k} is stamped by the hub; do not send it`);
    if (!CAPTURE_KEYS.includes(k)) return refuse(400, 'E_FIELD', `unknown key ${k}; a capture takes ${CAPTURE_KEYS.join(', ')}`);
  }
  if (typeof b.agent !== 'string' || !b.agent.trim()) return refuse(400, 'E_FIELD', 'agent required: the registered agent capturing this');
  if (!claims.KINDS.includes(b.kind)) return refuse(400, 'E_KIND', `kind is one of ${claims.KINDS.join(', ')}`);
  if (typeof b.text !== 'string' || !b.text.trim()) return refuse(400, 'E_FIELD', 'text required: one line, the claim itself');
  const text = b.text.trim();
  if (LINE_BREAK_RE.test(text)) return refuse(400, 'E_WRAP', 'text is one line: no line breaks');
  if (/\^[cj]-/.test(text)) return refuse(400, 'E_ID', 'text never contains ^c- or ^j-: the hub assigns the id');
  if ([...text].length > claims.TEXT_MAX) return refuse(400, 'E_TOO_LONG', `text is ${[...text].length} characters, over ${claims.TEXT_MAX}`);
  if (typeof b.evidence !== 'string' || !b.evidence.trim()) return refuse(400, 'E_EVIDENCE', 'evidence required: one line saying how you know');
  const evidence = b.evidence.trim();
  if (LINE_BREAK_RE.test(evidence)) return refuse(400, 'E_FIELD', 'evidence is one line: no line breaks');
  let tags = [];
  if (b.tags !== undefined) {
    if (!Array.isArray(b.tags) || b.tags.some((t) => typeof t !== 'string' || !TAG_RE.test(t))) return refuse(400, 'E_FIELD', 'tags is an array of [a-z0-9][a-z0-9-]*, without #');
    for (const t of b.tags) if (!tags.includes(t)) tags.push(t);
  }
  const confidence = b.confidence === undefined ? 'observed' : b.confidence;
  if (!CONFIDENCE.includes(confidence)) return refuse(400, 'E_FIELD', `confidence is one of ${CONFIDENCE.join(', ')}`);
  if (b.mission !== undefined && (typeof b.mission !== 'string' || !/^t-\d+$/.test(b.mission))) return refuse(400, 'E_FIELD', 'mission is a mission id (t-123)');
  return { value: { agent: b.agent.trim(), kind: b.kind, text, evidence, tags, confidence, mission: b.mission } };
}

// Every .md under journal/ and archive/ (digested days keep their ids)
function journalFiles() {
  const out = [];
  for (const dir of ['journal', 'archive']) {
    if (!fs.existsSync(path.join(knowledge.BRAIN_DIR, dir))) continue;
    for (const f of knowledge.listKnowledge(dir)) if (f.endsWith('.md')) out.push(f.split(path.sep).join('/'));
  }
  return out;
}

// j- and 8 characters [a-z0-9], never used before in a journal file
const ALPHABET = 'abcdefghijklmnopqrstuvwxyz0123456789';
function newId() {
  const used = new Set();
  for (const f of journalFiles()) for (const m of (knowledge.readKnowledge(f) || '').matchAll(/\^(j-[a-z0-9]{8})/g)) used.add(m[1]);
  for (;;) {
    let id = 'j-';
    for (let i = 0; i < 8; i++) id += ALPHABET[crypto.randomInt(ALPHABET.length)];
    if (!used.has(id)) return id;
  }
}

// The missions an agent holds right now (claimed or in progress)
function heldBy(agent) {
  store.expireLeases();
  return store.load().tasks.filter((t) => t.assignee === agent && (t.status === 'claimed' || t.status === 'in_progress')).map((t) => t.id);
}

// POST /api/journal. Returns {record, file, moved?} or a refusal {status, code, error}.
function capture(body, now = new Date()) {
  const v = validate(body);
  if (!v.value) return v;
  const c = v.value;
  if (!store.load().agents.some((a) => a.name === c.agent)) return refuse(400, 'E_AGENT', `unknown agent ${c.agent}: register first (POST /api/agents/register)`);
  const held = heldBy(c.agent);
  let mission = null;
  if (c.mission) {
    if (!held.includes(c.mission)) return refuse(400, 'E_MISSION', `${c.agent} does not hold ${c.mission}${held.length ? ` (holds ${held.join(', ')})` : ' (holds no claimed or in-progress mission)'}`);
    mission = c.mission;
  } else if (held.length === 1) mission = held[0];

  const at = now.toISOString().slice(0, 16) + 'Z';
  const day = at.slice(0, 10);
  const file = `journal/${day}.md`;
  const record = {
    id: newId(), kind: c.kind, form: 'long', line: 0, text: c.text, tags: c.tags, sources: [], source_note: null,
    fields: { evidence: c.evidence, by: c.agent, ...(mission ? { mission } : {}), at, confidence: c.confidence },
  };
  const block = claims.serializeClaim(record);

  // The block must read back as the record before it is written
  const check = claims.parseFile(`---\nformat: 0.3\n---\n${block}\n`, { path: file });
  const back = check.claims[0];
  if (check.errors.length || check.claims.length !== 1 || !isDeepStrictEqual({ ...back, line: 0 }, record))
    return refuse(400, 'E_FIELD', `this capture would not read back as sent${check.errors.length ? `: ${check.errors.map((e) => e.message).join('; ')}` : ''}`);

  // Cutover: a day written as v0.2 free text moves aside, untouched, first
  const before = knowledge.readKnowledge(file);
  let moved = null;
  if (before !== null && claims.parseFile(before, { path: file }).format !== '0.3') {
    const aside = `journal/${day}.v02.md`;
    if (knowledge.readKnowledge(aside) !== null) return refuse(409, 'E_CUTOVER', `${file} is v0.2 and ${aside} already exists; the boss decides which to keep`);
    moved = knowledge.moveFile(file, aside, { author: c.agent, message: `journal: ${day} is v0.2 free text, moved to ${aside} before its first typed capture` });
  }
  const fresh = before === null || moved;
  const content = fresh ? `---\ntitle: Journal ${day}\ncompartment: journal\nformat: 0.3\n---\n\n${block}` : block;
  knowledge.writeKnowledge({ file, content, mode: 'append', author: c.agent, message: `journal: ${record.id} [${c.kind}] by ${c.agent}` });

  const parsed = claims.parseFile(knowledge.readKnowledge(file), { path: file });
  const written = parsed.claims.find((x) => x.id === record.id) || record;
  return { record: { ...written, file }, file, ...(moved ? { moved } : {}) };
}

// The claim each error belongs to: the nearest claim starting at or above it
function invalidLines(parsed) {
  const bad = new Set();
  for (const e of parsed.errors) {
    let owner = null;
    for (const c of parsed.claims) if (c.line <= e.line) owner = c.line;
    if (owner !== null) bad.add(owner);
  }
  return bad;
}

// GET /api/journal. Records from format 0.3 day files only (never the .v02
// files), oldest first; every error is listed in invalid, never dropped.
function list({ day, kind, mission, author, since } = {}) {
  if (day && !/^\d{4}-\d{2}-\d{2}$/.test(day)) return refuse(400, 'E_FIELD', 'day is yyyy-mm-dd');
  const sinceMs = since ? Date.parse(since) : null;
  if (since && Number.isNaN(sinceMs)) return refuse(400, 'E_FIELD', 'since is an ISO 8601 date or time');
  const records = [], invalid = [];
  const files = fs.existsSync(path.join(knowledge.BRAIN_DIR, 'journal'))
    ? knowledge.listKnowledge('journal').map((f) => f.split(path.sep).join('/')).filter((f) => DAY_FILE_RE.test(f)).sort() : [];
  for (const file of files) {
    if (day && file !== `journal/${day}.md`) continue;
    const parsed = claims.parseFile(knowledge.readKnowledge(file), { path: file });
    if (parsed.format !== '0.3') continue;
    for (const e of parsed.errors) invalid.push({ file, line: e.line, code: e.code, message: e.message });
    const bad = invalidLines(parsed);
    for (const c of parsed.claims) {
      if (bad.has(c.line)) continue;
      if (kind && c.kind !== kind) continue;
      if (mission && c.fields.mission !== mission) continue;
      if (author && c.fields.by !== author) continue;
      if (sinceMs !== null && !(Date.parse(c.fields.at) >= sinceMs)) continue;
      records.push({ ...c, file });
    }
  }
  records.sort((a, b) => String(a.fields.at || '').localeCompare(String(b.fields.at || '')) || a.file.localeCompare(b.file) || a.line - b.line);
  return { records, invalid };
}

// The free-text window, on POST /api/knowledge and MCP write_knowledge. The
// boss's own writes always pass. Otherwise: with journal_free_text false, no
// journal write at all; while it is open, a write to a format 0.3 day must
// leave its records exactly as they were (no new, changed or broken claim).
function freeTextRefusal({ file, content, mode, author, encoding }) {
  if (typeof file !== 'string' || author === 'human') return null;
  const rel = path.normalize(file).replace(/^([/\\])+/, '').split(path.sep).join('/');
  if (!/^journal\//i.test(rel)) return null;
  const s = store.load();
  if (store.settingsOf(s).global.journal_free_text === false)
    return refuse(403, 'E_WINDOW', `the journal free-text window is closed (settings journal_free_text): ${POINTER}`);
  if (!/\.md$/i.test(rel)) return null;
  let before;
  try { before = knowledge.readKnowledge(rel) || ''; } catch { return null; }
  const added = encoding === 'base64' ? Buffer.from(String(content), 'base64').toString('utf8') : String(content);
  const after = mode === 'append' ? before + (before.length ? '\n' : '') + added : added;
  const pb = claims.parseFile(before, { path: rel }), pa = claims.parseFile(after, { path: rel });
  if (pb.format !== '0.3' && pa.format !== '0.3') return null;
  const same = (x) => JSON.stringify([x.format, x.claims, x.errors]);
  if (same(pb) === same(pa)) return null;
  return refuse(422, 'E_FREE_TEXT', `${rel} is a format 0.3 journal day: free text may add only lines that are not claims, and this write would add, change or break a record. To record a claim, ${POINTER}`);
}

module.exports = { capture, list, validate, freeTextRefusal };

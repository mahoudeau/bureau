// lib/claims.js: the Brain Format v0.3 claim grammar, read and written
// (docs/brain-format.md, "Claims", "Journal records", "The parsed form").
// One reader for the hub, brain-lint and the index, so they agree on every
// line. Zero dependencies. The fixtures in test/fixtures/claims/ are the
// contract: parseFile returns exactly the parsed form they hold, and
// serializeClaim writes a hub-written claim back byte for byte.
//
// Licensed Apache-2.0 (LICENSE-APACHE at the repo root), like brain-lint,
// which uses it.
'use strict';

const KINDS = ['fact', 'gotcha', 'step', 'rule', 'why', 'decision', 'preference', 'correction', 'question', 'process', 'pattern'];
// The field table, in the order the hub writes it
const FIELDS = ['source', 'belief', 'volatility', 'verified', 'pinned', 'contradicts', 'supersedes', 'believed-until', 'evidence', 'by', 'mission', 'at', 'confidence', 'tags'];
const TEXT_MAX = 2000;
const REF_RE = /^(j-[a-z0-9]{8}|t-\d+|\[\[[^\]]+\]\])$/;
const CLAIM_RE = /^- \[([A-Za-z0-9_-]+)\] (.*)$/;
const SUB_RE = /^ {2}- ([A-Za-z0-9_-]+):(?:\s+(.*))?$/;
const TAG_RE = /(?:^|\s)#([a-z0-9][a-z0-9-]*)(?=\s|$)/g;
const CLAIM_ID_RE = /^(c-[a-z0-9]{6}|j-[a-z0-9]{8})$/;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const AT_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d+)?)?Z$/;

// What each field's value must look like; null means any non-empty value
const ENUMS = {
  belief: ['hypothesis', 'validated', 'superseded'],
  volatility: ['volatile', 'stable', 'durable'],
  confidence: ['observed', 'stated', 'inferred'],
};
const PATTERNS = { verified: DATE_RE, 'believed-until': DATE_RE, mission: /^t-\d+$/, at: AT_RE };

const refType = (r) => r.startsWith('j-') ? 'record' : r.startsWith('t-') ? 'mission' : 'wikilink';
const toRef = (r) => ({ ref: r.startsWith('[[') ? r.slice(2, -2) : r, type: refType(r) });
const refText = (s) => s.type === 'wikilink' ? `[[${s.ref}]]` : s.ref;
const splitList = (v) => v.split(',').map((x) => x.trim()).filter(Boolean);

function tagsIn(text) {
  const out = [];
  for (const m of text.matchAll(TAG_RE)) if (!out.includes(m[1])) out.push(m[1]);
  return out;
}

// Where a file sits decides two rules: journal records need evidence, curated
// claims need a source. The path wins; without one, the frontmatter compartment.
function placeOf(rel, front) {
  if (typeof rel === 'string' && rel.length) {
    const p = rel.replace(/\\/g, '/').replace(/^\/+/, '');
    if (/^journal\//.test(p)) return 'journal';
    if (/^(knowledge|recipes)\//.test(p) || /^entities\/[^/]+\/(knowledge|recipes)\//.test(p)) return 'curated';
    return null;
  }
  const c = front.compartment;
  if (c === 'journal') return 'journal';
  if (['knowledge', 'recipe', 'recipes'].includes(c)) return 'curated';
  return null;
}

// "key: value" lines between two "---" lines at the top. Values stay strings;
// matching outer quotes are dropped, as YAML would.
function readFrontmatter(lines) {
  const front = {}, keyLine = {};
  if (lines[0] !== '---') return { front, keyLine, bodyStart: 0 };
  const end = lines.indexOf('---', 1);
  if (end === -1) return { front, keyLine, bodyStart: 0 };
  for (let i = 1; i < end; i++) {
    const m = lines[i].match(/^([A-Za-z_][A-Za-z0-9_-]*):\s*(.*)$/);
    if (!m) continue;
    front[m[1]] = m[2].trim().replace(/^(["'])(.*)\1$/, '$2');
    keyLine[m[1]] = i + 1;
  }
  return { front, keyLine, bodyStart: end + 1 };
}

// parseFile(text, {path}) -> { format, frontmatter, claims, errors }.
// A format 0.3 file is read strictly and reports errors; any other file is
// v0.2, read leniently (a hard-wrapped item is joined to its first line) and
// never reports any.
function parseFile(text, opts = {}) {
  const lines = String(text).split('\n').map((l) => l.replace(/\r$/, ''));
  const { front, keyLine, bodyStart } = readFrontmatter(lines);
  const format = front.format !== undefined ? front.format : null;
  const strict = format === '0.3';
  const place = placeOf(opts.path, front);
  const claims = [], errors = [];
  const err = (code, line, message) => { if (strict) errors.push({ code, line, message }); };

  // The file-level source: covers the claims that carry none of their own
  let fileSourced = false;
  if (front.source !== undefined) {
    const raw = front.source.startsWith('[') && !front.source.startsWith('[[') ? front.source.replace(/^\[|\]$/g, '') : front.source;
    const refs = splitList(raw);
    const bad = refs.find((r) => !REF_RE.test(r));
    if (bad || !refs.length) err('E_REF', keyLine.source, `frontmatter source holds a malformed ref "${bad || '(empty)'}" (use j-xxxxxxxx, t-123 or [[target]])`);
    else fileSourced = true;
  }

  const seenIds = new Set();
  for (let i = bodyStart; i < lines.length; i++) {
    const m = lines[i].match(CLAIM_RE);
    if (!m) continue;
    const lineNo = i + 1;
    const kind = m[1];
    let first = m[2];
    const fields = {}, seenKeys = new Set();
    let sources = [], fieldTags = [], long = false;

    // The block: every indented line right below the first one
    let j = i + 1;
    for (; j < lines.length && /^[ \t]+\S/.test(lines[j]); j++) {
      const sub = lines[j].match(SUB_RE);
      const at = j + 1;
      if (sub) {
        long = true;
        const key = sub[1], value = (sub[2] || '').trim();
        if (!FIELDS.includes(key)) {
          err('E_FIELD', at, `unknown field "${key}" (fields: ${FIELDS.join(', ')})`);
          continue;
        }
        if (seenKeys.has(key)) { err('E_FIELD', at, `field "${key}" appears twice on one claim`); continue; }
        seenKeys.add(key);
        if (key === 'source') {
          const refs = splitList(value);
          const bad = refs.filter((r) => !REF_RE.test(r));
          if (bad.length || !refs.length) err('E_REF', at, `source holds a malformed ref "${bad[0] || '(empty)'}" (use j-xxxxxxxx, t-123 or [[target]])`);
          sources = refs.filter((r) => REF_RE.test(r)).map(toRef);
        } else if (key === 'tags') {
          const toks = value.split(/\s+/).filter(Boolean);
          if (!toks.length || toks.some((t) => !/^#[a-z0-9][a-z0-9-]*$/.test(t))) err('E_FIELD', at, 'tags are #tags, space-separated, each [a-z0-9][a-z0-9-]*');
          fieldTags = toks.filter((t) => /^#[a-z0-9][a-z0-9-]*$/.test(t)).map((t) => t.slice(1));
        } else if (key === 'contradicts' || key === 'supersedes') {
          const ids = splitList(value);
          if (!ids.length || ids.some((x) => !CLAIM_ID_RE.test(x))) err('E_FIELD', at, `${key} takes claim ids, comma-separated`);
          fields[key] = ids;
        } else if (key === 'pinned') {
          if (value !== 'true') err('E_FIELD', at, 'pinned takes only true');
          fields.pinned = value === 'true' ? true : value;
        } else {
          fields[key] = value;
          if (!value) err('E_FIELD', at, `field "${key}" is empty`);
          else if (ENUMS[key] && !ENUMS[key].includes(value)) err('E_FIELD', at, `${key} is one of ${ENUMS[key].join(', ')}`);
          else if (PATTERNS[key] && !PATTERNS[key].test(value)) err('E_FIELD', at, `${key} is malformed`);
        }
      } else if (/^\s*-(\s|$)/.test(lines[j])) {
        // A nested list item: v0.2 notes have them; a 0.3 claim takes fields only
        err('E_FIELD', at, 'a sub-line is "  - key: value", two spaces of indent');
      } else {
        err('E_WRAP', at, 'the text continues on this line: a claim is one physical line in a format 0.3 file');
        first += ' ' + lines[j].trim();
      }
    }
    i = j - 1;

    // The id: " ^c-xxxxxx" or " ^j-xxxxxxxx" at the very end
    let id = null, rest = first;
    const idm = rest.match(/\s\^([cj]-\S*)$/);
    if (idm) {
      id = idm[1];
      rest = rest.slice(0, idm.index);
      const want = place === 'journal' ? /^j-[a-z0-9]{8}$/ : place ? /^c-[a-z0-9]{6}$/ : CLAIM_ID_RE;
      if (!want.test(id)) err('E_ID', lineNo, `malformed id ^${id} (${place === 'journal' ? 'j- and 8' : place ? 'c- and 6' : 'c- and 6, or j- and 8'} characters [a-z0-9])`);
    }
    if (/\^[cj]-/.test(rest)) err('E_ID', lineNo, 'an id appears inside the text; only the one at the end of the line is the claim\'s');

    // Short form: the first "(source: ...)" group whose items are all refs.
    // Long form: the text is verbatim; sources come from the source field.
    let textOut = rest.replace(/\s+$/, ''), note = null;
    if (!long) {
      for (const g of rest.matchAll(/\(source:\s*([^)]*)\)/g)) {
        const refs = splitList(g[1]);
        if (!refs.length || !refs.every((r) => REF_RE.test(r))) continue;
        sources = refs.map(toRef);
        textOut = rest.slice(0, g.index).replace(/\s+$/, '');
        note = rest.slice(g.index + g[0].length).trim() || null;
        break;
      }
    }

    // Short form: the #tags in the text. Long form: the tags field only, so
    // the text stays verbatim and a record reads back with the tags it was sent.
    const tags = long ? fieldTags : tagsIn(textOut);

    if (!KINDS.includes(kind)) err('E_KIND', lineNo, `kind "${kind}" is not one of ${KINDS.join(', ')}`);
    if ([...textOut].length > TEXT_MAX) err('E_TOO_LONG', lineNo, `the text is ${[...textOut].length} characters, over ${TEXT_MAX}`);
    if (long && !id) err('E_ID_MISSING', lineNo, 'a long-form claim needs an id at the end of its first line');
    if (id) {
      if (seenIds.has(id)) err('E_ID_DUP', lineNo, `id ${id} is used twice`);
      seenIds.add(id);
    }
    if (place === 'journal' && !fields.evidence) err('E_EVIDENCE', lineNo, 'a journal record needs an evidence field');
    if (place === 'curated' && !sources.length && !fileSourced) err('E_UNSOURCED', lineNo, 'no source: give the claim its own, or the file a source: in its frontmatter');

    claims.push({ id, kind, form: long ? 'long' : 'short', line: lineNo, text: textOut, tags, sources, source_note: note, fields });
  }
  return { format, frontmatter: front, claims, errors };
}

// serializeClaim(claim) -> the claim's lines, joined by "\n", no trailing
// newline: short form on one line (its tags are in the text), long form with
// its fields in table order (its tags on the tags line).
function serializeClaim(c) {
  const sources = c.sources || [], fields = c.fields || {}, tags = c.tags || [];
  if (c.form === 'long') {
    const out = [`- [${c.kind}] ${c.text}${c.id ? ` ^${c.id}` : ''}`];
    for (const key of FIELDS) {
      let v;
      if (key === 'source') { if (!sources.length) continue; v = sources.map(refText).join(', '); }
      else if (key === 'tags') { if (!tags.length) continue; v = tags.map((t) => '#' + t).join(' '); }
      else if (fields[key] === undefined) continue;
      else v = Array.isArray(fields[key]) ? fields[key].join(', ') : String(fields[key]);
      out.push(`  - ${key}: ${v}`);
    }
    return out.join('\n');
  }
  let line = `- [${c.kind}] ${c.text}`;
  if (sources.length) line += ` (source: ${sources.map(refText).join(', ')})`;
  if (c.source_note) line += ` ${c.source_note}`;
  if (c.id) line += ` ^${c.id}`;
  return line;
}

module.exports = { parseFile, serializeClaim, tagsIn, KINDS, FIELDS, TEXT_MAX, REF_RE };

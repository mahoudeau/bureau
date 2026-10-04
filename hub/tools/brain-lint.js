#!/usr/bin/env node
// brain-lint: validator for the Bureau Brain Format (docs/brain-format.md).
// A brain either passes lint or it does not.
//
// Licensed Apache-2.0 (LICENSE-APACHE at the repo root), unlike the AGPL hub:
// this tool is meant to run anywhere a brain lives.
//
// Usage: node hub/tools/brain-lint.js <brain-dir>
// Exit codes: 0 = clean or warnings only, 1 = errors, 2 = bad invocation.
// As a module: lint(dir) for a whole brain, lintFile(dir, rel, content) for
// one file as it would be after a write (the hub calls it before writing).
'use strict';
const fs = require('fs');
const path = require('path');
const claims = require('../lib/claims');

const AUTHORITATIVE = ['knowledge', 'recipes'];
const KNOWN_TOP = ['journal', 'meetings', 'import', 'knowledge', 'recipes', 'entities', 'projects', 'agents', 'daily', 'archive', 'attic'];
const REQUIRED_FRONT = ['title', 'compartment', 'permalink', 'version'];
const ATTIC_FRONT = ['retired', 'retired_by', 'retired_reason', 'superseded_by'];
const SUMMARY_MAX = 200;
// Brain paths are '/' paths on every OS: messages, keys and link targets
// read the same on Windows, where a wikilink names projects/demo/STATE too.
const toPosix = (p) => String(p).split(path.sep).join('/').replace(/\\/g, '/');
const RULE_RE = /^\s*-\s*\**(RULE-[A-Z0-9]+-\d{2,})\b/;
const RULE_SOURCE_RE = /\(source:\s*[^)\s][^)]*\)/;

// What a source may name (Brain Format v0.3, "Refs"): a journal record, a
// mission, or a wikilink.
const REF_RE = /^(j-[a-z0-9]{8}|t-\d+|\[\[[^\]]+\]\])$/;
const refsOf = (list) => list.split(',').map(s => s.trim()).filter(Boolean);

// An observation's own source: the first "(source: ...)" group whose items are
// all refs. A group holding anything else is text, not a source; it is
// reported as prose so the writer can move the words out of it.
function ownSource(line) {
  let prose = null;
  for (const m of line.matchAll(/\(source:\s*([^)]*)\)/g)) {
    const items = refsOf(m[1]);
    if (items.length && items.every(r => REF_RE.test(r))) return { refs: items, prose: null };
    if (!prose) prose = m[0];
  }
  return { refs: null, prose };
}

// The file-level source (option D in the v0.3 spec): covers the observations
// that carry none of their own. Returns the refs, or the first malformed one.
function fileSource(front) {
  if (!front || front.source === undefined) return { refs: null, bad: null };
  const items = Array.isArray(front.source) ? front.source.map(String) : refsOf(String(front.source));
  const bad = items.find(r => !REF_RE.test(r));
  return bad || !items.length ? { refs: null, bad: bad || '(empty)' } : { refs: items, bad: null };
}

// Files an agent reads first when it loads a scope: they carry a one-line
// `summary:` so a map of the brain can be built without opening every file.
// The knowledge index (global or entity) is a map itself, so it is exempt.
function needsSummary(f) {
  const segs = f.rel.split('/');
  if (f.compartment === 'knowledge' && segs[segs.length - 1] === 'INDEX.md' && segs[segs.length - 2] === 'knowledge') return false;
  if (AUTHORITATIVE.includes(f.compartment)) return true;
  if (segs[0] === 'entities' && segs.length === 3 && segs[2] === 'PROFILE.md') return true;
  if (segs[0] === 'projects' && segs.length === 3 && segs[2] === 'STATE.md') return true;
  return false;
}

// projects/<slug>/STATE.md opens with "## Now": status, open threads, next
// step, rewritten in place, short enough to read first every time.
const NOW_MAX = 30;
function isProjectState(rel) {
  const segs = rel.split('/');
  return segs[0] === 'projects' && segs.length === 3 && segs[2] === 'STATE.md';
}
function nowSection(body) {
  const lines = body.split('\n');
  const start = lines.findIndex(l => /^##\s+Now\s*$/.test(l));
  if (start === -1) return null;
  let end = lines.findIndex((l, i) => i > start && /^#{1,2}\s/.test(l));
  if (end === -1) end = lines.length;
  const section = lines.slice(start + 1, end);
  while (section.length && !section[section.length - 1].trim()) section.pop();
  while (section.length && !section[0].trim()) section.shift();
  return section;
}

// projects/<slug>/specs/<domain>.md: what the product does, as numbered rules.
function isSpec(rel) {
  const segs = rel.split('/');
  return segs[0] === 'projects' && segs.length === 4 && segs[2] === 'specs';
}

// The v0.2 layout has two axes: memory type and scope. entities/<slug>/knowledge
// is the knowledge compartment at entity scope, held to the same strictness as
// the global one; everything else under entities/ (PROFILE.md) is lenient.
function effective(rel) {
  const segs = rel.split('/');
  if (segs[0] === 'entities') {
    if (segs.length >= 4 && AUTHORITATIVE.includes(segs[2]))
      return { compartment: segs[2], scope: `entity:${segs[1]}` };
    return { compartment: 'entities', scope: segs[1] ? `entity:${segs[1]}` : 'global' };
  }
  const scope = segs[0] === 'projects' && segs[1] ? `project:${segs[1]}` : 'global';
  return { compartment: segs[0], scope };
}

// ---- minimal frontmatter parser: "key: value" lines, inline [a, b] lists ----
// Lint judges content, not line endings: a BOM and \r\n (a file saved on
// Windows) read as the same file saved with \n.
function parseFrontmatter(text) {
  text = String(text).replace(/^﻿/, '').replace(/\r\n/g, '\n');
  if (!text.startsWith('---\n')) return { front: null, body: text };
  const end = text.indexOf('\n---', 4);
  if (end === -1) return { front: null, body: text };
  const front = {};
  for (const line of text.slice(4, end).split('\n')) {
    const m = line.match(/^([A-Za-z_][A-Za-z0-9_-]*):\s*(.*)$/);
    if (!m) continue;
    let v = m[2].trim();
    // [a, b] is an inline list; [[target]] is a wikilink value and stays a string
    if (v.startsWith('[') && v.endsWith(']') && !v.startsWith('[[')) v = v.slice(1, -1).split(',').map(s => s.trim()).filter(Boolean);
    front[m[1]] = v;
  }
  return { front, body: text.slice(end + 4) };
}

function walk(dir) {
  if (!fs.existsSync(dir)) return [];
  const out = [];
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (e.name.startsWith('.')) continue;
    const p = path.join(dir, e.name);
    if (e.isDirectory()) out.push(...walk(p));
    else if (e.name.endsWith('.md')) out.push(p);
  }
  return out;
}

// overrides: { "<rel path>": "<content>" } lints the brain as it would be with
// those files written (new paths included), without touching the disk.
function lint(brainDir, overrides = {}) {
  const errors = [], warnings = [];
  const rels = new Set(walk(brainDir).map(abs => toPosix(path.relative(brainDir, abs))));
  const over = new Map(Object.entries(overrides).map(([rel, content]) => [toPosix(rel), content]));
  for (const rel of over.keys()) if (rel.endsWith('.md')) rels.add(rel);
  const files = [...rels].sort().map(rel => {
    const abs = path.join(brainDir, rel);
    const raw = over.has(rel) ? over.get(rel) : fs.readFileSync(abs, 'utf8');
    const { front, body } = parseFrontmatter(raw);
    const eff = effective(rel);
    return { abs, rel, raw, front, body, compartment: eff.compartment, scope: eff.scope };
  });

  // Link resolution: a wikilink resolves to a permalink, a relative path (with or
  // without .md), or a title. Journal targets like journal/2026-08-11 count as paths.
  const permalinks = new Set(), paths = new Set(), titles = new Set();
  for (const f of files) {
    paths.add(f.rel.replace(/\.md$/, ''));
    if (f.front && typeof f.front.permalink === 'string') permalinks.add(f.front.permalink);
    if (f.front && typeof f.front.title === 'string') titles.add(f.front.title);
  }
  const resolves = target => {
    const t = target.replace(/\.md$/, '');
    return permalinks.has(t) || paths.has(t) || titles.has(t)
      || paths.has(`attic/${t}`) || permalinks.has(t.replace(/^attic\//, ''));
  };
  const bySupersedes = new Map(); // superseded target -> file carrying `supersedes`
  for (const f of files) {
    if (f.front && f.front.supersedes) bySupersedes.set(String(f.front.supersedes).replace(/\[\[|\]\]/g, ''), f.rel);
  }

  for (const f of files) {
    const authoritative = AUTHORITATIVE.includes(f.compartment);
    const inAttic = f.compartment === 'attic';

    // Frontmatter schema (strict in authoritative compartments and the attic)
    if (authoritative || inAttic) {
      if (!f.front) { errors.push(`${f.rel}: missing frontmatter`); continue; }
      for (const k of REQUIRED_FRONT)
        if (f.front[k] === undefined) errors.push(`${f.rel}: frontmatter missing "${k}"`);
      if (authoritative && f.front.compartment && f.front.compartment !== f.compartment.replace(/s$/, '') && f.front.compartment !== f.compartment)
        errors.push(`${f.rel}: compartment "${f.front.compartment}" does not match folder "${f.compartment}"`);
      // scope: required from version 2 on in authoritative compartments, and it must match the folder
      if (authoritative && Number(f.front.version) >= 2 && f.front.scope === undefined)
        errors.push(`${f.rel}: frontmatter missing "scope" (required from version 2)`);
      if (authoritative && f.front.scope !== undefined && f.front.scope !== f.scope)
        errors.push(`${f.rel}: scope "${f.front.scope}" does not match location "${f.scope}"`);
    }

    // Observations: "- [category] statement ..." need provenance in authoritative
    // compartments: their own (source: ...) or the file's `source:`.
    const fsrc = fileSource(f.front);
    if (authoritative) {
      if (fsrc.bad) errors.push(`${f.rel}: frontmatter "source" holds a malformed ref "${fsrc.bad}" (use j-xxxxxxxx, t-123 or [[target]])`);
      for (const line of f.body.split('\n')) {
        const obs = line.match(/^\s*-\s*\[([a-z0-9_-]+)\]\s+/i);
        if (!obs) continue;
        const own = ownSource(line);
        if (own.prose) warnings.push(`${f.rel}: source group holds prose and is read as text: "${own.prose.slice(0, 60)}" (keep only refs inside, move the words after it)`);
        if (!own.refs && !fsrc.refs)
          errors.push(`${f.rel}: unsourced observation: "${line.trim().slice(0, 60)}"`);
      }
    }

    // Dangling wikilinks in authoritative compartments
    if (authoritative || inAttic) {
      for (const m of f.raw.matchAll(/\[\[([^\]#|]+)(?:[#|][^\]]*)?\]\]/g)) {
        if (!resolves(m[1].trim()))
          errors.push(`${f.rel}: dangling wikilink [[${m[1].trim()}]]`);
      }
    }

    // Attic lineage
    if (inAttic && f.front) {
      for (const k of ATTIC_FRONT)
        if (f.front[k] === undefined) errors.push(`${f.rel}: attic file missing "${k}"`);
      if (f.front.superseded_by) {
        const target = String(f.front.superseded_by).replace(/\[\[|\]\]/g, '');
        if (!resolves(target)) errors.push(`${f.rel}: superseded_by does not resolve: ${target}`);
        else if (!bySupersedes.has(f.front.permalink) && !bySupersedes.has(f.rel.replace(/\.md$/, '')))
          errors.push(`${f.rel}: replacement carries no "supersedes" back-link`);
      }
    }

    // Summary: one line, required on the files a scope load reads first
    if (needsSummary(f)) {
      const raw = f.front && f.front.summary !== undefined ? String(f.front.summary).trim().replace(/^(["'])(.*)\1$/, '$2') : '';
      if (!raw) warnings.push(`${f.rel}: missing "summary" (one line, ${SUMMARY_MAX} chars or fewer)`);
      else if (raw.length > SUMMARY_MAX) errors.push(`${f.rel}: summary is ${raw.length} chars, over the ${SUMMARY_MAX} limit`);
    }

    // Now: the part of STATE.md every agent reads first
    if (isProjectState(f.rel)) {
      const now = nowSection(f.body);
      if (!now) warnings.push(`${f.rel}: no "## Now" section`);
      else if (now.length > NOW_MAX) warnings.push(`${f.rel}: "## Now" is ${now.length} lines, over the ${NOW_MAX} limit`);
    }

    // Specs: every rule has a unique id within its file and names its source
    if (isSpec(f.rel)) {
      const seen = new Map();
      f.body.split('\n').forEach(line => {
        const m = line.match(RULE_RE);
        if (!m) return;
        if (seen.has(m[1])) errors.push(`${f.rel}: duplicate rule id ${m[1]}`);
        seen.set(m[1], true);
        if (!RULE_SOURCE_RE.test(line)) errors.push(`${f.rel}: rule ${m[1]} has no source`);
      });
    }

    // Belief status and freshness (warnings in v0)
    if (f.front) {
      if (f.front.belief === 'validated' && !fsrc.refs && !f.body.split('\n').some(l => ownSource(l).refs))
        warnings.push(`${f.rel}: belief is validated but no source found, in the body or the frontmatter`);
      if (f.front.volatility === 'volatile' && f.front.verified === undefined)
        warnings.push(`${f.rel}: volatile fact without a "verified" date`);
    }

    // Journal records (v0.3): the journal stays lenient, but a format 0.3 day
    // the hub can no longer read back is drift worth seeing
    if (f.compartment === 'journal' && f.front && String(f.front.format) === '0.3') {
      for (const e of claims.parseFile(f.raw, { path: f.rel }).errors)
        warnings.push(`${f.rel}: line ${e.line}: ${e.code} ${e.message}`);
    }

    // Unknown top-level folder: the layout is a contract too
    const top = f.rel.split('/')[0];
    if (f.rel.includes('/') && !KNOWN_TOP.includes(top))
      warnings.push(`${f.rel}: unknown compartment folder "${top}"`);
  }
  return { errors, warnings, count: files.length };
}

// One file as it would be after a write: only that file's errors and warnings.
// Links resolve against the whole brain, so a dangling link is still caught.
function lintFile(brainDir, rel, content) {
  const norm = path.posix.normalize(toPosix(rel));
  const { errors, warnings } = lint(brainDir, { [norm]: content });
  const mine = (m) => m.startsWith(`${norm}: `);
  return { errors: errors.filter(mine), warnings: warnings.filter(mine) };
}

module.exports = { lint, lintFile, parseFrontmatter, REF_RE };

// ---- CLI ----
if (require.main === module) {
  const dir = process.argv[2];
  if (!dir) { console.error('usage: brain-lint <brain-dir>'); process.exit(2); }
  const { errors, warnings, count } = lint(path.resolve(dir));
  for (const w of warnings) console.log(`warn: ${w}`);
  for (const e of errors) console.log(`ERROR: ${e}`);
  console.log(`${count} files · ${errors.length} errors · ${warnings.length} warnings`);
  console.log(errors.length ? 'LINT FAILED: this brain does not pass.' : 'LINT PASSED: this brain is well formed.');
  process.exit(errors.length ? 1 : 0);
}

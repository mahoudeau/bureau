#!/usr/bin/env node
// brain-lint: validator for the Bureau Brain Format (docs/brain-format.md).
// A brain either passes lint or it does not.
//
// Licensed Apache-2.0 (LICENSE-APACHE at the repo root), unlike the AGPL hub:
// this tool is meant to run anywhere a brain lives.
//
// Usage: node hub/tools/brain-lint.js <brain-dir>
// Exit codes: 0 = clean or warnings only, 1 = errors, 2 = bad invocation.
'use strict';
const fs = require('fs');
const path = require('path');

const AUTHORITATIVE = ['knowledge', 'recipes'];
const COMPARTMENTS = ['journal', 'knowledge', 'recipes', 'archive', 'attic'];
const REQUIRED_FRONT = ['title', 'compartment', 'permalink', 'version'];
const ATTIC_FRONT = ['retired', 'retired_by', 'retired_reason', 'superseded_by'];

// ---- minimal frontmatter parser: "key: value" lines, inline [a, b] lists ----
function parseFrontmatter(text) {
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

function lint(brainDir) {
  const errors = [], warnings = [];
  const files = walk(brainDir).map(abs => {
    const rel = path.relative(brainDir, abs);
    const raw = fs.readFileSync(abs, 'utf8');
    const { front, body } = parseFrontmatter(raw);
    return { abs, rel, raw, front, body, compartment: rel.split(path.sep)[0] };
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
    }

    // Observations: "- [category] statement ..." need provenance in authoritative compartments
    if (authoritative) {
      for (const line of f.body.split('\n')) {
        const obs = line.match(/^\s*-\s*\[([a-z0-9_-]+)\]\s+/i);
        if (obs && !/\(source:\s*\[\[[^\]]+\]\]\)/.test(line))
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

    // Belief status and freshness (warnings in v0)
    if (f.front) {
      if (f.front.belief === 'validated' && !/\(source:\s*\[\[[^\]]+\]\]\)/.test(f.body))
        warnings.push(`${f.rel}: belief is validated but no source link found in the body`);
      if (f.front.volatility === 'volatile' && f.front.verified === undefined)
        warnings.push(`${f.rel}: volatile fact without a "verified" date`);
      if (f.front.compartment && !COMPARTMENTS.includes(f.compartment) && f.rel.includes(path.sep))
        warnings.push(`${f.rel}: unknown compartment folder "${f.compartment}"`);
    }
  }
  return { errors, warnings, count: files.length };
}

// ---- CLI ----
const dir = process.argv[2];
if (!dir) { console.error('usage: brain-lint <brain-dir>'); process.exit(2); }
const { errors, warnings, count } = lint(path.resolve(dir));
for (const w of warnings) console.log(`warn: ${w}`);
for (const e of errors) console.log(`ERROR: ${e}`);
console.log(`${count} files · ${errors.length} errors · ${warnings.length} warnings`);
console.log(errors.length ? 'LINT FAILED: this brain does not pass.' : 'LINT PASSED: this brain is well formed.');
process.exit(errors.length ? 1 : 0);

#!/usr/bin/env node
// migrate-claims: move curated notes to Brain Format v0.3: format: 0.3 in the
// frontmatter, every claim on one physical line, every claim with an id.
// The text of a claim does not change. Running it twice changes nothing.
//
// Licensed Apache-2.0 (LICENSE-APACHE at the repo root), like brain-lint.
//
// Usage: node hub/tools/migrate-claims.js <brain-dir> [--write]
// Without --write it reports what it would do and touches nothing.
// As a module: migrate(text, rel, taken), stampIds(text, rel, taken).
'use strict';
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const claims = require('../lib/claims');

const CLAIM_RE = /^- \[[A-Za-z0-9_-]+\] /;
const HAS_ID_RE = /\s\^[cj]-[a-z0-9]+\s*$/;
const FIELD_RE = /^ {2}- [A-Za-z0-9_-]+:(\s|$)/;

const CURATED_RE = /^(knowledge|recipes)\/|^entities\/[^/]+\/(knowledge|recipes)\//;
const isCurated = (rel) => CURATED_RE.test(rel) && rel.endsWith('.md') && !/\/INDEX\.md$/.test(rel);

// Six characters from the file and the text, so a run on a copy of the brain
// gives the same ids. A collision moves to the next counter.
function newId(rel, text, taken) {
  for (let n = 0; ; n++) {
    const h = BigInt(`0x${crypto.createHash('sha256').update(`${rel}\n${text}\n${n}`).digest('hex').slice(0, 16)}`).toString(36).padStart(6, '0').slice(-6);
    const id = `c-${h}`;
    if (!taken.has(id)) { taken.add(id); return id; }
  }
}

function bodyStart(lines) {
  if (lines[0] !== '---') return 0;
  const end = lines.indexOf('---', 1);
  return end === -1 ? 0 : end + 1;
}

// Give every claim line without an id one. Nothing else moves.
function stampIds(text, rel, taken) {
  const lines = String(text).split('\n');
  let added = 0;
  for (let i = bodyStart(lines); i < lines.length; i++) {
    if (!CLAIM_RE.test(lines[i]) || HAS_ID_RE.test(lines[i])) continue;
    const line = lines[i].replace(/\s+$/, '');
    lines[i] = `${line} ^${newId(rel, line, taken)}`;
    added++;
  }
  return { content: lines.join('\n'), added };
}

// Join a claim's hard-wrapped lines into one, leaving field lines alone.
function unwrap(lines, from) {
  const out = lines.slice(0, from);
  for (let i = from; i < lines.length; i++) {
    let line = lines[i];
    if (CLAIM_RE.test(line)) {
      while (i + 1 < lines.length && /^[ \t]+\S/.test(lines[i + 1]) && !FIELD_RE.test(lines[i + 1]) && !/^\s*-(\s|$)/.test(lines[i + 1])) line = `${line.replace(/\s+$/, '')} ${lines[++i].trim()}`;
    }
    out.push(line);
  }
  return out;
}

function migrate(text, rel, taken) {
  const lines = String(text).replace(/^﻿/, '').split('\n').map((l) => l.replace(/\r$/, ''));
  const start = bodyStart(lines);
  if (!start) return { content: text, changed: false, errors: [{ line: 1, code: 'E_FRONT', message: 'no frontmatter' }] };
  const body = unwrap(lines, start);
  const front = body.slice(0, start);
  if (!front.some((l) => /^format:/.test(l))) front.splice(front.length - 1, 0, 'format: 0.3');
  const stamped = stampIds([...front, ...body.slice(start)].join('\n'), rel, taken);
  return { content: stamped.content, changed: stamped.content !== text, ids: stamped.added, errors: claims.parseFile(stamped.content, { path: rel }).errors };
}

// Every claim id already in these files, so a new one never repeats.
function idsIn(text) {
  const out = [];
  for (const line of String(text).split('\n')) {
    const m = line.match(/\s\^([cj]-[a-z0-9]+)\s*$/);
    if (m) out.push(m[1]);
  }
  return out;
}

function walk(dir) {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    if (e.name.startsWith('.')) return [];
    const p = path.join(dir, e.name);
    return e.isDirectory() ? walk(p) : e.name.endsWith('.md') ? [p] : [];
  });
}

module.exports = { migrate, stampIds, idsIn, isCurated, newId };

if (require.main === module) {
  const dir = process.argv[2];
  if (!dir) { console.error('usage: migrate-claims <brain-dir> [--write]'); process.exit(2); }
  const write = process.argv.includes('--write');
  const root = path.resolve(dir);
  const rels = walk(root).map((p) => path.relative(root, p).split(path.sep).join('/'));
  const taken = new Set(rels.flatMap((r) => idsIn(fs.readFileSync(path.join(root, r), 'utf8'))));
  let files = 0, ids = 0, bad = 0;
  for (const rel of rels.filter(isCurated)) {
    const text = fs.readFileSync(path.join(root, rel), 'utf8');
    const r = migrate(text, rel, taken);
    for (const e of r.errors) { bad++; console.log(`ERROR ${rel}:${e.line} ${e.code} ${e.message}`); }
    if (r.changed) { files++; ids += r.ids || 0; if (write && !r.errors.length) fs.writeFileSync(path.join(root, rel), r.content); }
  }
  console.log(`${files} files to migrate, ${ids} ids, ${bad} errors${write ? '' : ' (dry run)'}`);
  process.exit(bad ? 1 : 0);
}

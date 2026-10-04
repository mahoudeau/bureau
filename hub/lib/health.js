// lib/health.js: the memory health block (M5, drift checks). Computed by the
// hub from the brain and the mission store, so drift is seen when it happens,
// not found by accident. GET /api/memory/health and MCP memory_health serve
// it; the dashboards and the librarian's digest read it. Read-only.
'use strict';
const path = require('path');
const claims = require('./claims');
const knowledge = require('./knowledge');
const journal = require('./journal');
const store = require('./store');
const brainLint = require('../tools/brain-lint');

const DAY_MS = 86400_000;
const CACHE_MS = 60_000;
const JOURNAL_DAYS = 7;
const LINT_MESSAGES = 20;
const STALE_LISTED = 50;
const APPLY_OVERDUE_HOURS = 48;
// Freshness windows by volatility, in days; durable never goes stale
const WINDOW_DAYS = { volatile: 30, stable: 180 };
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const DAY_FILE_RE = /^journal\/\d{4}-\d{2}-\d{2}\.md$/;
const CURATED_RE = /^(knowledge|recipes)\/|^entities\/[^/]+\/(knowledge|recipes)\//;
const RETIRED_RE = /^(attic|archive)\//;

const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;

// Every .md in the brain, as forward-slash paths relative to it
function brainFiles() {
  return knowledge.listKnowledge('').map((f) => f.split(path.sep).join('/')).filter((f) => f.endsWith('.md')).sort();
}
function parse(file) {
  return claims.parseFile(knowledge.readKnowledge(file) || '', { path: file });
}

// The file-level source, read as claims.js reads it: refs only, or nothing
function fileSourced(front) {
  if (front.source === undefined) return false;
  const raw = front.source.startsWith('[') && !front.source.startsWith('[[') ? front.source.replace(/^\[|\]$/g, '') : front.source;
  const refs = raw.split(',').map((x) => x.trim()).filter(Boolean);
  return refs.length > 0 && refs.every((r) => claims.REF_RE.test(r));
}

// Unreadable blocks in format 0.3 journal days: the errors grouped under the
// claim they belong to (the nearest claim starting at or above the error).
function journalInvalid(files) {
  const out = [];
  for (const file of files.filter((f) => DAY_FILE_RE.test(f))) {
    const p = parse(file);
    if (p.format !== '0.3' || !p.errors.length) continue;
    const blocks = new Map();
    for (const e of p.errors) {
      let owner = e.line;
      for (const c of p.claims) if (c.line <= e.line) owner = c.line;
      if (!blocks.has(owner)) blocks.set(owner, { file, line: owner, errors: [] });
      blocks.get(owner).errors.push({ line: e.line, code: e.code, message: e.message });
    }
    out.push(...[...blocks.values()].sort((a, b) => a.line - b.line));
  }
  return out;
}

// How long an approved mission has waited: since it moved to approved
function approvedSince(t) {
  const entry = (t.log || []).filter((l) => l.to === 'approved').pop();
  return (entry && entry.ts) || t.created_at;
}

function compute(now = new Date()) {
  const nowMs = now.getTime();
  const files = brainFiles();
  const reasons = [];

  // Lint: the whole brain, as brain-lint sees it
  const l = brainLint.lint(knowledge.BRAIN_DIR);
  const lint = { errors: l.errors.length, warnings: l.warnings.length, messages: l.errors.slice(0, LINT_MESSAGES) };
  if (lint.errors) reasons.push(`${plural(lint.errors, 'lint error')} in the brain`);

  // Journal: capture volume over the last days, and blocks nobody can read
  const since = new Date(nowMs - JOURNAL_DAYS * DAY_MS).toISOString();
  const recent = journal.list({ since }).records || [];
  const byKind = {}, byAuthor = {};
  for (const r of recent) {
    byKind[r.kind] = (byKind[r.kind] || 0) + 1;
    const by = r.fields.by || 'unknown';
    byAuthor[by] = (byAuthor[by] || 0) + 1;
  }
  const invalid = journalInvalid(files);
  if (invalid.length) reasons.push(`${plural(invalid.length, 'unreadable journal block')}: ${invalid.slice(0, 5).map((b) => `${b.file}:${b.line}`).join(', ')}${invalid.length > 5 ? ', ...' : ''}`);

  // Approved missions whose approved payloads are not in the brain yet
  const approvedUnapplied = [];
  for (const t of store.load().tasks) {
    if (t.status !== 'approved') continue;
    const items = (t.items || []).filter((it) => it.verdict === 'approved' && it.payload && !it.applied_at).map((it) => it.id);
    if (!items.length) continue;
    const at = approvedSince(t);
    const hours = Math.max(0, Math.round((nowMs - Date.parse(at)) / 3600_000 * 10) / 10);
    approvedUnapplied.push({ id: t.id, title: t.title, assignee: t.assignee || null, items, approved_at: at, waiting_hours: hours, overdue: hours > APPLY_OVERDUE_HOURS });
    if (hours > APPLY_OVERDUE_HOURS) reasons.push(`${t.id} has waited ${Math.floor(hours)} hours to apply ${items.join(', ')}`);
  }

  // Curated claims: freshness and provenance. Contradictions: every claim
  // outside the retired compartments (attic/, archive/).
  const stale = [];
  let undated = 0;
  const prov = { claims: 0, own: 0, file: 0, none: 0 };
  const contradictions = [];
  for (const file of files) {
    if (RETIRED_RE.test(file)) continue;
    const curated = CURATED_RE.test(file);
    const p = parse(file);
    if (!p.claims.length) continue;
    const covered = fileSourced(p.frontmatter);
    for (const c of p.claims) {
      for (const other of c.fields.contradicts || []) contradictions.push({ id: c.id, contradicts: other, file, line: c.line, text: c.text });
      if (!curated) continue;
      prov.claims++;
      if (c.sources.length) prov.own++;
      else if (covered) prov.file++;
      else prov.none++;
      // Freshness reads the claim's own field first, then the file's
      let vol = c.fields.volatility || p.frontmatter.volatility || 'stable';
      if (!WINDOW_DAYS[vol] && vol !== 'durable') vol = 'stable';
      if (vol === 'durable' || c.fields.pinned === true) continue;
      const verified = c.fields.verified || p.frontmatter.verified;
      if (!verified || !DATE_RE.test(verified) || Number.isNaN(Date.parse(verified))) { undated++; continue; }
      const age = Math.floor((nowMs - Date.parse(`${verified}T00:00:00Z`)) / DAY_MS);
      if (age > WINDOW_DAYS[vol]) stale.push({ file, line: c.line, id: c.id, volatility: vol, verified, age_days: age, text: c.text });
    }
  }
  stale.sort((a, b) => b.age_days - a.age_days || a.file.localeCompare(b.file) || a.line - b.line);
  const sourced = prov.own + prov.file;

  return {
    status: reasons.length ? 'attention' : 'ok',
    reasons,
    lint,
    journal: { since, days: JOURNAL_DAYS, records: recent.length, by_kind: byKind, by_author: byAuthor, invalid },
    approved_unapplied: approvedUnapplied,
    stale: { count: stale.length, undated, claims: stale.slice(0, STALE_LISTED) },
    contradictions,
    provenance: { ...prov, sourced_pct: prov.claims ? Math.round(sourced / prov.claims * 1000) / 10 : null },
    reads: { tracked: false },
    computed_at: now.toISOString(),
  };
}

// Cached for a minute. The hub is the only writer, so the server drops the
// cache on every brain write and mission change (invalidate below).
let cache = null;
function get() {
  if (cache && Date.now() - cache.at < CACHE_MS) return cache.value;
  const value = compute();
  cache = { at: Date.now(), value };
  return value;
}
function invalidate() { cache = null; }

module.exports = { get, compute, invalidate, CACHE_MS, WINDOW_DAYS, APPLY_OVERDUE_HOURS };

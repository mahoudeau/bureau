// lib/work.js: the ungitted per-mission evidence store (t-243, bureau-internal/23).
// Same attachment shape as knowledge.js (file/content/encoding, base64 for
// binaries, the same extension whitelist) but deliberately NOT the brain:
// no git repo, no commit, no provenance, no lint. Boss ruling: evidence is
// not knowledge. Charters redirect work-in-progress deliverables and review
// screenshots here instead of projects/<p>/deliverables/, so the brain stops
// accumulating round-14-of-26 clutter that nobody will ever read again.
//
// Scoped per mission (every path lives under work/<t-id>/...) so the whole
// folder can be wholesale garbage-collected the moment its mission reaches a
// terminal status (done/failed/discarded) - see gcMission, called from
// server.js right after a status-changing PATCH, not from here: this module
// has no idea what a "terminal status" is, on purpose (that's store.js's
// TASK_STATUSES, not this module's concern).
'use strict';
const fs = require('fs');
const path = require('path');

const WORK_DIR = process.env.BUREAU_WORK_DIR || path.join(__dirname, '..', 'work');

// Same cap as knowledge.js's attachments; same whitelist rationale (episodic-
// grade evidence, not arbitrary file storage).
const MAX_ATTACHMENT = 5 * 1024 * 1024;
const BINARY_RE = /\.(png|jpe?g|gif|pdf)$/i;
const MIME = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', svg: 'image/svg+xml', pdf: 'application/pdf', md: 'text/markdown; charset=utf-8', txt: 'text/plain; charset=utf-8', json: 'application/json', csv: 'text/csv; charset=utf-8' };

function taskDir(task) {
  if (typeof task !== 'string' || !/^t-\d+$/.test(task)) throw new Error('task must look like t-<id>');
  return path.join(WORK_DIR, task);
}

// Confine writes to work/<t-id>/, no traversal, same extension whitelist as
// the brain's own safePath (knowledge.js) - deliberately duplicated rather
// than imported: this module must stay usable even if knowledge.js's own
// notion of "safe" ever grows brain-specific rules (frontmatter, lint paths)
// that evidence files should never inherit.
function safePath(task, rel) {
  if (typeof rel !== 'string' || !rel.length) throw new Error('path required');
  const norm = path.normalize(rel).replace(/^([/\\])+/, '');
  if (norm.split(/[/\\]/).includes('..')) throw new Error('bad path');
  if (!/\.(md|txt|json|csv|png|jpe?g|gif|svg|pdf)$/i.test(norm)) throw new Error('only .md .txt .json .csv .png .jpg .jpeg .gif .svg .pdf files');
  return path.join(taskDir(task), norm);
}

function writeWork({ task, file, content, mode, encoding }) {
  const abs = safePath(task, file);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  if (encoding === 'base64') {
    if (mode === 'append') throw new Error('base64 writes are replace-only');
    const buf = Buffer.from(String(content), 'base64');
    if (buf.length > MAX_ATTACHMENT) throw new Error('attachment too large (5MB cap)');
    fs.writeFileSync(abs, buf);
  } else if (mode === 'append') {
    fs.appendFileSync(abs, (fs.existsSync(abs) && fs.statSync(abs).size ? '\n' : '') + content);
  } else {
    fs.writeFileSync(abs, content);
  }
  return { task, file: path.relative(taskDir(task), abs).split(path.sep).join('/'), bytes: fs.statSync(abs).size };
}

function readWorkRaw(task, file) {
  const abs = safePath(task, file);
  if (!fs.existsSync(abs)) return null;
  const ext = abs.split('.').pop().toLowerCase();
  return { buf: fs.readFileSync(abs), type: MIME[ext] || 'application/octet-stream', binary: BINARY_RE.test(abs) };
}

function listWork(task) {
  const base = taskDir(task);
  if (!fs.existsSync(base)) return [];
  const out = [];
  (function walk(d) {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const p = path.join(d, e.name);
      if (e.isDirectory()) walk(p);
      else out.push(path.relative(base, p).split(path.sep).join('/'));
    }
  })(base);
  return out;
}

// Wholesale delete. Idempotent (a missing folder is not an error) so a
// double-fire - a retry, two terminal PATCHes racing - is harmless.
function gcMission(task) {
  if (typeof task !== 'string' || !/^t-\d+$/.test(task)) return { removed: false };
  const dir = path.join(WORK_DIR, task);
  if (!fs.existsSync(dir)) return { removed: false };
  fs.rmSync(dir, { recursive: true, force: true });
  return { removed: true };
}

module.exports = { writeWork, readWorkRaw, listWork, gcMission, WORK_DIR };

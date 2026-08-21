// lib/knowledge.js: the markdown + git "brain". Zero dependencies.
'use strict';
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const BRAIN_DIR = process.env.BUREAU_BRAIN_DIR || path.join(__dirname, '..', 'brain');

function git(args, opts = {}) {
  return execFileSync('git', args, { cwd: BRAIN_DIR, encoding: 'utf8', ...opts });
}

function ensureRepo() {
  fs.mkdirSync(BRAIN_DIR, { recursive: true });
  if (!fs.existsSync(path.join(BRAIN_DIR, '.git'))) {
    git(['init']);
    git(['config', 'user.email', 'hub@bureau.local']);
    git(['config', 'user.name', 'Bureau']);
  }
}

// Confine writes to brain/, no traversal, text plus a short attachment whitelist.
// Attachments (goal-bar references, review-evidence screenshots) are
// episodic-grade: no lint, no frontmatter, just bytes with provenance.
const BINARY_RE = /\.(png|jpe?g|gif|pdf)$/i;
const MAX_ATTACHMENT = 5 * 1024 * 1024; // 5MB decoded
function safePath(rel) {
  if (typeof rel !== 'string' || !rel.length) throw new Error('path required');
  const norm = path.normalize(rel).replace(/^([/\\])+/, '');
  if (norm.split(/[/\\]/).includes('..') || norm.startsWith('.git')) throw new Error('bad path');
  if (!/\.(md|txt|json|csv|png|jpe?g|gif|svg|pdf)$/i.test(norm)) throw new Error('only .md .txt .json .csv .png .jpg .jpeg .gif .svg .pdf files');
  return path.join(BRAIN_DIR, norm);
}

// t-243: which paths are the brain's protected compartments - knowledge/,
// recipes/ (global AND entity, per brain-format.md's curation-law table),
// entities/<slug>/PROFILE.md, and attic/. Everything else (journal/,
// meetings/, import/, projects/*, agents/*, daily/, archive/) stays open to
// any authenticated write, same as before this mission. The route handler
// (server.js) checks this before calling writeKnowledge, so an unauthorized
// write never touches disk or git at all - refused, not silently narrowed.
function isProtectedCompartment(rel) {
  const norm = String(rel || '').replace(/\\/g, '/').replace(/^\/+/, '');
  return /^(knowledge|recipes|attic)(\/|$)/.test(norm)
    || /^entities\/[^/]+\/(knowledge|recipes)(\/|$)/.test(norm)
    || /^entities\/[^/]+\/PROFILE\.md$/.test(norm);
}

function writeKnowledge({ file, content, mode, author, message, encoding }) {
  ensureRepo();
  const abs = safePath(file);
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
  const rel = path.relative(BRAIN_DIR, abs);
  git(['add', rel]);
  try {
    git(['commit', '-m', message || `update ${rel}`, '--author', `${author || 'agent'} <${(author || 'agent').replace(/\s+/g, '.')}@bureau.local>`]);
  } catch (e) {
    // "nothing to commit" (identical content) is fine
    if (!/nothing to commit/i.test(String(e.stdout || e.message))) throw e;
  }
  return { file: rel, bytes: fs.statSync(abs).size };
}

function readKnowledge(file) {
  const abs = safePath(file);
  if (!fs.existsSync(abs)) return null;
  return fs.readFileSync(abs, 'utf8');
}

// The boss's hands are a valid write path: files dropped over SFTP or edited
// directly on disk get swept into git as author human, so they are pushed,
// mirrored, and visible to the librarian like any API write. Whitelists stay
// API-only by design; this door is the owner's own.
function intakeSweep() {
  ensureRepo();
  const status = git(['status', '--porcelain']).trim();
  if (!status) return { committed: 0, files: [] };
  const files = status.split('\n').map(l => l.slice(3).trim()).filter(Boolean);
  git(['add', '-A']);
  try {
    git(['commit', '-m', 'intake: files dropped or edited by hand', '--author', 'human <human@bureau.local>']);
  } catch (e) {
    if (!/nothing to commit/i.test(String(e.stdout || e.message))) throw e;
    return { committed: 0, files: [] };
  }
  return { committed: files.length, files };
}

// Raw bytes + content-type, for attachments (and raw-mode reads of any file).
const MIME = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', svg: 'image/svg+xml', pdf: 'application/pdf', md: 'text/markdown; charset=utf-8', txt: 'text/plain; charset=utf-8', json: 'application/json', csv: 'text/csv; charset=utf-8' };
function readKnowledgeRaw(file) {
  const abs = safePath(file);
  if (!fs.existsSync(abs)) return null;
  const ext = abs.split('.').pop().toLowerCase();
  return { buf: fs.readFileSync(abs), type: MIME[ext] || 'application/octet-stream', binary: BINARY_RE.test(abs) };
}

function listKnowledge(dir) {
  ensureRepo();
  const base = dir ? safeDir(dir) : BRAIN_DIR;
  const out = [];
  (function walk(d) {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      if (e.name === '.git') continue;
      const p = path.join(d, e.name);
      if (e.isDirectory()) walk(p);
      else out.push(path.relative(BRAIN_DIR, p));
    }
  })(base);
  return out;
}

function safeDir(rel) {
  const norm = path.normalize(rel).replace(/^([/\\])+/, '');
  if (norm.split(/[/\\]/).includes('..') || norm.startsWith('.git')) throw new Error('bad path');
  return path.join(BRAIN_DIR, norm);
}

// Rename a project's brain folder with git mv, so file history survives the move.
// Caller validates the names (they come through the hub's project regex).
function renameProjectDir(from, to) {
  ensureRepo();
  const src = path.join(BRAIN_DIR, 'projects', from);
  const dst = path.join(BRAIN_DIR, 'projects', to);
  if (!fs.existsSync(src)) return { moved: false };
  if (fs.existsSync(dst)) return { error: `projects/${to} already exists in the brain` };
  fs.mkdirSync(path.dirname(dst), { recursive: true });
  git(['mv', `projects/${from}`, `projects/${to}`]);
  git(['commit', '-m', `project renamed: ${from} → ${to}`, '--author', 'human <human@bureau.local>']);
  return { moved: true };
}

function recentCommits(n = 20) {
  ensureRepo();
  try {
    const out = git(['log', `-${n}`, '--pretty=format:%h|%an|%ad|%s', '--date=iso']);
    return out.split('\n').filter(Boolean).map(l => {
      const [hash, author, date, ...msg] = l.split('|');
      return { hash, author, date, message: msg.join('|') };
    });
  } catch { return []; }
}

module.exports = { ensureRepo, writeKnowledge, readKnowledge, readKnowledgeRaw, listKnowledge, recentCommits, renameProjectDir, intakeSweep, isProtectedCompartment, BRAIN_DIR };

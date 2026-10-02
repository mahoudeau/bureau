// lib/knowledge.js: the markdown + git "brain". Zero dependencies.
'use strict';
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const BRAIN_DIR = process.env.BUREAU_BRAIN_DIR || path.join(__dirname, '..', 'brain');

function git(args, opts = {}) {
  return execFileSync('git', args, { cwd: BRAIN_DIR, encoding: 'utf8', ...opts });
}

// A repo with no commits makes git log complain ("does not have any commits
// yet"), so the brain starts with an empty root commit by the hub. Built with
// commit-tree so anything already staged in an existing empty repo stays
// staged and is not swept into it. Checked once per process.
let hasRoot = false;
function ensureRepo() {
  if (hasRoot && fs.existsSync(path.join(BRAIN_DIR, '.git'))) return;
  fs.mkdirSync(BRAIN_DIR, { recursive: true });
  if (!fs.existsSync(path.join(BRAIN_DIR, '.git'))) {
    git(['init']);
    git(['config', 'user.email', 'hub@bureau.local']);
    git(['config', 'user.name', 'Bureau']);
  }
  try {
    git(['rev-parse', '--verify', '-q', 'HEAD'], { stdio: 'pipe' });
  } catch {
    const hub = { GIT_AUTHOR_NAME: 'Bureau', GIT_AUTHOR_EMAIL: 'hub@bureau.local', GIT_COMMITTER_NAME: 'Bureau', GIT_COMMITTER_EMAIL: 'hub@bureau.local' };
    const tree = git(['mktree'], { input: '' }).trim();
    const sha = git(['commit-tree', tree, '-m', 'brain created'], { env: { ...process.env, ...hub } }).trim();
    git(['update-ref', 'HEAD', sha]);
  }
  hasRoot = true;
}

// Confine writes to brain/, no traversal, text plus a short attachment whitelist.
// Attachments (goal-bar references, review-evidence screenshots) are
// episodic-grade: no lint, no frontmatter, just bytes with provenance.
// The work store (lib/work.js) reuses these, so evidence takes exactly the
// same file types and cap as the brain.
const BINARY_RE = /\.(png|jpe?g|gif|pdf)$/i;
const FILE_RE = /\.(md|txt|json|csv|png|jpe?g|gif|svg|pdf)$/i;
const FILE_TYPES_ERROR = 'only .md .txt .json .csv .png .jpg .jpeg .gif .svg .pdf files';
const MAX_ATTACHMENT = 5 * 1024 * 1024; // 5MB decoded
function normRel(rel) { return path.normalize(rel).replace(/^([/\\])+/, ''); }
function safePath(rel) {
  if (typeof rel !== 'string' || !rel.length) throw new Error('path required');
  const norm = normRel(rel);
  if (norm.split(/[/\\]/).includes('..') || norm.startsWith('.git')) throw new Error('bad path');
  if (!FILE_RE.test(norm)) throw new Error(FILE_TYPES_ERROR);
  return path.join(BRAIN_DIR, norm);
}

// The curated compartments: global and entity knowledge/ and recipes/, an
// entity's PROFILE.md, and attic/. Only the boss, the librarian or a curator
// writes there (server.js asks before writing). Judged on the same normalized
// path safePath writes to, so "journal/../knowledge/x.md" is knowledge, and
// case-blind, so a case-insensitive disk cannot be used to slip past it.
// Returns the compartment's name, or null for an open path.
function curatedCompartment(rel) {
  if (typeof rel !== 'string' || !rel.length) return null;
  const norm = normRel(rel).split(path.sep).join('/').replace(/\\/g, '/');
  let m = norm.match(/^(knowledge|recipes|attic)(\/|$)/i);
  if (m) return m[1].toLowerCase() + '/';
  m = norm.match(/^entities\/[^/]+\/(knowledge|recipes)(\/|$)/i);
  if (m) return `entities/*/${m[1].toLowerCase()}/`;
  if (/^entities\/[^/]+\/profile\.md$/i.test(norm)) return 'entities/*/PROFILE.md';
  return null;
}

// Write-time validation: a markdown write to a curated compartment is linted
// as the file would be after the write, against the whole brain, before
// anything touches disk or git. A failing write throws E_LINT with the lint
// messages. The boss (author human) may pass force: true to write anyway; the
// result then carries what was overridden, so the route can log it. Hand edits
// on disk never pass through here: the intake sweep commits them as they are.
const brainLint = require('../tools/brain-lint');
function checkWrite({ file, content, mode, author, encoding, force }) {
  if (encoding === 'base64' || !/\.md$/i.test(file) || !curatedCompartment(file)) return null;
  const abs = safePath(file);
  const rel = path.relative(BRAIN_DIR, abs);
  const before = fs.existsSync(abs) ? fs.readFileSync(abs, 'utf8') : '';
  const after = mode === 'append' ? before + (before.length ? '\n' : '') + content : String(content);
  const { errors } = brainLint.lintFile(BRAIN_DIR, rel, after);
  if (!errors.length) return null;
  if (force === true && author === 'human') return { forced: errors };
  const e = new Error(`lint: this write would leave ${rel} failing brain-lint (${errors.length} error${errors.length > 1 ? 's' : ''})`);
  e.code = 'E_LINT';
  e.lint = errors;
  throw e;
}

function writeKnowledge({ file, content, mode, author, message, encoding, force }) {
  ensureRepo();
  const checked = checkWrite({ file, content, mode, author, encoding, force });
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
  return { file: rel, bytes: fs.statSync(abs).size, ...(checked ? { forced: checked.forced } : {}) };
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

module.exports = {
  ensureRepo, writeKnowledge, readKnowledge, readKnowledgeRaw, listKnowledge, recentCommits, renameProjectDir, intakeSweep,
  curatedCompartment, BRAIN_DIR, BINARY_RE, FILE_RE, FILE_TYPES_ERROR, MAX_ATTACHMENT, MIME,
};

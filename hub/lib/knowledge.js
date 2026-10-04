// lib/knowledge.js: the markdown + git "brain". Zero dependencies.
'use strict';
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const BRAIN_DIR = process.env.BUREAU_BRAIN_DIR || path.join(__dirname, '..', 'brain');

// git, found once. On Windows a bare 'git' is looked up in the working
// directory (the brain) before PATH, so the hub takes the absolute git.exe
// from PATH instead (execFile runs no .cmd without a shell). Elsewhere 'git'.
let GIT;
function gitBin() {
  if (GIT !== undefined) return GIT;
  if (process.platform !== 'win32') return (GIT = 'git');
  GIT = null;
  for (const dir of (process.env.PATH || '').split(path.delimiter)) {
    const d = dir.replace(/^"(.*)"$/, '$1');
    if (d && path.isAbsolute(d) && fs.existsSync(path.join(d, 'git.exe'))) { GIT = path.join(d, 'git.exe'); break; }
  }
  return GIT;
}
// Boot check: the brain is a git repo, so no git means no hub. Null when fine.
function checkGit() {
  try {
    if (!gitBin()) throw new Error('not on PATH');
    execFileSync(gitBin(), ['--version'], { stdio: 'pipe' });
    return null;
  } catch {
    return 'git not found: the brain is a git repository, so the hub needs git on its PATH. Install it (https://git-scm.com) and start the hub again.';
  }
}

function git(args, opts = {}) {
  return execFileSync(gitBin() || 'git', args, { cwd: BRAIN_DIR, encoding: 'utf8', ...opts });
}

const HUB_ID = { GIT_AUTHOR_NAME: 'Bureau', GIT_AUTHOR_EMAIL: 'hub@bureau.local', GIT_COMMITTER_NAME: 'Bureau', GIT_COMMITTER_EMAIL: 'hub@bureau.local' };
// Every brain carries these, so a clone behaves the same on any OS. -text:
// git keeps the bytes as written, no line-ending conversion, so an approved
// payload is what lands on disk and in history. The ignores keep OS and
// editor junk out of the intake sweep.
const HYGIENE = {
  '.gitattributes': '* -text\n',
  '.gitignore': 'Thumbs.db\ndesktop.ini\n~$*\n*.swp\n.DS_Store\n',
};

// A repo with no commits makes git log complain ("does not have any commits
// yet"), so the brain starts with an empty root commit by the hub. Built with
// commit-tree so anything already staged in an existing empty repo stays
// staged and is not swept into it. Then the hygiene files, written and
// committed once when missing (--only: nothing else staged goes in), and long
// paths on for Windows. Checked once per process.
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
    const tree = git(['mktree'], { input: '' }).trim();
    const sha = git(['commit-tree', tree, '-m', 'brain created'], { env: { ...process.env, ...HUB_ID } }).trim();
    git(['update-ref', 'HEAD', sha]);
  }
  try { git(['config', 'core.longpaths', 'true']); } catch { }
  const missing = Object.keys(HYGIENE).filter(f => !fs.existsSync(path.join(BRAIN_DIR, f)));
  if (missing.length) {
    // never fatal: a brain git will not commit to still serves (the intake sweep retries)
    try {
      for (const f of missing) fs.writeFileSync(path.join(BRAIN_DIR, f), HYGIENE[f]);
      git(['add', '--', ...missing]);
      git(['commit', '--only', '-m', `brain: ${missing.join(' and ')} (bytes kept as written, OS junk ignored)`, '--', ...missing],
        { env: { ...process.env, ...HUB_ID }, stdio: 'pipe' });
    } catch (e) { console.error(`[brain] could not commit ${missing.join(', ')}: ${String(e.stderr || e.message).trim()}`); }
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

// Paths in and out of the hub use '/', whatever the OS: the API, events,
// commit messages and lint all see knowledge/x.md, never knowledge\x.md. A
// backslash is a separator on every OS, as it is on Windows.
function toPosix(rel) { return String(rel).split(path.sep).join('/').replace(/\\/g, '/'); }
function normRel(rel) { return path.posix.normalize(toPosix(rel)).replace(/^\/+/, ''); }

// The one path guard (safePath, safeDir, work.parse, review payloads, project
// ids). Takes a normRel path, returns null or why it is refused. Besides
// traversal and .git (any case), it refuses on every OS what Windows cannot
// hold, so a brain made on Linux still clones there: device names in any
// segment (CON, PRN, AUX, NUL, COM1-9, LPT1-9, with or without an extension),
// : < > " | ? * and control characters, a segment ending in a dot or a space,
// and ~ followed by a digit (8.3 short names alias other files).
const RESERVED_RE = /^(con|prn|aux|nul|com[1-9]|lpt[1-9]|conin\$|conout\$)(\.|$)/i;
const BAD_CHAR_RE = /[:<>"|?*\x00-\x1f]/;
function pathError(norm) {
  const segs = String(norm).split('/');
  if (segs.includes('..') || /^\.git/i.test(segs[0])) return 'bad path';
  for (const s of segs) {
    if (s === '' || s === '.') continue;
    if (RESERVED_RE.test(s) || BAD_CHAR_RE.test(s) || /[. ]$/.test(s) || /~\d/.test(s))
      return `bad path: "${s.replace(/[\x00-\x1f]/g, '?')}" cannot exist on Windows (a reserved name like CON or COM1, one of : < > " | ? * or a control character, a trailing dot or space, or a ~1 short name)`;
  }
  return null;
}
const pathRefused = msg => Object.assign(new Error(msg), { code: 'E_PATH' });

function safePath(rel) {
  if (typeof rel !== 'string' || !rel.length) throw pathRefused('path required');
  const norm = normRel(rel);
  const bad = pathError(norm);
  if (bad) throw pathRefused(bad);
  if (!FILE_RE.test(norm)) throw pathRefused(FILE_TYPES_ERROR);
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
  const norm = normRel(rel);
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
// The lint errors a write would leave in its file ([] when the write is not
// checked or passes). Never throws on lint, so a proposal can be checked
// before it is filed (store.js, review item payloads).
function writeLintErrors({ file, content, mode, encoding }) {
  if (encoding === 'base64' || !/\.md$/i.test(String(file)) || !curatedCompartment(file)) return [];
  const abs = safePath(file);
  const rel = toPosix(path.relative(BRAIN_DIR, abs));
  const before = fs.existsSync(abs) ? fs.readFileSync(abs, 'utf8') : '';
  const after = mode === 'append' ? before + (before.length ? '\n' : '') + content : String(content);
  return brainLint.lintFile(BRAIN_DIR, rel, after).errors;
}
function checkWrite({ file, content, mode, author, encoding, force }) {
  const errors = writeLintErrors({ file, content, mode, encoding });
  if (!errors.length) return null;
  const rel = toPosix(path.relative(BRAIN_DIR, safePath(file)));
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
  const rel = toPosix(path.relative(BRAIN_DIR, abs));
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
      // .git itself, and the hygiene files beside it (.gitattributes, .gitignore)
      if (e.name === '.git') continue;
      const p = path.join(d, e.name);
      const rel = toPosix(path.relative(BRAIN_DIR, p));
      if (e.isDirectory()) walk(p);
      else if (!Object.keys(HYGIENE).includes(rel)) out.push(rel);
    }
  })(base);
  return out;
}

function safeDir(rel) {
  const norm = normRel(rel);
  const bad = pathError(norm);
  if (bad) throw pathRefused(bad);
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

// Move one brain file with git mv, in a commit of its own, content untouched.
// Used by the journal cutover (a v0.2 day moves aside before its first typed
// capture). Refuses to overwrite: the caller checks the target first.
function moveFile(from, to, { author, message } = {}) {
  ensureRepo();
  const src = safePath(from), dst = safePath(to);
  if (!fs.existsSync(src)) throw new Error(`${from} does not exist`);
  if (fs.existsSync(dst)) throw new Error(`${to} already exists`);
  const relFrom = toPosix(path.relative(BRAIN_DIR, src)), relTo = toPosix(path.relative(BRAIN_DIR, dst));
  // A file the intake sweep has not committed yet is added first, so git mv knows it
  git(['add', relFrom]);
  git(['mv', relFrom, relTo]);
  git(['commit', '-m', message || `move ${relFrom} to ${relTo}`, '--author', `${author || 'agent'} <${(author || 'agent').replace(/\s+/g, '.')}@bureau.local>`]);
  return { from: relFrom, to: relTo };
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
  ensureRepo, checkGit, writeKnowledge, writeLintErrors, readKnowledge, readKnowledgeRaw, listKnowledge, recentCommits, renameProjectDir, moveFile, intakeSweep,
  curatedCompartment, toPosix, normRel, pathError, BRAIN_DIR, BINARY_RE, FILE_RE, FILE_TYPES_ERROR, MAX_ATTACHMENT, MIME,
};

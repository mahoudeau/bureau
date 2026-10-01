// lib/work.js: the work store, a mission's evidence while it is open.
// Screenshots, drafts, test output: what a reviewer needs to see this round
// and nobody needs next month. Same attachment shape as the brain (the same
// file types, base64 for binaries, the same 5MB cap) but plain files: no git,
// no commit, no lint. Evidence is not knowledge (boss ruling).
//
// Every path is work/<t-id>/..., and the whole folder goes when its mission
// reaches done, failed or discarded (store.updateTask calls removeMission, so
// every door that closes a mission cleans up the same way).
'use strict';
const fs = require('fs');
const path = require('path');
const { BINARY_RE, FILE_RE, FILE_TYPES_ERROR, MAX_ATTACHMENT, MIME } = require('./knowledge');

const WORK_DIR = process.env.BUREAU_WORK_DIR || path.join(__dirname, '..', 'work');
const TASK_RE = /^t-\d+$/;

// "work/t-12/shots/home.png" -> { task: "t-12", rel: "shots/home.png", abs }.
// The prefix is the whole scope: no traversal, no file outside a mission folder.
function parse(file) {
  if (typeof file !== 'string' || !file.length) throw new Error('file required');
  // ".." is refused before normalizing: a path may not even pass through
  // another mission's folder.
  if (file.split(/[/\\]/).includes('..')) throw new Error('bad path');
  const parts = path.normalize(file).replace(/^([/\\])+/, '').split(/[/\\]/).filter(Boolean);
  if (parts[0] !== 'work' || !TASK_RE.test(parts[1] || '') || parts.length < 3)
    throw new Error('file must be work/<t-id>/<name>, e.g. work/t-12/home.png');
  const rel = parts.slice(2).join('/');
  if (!FILE_RE.test(rel)) throw new Error(FILE_TYPES_ERROR);
  return { task: parts[1], rel, abs: path.join(WORK_DIR, parts[1], ...parts.slice(2)) };
}
function taskOf(file) { try { return parse(file).task; } catch { return null; } }

function writeWork({ file, content, mode, encoding }) {
  const { task, rel, abs } = parse(file);
  let buf = null;
  if (encoding === 'base64') {
    if (mode === 'append') throw new Error('base64 writes are replace-only');
    buf = Buffer.from(String(content), 'base64');
    if (buf.length > MAX_ATTACHMENT) throw new Error('attachment too large (5MB cap)');
  }
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  if (buf) fs.writeFileSync(abs, buf);
  else if (mode === 'append') fs.appendFileSync(abs, (fs.existsSync(abs) && fs.statSync(abs).size ? '\n' : '') + content);
  else fs.writeFileSync(abs, String(content));
  return { file: `work/${task}/${rel}`, bytes: fs.statSync(abs).size };
}

function readWorkRaw(file) {
  const { abs } = parse(file);
  if (!fs.existsSync(abs) || !fs.statSync(abs).isFile()) return null;
  const ext = abs.split('.').pop().toLowerCase();
  return { buf: fs.readFileSync(abs), type: MIME[ext] || 'application/octet-stream', binary: BINARY_RE.test(abs) };
}

// Every file under work/, or under one mission's folder, as work/<t-id>/... paths.
function listWork(task) {
  if (task !== undefined && task !== null && task !== '' && !TASK_RE.test(task)) throw new Error('task must look like t-<n>');
  const base = task ? path.join(WORK_DIR, task) : WORK_DIR;
  const out = [];
  if (!fs.existsSync(base)) return out;
  (function walk(d) {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const p = path.join(d, e.name);
      if (e.isDirectory()) walk(p);
      else out.push('work/' + path.relative(WORK_DIR, p).split(path.sep).join('/'));
    }
  })(base);
  return out.sort();
}

// Wholesale and idempotent: a missing folder is not an error, so a retry or
// two closes in a row are harmless.
function removeMission(task) {
  if (typeof task !== 'string' || !TASK_RE.test(task)) return false;
  const dir = path.join(WORK_DIR, task);
  if (!fs.existsSync(dir)) return false;
  fs.rmSync(dir, { recursive: true, force: true });
  return true;
}

// Boot sweep: a folder whose mission is closed or unknown is left over from a
// crash between the close and the removal, or from a hand copy. Remove it.
function sweep(isOpen) {
  if (!fs.existsSync(WORK_DIR)) return [];
  const gone = [];
  for (const e of fs.readdirSync(WORK_DIR, { withFileTypes: true }))
    if (e.isDirectory() && TASK_RE.test(e.name) && !isOpen(e.name) && removeMission(e.name)) gone.push(e.name);
  return gone;
}

module.exports = { parse, writeWork, readWorkRaw, listWork, removeMission, sweep, taskOf, WORK_DIR };

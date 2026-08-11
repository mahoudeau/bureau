// lib/knowledge.js: the markdown + git "brain". Zero dependencies.
'use strict';
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const BRAIN_DIR = process.env.HQ_BRAIN_DIR || path.join(__dirname, '..', 'brain');

function git(args, opts = {}) {
  return execFileSync('git', args, { cwd: BRAIN_DIR, encoding: 'utf8', ...opts });
}

function ensureRepo() {
  fs.mkdirSync(BRAIN_DIR, { recursive: true });
  if (!fs.existsSync(path.join(BRAIN_DIR, '.git'))) {
    git(['init']);
    git(['config', 'user.email', 'hub@agent-hq.local']);
    git(['config', 'user.name', 'Bureau']);
  }
}

// Confine writes to brain/, no traversal, markdown/text only.
function safePath(rel) {
  if (typeof rel !== 'string' || !rel.length) throw new Error('path required');
  const norm = path.normalize(rel).replace(/^([/\\])+/, '');
  if (norm.split(/[/\\]/).includes('..') || norm.startsWith('.git')) throw new Error('bad path');
  if (!/\.(md|txt|json|csv)$/i.test(norm)) throw new Error('only .md .txt .json .csv files');
  return path.join(BRAIN_DIR, norm);
}

function writeKnowledge({ file, content, mode, author, message }) {
  ensureRepo();
  const abs = safePath(file);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  if (mode === 'append') {
    fs.appendFileSync(abs, (fs.existsSync(abs) && fs.statSync(abs).size ? '\n' : '') + content);
  } else {
    fs.writeFileSync(abs, content);
  }
  const rel = path.relative(BRAIN_DIR, abs);
  git(['add', rel]);
  try {
    git(['commit', '-m', message || `update ${rel}`, '--author', `${author || 'agent'} <${(author || 'agent').replace(/\s+/g, '.')}@agent-hq.local>`]);
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

module.exports = { ensureRepo, writeKnowledge, readKnowledge, listKnowledge, recentCommits, BRAIN_DIR };

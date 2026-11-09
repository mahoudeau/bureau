#!/usr/bin/env node
// context-hook.js: every prompt in Claude Code starts from what Bureau knows.
// A UserPromptSubmit hook: it asks the hub for the passages this prompt needs
// and hands them to the model as added context.
// Also a SessionStart hook on the compact matcher: a compaction drops the
// passages from the model's context, so the hub's no-repeat memory for this
// session is cleared and they can be served again.
// Licensed Apache-2.0 (LICENSE-APACHE at the repo root).
//
// It never gets in the way. No hub, a slow hub, a bad token: it exits 0 with no
// output and the prompt goes through. Never exit 2, which would block it.
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');

const TIMEOUT_MS = 1000;
const MAX_CHARS = 9500; // Claude Code swaps hook output over 10,000 characters for a file path
const HOME = os.homedir();
const LOG = process.env.BUREAU_HOOK_LOG || path.join(HOME, '.bureau-context-hook.log');

function note(msg) {
  try { fs.appendFileSync(LOG, `${new Date().toISOString()} ${msg}\n`); } catch { /* nothing left to tell */ }
}
function readFirst(file) {
  try { return fs.readFileSync(file, 'utf8').trim(); } catch { return ''; }
}
function gitRoot(dir) {
  for (let d = dir; ; d = path.dirname(d)) {
    if (fs.existsSync(path.join(d, '.git'))) return d;
    if (path.dirname(d) === d) return dir;
  }
}
// As project-of.sh: the .bureau marker at the git root, then the map file, longest prefix wins.
function projectOf(cwd) {
  const root = gitRoot(cwd);
  const marker = readFirst(path.join(root, '.bureau')).split(/\s/)[0];
  if (marker) return marker;
  let best = '', len = 0;
  for (const line of readFirst(process.env.BUREAU_PROJECT_MAP || path.join(HOME, '.bureau-projects')).split(/\r?\n/)) {
    const at = line.indexOf('=');
    if (at < 0) continue;
    const prefix = line.slice(0, at).trim(), id = line.slice(at + 1).trim();
    if (prefix && (root === prefix || root.startsWith(prefix + '/') || root.startsWith(prefix + '\\')) && prefix.length > len) { best = id; len = prefix.length; }
  }
  return best || undefined;
}

function readStdin() {
  return new Promise((resolve) => {
    let text = '';
    process.stdin.setEncoding('utf8');
    process.stdin.on('data', (d) => { text += d; });
    process.stdin.on('end', () => resolve(text));
    process.stdin.on('error', () => resolve(text));
  });
}

async function main() {
  const input = JSON.parse(await readStdin());
  const base = (process.env.BUREAU_URL || readFirst(path.join(HOME, '.bureau-url'))).replace(/\/$/, '');
  const token = process.env.BUREAU_TOKEN || readFirst(process.env.BUREAU_TOKEN_FILE || path.join(HOME, '.bureau-token'));
  if (!base || !token) return note('no hub address or token');
  // Only a compaction loses the passages. A startup has nothing to forget, a
  // resume still holds them, and /clear starts under a new session id.
  const starting = input.hook_event_name === 'SessionStart';
  const compacted = starting && input.source === 'compact';
  if (starting && !compacted) return;
  const body = { request: input.prompt || '', project: projectOf(input.cwd || process.cwd()), session: input.session_id, surface: 'claude-code', agent: 'consul', max_chars: MAX_CHARS, ...(compacted ? { reset: true } : {}) };
  if (!body.project) delete body.project;
  if (!body.session) delete body.session;
  const res = await fetch(`${base}/api/context`, { method: 'POST', headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' }, body: JSON.stringify(body), signal: AbortSignal.timeout(TIMEOUT_MS) });
  if (!res.ok) return note(`hub answered ${res.status}`);
  const out = await res.json();
  if (compacted || !out.rendered) return;
  process.stdout.write(JSON.stringify({ hookSpecificOutput: { hookEventName: 'UserPromptSubmit', additionalContext: out.rendered } }));
}

main().catch((e) => note(`failed: ${e.message}`)).finally(() => { process.exitCode = 0; });

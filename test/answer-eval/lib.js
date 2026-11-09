// Shared parts of the answer eval: arguments, the Claude runner, a scratch hub,
// seeded randomness and the file helpers. No dependencies.
'use strict';
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

const REPO = path.resolve(__dirname, '..', '..');
const HUB_TOKEN = 'answer-eval-token';

// --name value pairs. Names listed in `multi` may repeat and give an array.
function parseArgs(argv, multi = []) {
  const out = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith('--')) throw new Error(`unexpected argument: ${a}`);
    const name = a.slice(2);
    const value = argv[i + 1] === undefined || argv[i + 1].startsWith('--') ? true : argv[++i];
    if (multi.includes(name)) (out[name] = out[name] || []).push(value);
    else out[name] = value;
  }
  return out;
}
function need(o, name) {
  if (o[name] === undefined || o[name] === true) throw new Error(`--${name} is required`);
  return o[name];
}

const readJson = (f) => JSON.parse(fs.readFileSync(f, 'utf8'));
const writeJson = (f, v) => fs.writeFileSync(f, JSON.stringify(v, null, 1) + '\n');
function readJsonl(f) {
  if (!fs.existsSync(f)) return [];
  return fs.readFileSync(f, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l));
}
const appendJsonl = (f, v) => fs.appendFileSync(f, JSON.stringify(v) + '\n');
const tokensOf = (s) => Math.ceil(Buffer.byteLength(String(s), 'utf8') / 4);

// A small seeded generator, so a run can be repeated exactly.
function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
function shuffle(list, rand) {
  const a = list.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

// Nothing of the parent session reaches the child. BUREAU_URL points at a closed
// local port, so a hook that fired by mistake could not reach a real hub, and
// BUREAU_HOOK_LOG points at a canary file that such a hook would create.
function childEnv(outDir, extra = {}) {
  const env = {};
  for (const k of ['PATH', 'HOME', 'USER', 'LOGNAME', 'SHELL', 'TERM', 'LANG', 'TMPDIR']) if (process.env[k]) env[k] = process.env[k];
  return { ...env, CLAUDE_CODE_DISABLE_AUTO_MEMORY: '1', BUREAU_URL: 'http://127.0.0.1:9', BUREAU_TOKEN: 'none',
    BUREAU_HOOK_LOG: path.join(outDir, 'hook-canary.log'), BUREAU_PROJECT_MAP: path.join(outDir, 'no-project-map'), ...extra };
}

// The flags that make a run isolated. Safe mode drops hooks, CLAUDE.md, skills,
// plugins and MCP servers. An empty settings source list drops the settings files.
function isolationFlags() {
  return ['--safe-mode', '--setting-sources', '', '--strict-mcp-config', '--disable-slash-commands', '--no-session-persistence'];
}

// One call of `claude -p`, prompt on stdin, stream-json out so that the init
// message and any hook event can be inspected.
function runClaude({ prompt, system, tools = [], model, effort, cwd, env, flags, timeoutMs = 240000, restricted = false }) {
  const args = ['-p', ...flags, '--output-format', 'stream-json', '--verbose', '--include-hook-events', '--permission-mode', 'dontAsk', '--model', model, '--system-prompt', system];
  if (effort) args.push('--effort', effort);
  if (restricted) args.push('--restricted');
  if (tools.length) args.push('--tools', tools.join(','), '--allowedTools', ...tools);
  else args.push('--tools', '');
  return new Promise((resolve) => {
    const t0 = Date.now();
    const child = spawn('claude', args, { cwd, env, stdio: ['pipe', 'pipe', 'pipe'] });
    let buf = '', stderr = '', timedOut = false;
    const parsed = { init: null, result: null, hookEvents: 0, rateLimit: null, toolUses: 0, reads: [] };
    const eat = (line) => {
      if (!line.trim()) return;
      let m;
      try { m = JSON.parse(line); } catch { return; }
      if (m.type === 'system' && m.subtype === 'init') parsed.init = m;
      else if (m.type === 'result') parsed.result = m;
      else if (m.type === 'rate_limit_event') parsed.rateLimit = m.rate_limit_info;
      else if (/hook/i.test(`${m.type} ${m.subtype || ''}`)) parsed.hookEvents++;
      else if (m.type === 'assistant') for (const b of (m.message && m.message.content) || []) if (b.type === 'tool_use') { parsed.toolUses++; if (b.name === 'Read' && b.input && b.input.file_path) parsed.reads.push(b.input.file_path); }
    };
    child.stdout.on('data', (d) => {
      buf += d;
      const lines = buf.split('\n');
      buf = lines.pop();
      lines.forEach(eat);
    });
    child.stderr.on('data', (d) => { stderr += d; });
    const timer = setTimeout(() => { timedOut = true; child.kill('SIGKILL'); }, timeoutMs);
    child.on('close', (code) => {
      clearTimeout(timer);
      if (buf) eat(buf);
      resolve({ ...parsed, code, timedOut, stderr: stderr.slice(0, 2000), latencyMs: Date.now() - t0 });
    });
    child.stdin.end(prompt);
  });
}

// True when the plan has stopped being normal quota: stop rather than spend overage.
function quotaTrouble(r, maxUtilization) {
  const rl = r.rateLimit;
  if (rl && (rl.status !== 'allowed' || rl.isUsingOverage)) return `rate limit status ${rl.status}, overage ${rl.isUsingOverage}`;
  const week = rl && rl.unifiedWindows && rl.unifiedWindows.seven_day;
  if (week && week.utilization >= maxUtilization) return `seven day utilization at ${week.utilization}`;
  const res = r.result;
  if (res && (res.api_error_status === 429 || (res.is_error && /limit|quota/i.test(`${res.result || ''}`)))) return `API said: ${String(res.result || res.api_error_status).slice(0, 200)}`;
  return null;
}

// A hub on a copy of a brain. The address is always loopback.
async function startHub({ brain, dataDir, port, log }) {
  fs.mkdirSync(dataDir, { recursive: true });
  const workDir = path.join(dataDir, 'work');
  fs.mkdirSync(workDir, { recursive: true });
  const fd = fs.openSync(log, 'a');
  const env = { PATH: process.env.PATH, HOME: dataDir, PORT: String(port), BUREAU_TOKEN: HUB_TOKEN, BUREAU_DATA_DIR: dataDir, BUREAU_BRAIN_DIR: brain, BUREAU_WORK_DIR: workDir, BUREAU_ENV_FILE: path.join(dataDir, 'no.env') };
  const child = spawn(process.execPath, [path.join(REPO, 'hub', 'server.js')], { cwd: REPO, env, stdio: ['ignore', fd, fd] });
  const url = `http://127.0.0.1:${port}`;
  for (let i = 0; i < 60; i++) {
    try { const r = await fetch(`${url}/health`); if (r.ok) break; } catch { /* still booting */ }
    await new Promise((r) => setTimeout(r, 500));
    if (i === 59) { child.kill(); throw new Error(`hub did not start, see ${log}`); }
  }
  const call = async (method, p, body) => {
    const r = await fetch(`${url}${p}`, { method, headers: { authorization: `Bearer ${HUB_TOKEN}`, 'content-type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });
    const text = await r.text();
    let json = null;
    try { json = JSON.parse(text); } catch { /* not json */ }
    return { status: r.status, json, text };
  };
  return { url, call, stop: () => new Promise((resolve) => { child.on('close', resolve); child.kill(); }) };
}

// A pool that stops taking jobs once `stop()` returns a reason.
async function pool(jobs, concurrency, work) {
  let next = 0, reason = null;
  const stop = (why) => { reason = reason || why; };
  const worker = async () => {
    while (next < jobs.length && !reason) {
      const job = jobs[next++];
      await work(job, stop);
    }
  };
  await Promise.all(Array.from({ length: concurrency }, worker));
  return reason;
}

module.exports = { REPO, HUB_TOKEN, parseArgs, need, readJson, writeJson, readJsonl, appendJsonl, tokensOf, rng, shuffle, childEnv, isolationFlags, runClaude, quotaTrouble, startHub, pool };

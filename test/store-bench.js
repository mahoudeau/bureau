// test/store-bench.js: the file store against SQLite. Load time, save time
// after one change, and file size, at 1k, 10k and 50k synthetic missions
// with realistic logs (a 2000-entry event log, messages, agents, settings).
// Each measure runs the real lib/store.js in its own process, so it pays
// what a hub pays. Not part of CI: a benchmark, not a test.
// Usage: node test/store-bench.js [sizes, comma separated]   e.g. 1000,10000
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const SAVES = 7;

// ---------- one measure, in a child process ----------
function child() {
  const [, , , kind, dir] = process.argv;
  const store = require(path.join(ROOT, 'hub', 'lib', 'store'));
  const ms = (t) => Number(process.hrtime.bigint() - t) / 1e6;
  const median = (xs) => xs.slice().sort((a, b) => a - b)[Math.floor(xs.length / 2)];
  let t = process.hrtime.bigint();
  const s = store.load();
  const load = ms(t);
  const result = { kind, load_ms: load, missions: s.tasks.length };
  if (kind === 'import') { require(path.join(ROOT, 'hub', 'lib', 'sqlite-store')).close(); return console.log(JSON.stringify(result)); }
  // One change: a note on one mission, as a PATCH makes.
  const saves = [];
  for (let i = 0; i < SAVES; i++) {
    const task = s.tasks[Math.floor(s.tasks.length / 2) + i];
    task.log.push({ ts: new Date().toISOString(), by: 'bench', note: `note ${i}` });
    store.save();
    t = process.hrtime.bigint();
    store.flush();
    saves.push(ms(t));
  }
  result.save_ms = median(saves);
  // A heartbeat: one agent's last_seen. The file store writes the whole file
  // all the same; SQLite looks at the agents table only.
  const beats = [];
  for (let i = 0; i < SAVES; i++) {
    store.heartbeat('agent-1', `beat ${i}`);
    t = process.hrtime.bigint();
    store.flush();
    beats.push(ms(t));
  }
  result.heartbeat_ms = median(beats);
  if (kind === 'sqlite') require(path.join(ROOT, 'hub', 'lib', 'sqlite-store')).close();
  const file = kind === 'sqlite' ? store.DB_FILE : store.STATE_FILE;
  result.bytes = fs.statSync(file).size;
  console.log(JSON.stringify(result));
}

// ---------- synthetic state ----------
function synth(n) {
  let seed = 42;
  const rnd = () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff; };
  const pick = (xs) => xs[Math.floor(rnd() * xs.length)];
  const words = 'the hub keeps every mission in memory and writes it down after each change so a restart loses nothing agents claim work post notes and park it for review'.split(' ');
  const text = (k) => Array.from({ length: k }, () => pick(words)).join(' ');
  const projects = Array.from({ length: 12 }, (_, i) => ({ id: `p${i}`, label: `Project ${i}`, capacity: 1 }));
  const agents = Array.from({ length: 20 }, (_, i) => ({ name: `agent-${i}`, kind: 'claude-code', capabilities: ['critic'], registered_at: '2026-01-01T00:00:00.000Z', last_seen: '2026-11-01T00:00:00.000Z', note: text(8), activity: 'idle', sub_agents: [] }));
  const base = Date.UTC(2026, 0, 1);
  const iso = (m) => new Date(base + m * 60000).toISOString();
  const tasks = [];
  for (let i = 1; i <= n; i++) {
    const who = pick(agents).name;
    const status = rnd() < 0.85 ? pick(['done', 'done', 'done', 'failed', 'discarded']) : pick(['queued', 'claimed', 'in_progress', 'blocked', 'review']);
    const log = [{ ts: iso(i * 10), by: who, note: 'claimed (lease 120m)', from: 'queued', to: 'claimed' }];
    const notes = 3 + Math.floor(rnd() * 8);
    for (let j = 0; j < notes; j++) log.push({ ts: iso(i * 10 + j + 1), by: who, note: text(10 + Math.floor(rnd() * 30)) });
    if (status === 'done') log.push({ ts: iso(i * 10 + 9), by: 'human', note: 'approved', from: 'review', to: 'done', kind: 'approve' });
    const t = { id: `t-${i}`, title: text(6), body: text(60 + Math.floor(rnd() * 120)), status, priority: 3, project: pick(projects).id, gate: 'boss', created_by: 'human', created_at: iso(i * 10), assignee: status === 'queued' ? null : who, lease_until: null, log, artifacts: rnd() < 0.3 ? [{ ts: iso(i * 10 + 5), by: who, label: 'PR', url: `https://example.com/pr/${i}` }] : [] };
    if (rnd() < 0.1) t.items = [{ id: 'i1', title: text(5), body: text(40), verdict: 'approved', comment: null }];
    tasks.push(t);
  }
  const log = Array.from({ length: 2000 }, (_, i) => ({ ts: iso(i), type: pick(['task.created', 'task.updated', 'knowledge.written', 'agent.heartbeat']), id: `t-${1 + (i % n)}`, title: text(6), by: pick(agents).name }));
  const messages = Array.from({ length: Math.min(5000, n) }, (_, i) => ({ id: `m-${n + i + 1}`, ts: iso(i), from: pick(agents).name, to: '*', body: text(25), task_id: null }));
  return { schema_version: 2, tasks, agents, messages, log, seq: n + messages.length, projects, settings: { global: { approval: 'in-session' }, projects: {}, agents: {}, members: {} }, agent_tokens: [], oauth_apps: [], sessions: [] };
}

// ---------- the parent ----------
function run(kind, dir, store) {
  const env = { PATH: process.env.PATH, NODE_NO_WARNINGS: '1', BUREAU_DATA_DIR: path.join(dir, 'data'), BUREAU_BRAIN_DIR: path.join(dir, 'brain'), BUREAU_WORK_DIR: path.join(dir, 'work'), BUREAU_ENV_FILE: path.join(dir, 'none.env'), BUREAU_STORE: store };
  const r = spawnSync(process.execPath, ['--max-old-space-size=4096', __filename, '--child', kind, dir], { env, encoding: 'utf8' });
  if (r.status !== 0) throw new Error(`${kind} failed: ${r.stderr}`);
  return JSON.parse(r.stdout.trim().split('\n').pop());
}

function main() {
  let sqliteOk = true;
  try { require('node:sqlite'); } catch { sqliteOk = false; }
  const sizes = (process.argv[2] || '1000,10000,50000').split(',').map(Number);
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'bureau-bench-'));
  const rows = [];
  try {
    for (const n of sizes) {
      const text = JSON.stringify(synth(n), null, 2);
      const jdir = path.join(tmp, `json-${n}`), sdir = path.join(tmp, `sqlite-${n}`);
      for (const d of [jdir, sdir]) { fs.mkdirSync(path.join(d, 'data'), { recursive: true }); fs.writeFileSync(path.join(d, 'data', 'state.json'), text); }
      const j = run('json', jdir, '');
      rows.push({ n, store: 'json', ...j });
      if (!sqliteOk) continue;
      const imp = run('import', sdir, 'sqlite');
      const s = run('sqlite', sdir, 'sqlite');
      rows.push({ n, store: 'sqlite', ...s, import_ms: imp.load_ms });
    }
  } finally { fs.rmSync(tmp, { recursive: true, force: true }); }
  const f = (x) => (x === undefined ? '' : x < 10 ? x.toFixed(2) : x.toFixed(0));
  const mb = (b) => (b / 1048576).toFixed(1);
  console.log(`Node ${process.version}, ${os.platform()} ${os.arch()}, median of ${SAVES} saves\n`);
  console.log('| missions | store | load ms | save after one change ms | heartbeat save ms | file MB | first import ms |');
  console.log('|---:|---|---:|---:|---:|---:|---:|');
  for (const r of rows) console.log(`| ${r.n} | ${r.store} | ${f(r.load_ms)} | ${f(r.save_ms)} | ${f(r.heartbeat_ms)} | ${mb(r.bytes)} | ${f(r.import_ms)} |`);
  if (!sqliteOk) console.log('\nnode:sqlite is not available on this Node: SQLite rows skipped.');
}

if (process.argv[2] === '--child') child(); else main();

// lib/store.js: JSON state with atomic writes. Zero dependencies.
'use strict';
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const DATA_DIR = process.env.BUREAU_DATA_DIR || path.join(__dirname, '..', 'data');
const STATE_FILE = path.join(DATA_DIR, 'state.json');

const EMPTY = { tasks: [], agents: [], messages: [], log: [], seq: 0 };

let state = null;

function load() {
  if (state) return state;
  try {
    state = JSON.parse(fs.readFileSync(STATE_FILE, 'utf8'));
  } catch {
    state = structuredClone(EMPTY);
  }
  for (const k of Object.keys(EMPTY)) if (state[k] === undefined) state[k] = structuredClone(EMPTY[k]);
  return state;
}

let saveTimer = null;
function save() {
  // Debounced atomic write: write tmp file then rename.
  if (saveTimer) return;
  saveTimer = setTimeout(() => {
    saveTimer = null;
    fs.mkdirSync(DATA_DIR, { recursive: true });
    const tmp = STATE_FILE + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(state, null, 2));
    fs.renameSync(tmp, STATE_FILE);
  }, 100);
}

function nextId(prefix) {
  const s = load();
  s.seq += 1;
  save();
  return `${prefix}-${s.seq}`;
}

function nowISO() { return new Date().toISOString(); }

// ---- Startup lock ----
// One process owns a data dir, ever. Two hubs sharing state.json would break
// the single-writer guarantee silently; refusing to boot is the honest failure.
const LOCK_FILE = path.join(DATA_DIR, 'hub.lock');
function acquireLock() {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  try {
    const pid = parseInt(fs.readFileSync(LOCK_FILE, 'utf8'), 10);
    if (pid && pid !== process.pid) {
      try {
        process.kill(pid, 0); // throws if the process is gone
        return { error: `data dir is owned by a live hub process (pid ${pid}); refusing to boot` };
      } catch { /* stale lock from a dead process: take over */ }
    }
  } catch { /* no lock file yet */ }
  fs.writeFileSync(LOCK_FILE, String(process.pid));
  const release = () => { try { if (parseInt(fs.readFileSync(LOCK_FILE, 'utf8'), 10) === process.pid) fs.unlinkSync(LOCK_FILE); } catch { } };
  process.on('exit', release);
  for (const sig of ['SIGINT', 'SIGTERM']) process.on(sig, () => process.exit(0));
  return {};
}

// ---- Activity log (ring buffer) ----
function logEvent(type, data) {
  const s = load();
  const entry = { ts: nowISO(), type, ...data };
  s.log.push(entry);
  if (s.log.length > 2000) s.log.splice(0, s.log.length - 2000);
  save();
  return entry;
}

// ---- Agents ----
function upsertAgent({ name, kind, capabilities }) {
  const s = load();
  let a = s.agents.find(x => x.name === name);
  if (!a) {
    a = { name, kind: kind || 'other', capabilities: capabilities || [], registered_at: nowISO() };
    s.agents.push(a);
  } else {
    if (kind) a.kind = kind;
    if (capabilities) a.capabilities = capabilities;
  }
  a.last_seen = nowISO();
  save();
  return a;
}

function heartbeat(name, note, activity) {
  const s = load();
  const a = s.agents.find(x => x.name === name);
  if (!a) return null;
  a.last_seen = nowISO();
  if (note !== undefined) a.note = note;
  if (activity !== undefined) {
    if (activity !== null && !ACTIVITIES.includes(activity)) return { error: `unknown activity; use one of ${ACTIVITIES.join(', ')}` };
    a.activity = activity;
  }
  save();
  return a;
}

// ---- Tasks ----
const TASK_STATUSES = ['queued', 'claimed', 'in_progress', 'blocked', 'review', 'done', 'failed'];

// Generic activity vocabulary (docs/protocol.md). The office animates these verbs.
const ACTIVITIES = ['editing', 'reading', 'executing', 'thinking', 'waiting_input', 'waiting_permission', 'blocked', 'idle'];

// Project names become brain paths (projects/<name>/...), so they stay path-safe.
const PROJECT_RE = /^[a-zA-Z0-9][a-zA-Z0-9._-]{0,39}$/;

function createTask({ title, body, priority, project, created_by }) {
  const t = {
    id: nextId('t'),
    title: String(title || 'untitled'),
    body: body || '',
    status: 'queued',
    priority: Number.isFinite(+priority) ? +priority : 3, // 1 = highest
    project: project || 'general', // always named: the brain files under projects/<project>/
    created_by: created_by || 'human',
    created_at: nowISO(),
    assignee: null,
    lease_until: null,
    log: [],
    artifacts: [],
    // Read-only capability: the mission record page (/m/<token>), linked from pings.
    view_token: crypto.randomBytes(16).toString('hex'),
  };
  load().tasks.push(t);
  save();
  return t;
}

function renameProject(from, to) {
  const s = load();
  let n = 0;
  for (const t of s.tasks) if (t.project === from) { t.project = to; n++; }
  if (n) save();
  return n;
}

function findByViewToken(token) {
  return load().tasks.find(t => t.view_token === token) || null;
}

function expireLeases() {
  const s = load();
  const now = nowISO();
  const expired = [];
  for (const t of s.tasks) {
    if ((t.status === 'claimed' || t.status === 'in_progress') && t.lease_until && t.lease_until < now) {
      t.log.push({ ts: nowISO(), by: 'system', note: `lease expired (was ${t.assignee}); back to queue` });
      t.status = 'queued';
      t.assignee = null;
      t.lease_until = null;
      expired.push(t);
    }
  }
  if (expired.length) save();
  return expired;
}

function claimTask({ id, agent, lease_minutes }) {
  expireLeases();
  const s = load();
  let t;
  if (id) {
    t = s.tasks.find(x => x.id === id);
    if (!t) return { error: 'not_found' };
    if (t.status !== 'queued') return { error: `not claimable (status: ${t.status})` };
  } else {
    // Highest-priority queued task (lowest number wins, then oldest).
    t = s.tasks
      .filter(x => x.status === 'queued')
      .sort((a, b) => a.priority - b.priority || a.created_at.localeCompare(b.created_at))[0];
    if (!t) return { error: 'queue_empty' };
  }
  t.status = 'claimed';
  t.assignee = agent;
  const mins = Number.isFinite(+lease_minutes) ? +lease_minutes : 120;
  t.lease_until = new Date(Date.now() + mins * 60000).toISOString();
  t.log.push({ ts: nowISO(), by: agent, note: `claimed (lease ${mins}m)` });
  save();
  return { task: t };
}

function updateTask({ id, agent, status, note, artifact, lease_minutes, priority, title, body }) {
  const s = load();
  const t = s.tasks.find(x => x.id === id);
  if (!t) return { error: 'not_found' };
  if (status) {
    if (!TASK_STATUSES.includes(status)) return { error: `bad status; use one of ${TASK_STATUSES.join(', ')}` };
    t.status = status;
    // blocked keeps its assignee but pauses the lease, so it never auto-requeues
    if (status === 'done' || status === 'failed' || status === 'review' || status === 'blocked') t.lease_until = null;
    if (status === 'queued') { t.assignee = null; t.lease_until = null; }
    // Capability links exist exactly while the task sits in review; any transition out consumes them.
    if (status === 'review') t.review_links = makeReviewLinks();
    else delete t.review_links;
  }
  if (lease_minutes) t.lease_until = new Date(Date.now() + (+lease_minutes) * 60000).toISOString();
  if (priority !== undefined) t.priority = +priority;
  if (title) t.title = title;
  if (body !== undefined) t.body = body;
  if (artifact) t.artifacts.push({ ts: nowISO(), by: agent || 'unknown', ...artifact });
  t.log.push({ ts: nowISO(), by: agent || 'unknown', note: note || (status ? `status → ${status}` : 'updated') });
  save();
  return { task: t };
}

// ---- Review capability links ----
// Single-use by construction: updateTask clears review_links on any transition out of review.
function makeReviewLinks() {
  const exp = new Date(Date.now() + 7 * 86400_000).toISOString();
  return {
    approve: { token: crypto.randomBytes(16).toString('hex'), exp },
    sendback: { token: crypto.randomBytes(16).toString('hex'), exp },
  };
}

function findByReviewToken(token) {
  const s = load();
  for (const t of s.tasks) {
    const l = t.review_links;
    if (!l) continue;
    if (l.approve.token === token) return { task: t, action: 'done', exp: l.approve.exp };
    if (l.sendback.token === token) return { task: t, action: 'queued', exp: l.sendback.exp };
  }
  return null;
}

// ---- Messages ----
function postMessage({ from, to, body, task_id }) {
  const m = { id: nextId('m'), ts: nowISO(), from, to: to || '*', body: String(body || ''), task_id: task_id || null };
  const s = load();
  s.messages.push(m);
  if (s.messages.length > 5000) s.messages.splice(0, s.messages.length - 5000);
  save();
  return m;
}

function getMessages({ forAgent, since }) {
  const s = load();
  return s.messages.filter(m =>
    (!forAgent || m.to === '*' || m.to === forAgent || m.from === forAgent) &&
    (!since || m.ts > since)
  );
}

module.exports = {
  load, save, logEvent, upsertAgent, heartbeat, acquireLock,
  createTask, claimTask, updateTask, expireLeases, findByReviewToken,
  renameProject, findByViewToken, PROJECT_RE,
  postMessage, getMessages, TASK_STATUSES, ACTIVITIES,
};

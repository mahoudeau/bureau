// lib/store.js: JSON state with atomic writes. Zero dependencies.
'use strict';
const fs = require('fs');
const path = require('path');

const DATA_DIR = process.env.HQ_DATA_DIR || path.join(__dirname, '..', 'data');
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

function createTask({ title, body, priority, project, created_by }) {
  const t = {
    id: nextId('t'),
    title: String(title || 'untitled'),
    body: body || '',
    status: 'queued',
    priority: Number.isFinite(+priority) ? +priority : 3, // 1 = highest
    project: project || null,
    created_by: created_by || 'human',
    created_at: nowISO(),
    assignee: null,
    lease_until: null,
    log: [],
    artifacts: [],
  };
  load().tasks.push(t);
  save();
  return t;
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
  load, save, logEvent, upsertAgent, heartbeat,
  createTask, claimTask, updateTask, expireLeases,
  postMessage, getMessages, TASK_STATUSES, ACTIVITIES,
};

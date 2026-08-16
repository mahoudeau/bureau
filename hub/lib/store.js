// lib/store.js: JSON state with atomic writes. Zero dependencies.
'use strict';
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const DATA_DIR = process.env.BUREAU_DATA_DIR || path.join(__dirname, '..', 'data');
const STATE_FILE = path.join(DATA_DIR, 'state.json');

const EMPTY = { tasks: [], agents: [], messages: [], log: [], seq: 0, projects: [{ id: 'general', label: 'General' }] };

let state = null;

function load() {
  if (state) return state;
  try {
    state = JSON.parse(fs.readFileSync(STATE_FILE, 'utf8'));
  } catch {
    state = structuredClone(EMPTY);
  }
  for (const k of Object.keys(EMPTY)) if (state[k] === undefined) state[k] = structuredClone(EMPTY[k]);
  // Projects grew from plain names to {id, label, capacity}; migrate old state transparently.
  state.projects = (state.projects || []).map(p => (typeof p === 'string' ? { id: p, label: p } : p));
  for (const pj of state.projects) if (!Number.isInteger(pj.capacity) || pj.capacity < 1) pj.capacity = 1;
  // Self-heal: any project with OPEN missions is registered (pre-registry data included).
  // Closed missions do not resurrect deliberately deleted projects.
  for (const t of state.tasks)
    if (t.project && t.status !== 'done' && t.status !== 'failed' && t.status !== 'discarded' && !state.projects.some(pj => pj.id === t.project))
      state.projects.push({ id: t.project, label: t.project });
  state.projects.sort((a, b) => a.id.localeCompare(b.id));
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

// Sub-agent fleets (t-60/t-61 i1+i2): a parent agent's sub-agent fleet rides
// its own heartbeat as a full-snapshot array, stored ONLY on the parent's own
// roster record (agent.sub_agents) - never inserted into s.agents itself, so
// a sub-agent has no name/kind/registration/token of its own and structurally
// cannot claim a mission or heartbeat as itself (claim and heartbeat both key
// strictly off registered roster `name`s; nothing reads INTO sub_agents to
// authenticate anything). Omitting the field, or sending [], means "nothing
// to report this beat" and clears whatever fleet was last seen - this is a
// full-snapshot report, not a diff, so a parent that stops including the
// field is read as having stood its fleet down.
const SUBAGENT_CAP = 24;
function normalizeFleet(list) {
  if (!Array.isArray(list)) return [];
  return list.slice(0, SUBAGENT_CAP).map(e => {
    const label = String((e && e.label) ?? '').slice(0, 80); // free text; truncate, never reject
    const activity = e && e.activity != null && ACTIVITIES.includes(e.activity) ? e.activity : undefined;
    return activity ? { label, activity } : { label };
  });
}
// Order-insensitive composition key: reordering the same labels/activities is
// not itself a "change" per i2 (label added/removed, or an activity change on
// an existing label are the three named triggers).
function fleetKey(list) { return JSON.stringify(list.map(e => [e.label, e.activity || '']).sort()); }
function fleetLogLine(list) {
  if (!list.length) return 'fleet: 0 - cleared';
  const parts = list.map(e => (e.activity ? `${e.label} (${e.activity})` : e.label));
  return `fleet: ${list.length} running - ${parts.join(', ')}`;
}
// Throttled on CHANGE only: appends one log line to every mission currently
// assigned (claimed/in_progress) to this agent. No active mission -> the
// fleet still lands on the roster record for live display, but there is
// nothing to attach a log line to, so none is written (per i2).
function logFleetChange(s, agentName, fleet) {
  const active = s.tasks.filter(t => t.assignee === agentName && (t.status === 'claimed' || t.status === 'in_progress'));
  if (!active.length) return;
  const note = fleetLogLine(fleet);
  for (const t of active) t.log.push({ ts: nowISO(), by: agentName, note });
  save();
}

function heartbeat(name, note, activity, subAgents) {
  const s = load();
  const a = s.agents.find(x => x.name === name);
  if (!a) return null;
  a.last_seen = nowISO();
  if (note !== undefined) a.note = note;
  if (activity !== undefined) {
    if (activity !== null && !ACTIVITIES.includes(activity)) return { error: `unknown activity; use one of ${ACTIVITIES.join(', ')}` };
    a.activity = activity;
  }
  const prevFleet = Array.isArray(a.sub_agents) ? a.sub_agents : [];
  const nextFleet = normalizeFleet(subAgents);
  const fleetChanged = fleetKey(prevFleet) !== fleetKey(nextFleet);
  a.sub_agents = nextFleet;
  save();
  if (fleetChanged) logFleetChange(s, a.name, nextFleet);
  return a;
}

// ---- Tasks ----
const TASK_STATUSES = ['queued', 'claimed', 'in_progress', 'blocked', 'review', 'done', 'failed', 'discarded'];

// Generic activity vocabulary (docs/protocol.md). The office animates these verbs.
const ACTIVITIES = ['editing', 'reading', 'executing', 'thinking', 'waiting_input', 'waiting_permission', 'blocked', 'idle'];

// Project names become brain paths (projects/<name>/...), so they stay path-safe.
const PROJECT_RE = /^[a-zA-Z0-9][a-zA-Z0-9._-]{0,39}$/;

// Free-text label to path-safe id: "Chasse aux Trésors" → "chasse-aux-tresors".
function slugify(label) {
  return String(label || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .toLowerCase().replace(/[^a-z0-9._-]+/g, '-').replace(/^[-.]+|[-.]+$/g, '').slice(0, 40);
}

// A project's repo is where its code lives (https clone URL); agents that build
// need the address, not a guess. Optional, like the entity wall.
const REPO_RE = /^https:\/\/[\w.-]+\/[\w.\/~-]+$/;

function createProject(label, id, entity, repo) {
  const s = load();
  id = id || slugify(label);
  if (!PROJECT_RE.test(id)) return { error: 'label produces an empty or invalid id' };
  if (entity && !PROJECT_RE.test(entity)) return { error: 'bad entity slug: letters, digits, dot, dash, underscore, max 40' };
  if (repo && !REPO_RE.test(repo)) return { error: 'repo must be an https clone URL' };
  if (s.projects.some(p => p.id === id)) return { exists: true, project: s.projects.find(p => p.id === id) };
  // entity: the scope wall this project sits behind (entities/<slug>/ in the brain); optional
  const project = { id, label: String(label || id), capacity: 1, ...(entity ? { entity } : {}), ...(repo ? { repo } : {}) };
  s.projects.push(project);
  s.projects.sort((a, b) => a.id.localeCompare(b.id));
  save();
  return { created: true, project };
}

function deleteProject(id) {
  const s = load();
  if (!s.projects.some(p => p.id === id)) return { error: 'not_found' };
  const open = s.tasks.filter(t => t.project === id && t.status !== 'done' && t.status !== 'failed' && t.status !== 'discarded').length;
  if (open) return { error: `project has ${open} open mission(s); finish or move them first` };
  s.projects = s.projects.filter(p => p.id !== id);
  save();
  // Closed missions keep their project id for history; the brain folder is never touched.
  return { deleted: true };
}

function updateProject(id, { label, capacity, entity, repo }) {
  const s = load();
  const p = s.projects.find(x => x.id === id);
  if (!p) return null;
  if (label !== undefined) p.label = String(label);
  if (capacity !== undefined) {
    if (!Number.isInteger(+capacity) || +capacity < 1 || +capacity > 9) return { error: 'capacity must be an integer from 1 to 9' };
    p.capacity = +capacity;
  }
  if (entity !== undefined) {
    if (entity === '' || entity === null) delete p.entity; // clearing the wall is explicit
    else if (!PROJECT_RE.test(entity)) return { error: 'bad entity slug: letters, digits, dot, dash, underscore, max 40' };
    else p.entity = entity;
  }
  if (repo !== undefined) {
    if (repo === '' || repo === null) delete p.repo;
    else if (!REPO_RE.test(repo)) return { error: 'repo must be an https clone URL' };
    else p.repo = repo;
  }
  save();
  return p;
}

function createTask({ title, body, priority, project, created_by, gate }) {
  const t = {
    id: nextId('t'),
    title: String(title || 'untitled'),
    body: body || '',
    status: 'queued',
    priority: Number.isFinite(+priority) ? +priority : 3, // 1 = highest
    project: project || 'general', // always named: the brain files under projects/<project>/
    // Two-tier review: 'boss' (default; only the human moves it out of review)
    // or 'critic' (the critic agent may rule on it). The irreversible list is
    // always boss-gate by law (docs/protocol.md).
    gate: gate === 'critic' ? 'critic' : 'boss',
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
  const dupe = s.projects.some(p => p.id === to);
  s.projects = s.projects.filter(p => !(p.id === from && dupe)).map(p => (p.id === from ? { ...p, id: to } : p));
  s.projects.sort((a, b) => a.id.localeCompare(b.id));
  save();
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
      // Unified reservations: the expired holder gets first claim on its own
      // mission. claimTask lets cowork reservations lapse after the TTL, so a
      // dead shift's mission returns to the pool; the envoy's waits for him.
      t.log.push({ ts: nowISO(), by: 'system', note: `lease expired (was ${t.assignee}); back to queue, reserved for ${t.assignee}` });
      if (t.assignee) { t.reserved_for = t.assignee; t.reserved_at = nowISO(); }
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
    // Projects are the unit of concurrency: claim-without-id serves only projects
    // with free capacity (active = claimed or in_progress, whoever holds them).
    // blocked and review missions do not occupy a slot, and neither do goal
    // missions: a goal is coordination held open by the lead for its whole life,
    // and it must not starve its own children of the desk. Claim-by-id bypasses.
    const active = {};
    for (const x of s.tasks)
      if ((x.status === 'claimed' || x.status === 'in_progress') && !/^goal:/i.test(x.title)) active[x.project] = (active[x.project] || 0) + 1;
    const capOf = pid => { const pj = s.projects.find(x => x.id === pid); return (pj && pj.capacity) || 1; };
    // Reservations hold a mission for the agent with context. A cowork holder's
    // reservation lapses after the TTL (its shift may be over; the pool takes
    // the mission); a non-cowork holder's never lapses (the envoy's context
    // lives outside any session and keeps).
    const ttlMs = (+process.env.BUREAU_RESERVATION_TTL_MIN || 30) * 60000;
    const claimable = x => {
      if (!x.reserved_for || x.reserved_for === agent) return true;
      const holder = s.agents.find(a => a.name === x.reserved_for);
      if (!holder || holder.kind !== 'cowork') return false;
      return !x.reserved_at || (Date.now() - Date.parse(x.reserved_at)) > ttlMs;
    };
    const queued = s.tasks
      .filter(x => x.status === 'queued' && claimable(x))
      .sort((a, b) => a.priority - b.priority || a.created_at.localeCompare(b.created_at));
    if (!queued.length) return { error: 'queue_empty' };
    t = queued.find(x => (active[x.project] || 0) < capOf(x.project));
    if (!t) return { error: 'all_busy' };
  }
  delete t.reserved_for; // any claim (owner, or explicit by id) clears the reservation
  delete t.reserved_at;
  t.status = 'claimed';
  t.assignee = agent;
  const mins = Number.isFinite(+lease_minutes) ? +lease_minutes : 120;
  t.lease_until = new Date(Date.now() + mins * 60000).toISOString();
  t.log.push({ ts: nowISO(), by: agent, note: `claimed (lease ${mins}m)` });
  save();
  return { task: t };
}

function updateTask({ id, agent, status, note, artifact, lease_minutes, priority, title, body, items, verdicts, gate }) {
  const s = load();
  const t = s.tasks.find(x => x.id === id);
  if (!t) return { error: 'not_found' };
  const prevStatus = t.status, prevAssignee = t.assignee;
  // Gate changes: anyone may raise to boss; only the boss or the lead set critic.
  if (gate !== undefined) {
    if (gate === 'boss') t.gate = 'boss';
    else if (gate === 'critic' && (agent === 'human' || agent === 'ummon')) t.gate = 'critic';
    else return { error: 'gate: anyone may raise to boss; only the boss or ummon set critic' };
  }
  // The boss-gate law, hub-enforced: a boss-gate mission in review moves out
  // (done or back to queued) only by the human's hand. Missions without a gate
  // predate the field and are boss-gate by definition.
  if ((status === 'done' || status === 'queued') && t.status === 'review' && (t.gate || 'boss') === 'boss' && agent !== 'human')
    return { error: 'boss-gate: only the boss moves this mission out of review' };
  // Itemized review: a worker files proposal items; the boss files per-item
  // verdicts (approved/rejected + comment). Verdicts persist on the mission so
  // the next shift reads exactly what was accepted and what needs rework.
  if (Array.isArray(items)) {
    t.items = t.items || [];
    let added = 0;
    for (const it of items) {
      if (!it || !it.title) continue;
      t.items.push({ id: `i${t.items.length + 1}`, title: String(it.title).slice(0, 200), body: String(it.body || '').slice(0, 20000), verdict: 'proposed', comment: null });
      added++;
    }
    if (added && !note && !status) note = `filed ${added} review item(s)`;
  }
  if (Array.isArray(verdicts) && t.items) {
    const lines = [];
    for (const v of verdicts) {
      const it = t.items.find(x => x.id === v.id);
      if (!it) continue;
      if (v.verdict === 'approved' || v.verdict === 'rejected') it.verdict = v.verdict;
      if (v.comment) it.comment = String(v.comment).slice(0, 2000);
      lines.push(`${it.id} ${it.verdict}${it.comment ? ` (${it.comment})` : ''}`);
    }
    // Verdicts get their own log entry: the worker's apply pass reads them here too
    if (lines.length) t.log.push({ ts: nowISO(), by: agent || 'human', note: `verdicts: ${lines.join(' · ')}` });
  }
  if (status) {
    if (!TASK_STATUSES.includes(status)) return { error: `bad status; use one of ${TASK_STATUSES.join(', ')}` };
    t.status = status;
    // blocked keeps its assignee but pauses the lease, so it never auto-requeues
    if (status === 'done' || status === 'failed' || status === 'discarded' || status === 'review' || status === 'blocked') t.lease_until = null;
    if (status === 'queued') { t.assignee = null; t.lease_until = null; }
    // Capability links exist exactly while the task sits in review; any transition out consumes them.
    if (status === 'review') t.review_links = makeReviewLinks();
    else delete t.review_links;
    // Same pattern for blocked: an answer link, so the boss can reply from any channel.
    if (status === 'blocked') t.answer_link = { token: crypto.randomBytes(16).toString('hex'), exp: new Date(Date.now() + 7 * 86400_000).toISOString() };
    else delete t.answer_link;
    // Unified reservations: an answer or a send-back returns the mission to its
    // previous holder, who has the context (a lingering builder claims it back
    // within its shift). claimTask lets cowork reservations lapse after a TTL;
    // non-cowork holders (the envoy) keep theirs until they claim.
    if (status === 'queued' && (prevStatus === 'blocked' || prevStatus === 'review') && prevAssignee) {
      t.reserved_for = prevAssignee;
      t.reserved_at = nowISO();
    }
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
    if (l) {
      if (l.approve.token === token) return { task: t, action: 'done', exp: l.approve.exp, kind: 'approve' };
      if (l.sendback.token === token) return { task: t, action: 'queued', exp: l.sendback.exp, kind: 'sendback' };
    }
    if (t.answer_link && t.answer_link.token === token) return { task: t, action: 'queued', exp: t.answer_link.exp, kind: 'answer' };
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
  renameProject, createProject, updateProject, deleteProject, findByViewToken, PROJECT_RE,
  postMessage, getMessages, TASK_STATUSES, ACTIVITIES,
};

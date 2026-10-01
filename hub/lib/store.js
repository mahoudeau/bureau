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
    // A re-registration replaces the capabilities array, and that is how
    // consul lost its lead tag in September 2026: two sessions registered it
    // with an improvised list and nobody could park the librarian's digests
    // for a week (t-356). Replace stays the rule (a role has to be droppable
    // on purpose), but an empty array is ignored and every change is logged
    // with before and after, so the roster's history can be read back.
    if (Array.isArray(capabilities) && capabilities.length) {
      const before = Array.isArray(a.capabilities) ? a.capabilities : [];
      const same = before.length === capabilities.length && before.every(c => capabilities.includes(c));
      if (!same) {
        a.capabilities = capabilities;
        logEvent('agent.capabilities_changed', { name, before, after: capabilities });
      }
    }
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

// Roster curation, not a ban: removing a name clears its roster entry only.
// Missions keep their historical assignee strings and logs untouched (they
// are never rewritten), and the bare name is free to register again later -
// upsertAgent just creates a fresh entry since none matches by name anymore.
// A name holding a live lease is refused so curation can never strand
// claimed work; blocked/review missions hold no lease (see updateTask) so
// only claimed/in_progress count.
function deleteAgent(name) {
  const s = load();
  if (!s.agents.some(a => a.name === name)) return { error: 'not_found' };
  expireLeases(); // a lease that already expired is not "live"
  const held = s.tasks.filter(t => t.assignee === name && (t.status === 'claimed' || t.status === 'in_progress'));
  if (held.length) return { error: `${name} holds a live lease on ${held.map(t => t.id).join(', ')}; release the mission(s) first` };
  s.agents = s.agents.filter(a => a.name !== name);
  save();
  return { removed: true };
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
  // No gate given: the project's default_gate from settings, boss when unset.
  if (gate === undefined || gate === null || gate === '') gate = effectiveSettings(load(), project || 'general').default_gate;
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

// Generic role check (t-119): "the lead" and "the critic" are roles, not
// names, and the roster is exactly where an agent already self-declares
// what it is (kind/capabilities, both free text since register's own
// beginning). An agent holds a role here if it registered with that literal
// tag in its capabilities array - no agent NAME is ever compared, so the
// role can move to a different agent (a new shift, a different session)
// just by that agent registering with the tag, with no hub code change.
// 'human' is not a roster lookup: it is the existing sentinel the review
// capability-link handlers already pass for boss actions (see server.js),
// itself a role word, not an individual's name.
function agentHasCapability(s, agentName, cap) {
  const a = s.agents.find(x => x.name === agentName);
  return !!(a && Array.isArray(a.capabilities) && a.capabilities.includes(cap));
}
// S2: when the boss set roles for an agent in settings, those decide lead and
// critic, and self-registered capabilities no longer count for either. No
// roles in settings: the capability check above, as before.
function agentHasRole(s, agentName, role) {
  const cfg = s.settings && s.settings.agents && s.settings.agents[agentName];
  if (cfg && Array.isArray(cfg.roles)) return cfg.roles.includes(role);
  return agentHasCapability(s, agentName, role);
}
function isLead(s, agentName) { return agentName === 'human' || agentHasRole(s, agentName, 'lead'); }
function isCriticOrLead(s, agentName) { return isLead(s, agentName) || agentHasRole(s, agentName, 'critic'); }

// ---- Settings (S2) ----
// Absent settings mean today's behavior, exactly. Every stricter rule is
// opt-in: approval only bites when the boss set it, globally or per project.
const APPROVALS = ['dashboard', 'in-session', 'critic'];
const GATES = ['boss', 'critic'];
const NOTIFY = ['all', 'review', 'blocked', 'none'];
const ROLES = ['lead', 'critic'];

function settingsOf(s) {
  const st = s.settings || {};
  return { global: st.global || {}, projects: st.projects || {}, agents: st.agents || {} };
}
// Project override wins over global. approval stays undefined when nobody set
// it, which is how the hub tells "dashboard by default" from "dashboard by choice".
function effectiveSettings(s, project) {
  const { global: g, projects } = settingsOf(s);
  const p = projects[project] || {};
  return {
    approval: p.approval ?? g.approval,
    default_gate: p.default_gate ?? g.default_gate ?? 'boss',
    notify: p.notify ?? g.notify ?? 'all',
  };
}

function checkPolicyKeys(obj, where, allowLibrarian) {
  if (!obj || typeof obj !== 'object' || Array.isArray(obj)) return `${where} must be an object`;
  for (const [k, v] of Object.entries(obj)) {
    if (v === null) continue; // null clears the key
    if (k === 'approval') { if (!APPROVALS.includes(v)) return `${where}.approval: use one of ${APPROVALS.join(', ')}`; }
    else if (k === 'default_gate') { if (!GATES.includes(v)) return `${where}.default_gate: use one of ${GATES.join(', ')}`; }
    else if (k === 'notify') { if (!NOTIFY.includes(v)) return `${where}.notify: use one of ${NOTIFY.join(', ')}`; }
    else if (k === 'librarian' && allowLibrarian) {
      if (typeof v !== 'object' || Array.isArray(v)) return `${where}.librarian must be an object`;
      for (const [lk, lv] of Object.entries(v)) {
        if (lk === 'schedule') { if (lv !== null && !/^([01]\d|2[0-3]):[0-5]\d$/.test(String(lv))) return `${where}.librarian.schedule: use HH:MM`; }
        else if (lk === 'gap_missions_per_week') { if (lv !== null && (!Number.isInteger(lv) || lv < 0 || lv > 100)) return `${where}.librarian.gap_missions_per_week: an integer from 0 to 100`; }
        else return `${where}.librarian: unknown key ${lk}`;
      }
    }
    else return `${where}: unknown key ${k}`;
  }
  return null;
}

// Merge a {key: value} patch into target; null deletes the key.
function mergeInto(target, patch) {
  for (const [k, v] of Object.entries(patch)) {
    if (v === null) delete target[k];
    else if (k === 'librarian') { target[k] = { ...(target[k] || {}) }; mergeInto(target[k], v); }
    else target[k] = v;
  }
  return target;
}

// PATCH /api/settings. Merges one level deep: global keys, and each project
// or agent entry key by key. null clears a key or a whole entry. Everything is
// validated before anything is applied.
function patchSettings(patch) {
  const s = load();
  if (!patch || typeof patch !== 'object' || Array.isArray(patch)) return { error: 'settings patch must be an object' };
  for (const k of Object.keys(patch)) if (!['global', 'projects', 'agents'].includes(k)) return { error: `unknown section ${k}; use global, projects, agents` };
  if (patch.global !== undefined) { const e = checkPolicyKeys(patch.global, 'global', true); if (e) return { error: e }; }
  if (patch.projects !== undefined) {
    if (!patch.projects || typeof patch.projects !== 'object' || Array.isArray(patch.projects)) return { error: 'projects must be an object keyed by project id' };
    for (const [pid, v] of Object.entries(patch.projects)) {
      if (!s.projects.some(pj => pj.id === pid)) return { error: `unknown project: ${pid}` };
      if (v === null) continue;
      const e = checkPolicyKeys(v, `projects.${pid}`, false); if (e) return { error: e };
    }
  }
  if (patch.agents !== undefined) {
    if (!patch.agents || typeof patch.agents !== 'object' || Array.isArray(patch.agents)) return { error: 'agents must be an object keyed by agent name' };
    for (const [name, v] of Object.entries(patch.agents)) {
      if (v === null) continue;
      if (typeof v !== 'object' || Array.isArray(v)) return { error: `agents.${name} must be an object` };
      for (const [k, r] of Object.entries(v)) {
        if (k !== 'roles') return { error: `agents.${name}: unknown key ${k}` };
        if (r === null) continue;
        if (!Array.isArray(r) || r.some(x => !ROLES.includes(x))) return { error: `agents.${name}.roles: an array of ${ROLES.join(', ')}` };
      }
    }
  }
  const before = structuredClone(settingsOf(s));
  const next = structuredClone(before);
  if (patch.global) mergeInto(next.global, patch.global);
  for (const sec of ['projects', 'agents']) {
    for (const [id, v] of Object.entries(patch[sec] || {})) {
      if (v === null) { delete next[sec][id]; continue; }
      next[sec][id] = mergeInto(next[sec][id] || {}, v);
      if (!Object.keys(next[sec][id]).length) delete next[sec][id];
    }
  }
  if (next.global.librarian && !Object.keys(next.global.librarian).length) delete next.global.librarian;
  s.settings = next;
  logEvent('settings.changed', { before, after: next });
  // Role changes get their own event, like capability changes (t-356)
  const names = new Set([...Object.keys(before.agents), ...Object.keys(next.agents)]);
  for (const name of names) {
    const b = before.agents[name] && before.agents[name].roles, a = next.agents[name] && next.agents[name].roles;
    if (JSON.stringify(b ?? null) !== JSON.stringify(a ?? null)) logEvent('agent.roles_changed', { name, before: b ?? null, after: a ?? null });
  }
  save();
  return { settings: next, before };
}
// The librarian's own digest (t-356): a mission titled "<name>: ..." by an
// agent registered with the "librarian" tag is a proposal set the boss rules
// item by item. No builder is promoting its own build past a critic, so the
// conflict of interest t-119 guards against does not exist, and the
// librarian may park it into review itself. Both halves are required: the
// title prefix alone would let any worker name a mission after itself.
function isOwnLibrarianDigest(s, t, agentName) {
  return !!agentName && agentName !== 'human'
    && agentHasCapability(s, agentName, 'librarian')
    && typeof t.title === 'string' && t.title.toLowerCase().startsWith(agentName.toLowerCase() + ':');
}

function updateTask({ id, agent, status, note, artifact, lease_minutes, priority, title, body, items, verdicts, gate, approved_in_session }) {
  const s = load();
  const t = s.tasks.find(x => x.id === id);
  if (!t) return { error: 'not_found' };
  const prevStatus = t.status, prevAssignee = t.assignee;
  // S2 approval policy. Settings decide it; with none set, nothing below
  // refuses anything that was allowed before.
  const policy = effectiveSettings(s, t.project).approval;
  let quote = null;
  if (approved_in_session !== undefined && approved_in_session !== null) {
    quote = String(approved_in_session).trim();
    if (!quote) return { error: 'approved_in_session: quote the boss\'s words, it cannot be empty' };
    if (policy !== 'in-session') return { error: `approved_in_session: the ${t.project} project's policy does not accept chat approvals (approval: ${policy || 'not set'}); the boss approves in the dashboard` };
    if (status !== 'done') return { error: 'approved_in_session: only rides a close to done' };
  }
  // Gate changes: anyone may raise to boss; only the boss or the lead set critic.
  if (gate !== undefined) {
    if (gate === 'boss') t.gate = 'boss';
    else if (gate === 'critic' && isLead(s, agent)) t.gate = 'critic';
    else return { error: 'gate: anyone may raise to boss; only the boss or the lead (capabilities: ["lead"]) set critic' };
  }
  // Boss-gate review entry, hub-enforced (t-119, boss ruling 2026-08-16 after
  // t-59 rounds 22-23 reached his door with no critic pass): a mission with
  // gate:boss may be PARKED into review only by an agent authorized to clear
  // boss-gate work - the critic, the lead, or the boss himself. This is what
  // makes "the boss never sees an uncritiqued round" true by construction,
  // not by convention a builder has to remember. Critic-gate missions are
  // unaffected: any agent parks those exactly as before (see the plain
  // `status === 'review'` handling below, unguarded).
  if (status === 'review' && t.status !== 'review' && (t.gate || 'boss') === 'boss' && !isCriticOrLead(s, agent) && !isOwnLibrarianDigest(s, t, agent))
    return { error: 'boss-gate: only the critic, the lead, or the boss may park a gate:boss mission in review (the librarian may park its own digest) - hand this round to the critic instead (or register with capabilities including "critic" or "lead" if that authority is genuinely yours)' };
  // The boss-gate law, hub-enforced: a boss-gate mission in review moves out
  // (done or back to queued) only by the human's hand. Missions without a gate
  // predate the field and are boss-gate by definition.
  // S2 in-session: the boss's quoted words count as his hand, for done only.
  const chatApproved = quote && policy === 'in-session' && status === 'done';
  if ((status === 'done' || status === 'queued') && t.status === 'review' && (t.gate || 'boss') === 'boss' && agent !== 'human' && !chatApproved)
    return { error: 'boss-gate: only the boss moves this mission out of review' };
  // S2 close policy, only when the boss set approval explicitly. dashboard:
  // agents never close boss-gate work done. in-session: they may, quoting
  // the boss. critic: a critic or lead pass closes it. Unset: as before.
  if (status === 'done' && t.status !== 'done' && (t.gate || 'boss') === 'boss' && agent !== 'human' && policy) {
    if (policy === 'dashboard')
      return { error: `approval policy (dashboard) for ${t.project}: only the boss closes a gate:boss mission done; park it in review for him instead` };
    if (policy === 'in-session' && !chatApproved)
      return { error: `approval policy (in-session) for ${t.project}: closing a gate:boss mission done needs approved_in_session with the boss's words, or the boss's own hand in the dashboard` };
    if (policy === 'critic' && !isCriticOrLead(s, agent))
      return { error: `approval policy (critic) for ${t.project}: only the critic, the lead, or the boss closes a gate:boss mission done` };
  }
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
  if (chatApproved) {
    t.log.push({ ts: nowISO(), by: agent || 'unknown', note: `approved by boss in session: "${quote}" (recorded by ${agent || 'unknown'})` });
    logEvent('task.approved_in_session', { id: t.id, project: t.project, approval: 'in-session', channel: 'chat', by: `${agent || 'unknown'} for human`, quote });
  }
  save();
  return { task: t, prev_status: prevStatus };
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
  load, save, logEvent, upsertAgent, heartbeat, deleteAgent, acquireLock,
  createTask, claimTask, updateTask, expireLeases, findByReviewToken,
  renameProject, createProject, updateProject, deleteProject, findByViewToken, PROJECT_RE,
  postMessage, getMessages, TASK_STATUSES, ACTIVITIES,
  patchSettings, settingsOf, effectiveSettings,
};

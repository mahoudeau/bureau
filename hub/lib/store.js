// lib/store.js: JSON state with atomic writes, backups and schema migrations. Zero dependencies.
'use strict';
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const work = require('./work');
const knowledge = require('./knowledge');

const DATA_DIR = process.env.BUREAU_DATA_DIR || path.join(__dirname, '..', 'data');
const STATE_FILE = path.join(DATA_DIR, 'state.json');

const EMPTY = { tasks: [], agents: [], messages: [], log: [], seq: 0, projects: [{ id: 'general', label: 'General' }] };

// ---- Schema migrations ----
// state.json carries schema_version. A file without one is version 0.
// MIGRATIONS[i] takes the state from version i to i+1; they run in order on
// boot, after a copy of the file is kept as state.json.pre-migrate-<ts>.
// Append new migrations at the end, never edit a released one.
const MIGRATIONS = [
  // 0 -> 1: the field itself, plus the top-level keys older files may lack.
  s => { for (const k of Object.keys(EMPTY)) if (s[k] === undefined) s[k] = structuredClone(EMPTY[k]); },
];
const SCHEMA_VERSION = MIGRATIONS.length;

function stamp() { return new Date().toISOString().replace(/[:.]/g, '-'); }

// Refusing to boot is the point: a hub that starts on empty state after a bad
// read looks healthy and quietly loses every mission on its next save.
class StorageError extends Error {}

let state = null;

function readState() {
  let raw;
  try {
    raw = fs.readFileSync(STATE_FILE, 'utf8');
  } catch (e) {
    if (e.code !== 'ENOENT') throw new StorageError(`cannot read ${STATE_FILE}: ${e.message}. Refusing to boot.`);
    // No state file. Fine on a fresh install, suspicious when backups exist.
    const baks = listBackups();
    if (baks.length) throw new StorageError(`${STATE_FILE} is missing but backups exist (${baks.join(', ')}). Refusing to boot on empty state. Copy a backup to state.json, or move the backups away to start fresh.`);
    return { ...structuredClone(EMPTY), schema_version: SCHEMA_VERSION };
  }
  try {
    return JSON.parse(raw);
  } catch (e) {
    // One copy per distinct bad file, so a supervisor restarting the hub in a loop does not fill the disk.
    let kept = null;
    try {
      const same = fs.readdirSync(DATA_DIR).filter(n => n.startsWith(BASE + '.corrupt-'))
        .find(n => fs.readFileSync(path.join(DATA_DIR, n), 'utf8') === raw);
      kept = same ? path.join(DATA_DIR, same) : `${STATE_FILE}.corrupt-${stamp()}`;
      if (!same) fs.copyFileSync(STATE_FILE, kept);
    } catch { kept = null; }
    throw new StorageError(`${STATE_FILE} does not parse (${e.message}). ${kept ? `A copy is kept at ${kept}.` : 'Could not copy it aside.'} Refusing to boot. Restore the newest good backup (state.json.bak.1, then .bak.2, ..., or a state.json.daily-*) over state.json, see UPGRADING.md.`);
  }
}

function migrate(s) {
  const from = Number.isInteger(s.schema_version) ? s.schema_version : 0;
  if (from > SCHEMA_VERSION) throw new StorageError(`${STATE_FILE} has schema_version ${from}, this hub knows up to ${SCHEMA_VERSION}. It was written by a newer Bureau. Upgrade the hub, or restore a state.json.pre-migrate-* backup.`);
  if (from === SCHEMA_VERSION) return s;
  if (fs.existsSync(STATE_FILE)) {
    const pre = `${STATE_FILE}.pre-migrate-${stamp()}`;
    fs.copyFileSync(STATE_FILE, pre);
    console.log(`[store] migrating state from schema ${from} to ${SCHEMA_VERSION}; previous file kept at ${pre}`);
  }
  for (let v = from; v < SCHEMA_VERSION; v++) {
    MIGRATIONS[v](s);
    s.schema_version = v + 1;
  }
  writeNow(s);
  return s;
}

function load() {
  if (state) return state;
  const s = migrate(readState());
  // A fresh hub writes its empty state now: the daily snapshot comes next,
  // and backups with no state.json beside them refuse the next boot, so a
  // hub stopped before its first change could never start again.
  if (!fs.existsSync(STATE_FILE)) writeNow(s);
  state = s;
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

// Atomic write: tmp file, fsync, rename. A crash leaves the old file or the new one.
function writeFileAtomic(file, text) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  const tmp = file + '.tmp';
  const fd = fs.openSync(tmp, 'w');
  try { fs.writeSync(fd, text); fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
  renameRetry(tmp, file);
}
// Windows: an antivirus scan or the search indexer holding the target fails
// the rename for a moment (EPERM, EBUSY, EACCES). Three tries, a short wait
// between, then the error is the caller's.
const RENAME_BUSY = ['EPERM', 'EBUSY', 'EACCES'];
function renameRetry(from, to) {
  for (let i = 1; ; i++) {
    try { return fs.renameSync(from, to); } catch (e) {
      if (i >= 3 || !RENAME_BUSY.includes(e.code)) throw e;
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 50 * i);
    }
  }
}
function writeNow(s) { writeFileAtomic(STATE_FILE, JSON.stringify(s, null, 2)); dirty = false; }

let saveTimer = null;
// A save that failed: the state is still unwritten, retried in a second and
// by the exit flush. A failure is logged, never thrown from the timer (that
// would take the hub down).
let dirty = false;
function save() {
  // Debounced: many mutations in one tick make one write.
  if (saveTimer) return;
  saveTimer = setTimeout(() => {
    saveTimer = null;
    try { writeNow(state); } catch (e) {
      dirty = true;
      console.error(`[store] saving state failed, retrying: ${e.message}`);
      setTimeout(() => { if (dirty) save(); }, 1000).unref();
    }
  }, 100);
}
// Called on exit, so a SIGTERM inside the debounce window loses nothing.
function flush() {
  if (!saveTimer && !dirty) return;
  clearTimeout(saveTimer);
  saveTimer = null;
  if (state) writeNow(state);
}

// ---- Backups ----
// Rolling: state.json.bak.1 (newest) .. bak.N, one per interval (hourly, keep 24).
// Daily: state.json.daily-YYYY-MM-DD, first tick of each UTC day, keep 7.
// Both are written from the in-memory state, so they are always a whole file.
const BACKUP_INTERVAL_MS = +process.env.BUREAU_BACKUP_INTERVAL_MS || 3600_000;
const BACKUP_KEEP = +process.env.BUREAU_BACKUP_KEEP || 24;
const DAILY_KEEP = +process.env.BUREAU_DAILY_KEEP || 7;
const BASE = path.basename(STATE_FILE);

function listBackups() {
  let names = [];
  try { names = fs.readdirSync(DATA_DIR); } catch { return []; }
  return names.filter(n => n.startsWith(BASE + '.bak.') || n.startsWith(BASE + '.daily-')).sort();
}

function rotateBackups() {
  if (!state) return;
  const bak = i => `${STATE_FILE}.bak.${i}`;
  try { fs.unlinkSync(bak(BACKUP_KEEP)); } catch { }
  for (let i = BACKUP_KEEP - 1; i >= 1; i--) {
    try { fs.renameSync(bak(i), bak(i + 1)); } catch { }
  }
  writeFileAtomic(bak(1), JSON.stringify(state, null, 2));
}

function dailySnapshot() {
  if (!state) return;
  const day = new Date().toISOString().slice(0, 10);
  const file = `${STATE_FILE}.daily-${day}`;
  if (!fs.existsSync(file)) writeFileAtomic(file, JSON.stringify(state, null, 2));
  const dailies = listBackups().filter(n => n.startsWith(BASE + '.daily-'));
  for (const n of dailies.slice(0, Math.max(0, dailies.length - DAILY_KEEP))) {
    try { fs.unlinkSync(path.join(DATA_DIR, n)); } catch { }
  }
}

function backupTick() {
  try { rotateBackups(); dailySnapshot(); } catch (e) { console.error('[store] backup failed:', e.message); }
}

// Boot: load and migrate (throws StorageError on bad state), take today's
// snapshot if missing, then start the rolling backups.
function init() {
  load();
  try { dailySnapshot(); } catch (e) { console.error('[store] daily snapshot failed:', e.message); }
  // Work folders of missions that closed while the removal failed, or that
  // no mission owns: gone at boot, like they would have been at the close.
  try {
    const open = id => state.tasks.some(t => t.id === id && !TERMINAL_STATUSES.includes(t.status));
    const gone = work.sweep(open);
    if (gone.length) console.log(`[work] removed leftover evidence of ${gone.join(', ')}`);
  } catch (e) { console.error('[work] boot sweep failed:', e.message); }
  setInterval(backupTick, BACKUP_INTERVAL_MS).unref();
  return { schema_version: state.schema_version };
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
// The owner touches the lock every 30s. A lock untouched for 2 minutes is
// stale even when its pid answers: Windows reuses pids quickly, and a hub
// killed without its exit handler (no SIGTERM there) leaves its lock behind.
const LOCK_FILE = path.join(DATA_DIR, 'hub.lock');
const LOCK_TOUCH_MS = 30_000;
const LOCK_STALE_MS = 120_000;
function acquireLock() {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  try {
    const pid = parseInt(fs.readFileSync(LOCK_FILE, 'utf8'), 10);
    if (pid && pid !== process.pid) {
      let alive = true;
      try { process.kill(pid, 0); } catch (e) { alive = e.code === 'EPERM'; } // EPERM: alive, another user's
      const age = Date.now() - fs.statSync(LOCK_FILE).mtimeMs;
      if (alive && age < LOCK_STALE_MS) return { error: `data dir ${DATA_DIR} is owned by a live hub process (pid ${pid}, see ${LOCK_FILE}); refusing to boot` };
      if (alive) console.log(`[store] taking over stale lock from pid ${pid}: untouched for ${Math.round(age / 1000)}s, so that pid is no hub`);
      else console.log(`[store] taking over stale lock from dead pid ${pid}`);
    }
  } catch { /* no lock file yet */ }
  fs.writeFileSync(LOCK_FILE, String(process.pid));
  const mine = () => parseInt(fs.readFileSync(LOCK_FILE, 'utf8'), 10) === process.pid;
  setInterval(() => { try { if (mine()) { const now = new Date(); fs.utimesSync(LOCK_FILE, now, now); } } catch { } }, LOCK_TOUCH_MS).unref();
  const release = () => { try { if (mine()) fs.unlinkSync(LOCK_FILE); } catch { } };
  process.on('exit', () => { try { flush(); } catch (e) { console.error('[store] final save failed:', e.message); } release(); });
  // SIGBREAK is Ctrl+Break, SIGHUP a closed console window: Windows only. On
  // Unix SIGHUP keeps its default, so nohup still shields the hub.
  const signals = process.platform === 'win32' ? ['SIGINT', 'SIGTERM', 'SIGHUP', 'SIGBREAK'] : ['SIGINT', 'SIGTERM'];
  for (const sig of signals) { try { process.on(sig, () => process.exit(0)); } catch { } }
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
  // S2-c: role tags (lead, critic, librarian, curator) are still stored, but
  // grant nothing while settings hold roles. Say so in the log, so nobody
  // mistakes the tag for authority.
  const ignored = ignoredRoleTags(s, capabilities);
  if (!a) {
    a = { name, kind: kind || 'other', capabilities: capabilities || [], registered_at: nowISO() };
    s.agents.push(a);
    if (ignored) logEvent('agent.capabilities_changed', { name, before: [], after: a.capabilities, note: SETTINGS_ROLES_NOTE });
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
        logEvent('agent.capabilities_changed', { name, before, after: capabilities, ...(ignored ? { note: SETTINGS_ROLES_NOTE } : {}) });
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
// approved (M4): the boss approved a mission parked with after_approval
// "return"; it is back with its holder, who applies the approved items and
// then closes it done. Not terminal (its work folder stays), holds no lease,
// takes no project capacity, and the pool never claims it.
const TASK_STATUSES = ['queued', 'claimed', 'in_progress', 'blocked', 'review', 'approved', 'done', 'failed', 'discarded'];
const TERMINAL_STATUSES = ['done', 'failed', 'discarded'];

// Generic activity vocabulary (docs/protocol.md). The office animates these verbs.
const ACTIVITIES = ['editing', 'reading', 'executing', 'thinking', 'waiting_input', 'waiting_permission', 'blocked', 'idle'];

// Project names become brain paths (projects/<name>/...), so they stay path-safe,
// on Windows too (knowledge.pathError: no CON, no trailing dot). Used as a regex.
const ID_RE = /^[a-zA-Z0-9][a-zA-Z0-9._-]{0,39}$/;
const PROJECT_RE = { test: id => ID_RE.test(id) && !knowledge.pathError(String(id)) };

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
      t.log.push({ ts: nowISO(), by: 'system', note: `lease expired (was ${t.assignee}); back to queue, reserved for ${t.assignee}`, from: t.status, to: 'queued' });
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
  const fromStatus = t.status;
  t.status = 'claimed';
  t.assignee = agent;
  const mins = Number.isFinite(+lease_minutes) ? +lease_minutes : 120;
  t.lease_until = new Date(Date.now() + mins * 60000).toISOString();
  t.log.push({ ts: nowISO(), by: agent, note: `claimed (lease ${mins}m)`, from: fromStatus, to: 'claimed' });
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
// S2-c (boss ruling 2026-10-01): once any agent has roles in settings, every
// role (lead, critic, librarian, curator) comes from settings only, for every
// agent; an agent missing from settings.agents holds none, whatever it
// registered with. No roles set anywhere: the capability check above, as before.
function rolesConfigured(s) {
  const agents = s.settings && s.settings.agents;
  return !!agents && Object.values(agents).some(a => a && Array.isArray(a.roles));
}
function agentHasRole(s, agentName, role) {
  if (!rolesConfigured(s)) return agentHasCapability(s, agentName, role);
  const cfg = s.settings.agents[agentName];
  return !!(cfg && Array.isArray(cfg.roles) && cfg.roles.includes(role));
}
const SETTINGS_ROLES_NOTE = 'settings govern lead, critic, librarian and curator; self-registered tags for those roles grant nothing';
function ignoredRoleTags(s, capabilities) {
  return rolesConfigured(s) && Array.isArray(capabilities) && capabilities.some(c => ROLES.includes(c));
}
function isLead(s, agentName) { return agentName === 'human' || agentHasRole(s, agentName, 'lead'); }
function isCriticOrLead(s, agentName) { return isLead(s, agentName) || agentHasRole(s, agentName, 'critic'); }
// Who writes the curated compartments (knowledge/, recipes/, entity
// PROFILE.md, attic/): the boss, the librarian, or a curator. "curator" is
// the write grant alone, for an agent the boss trusts to file knowledge
// without being the librarian (consul, in pair mode). The librarian holds it
// too, plus parking its own digest (isOwnLibrarianDigest).
function canCurate(s, agentName) {
  return agentName === 'human' || agentHasRole(s, agentName, 'librarian') || agentHasRole(s, agentName, 'curator');
}

// ---- Settings (S2) ----
// Absent settings mean today's behavior, exactly. Every stricter rule is
// opt-in: approval only bites when the boss set it, globally or per project.
const APPROVALS = ['dashboard', 'in-session', 'critic'];
const GATES = ['boss', 'critic'];
const NOTIFY = ['all', 'review', 'blocked', 'none'];
const ROLES = ['lead', 'critic', 'librarian', 'curator'];

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

// isGlobal: the keys only the global section takes (librarian, journal_free_text)
function checkPolicyKeys(obj, where, isGlobal) {
  if (!obj || typeof obj !== 'object' || Array.isArray(obj)) return `${where} must be an object`;
  for (const [k, v] of Object.entries(obj)) {
    if (v === null) continue; // null clears the key
    if (k === 'approval') { if (!APPROVALS.includes(v)) return `${where}.approval: use one of ${APPROVALS.join(', ')}`; }
    else if (k === 'default_gate') { if (!GATES.includes(v)) return `${where}.default_gate: use one of ${GATES.join(', ')}`; }
    else if (k === 'notify') { if (!NOTIFY.includes(v)) return `${where}.notify: use one of ${NOTIFY.join(', ')}`; }
    // The journal free-text window (M2): true or unset keeps it open, false closes it
    else if (k === 'journal_free_text' && isGlobal) { if (typeof v !== 'boolean') return `${where}.journal_free_text: true or false`; }
    else if (k === 'librarian' && isGlobal) {
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
// agent holding the librarian role (settings, else its tag) is a proposal set the boss rules
// item by item. No builder is promoting its own build past a critic, so the
// conflict of interest t-119 guards against does not exist, and the
// librarian may park it into review itself. Both halves are required: the
// title prefix alone would let any worker name a mission after itself.
function isOwnLibrarianDigest(s, t, agentName) {
  return !!agentName && agentName !== 'human'
    && agentHasRole(s, agentName, 'librarian')
    && typeof t.title === 'string' && t.title.toLowerCase().startsWith(agentName.toLowerCase() + ':');
}

// The boss's log entries say what his hand did, so approve, send-back, answer
// and verdict can be told apart when the history is read back.
const HUMAN_KINDS = ['approve', 'send_back', 'answer', 'verdict', 'edit'];
function humanKind(kind, prevStatus, status, verdicts) {
  if (HUMAN_KINDS.includes(kind)) return kind;
  const moved = status && status !== prevStatus;
  if (moved && prevStatus === 'review' && (status === 'done' || status === 'approved')) return 'approve';
  if (moved && prevStatus === 'review' && status === 'queued') return 'send_back';
  if (moved && prevStatus === 'blocked' && status === 'queued') return 'answer';
  if (!moved && Array.isArray(verdicts) && verdicts.length) return 'verdict';
  return 'edit';
}

// ---- Review item payloads (M4: approval pins the text) ----
// An item may carry the exact brain change it proposes: {ops: [{op, file,
// content}]}. The hub hashes it when the item is filed, nothing can change it
// afterwards, and the apply route writes those bytes and no others.
const PAYLOAD_OPS = ['write', 'append'];
// What the boss can rule on an item. later is a decision too: deferred on
// purpose, carried to the librarian's next digest. Only proposed (nobody
// ruled yet) blocks an approval.
const ITEM_VERDICTS = ['approved', 'rejected', 'later'];
// Canonical form: every op is exactly {op, file, content}, in that order, so
// the hash does not depend on how the caller ordered its keys.
function canonicalOps(ops) { return ops.map(o => ({ op: o.op, file: o.file, content: o.content })); }
function payloadHash(ops) { return crypto.createHash('sha256').update(JSON.stringify(canonicalOps(ops))).digest('hex'); }
// The knowledge API's path rules (lib/knowledge.js safePath), checked at
// filing so a bad path is refused before the boss ever sees it. Text only:
// content is a JSON string, and a binary would not survive the trip.
function brainPathError(rel) {
  if (typeof rel !== 'string' || !rel.length) return 'path required';
  const norm = knowledge.normRel(rel);
  const bad = knowledge.pathError(norm);
  if (bad) return bad;
  if (!knowledge.FILE_RE.test(norm)) return knowledge.FILE_TYPES_ERROR;
  if (knowledge.BINARY_RE.test(norm)) return 'text files only; attachments go through POST /api/knowledge';
  return null;
}
function payloadError(payload) {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload) || !Array.isArray(payload.ops) || !payload.ops.length)
    return 'payload must be {"ops": [{"op", "file", "content"}, ...]} with at least one op';
  let bytes = 0;
  for (let i = 0; i < payload.ops.length; i++) {
    const o = payload.ops[i], at = `payload.ops[${i}]`;
    if (!o || typeof o !== 'object' || Array.isArray(o)) return `${at} must be an object {op, file, content}`;
    if (!PAYLOAD_OPS.includes(o.op)) return `${at}.op: use one of ${PAYLOAD_OPS.join(', ')}`;
    if (typeof o.content !== 'string') return `${at}.content must be a string`;
    const e = brainPathError(o.file);
    if (e) return `${at}.file: ${e}`;
    bytes += Buffer.byteLength(o.content);
  }
  // The knowledge API's cap, for the whole payload: it lives in state.json.
  if (bytes > knowledge.MAX_ATTACHMENT) return 'payload too large (5MB cap, as for the knowledge API)';
  return null;
}
// Approved items with a payload that the holder has not applied yet.
function unappliedItems(t) {
  return (t.items || []).filter(it => it.verdict === 'approved' && it.payload && !it.applied_at).map(it => it.id);
}

function updateTask({ id, agent, kind, status, note, artifact, lease_minutes, priority, title, body, items, verdicts, gate, approved_in_session, after_approval }) {
  const s = load();
  const t = s.tasks.find(x => x.id === id);
  if (!t) return { error: 'not_found' };
  // History is written by someone: an update that names no agent is the lease
  // holder's (it is the only one who should be touching the mission), and with
  // no holder there is nobody to credit, so it is refused. A third of the live
  // log had been filed as "unknown" before this.
  if (!agent) {
    if (!t.assignee) return { error: 'agent required: say which agent is acting' };
    agent = t.assignee;
  }
  const prevStatus = t.status, prevAssignee = t.assignee;
  // Every check runs before anything changes, so a refused update leaves the
  // mission exactly as it was (the gate used to be raised before a refusal).
  if (status && !TASK_STATUSES.includes(status)) return { error: `bad status; use one of ${TASK_STATUSES.join(', ')}` };
  // M4. approved is reached only by approving: an explicit request for it is
  // judged below as the approval to done it is, and lands on approved.
  if (status === 'approved') {
    if (prevStatus !== 'review') return { error: 'approved: only a mission in review can be approved' };
    if (t.after_approval !== 'return') return { error: 'approved: only for a mission parked with after_approval "return"; approve it to done instead' };
    status = 'done';
  }
  if (after_approval !== undefined && after_approval !== null) {
    if (after_approval !== 'return') return { error: 'after_approval: the only value is "return"' };
    if (status !== 'review' || prevStatus === 'review') return { error: 'after_approval: rides the PATCH that moves the mission into review' };
  }
  // Leaving approved: the holder (or the boss) closes it done once every
  // approved item with a payload is applied. Only the boss closes it failed
  // or discarded. There is no send-back from here.
  if (prevStatus === 'approved' && status && status !== 'approved') {
    if (status === 'done') {
      if (agent !== 'human' && agent !== t.assignee) return { error: `approved: only its holder (${t.assignee}) or the boss closes ${t.id}` };
      const left = unappliedItems(t);
      if (left.length) return { error: `approved: apply ${left.join(', ')} before closing done (POST /api/tasks/${t.id}/apply)` };
    } else if (!((status === 'failed' || status === 'discarded') && agent === 'human')) {
      return { error: 'approved: its holder applies the approved items and closes it done; only the boss closes it failed or discarded' };
    }
  }
  // Payloads are checked before anything changes, and an item already filed
  // keeps the payload it was hashed with: nothing rewrites it.
  if (Array.isArray(items)) {
    if (prevStatus === 'approved' && items.some(it => it && it.title))
      return { error: `items: ${t.id} is approved; the boss ruled on its items, so file new ones on a new mission` };
    for (const it of items) {
      if (!it || !it.title) continue;
      if (it.payload !== undefined && it.id && (t.items || []).some(x => x.id === it.id))
        return { error: `items: ${it.id} is already filed and its payload is pinned; file a new item instead` };
      if (it.payload !== undefined) {
        const e = payloadError(it.payload);
        if (e) return { error: `items: "${String(it.title).slice(0, 60)}": ${e}` };
        // The boss only ever sees proposals that would pass write-time lint:
        // each op is linted against the brain as it is now. Several ops on
        // one file are each judged against the file on disk, not each other.
        const lint = it.payload.ops.flatMap(o => knowledge.writeLintErrors({ file: o.file, content: o.content, mode: o.op === 'append' ? 'append' : 'replace' }));
        if (lint.length) return { error: `items: "${String(it.title).slice(0, 60)}": the payload would fail brain-lint: ${lint.join('; ')}`, lint };
      }
    }
  }
  if (Array.isArray(verdicts) && t.items) {
    for (const v of verdicts) {
      const it = v && t.items.find(x => x.id === v.id);
      if (it && it.applied_at && v.verdict && v.verdict !== it.verdict)
        return { error: `verdicts: ${it.id} is already applied; its verdict stays ${it.verdict}` };
    }
  }
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
  if (gate !== undefined && gate !== 'boss' && !(gate === 'critic' && isLead(s, agent)))
    return { error: 'gate: anyone may raise to boss; only the boss or the lead (capabilities: ["lead"]) set critic' };
  // The guards below judge the update against the gate it asks for.
  const effGate = (gate !== undefined ? gate : t.gate) || 'boss';
  // Boss-gate review entry, hub-enforced (t-119, boss ruling 2026-08-16 after
  // t-59 rounds 22-23 reached his door with no critic pass): a mission with
  // gate:boss may be PARKED into review only by an agent authorized to clear
  // boss-gate work - the critic, the lead, or the boss himself. This is what
  // makes "the boss never sees an uncritiqued round" true by construction,
  // not by convention a builder has to remember. Critic-gate missions are
  // unaffected: any agent parks those exactly as before (see the plain
  // `status === 'review'` handling below, unguarded).
  if (status === 'review' && t.status !== 'review' && effGate === 'boss' && !isCriticOrLead(s, agent) && !isOwnLibrarianDigest(s, t, agent))
    return { error: 'boss-gate: only the critic, the lead, or the boss may park a gate:boss mission in review (the librarian may park its own digest) - hand this round to the critic instead (or register with capabilities including "critic" or "lead" if that authority is genuinely yours)' };
  // The boss-gate law, hub-enforced: a boss-gate mission in review moves out
  // (done or back to queued) only by the human's hand. Missions without a gate
  // predate the field and are boss-gate by definition.
  // S2 in-session: the boss's quoted words count as his hand, for done only.
  const chatApproved = quote && policy === 'in-session' && status === 'done';
  if ((status === 'done' || status === 'queued') && t.status === 'review' && effGate === 'boss' && agent !== 'human' && !chatApproved)
    return { error: 'boss-gate: only the boss moves this mission out of review' };
  // S2 close policy, only when the boss set approval explicitly. dashboard:
  // agents never close boss-gate work done. in-session: they may, quoting
  // the boss. critic: a critic or lead pass closes it. Unset: as before.
  // An approved mission was approved already: closing it is bookkeeping.
  if (status === 'done' && t.status !== 'done' && t.status !== 'approved' && effGate === 'boss' && agent !== 'human' && policy) {
    if (policy === 'dashboard')
      return { error: `approval policy (dashboard) for ${t.project}: only the boss closes a gate:boss mission done; park it in review for him instead` };
    if (policy === 'in-session' && !chatApproved)
      return { error: `approval policy (in-session) for ${t.project}: closing a gate:boss mission done needs approved_in_session with the boss's words, or the boss's own hand in the dashboard` };
    if (policy === 'critic' && !isCriticOrLead(s, agent))
      return { error: `approval policy (critic) for ${t.project}: only the critic, the lead, or the boss closes a gate:boss mission done` };
  }
  // M4: no approval with undecided items. An approval (out of review, or a
  // close carrying the boss's quoted words) is refused while any item would
  // still read proposed once this request's own verdicts are applied. A
  // question inside a proposal set cannot be closed without an answer.
  const approving = status === 'done' && prevStatus !== 'approved' && (prevStatus === 'review' || !!quote);
  if (approving) {
    const verdictOf = new Map((t.items || []).map(it => [it.id, it.verdict]));
    for (const v of Array.isArray(verdicts) ? verdicts : [])
      if (v && verdictOf.has(v.id) && ITEM_VERDICTS.includes(v.verdict)) verdictOf.set(v.id, v.verdict);
    const open = [...verdictOf].filter(([, v]) => v === 'proposed').map(([iid]) => iid);
    if (Array.isArray(items) && items.some(it => it && it.title)) open.push('the items filed with this request');
    if (open.length) return { error: `undecided items: ${open.join(', ')} still proposed; accept or reject each before approving` };
  }
  // after_approval "return": the approval lands on approved, back with the
  // holder, instead of done.
  if (status === 'done' && prevStatus === 'review' && t.after_approval === 'return') status = 'approved';
  if (gate !== undefined) t.gate = gate;
  // Itemized review: a worker files proposal items; the boss files per-item
  // verdicts (approved/rejected + comment). Verdicts persist on the mission so
  // the next shift reads exactly what was accepted and what needs rework.
  if (Array.isArray(items)) {
    t.items = t.items || [];
    let added = 0;
    for (const it of items) {
      if (!it || !it.title) continue;
      const rec = { id: `i${t.items.length + 1}`, title: String(it.title).slice(0, 200), body: String(it.body || '').slice(0, 20000), verdict: 'proposed', comment: null };
      // Stored whole, never truncated: the hash covers every byte.
      if (it.payload !== undefined) {
        rec.payload = { ops: canonicalOps(it.payload.ops) };
        rec.payload_sha256 = payloadHash(rec.payload.ops);
      }
      t.items.push(rec);
      added++;
    }
    if (added && !note && !status) note = `filed ${added} review item(s)`;
  }
  if (Array.isArray(verdicts) && t.items) {
    const lines = [];
    for (const v of verdicts) {
      const it = t.items.find(x => x.id === v.id);
      if (!it) continue;
      if (ITEM_VERDICTS.includes(v.verdict)) it.verdict = v.verdict;
      if (v.comment) it.comment = String(v.comment).slice(0, 2000);
      lines.push(`${it.id} ${it.verdict}${it.comment ? ` (${it.comment})` : ''}`);
    }
    // Verdicts get their own log entry: the worker's apply pass reads them here too
    if (lines.length) t.log.push({ ts: nowISO(), by: agent, note: `verdicts: ${lines.join(' · ')}`, ...(agent === 'human' ? { kind: 'verdict' } : {}) });
  }
  if (status) {
    t.status = status;
    // blocked keeps its assignee but pauses the lease, so it never auto-requeues
    // approved keeps its assignee too (the holder applies), with no lease
    if (status === 'done' || status === 'failed' || status === 'discarded' || status === 'review' || status === 'blocked' || status === 'approved') t.lease_until = null;
    if (status === 'queued') { t.assignee = null; t.lease_until = null; }
    // Each park decides what its approval does: after_approval "return"
    // sends the approved mission back to its holder instead of to done.
    if (status === 'review' && prevStatus !== 'review') {
      if (after_approval === 'return') t.after_approval = 'return';
      else delete t.after_approval;
    }
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
  if (artifact) t.artifacts.push({ ts: nowISO(), by: agent, ...artifact });
  // A status change is recorded as from/to beside the note, so a PATCH that
  // carries both keeps both (the note used to replace the status line).
  const entry = { ts: nowISO(), by: agent, note: note || (status ? `status → ${status}` : 'updated') };
  if (status && status !== prevStatus) { entry.from = prevStatus; entry.to = status; }
  if (agent === 'human') entry.kind = humanKind(kind, prevStatus, status, verdicts);
  t.log.push(entry);
  if (chatApproved) {
    t.log.push({ ts: nowISO(), by: agent, note: `approved by boss in session: "${quote}" (recorded by ${agent})` });
    logEvent('task.approved_in_session', { id: t.id, project: t.project, approval: 'in-session', channel: 'chat', by: `${agent} for human`, quote });
  }
  save();
  // The work store goes with the mission. Here, not in the routes, so every
  // door that closes a mission (PATCH, MCP, a review link, whatever comes
  // next) cleans up the same way. Best effort: a disk error never undoes the
  // close, and the boot sweep catches what is left.
  if (TERMINAL_STATUSES.includes(t.status)) {
    try { work.removeMission(t.id); } catch (e) { console.error('[work] cleanup failed for', t.id, e.message); }
  }
  return { task: t, prev_status: prevStatus, by: agent };
}

// ---- Apply (M4) ----
// POST /api/tasks/:id/apply. Every check runs before anything is written,
// the hash last: a payload that no longer matches what was filed and
// approved writes nothing. Refusals carry the HTTP code the route answers.
function applyCheck({ id, agent, item }) {
  const t = load().tasks.find(x => x.id === id);
  if (!t) return { code: 404, error: 'not_found' };
  if (!agent) return { code: 400, error: 'agent required: say which agent is applying' };
  if (!item) return { code: 400, error: 'item required: the id of the approved item to apply' };
  if (t.status !== 'approved') return { code: 409, error: `apply: ${t.id} is ${t.status}; only an approved mission applies its items` };
  if (agent !== 'human' && agent !== t.assignee) return { code: 403, error: `apply: only its holder (${t.assignee}) or the boss applies ${t.id}'s items` };
  const it = (t.items || []).find(x => x.id === item);
  if (!it) return { code: 404, error: `apply: ${t.id} has no item ${item}` };
  if (it.verdict !== 'approved') return { code: 409, error: `apply: ${it.id} is ${it.verdict}, not approved` };
  if (!it.payload || !Array.isArray(it.payload.ops) || !it.payload.ops.length) return { code: 409, error: `apply: ${it.id} carries no payload` };
  if (it.applied_at) return { code: 409, error: `apply: ${it.id} was applied at ${it.applied_at} by ${it.applied_by}` };
  const sha = payloadHash(it.payload.ops);
  if (sha !== it.payload_sha256) return { code: 409, error: `apply: ${it.id}'s payload does not match the hash stored when it was filed (${it.payload_sha256}); nothing written` };
  return { task: t, item: it, sha };
}

// writeOp(op) performs one op and returns what the knowledge write returned;
// the caller passes the knowledge route's own write function, so applied text
// meets every rule a plain write meets. Ops run in order. If one is refused,
// the ones before it stay written and are counted (applied_ops), and a retry
// resumes at the refused op, so an append is never written twice.
function applyItem({ id, agent, item }, writeOp) {
  const pre = applyCheck({ id, agent, item });
  if (pre.error) return pre;
  const { task: t, item: it, sha } = pre;
  const ops = it.payload.ops, n = ops.length;
  let commit = null;
  for (let i = it.applied_ops || 0; i < n; i++) {
    let r;
    try {
      r = writeOp(ops[i], sha);
    } catch (e) {
      const kept = i ? `ops 1 to ${i} are written; a retry resumes at op ${i + 1}` : 'nothing written';
      t.log.push({ ts: nowISO(), by: agent, note: `apply ${it.id} refused at op ${i + 1} of ${n} (${ops[i].op} ${ops[i].file}): ${e.message}; ${kept}` });
      save();
      const code = Number.isInteger(e.status) ? e.status : Number.isInteger(e.statusCode) ? e.statusCode : 500;
      return { code, error: `apply ${it.id}: op ${i + 1} of ${n} (${ops[i].op} ${ops[i].file}) refused: ${e.message}; ${kept}` };
    }
    it.applied_ops = i + 1;
    if (r && r.commit) commit = r.commit;
    save();
  }
  delete it.applied_ops;
  it.applied_at = nowISO();
  it.applied_by = agent;
  it.commit = commit;
  it.payload_sha256 = sha;
  t.log.push({ ts: nowISO(), by: agent, note: `applied ${it.id}: ${ops.map(o => `${o.op} ${o.file}`).join(', ')} (sha256 ${sha.slice(0, 12)}${commit ? `, commit ${commit}` : ''})` });
  save();
  return { task: t, item: it };
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
  load, save, flush, init, logEvent, upsertAgent, heartbeat, deleteAgent, acquireLock,
  StorageError, SCHEMA_VERSION, STATE_FILE,
  createTask, claimTask, updateTask, expireLeases, findByReviewToken, applyCheck, applyItem, payloadHash,
  renameProject, createProject, updateProject, deleteProject, findByViewToken, PROJECT_RE,
  postMessage, getMessages, TASK_STATUSES, TERMINAL_STATUSES, ACTIVITIES,
  patchSettings, settingsOf, effectiveSettings, rolesConfigured, ignoredRoleTags, canCurate, SETTINGS_ROLES_NOTE,
};

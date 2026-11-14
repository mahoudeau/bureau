// lib/sqlite-store.js: the hub's state in SQLite, when BUREAU_STORE=sqlite.
// The hub still works from memory, as with state.json. This is what sits
// under it: one transaction per save, and a save writes only the rows that
// changed. Uses Node's built-in node:sqlite, so still no dependency.
//
// Tables:
//   tasks         one row per mission. Real columns for queries (status,
//                 project, assignee, created_at, claimed_at, closed_at,
//                 send_backs); doc is the whole record, so nothing is lost.
//   agents, messages, projects, sessions, oauth_apps, agent_tokens
//                 one row per record, keyed by its id (agents: its name).
//   events        the event log (state.log), append-only, capped like the
//                 log in memory. A save inserts the new events only.
//   meta          every other top-level key (seq, schema_version, settings,
//                 mcp_token, anything a later version adds), one row each.
//                 Keys starting with _ are the store's own: the hub's
//                 identity and the order of the state's keys.
//   backup_runs   one row per nightly off-server backup (lib/backup.js).
//   backup_checks one row per check of a copy made on the Mac (bureau backup
//                 verify). Neither is part of the state: a save never
//                 touches them.
//
// Arrays come back in the order their rows were first written (rowid), which
// is the order the hub appends in. Projects are sorted at load anyway.
'use strict';
const fs = require('fs');
const crypto = require('crypto');

const TABLES = { tasks: 'id', agents: 'name', messages: 'id', projects: 'id', sessions: 'id', oauth_apps: 'id', agent_tokens: 'id' };
const CLOSED = ['done', 'failed', 'discarded'];

const SCHEMA = `
  CREATE TABLE IF NOT EXISTS meta(key TEXT PRIMARY KEY, doc TEXT NOT NULL);
  CREATE TABLE IF NOT EXISTS tasks(id TEXT PRIMARY KEY, status TEXT, project TEXT, assignee TEXT, created_at TEXT, claimed_at TEXT, closed_at TEXT, send_backs INTEGER, doc TEXT NOT NULL);
  CREATE INDEX IF NOT EXISTS tasks_status ON tasks(status);
  CREATE INDEX IF NOT EXISTS tasks_project ON tasks(project);
  CREATE INDEX IF NOT EXISTS tasks_closed ON tasks(closed_at);
  CREATE TABLE IF NOT EXISTS agents(name TEXT PRIMARY KEY, doc TEXT NOT NULL);
  CREATE TABLE IF NOT EXISTS messages(id TEXT PRIMARY KEY, doc TEXT NOT NULL);
  CREATE TABLE IF NOT EXISTS projects(id TEXT PRIMARY KEY, doc TEXT NOT NULL);
  CREATE TABLE IF NOT EXISTS sessions(id TEXT PRIMARY KEY, doc TEXT NOT NULL);
  CREATE TABLE IF NOT EXISTS oauth_apps(id TEXT PRIMARY KEY, doc TEXT NOT NULL);
  CREATE TABLE IF NOT EXISTS agent_tokens(id TEXT PRIMARY KEY, doc TEXT NOT NULL);
  CREATE TABLE IF NOT EXISTS events(seq INTEGER PRIMARY KEY AUTOINCREMENT, ts TEXT, type TEXT, doc TEXT NOT NULL);
  CREATE TABLE IF NOT EXISTS backup_runs(id INTEGER PRIMARY KEY AUTOINCREMENT, started_at TEXT NOT NULL, finished_at TEXT, ok INTEGER, offsite INTEGER, verified INTEGER, detail TEXT);
  CREATE TABLE IF NOT EXISTS backup_checks(id INTEGER PRIMARY KEY AUTOINCREMENT, checked_at TEXT NOT NULL, ok INTEGER NOT NULL, file TEXT, detail TEXT, by TEXT);
`;

function sqlite() {
  try { return require('node:sqlite'); }
  catch { throw new Error(`BUREAU_STORE=sqlite needs Node 22.13 or newer (this is ${process.version})`); }
}

let db = null;
let st = null; // prepared statements, made once at open
// What the database holds, as JSON text per key, so a save can skip what did
// not change. lastEvent is the newest log entry already written.
let seen = null;
let lastEvent = null;

function resetCache() {
  seen = { meta: new Map() };
  for (const t of Object.keys(TABLES)) seen[t] = new Map();
  lastEvent = null;
}

function prepare() {
  st = { upsert: {}, del: {}, all: {} };
  st.metaAll = db.prepare('SELECT key, doc FROM meta');
  st.metaGet = db.prepare('SELECT doc FROM meta WHERE key = ?');
  st.metaPut = db.prepare('INSERT INTO meta(key, doc) VALUES(?, ?) ON CONFLICT(key) DO UPDATE SET doc = excluded.doc');
  st.metaDel = db.prepare('DELETE FROM meta WHERE key = ?');
  for (const [table, key] of Object.entries(TABLES)) {
    st.all[table] = db.prepare(`SELECT doc FROM ${table} ORDER BY rowid`);
    st.del[table] = db.prepare(`DELETE FROM ${table} WHERE ${key} = ?`);
    st.upsert[table] = table === 'tasks'
      ? db.prepare('INSERT INTO tasks(id, status, project, assignee, created_at, claimed_at, closed_at, send_backs, doc) VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT(id) DO UPDATE SET status = excluded.status, project = excluded.project, assignee = excluded.assignee, created_at = excluded.created_at, claimed_at = excluded.claimed_at, closed_at = excluded.closed_at, send_backs = excluded.send_backs, doc = excluded.doc')
      : db.prepare(`INSERT INTO ${table}(${key}, doc) VALUES(?, ?) ON CONFLICT(${key}) DO UPDATE SET doc = excluded.doc`);
  }
  st.eventsAll = db.prepare('SELECT doc FROM events ORDER BY seq');
  st.eventAdd = db.prepare('INSERT INTO events(ts, type, doc) VALUES(?, ?, ?)');
  st.eventsTrim = db.prepare('DELETE FROM events WHERE seq <= ?');
  st.eventsClear = db.prepare('DELETE FROM events');
}

// file: the database. readOnly: for the tools, which only read.
function open(file, { readOnly = false } = {}) {
  const { DatabaseSync } = sqlite();
  close();
  db = new DatabaseSync(file, readOnly ? { readOnly: true } : {});
  if (!readOnly) db.exec(`PRAGMA journal_mode = WAL; PRAGMA synchronous = NORMAL; PRAGMA busy_timeout = 5000; ${SCHEMA}`);
  else db.exec('PRAGMA busy_timeout = 5000');
  prepare();
  resetCache();
}

function close() {
  if (db) { try { db.close(); } catch { /* already closed */ } }
  db = null; st = null;
}

function metaValue(key) {
  const r = st.metaGet.get(key);
  return r ? JSON.parse(r.doc) : null;
}

// ---- Identity: one database, one hub ----
// Recorded once, when the database is created: a random hub_id (or
// BUREAU_HUB_ID) and the public URL when it is set. At every boot the
// configured values must match, so a wrong path or a swapped volume can never
// open another hub's data. Returns { error } when they do not.
const normUrl = (u) => (u ? String(u).trim().replace(/\/+$/, '') : null);
function identity() {
  return { hub_id: metaValue('_hub_id'), public_url: metaValue('_public_url'), created_at: metaValue('_created_at') };
}
function claimIdentity({ hubId, publicUrl } = {}) {
  const want = { hub_id: hubId ? String(hubId).trim() : null, public_url: normUrl(publicUrl) };
  const have = identity();
  if (!have.hub_id) {
    const id = want.hub_id || `hub-${crypto.randomBytes(8).toString('hex')}`;
    st.metaPut.run('_hub_id', JSON.stringify(id));
    st.metaPut.run('_public_url', JSON.stringify(want.public_url));
    st.metaPut.run('_created_at', JSON.stringify(new Date().toISOString()));
    return { hub_id: id, created: true };
  }
  if (want.hub_id && want.hub_id !== have.hub_id)
    return { error: `this database belongs to hub ${have.hub_id}, but BUREAU_HUB_ID is ${want.hub_id}. Refusing to boot on another hub's data. Check BUREAU_DATA_DIR and the volume it points at.` };
  if (want.public_url && have.public_url && want.public_url !== have.public_url)
    return { error: `this database belongs to the hub at ${have.public_url}, but BUREAU_PUBLIC_URL is ${want.public_url}. Refusing to boot on another hub's data. If this hub really moved, run: node hub/tools/hub-identity.js <data-dir> --public-url ${want.public_url}` };
  // A URL set for the first time is recorded, so it is checked from now on.
  if (want.public_url && !have.public_url) st.metaPut.run('_public_url', JSON.stringify(want.public_url));
  return { hub_id: have.hub_id };
}
function setPublicUrl(url) { st.metaPut.run('_public_url', JSON.stringify(normUrl(url))); }

// ---- Load ----
// The whole state, or null when the database holds none yet.
function load() {
  const metaRows = st.metaAll.all();
  if (!metaRows.some((r) => r.key === 'schema_version')) return null;
  const parts = {};
  let keys = null;
  for (const r of metaRows) {
    if (r.key === '_keys') { keys = JSON.parse(r.doc); seen.meta.set(r.key, r.doc); continue; }
    if (r.key.startsWith('_')) continue;
    parts[r.key] = JSON.parse(r.doc);
    seen.meta.set(r.key, r.doc);
  }
  for (const [table, key] of Object.entries(TABLES)) {
    const rows = st.all[table].all();
    const list = [];
    for (const r of rows) {
      const item = JSON.parse(r.doc);
      list.push(item);
      seen[table].set(item[key], r.doc);
    }
    parts[table] = list;
  }
  parts.log = st.eventsAll.all().map((r) => JSON.parse(r.doc));
  lastEvent = parts.log.length ? parts.log[parts.log.length - 1] : null;
  // The state's keys in the order they were saved. A table key the state never
  // had stays out, unless rows turned up for it.
  const s = {};
  const order = keys || Object.keys(parts);
  for (const k of order) if (k in parts) s[k] = parts[k];
  for (const k of Object.keys(parts)) {
    if (k in s) continue;
    if (k in TABLES && !parts[k].length && keys) continue;
    s[k] = parts[k];
  }
  return s;
}

// ---- Save ----
function taskColumns(t) {
  const log = Array.isArray(t.log) ? t.log : [];
  const claimed = log.find((l) => l && l.to === 'claimed');
  const closed = CLOSED.includes(t.status) ? [...log].reverse().find((l) => l && CLOSED.includes(l.to)) : null;
  return [t.status ?? null, t.project ?? null, t.assignee ?? null, t.created_at ?? null, claimed ? claimed.ts : null, closed ? closed.ts : null, log.filter((l) => l && l.kind === 'send_back').length];
}

// One transaction. Only what changed is written, what is gone is deleted.
// scopes: a Set of the table names to look at (plus "log"); null looks at
// everything. Meta is always looked at: it is a handful of small rows. The
// cache is updated only once the transaction has committed, so a failed save
// is tried again in full.
function save(state, scopes = null) {
  const after = [];
  let nextLast = lastEvent;
  db.exec('BEGIN IMMEDIATE');
  try {
    for (const [table, key] of Object.entries(TABLES)) {
      if (scopes && !scopes.has(table)) continue;
      const cache = seen[table];
      const live = new Set();
      const list = Array.isArray(state[table]) ? state[table] : [];
      for (const item of list) {
        const id = item ? item[key] : undefined;
        if (typeof id !== 'string' || !id) throw new Error(`a record in ${table} has no ${key}`);
        if (live.has(id)) throw new Error(`two records in ${table} share the ${key} ${id}`);
        live.add(id);
        const doc = JSON.stringify(item);
        if (cache.get(id) === doc) continue;
        if (table === 'tasks') st.upsert.tasks.run(id, ...taskColumns(item), doc);
        else st.upsert[table].run(id, doc);
        after.push([cache, id, doc]);
      }
      for (const id of cache.keys()) {
        if (live.has(id)) continue;
        st.del[table].run(id);
        after.push([cache, id, undefined]);
      }
    }
    if (!scopes || scopes.has('log')) nextLast = saveEvents(Array.isArray(state.log) ? state.log : []);
    const keys = Object.keys(state);
    const metaKeys = new Set();
    for (const k of keys) {
      if (k in TABLES || k === 'log' || k.startsWith('_')) continue;
      const doc = JSON.stringify(state[k]);
      if (doc === undefined) continue;
      metaKeys.add(k);
      if (seen.meta.get(k) === doc) continue;
      st.metaPut.run(k, doc);
      after.push([seen.meta, k, doc]);
    }
    for (const k of seen.meta.keys()) {
      if (metaKeys.has(k) || k.startsWith('_')) continue;
      st.metaDel.run(k);
      after.push([seen.meta, k, undefined]);
    }
    const order = JSON.stringify(keys);
    if (seen.meta.get('_keys') !== order) { st.metaPut.run('_keys', order); after.push([seen.meta, '_keys', order]); }
    db.exec('COMMIT');
  } catch (e) {
    try { db.exec('ROLLBACK'); } catch { /* nothing to roll back */ }
    throw e;
  }
  for (const [cache, k, doc] of after) { if (doc === undefined) cache.delete(k); else cache.set(k, doc); }
  lastEvent = nextLast;
}
// The log only grows at its end and loses entries at its start. New entries
// are the ones after the last one written; anything else (the newest written
// entry is gone, say) rewrites the table. Returns the new newest entry.
function saveEvents(log) {
  let from = 0;
  if (lastEvent) {
    const i = log.lastIndexOf(lastEvent);
    if (i >= 0) from = i + 1;
    else st.eventsClear.run();
  } else st.eventsClear.run();
  let lastSeq = null;
  for (let i = from; i < log.length; i++) {
    const e = log[i];
    lastSeq = st.eventAdd.run(e && e.ts != null ? String(e.ts) : null, e && e.type != null ? String(e.type) : null, JSON.stringify(e)).lastInsertRowid;
  }
  // Keep exactly as many rows as the log in memory holds.
  if (lastSeq !== null) st.eventsTrim.run(Number(lastSeq) - log.length);
  return log.length ? log[log.length - 1] : null;
}

// ---- Backups ----
// A consistent copy of the live database, taken with VACUUM INTO (safe while
// the hub writes), then opened and run through PRAGMA quick_check. A copy that
// fails the check is deleted and the error thrown. check is for the tests.
function verify(file) {
  const { DatabaseSync } = sqlite();
  let c = null;
  try {
    c = new DatabaseSync(file, { readOnly: true });
    const res = c.prepare('PRAGMA quick_check').all().map((r) => Object.values(r)[0]);
    if (res.length !== 1 || res[0] !== 'ok') return `quick_check: ${res.join('; ').slice(0, 300)}`;
    if (!c.prepare("SELECT doc FROM meta WHERE key = 'schema_version'").get()) return 'no state in the copy';
    return null;
  } catch (e) {
    return e.message;
  } finally {
    if (c) try { c.close(); } catch { /* closed */ }
  }
}
// The full check, for the copy that leaves the server: PRAGMA integrity_check
// reads every page and index. Slower than quick_check, once a night.
function integrity(file) {
  const { DatabaseSync } = sqlite();
  let c = null;
  try {
    c = new DatabaseSync(file, { readOnly: true });
    const res = c.prepare('PRAGMA integrity_check').all().map((r) => Object.values(r)[0]);
    if (res.length !== 1 || res[0] !== 'ok') return `integrity_check: ${res.join('; ').slice(0, 300)}`;
    if (!c.prepare("SELECT doc FROM meta WHERE key = 'schema_version'").get()) return 'no state in the copy';
    return null;
  } catch (e) {
    return e.message;
  } finally {
    if (c) try { c.close(); } catch { /* closed */ }
  }
}
function copyTo(target, check = verify) {
  try { fs.unlinkSync(target); } catch { /* not there */ }
  db.prepare('VACUUM INTO ?').run(target);
  const problem = check(target);
  if (problem) {
    try { fs.unlinkSync(target); } catch { /* gone */ }
    throw new Error(`the copy ${target} failed its check (${problem}) and was deleted`);
  }
  if (process.platform !== 'win32') { try { fs.chmodSync(target, 0o600); } catch { /* best effort */ } }
}

// The state in a database file, read without writing anything. For the tools
// and the tests. null when it holds none.
function readFile(file) {
  if (!fs.existsSync(file)) return null;
  const was = db;
  if (was) throw new Error('readFile: another database is open in this process');
  try {
    open(file, { readOnly: true });
    return load();
  } finally { close(); }
}

// ---- The off-server backup's record (lib/backup.js) ----
// Prepared on first use: a tool opening an older database read-only must not
// trip over tables it never asks for.
function bst(name, sqlText) {
  if (!st.backup) st.backup = {};
  if (!st.backup[name]) st.backup[name] = db.prepare(sqlText);
  return st.backup[name];
}
const bool = (v) => (v === null || v === undefined ? null : v ? 1 : 0);
const backupRuns = {
  start(at) { return Number(bst('start', 'INSERT INTO backup_runs(started_at) VALUES(?)').run(at).lastInsertRowid); },
  finish(id, { at, ok, offsite, verified, detail }) {
    bst('finish', 'UPDATE backup_runs SET finished_at = ?, ok = ?, offsite = ?, verified = ?, detail = ? WHERE id = ?').run(at, bool(ok), bool(offsite), bool(verified), detail || '', id);
  },
  get(id) { return bst('get', 'SELECT * FROM backup_runs WHERE id = ?').get(id) || null; },
  recent(n = 20) { return bst('recent', 'SELECT * FROM backup_runs ORDER BY id DESC LIMIT ?').all(n); },
  first() { return bst('first', 'SELECT * FROM backup_runs ORDER BY id LIMIT 1').get() || null; },
  lastOk() { return bst('lastOk', 'SELECT * FROM backup_runs WHERE ok = 1 ORDER BY id DESC LIMIT 1').get() || null; },
};
const backupChecks = {
  add({ at, ok, file, detail, by }) {
    return Number(bst('checkAdd', 'INSERT INTO backup_checks(checked_at, ok, file, detail, by) VALUES(?, ?, ?, ?, ?)').run(at, ok ? 1 : 0, file || null, detail || '', by || null).lastInsertRowid);
  },
  recent(n = 10) { return bst('checkRecent', 'SELECT * FROM backup_checks ORDER BY id DESC LIMIT ?').all(n); },
  lastOk() { return bst('checkLastOk', 'SELECT * FROM backup_checks WHERE ok = 1 ORDER BY id DESC LIMIT 1').get() || null; },
};

// Throws the plain message when this Node has no node:sqlite.
function requireNode() { sqlite(); }

module.exports = { requireNode, open, close, load, save, identity, claimIdentity, setPublicUrl, copyTo, verify, integrity, readFile, backupRuns, backupChecks, TABLES };

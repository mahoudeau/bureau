// lib/sqlite-store.js: hub state in SQLite, when BUREAU_STORE=sqlite. The hub
// still works from memory, as with state.json. This replaces the file under it:
// atomic transactions, and a save writes only the rows that changed. Real
// columns (status, project, claimed_at, closed_at, send_backs) are there for
// queries; `doc` is the whole record, so nothing is lost in the mapping.
// Uses Node's built-in node:sqlite, so still no dependency.
'use strict';

const TABLES = { tasks: 'id', agents: 'name', messages: 'id', projects: 'id' };
const CLOSED = ['done', 'failed', 'discarded'];

let db = null;
const seen = { tasks: new Map(), agents: new Map(), messages: new Map(), projects: new Map(), meta: new Map() };

function taskColumns(t) {
  const log = t.log || [];
  const claimed = log.find((l) => l.to === 'claimed' || /^claimed/.test(l.note || ''));
  const closed = [...log].reverse().find((l) => CLOSED.includes(l.to));
  return [t.status || null, t.project || null, t.assignee || null, t.created_at || null, claimed ? claimed.ts : null, closed ? closed.ts : null, log.filter((l) => l.kind === 'send_back').length];
}

function open(file) {
  let DatabaseSync;
  try { ({ DatabaseSync } = require('node:sqlite')); }
  catch { throw new Error(`BUREAU_STORE=sqlite needs Node 22.13 or newer (this is ${process.version})`); }
  db = new DatabaseSync(file);
  db.exec(`PRAGMA journal_mode=WAL; PRAGMA synchronous=NORMAL;
    CREATE TABLE IF NOT EXISTS meta(key TEXT PRIMARY KEY, doc TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS tasks(id TEXT PRIMARY KEY, status TEXT, project TEXT, assignee TEXT, created_at TEXT, claimed_at TEXT, closed_at TEXT, send_backs INTEGER, doc TEXT NOT NULL);
    CREATE INDEX IF NOT EXISTS tasks_status ON tasks(status);
    CREATE INDEX IF NOT EXISTS tasks_project ON tasks(project);
    CREATE INDEX IF NOT EXISTS tasks_closed ON tasks(closed_at);
    CREATE TABLE IF NOT EXISTS agents(name TEXT PRIMARY KEY, doc TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS messages(id TEXT PRIMARY KEY, doc TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS projects(id TEXT PRIMARY KEY, doc TEXT NOT NULL);`);
}

// The whole state, or null when the database holds none yet.
function load() {
  const metaRows = db.prepare('SELECT key, doc FROM meta').all();
  if (!metaRows.some((r) => r.key === 'schema_version')) return null;
  const s = {};
  for (const r of metaRows) { s[r.key] = JSON.parse(r.doc); seen.meta.set(r.key, r.doc); }
  for (const [table, key] of Object.entries(TABLES)) {
    s[table] = [];
    for (const r of db.prepare(`SELECT doc FROM ${table} ORDER BY rowid`).all()) {
      const item = JSON.parse(r.doc);
      s[table].push(item);
      seen[table].set(item[key], r.doc);
    }
  }
  return s;
}

// One transaction: only what changed is written, what is gone is deleted.
function save(state) {
  db.exec('BEGIN IMMEDIATE');
  try {
    for (const [table, key] of Object.entries(TABLES)) {
      const live = new Set();
      for (const item of state[table] || []) {
        const id = item[key];
        live.add(id);
        const doc = JSON.stringify(item);
        if (seen[table].get(id) === doc) continue;
        if (table === 'tasks') db.prepare('INSERT INTO tasks(id,status,project,assignee,created_at,claimed_at,closed_at,send_backs,doc) VALUES(?,?,?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET status=excluded.status,project=excluded.project,assignee=excluded.assignee,created_at=excluded.created_at,claimed_at=excluded.claimed_at,closed_at=excluded.closed_at,send_backs=excluded.send_backs,doc=excluded.doc').run(id, ...taskColumns(item), doc);
        else db.prepare(`INSERT INTO ${table}(${key},doc) VALUES(?,?) ON CONFLICT(${key}) DO UPDATE SET doc=excluded.doc`).run(id, doc);
        seen[table].set(id, doc);
      }
      for (const id of [...seen[table].keys()]) {
        if (live.has(id)) continue;
        db.prepare(`DELETE FROM ${table} WHERE ${key}=?`).run(id);
        seen[table].delete(id);
      }
    }
    for (const [k, v] of Object.entries(state)) {
      if (k in TABLES) continue;
      const doc = JSON.stringify(v);
      if (seen.meta.get(k) === doc) continue;
      db.prepare('INSERT INTO meta(key,doc) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET doc=excluded.doc').run(k, doc);
      seen.meta.set(k, doc);
    }
    db.exec('COMMIT');
  } catch (e) {
    db.exec('ROLLBACK');
    throw e;
  }
}

function close() { if (db) { db.close(); db = null; } }

module.exports = { open, load, save, close };

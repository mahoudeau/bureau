#!/usr/bin/env node
// hub/tools/state-export.js: the way back from SQLite. Writes a hub's whole
// state, from its bureau.db, out as a state.json, every key included. Then the
// hub runs on the file store again: remove BUREAU_STORE=sqlite and start it.
// Read-only on the database, so it is safe while the hub runs, but stop the
// hub first when going back, or the last minutes of work stay in the database.
//
//   node hub/tools/state-export.js <data-dir> [output-file]
//
// The output defaults to <data-dir>/state.json and is never overwritten. The
// data dir may also be a backup file (bureau.db.bak.1, bureau.db.daily-*).
'use strict';
const fs = require('fs');
const path = require('path');

function main() {
  const from = process.argv[2];
  if (!from) throw new Error('usage: node hub/tools/state-export.js <data-dir or .db file> [output-file]');
  const isDir = fs.existsSync(from) && fs.statSync(from).isDirectory();
  const db = isDir ? path.join(from, 'bureau.db') : from;
  if (!fs.existsSync(db)) throw new Error(`no database at ${db}`);
  const out = process.argv[3] || path.join(isDir ? from : path.dirname(from), 'state.json');
  if (fs.existsSync(out)) throw new Error(`${out} already exists; move it aside first`);
  const state = require('../lib/sqlite-store').readFile(db);
  if (!state) throw new Error(`${db} holds no state`);
  fs.writeFileSync(out, JSON.stringify(state, null, 2), { mode: 0o600 });
  console.log(`Wrote ${out}: ${(state.tasks || []).length} missions, ${(state.agents || []).length} agents, ${(state.messages || []).length} messages, ${(state.log || []).length} events.`);
}
try { main(); } catch (e) { console.error(`state-export: ${e.message}`); process.exit(1); }

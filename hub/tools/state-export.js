#!/usr/bin/env node
// state-export: write a hub's SQLite state back out as a state.json, for going
// back to the file store or reading the state without SQLite tools. Stop the
// hub first. Licensed Apache-2.0 (LICENSE-APACHE at the repo root).
//
// Usage: node hub/tools/state-export.js <data-dir> [output-file]
// The output defaults to <data-dir>/state.json and is never overwritten.
'use strict';
const fs = require('fs');
const path = require('path');
const sql = require('../lib/sqlite-store');

const dir = process.argv[2];
if (!dir) { console.error('usage: state-export <data-dir> [output-file]'); process.exit(2); }
const db = path.join(dir, 'bureau.db');
if (!fs.existsSync(db)) { console.error(`no database at ${db}`); process.exit(1); }
const out = process.argv[3] || path.join(dir, 'state.json');
if (fs.existsSync(out)) { console.error(`${out} already exists; move it aside first`); process.exit(1); }
sql.open(db);
const state = sql.load();
sql.close();
if (!state) { console.error('the database holds no state'); process.exit(1); }
fs.writeFileSync(out, JSON.stringify(state, null, 2));
console.log(`wrote ${out}: ${state.tasks.length} missions, ${state.agents.length} agents, ${state.messages.length} messages`);

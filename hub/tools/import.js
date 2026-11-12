#!/usr/bin/env node
// hub/tools/import.js: start a hub from a folder written by export.js
// (doc 30, B5). Run it with the hub stopped, on a hub with no data yet:
//
//   node hub/tools/import.js <folder>
//
// It writes state.json into the data dir and clones brain.bundle into the
// brain dir. It refuses a hub that already has state or a brain, a hub that is
// running (its lock is live), and an export from a newer Bureau. Then start the
// hub: it migrates the state if the export came from an older schema. On the
// new hub: pair it again (node hub/tools/omako.js pair), turn agents' sign-in
// back on if the address changed, and allow the apps again.
'use strict';
require('../lib/env').load();
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const DATA = process.env.BUREAU_DATA_DIR || path.join(__dirname, '..', 'data');
const BRAIN = process.env.BUREAU_BRAIN_DIR || path.join(__dirname, '..', 'brain');

function lockIsLive() {
  try {
    const pid = Number(fs.readFileSync(path.join(DATA, 'hub.lock'), 'utf8').trim());
    const age = Date.now() - fs.statSync(path.join(DATA, 'hub.lock')).mtimeMs;
    if (!pid || age > 120_000) return false;
    process.kill(pid, 0);
    return true;
  } catch { return false; }
}

function main() {
  const from = process.argv[2];
  if (!from) throw new Error('usage: node hub/tools/import.js <folder>');
  const manifest = JSON.parse(fs.readFileSync(path.join(from, 'manifest.json'), 'utf8'));
  if (manifest.kind !== 'bureau-hub-export') throw new Error(`${from} is not a Bureau export`);
  const { SCHEMA_VERSION } = require('../lib/store');
  if ((manifest.schema_version || 0) > SCHEMA_VERSION) throw new Error(`the export has schema ${manifest.schema_version}; this hub knows up to ${SCHEMA_VERSION}. Upgrade this hub first`);
  if (lockIsLive()) throw new Error('the hub is running: stop it first');
  if (fs.existsSync(path.join(DATA, 'state.json'))) throw new Error(`${DATA} already holds a state.json: import only into a fresh hub`);
  if (fs.existsSync(BRAIN) && fs.readdirSync(BRAIN).length) throw new Error(`${BRAIN} is not empty: import only into a fresh hub`);

  fs.mkdirSync(DATA, { recursive: true, mode: 0o700 });
  const state = fs.readFileSync(path.join(from, 'state.json'), 'utf8');
  JSON.parse(state); // refuse a broken file before writing anything
  fs.writeFileSync(path.join(DATA, 'state.json'), state, { mode: 0o600 });
  if (manifest.brain === 'brain.bundle') {
    execFileSync('git', ['clone', '--quiet', path.resolve(from, 'brain.bundle'), BRAIN], { stdio: ['ignore', 'ignore', 'pipe'] });
    // The bundle is not a place to push back to.
    execFileSync('git', ['-C', BRAIN, 'remote', 'remove', 'origin'], { stdio: 'ignore' });
  }
  console.log(`Imported ${manifest.counts.missions} missions and ${manifest.counts.projects} projects from ${manifest.from || from} (Bureau ${manifest.bureau_version}).`);
  console.log(`Not in the export: ${(manifest.left_out || []).join(', ')}. Start the hub, then pair it and allow the apps again.`);
}
try { main(); } catch (e) { console.error(`import: ${e.message}`); process.exit(1); }

#!/usr/bin/env node
// hub/tools/export.js: write a whole hub to one folder, to move it to another
// server, or between self-hosted and hosted (doc 30, B5).
//
//   node hub/tools/export.js <folder> [--keep-tokens]
//
// The folder gets:
//   state.json     missions, agents, messages, projects, settings, the log
//   brain.bundle   the brain's git repository, every branch and its history
//   manifest.json  what this is, from which version, what was left out
//
// Left out, always: the old MCP URL (a key in plain text), dashboard sessions,
// and the pairing with OMAKO (omako.json): the new hub pairs on its own. Left
// out unless --keep-tokens: minted agent tokens (only their hashes are stored,
// but they would keep working on the new hub). Never read: hub/.env and the
// environment's tokens. The work store is not exported: it only holds open
// missions' scratch files.
// Safe to run while the hub runs: state.json is always written whole.
'use strict';
require('../lib/env').load();
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const { VERSION } = require('../version');

const DATA = process.env.BUREAU_DATA_DIR || path.join(__dirname, '..', 'data');
const BRAIN = process.env.BUREAU_BRAIN_DIR || path.join(__dirname, '..', 'brain');

function main() {
  const out = process.argv[2];
  const keepTokens = process.argv.includes('--keep-tokens');
  if (!out || out.startsWith('--')) throw new Error('usage: node hub/tools/export.js <folder> [--keep-tokens]');
  if (fs.existsSync(out) && fs.readdirSync(out).length) throw new Error(`${out} is not empty`);
  fs.mkdirSync(out, { recursive: true, mode: 0o700 });

  const state = JSON.parse(fs.readFileSync(path.join(DATA, 'state.json'), 'utf8'));
  const dropped = [];
  if (state.mcp_token) { delete state.mcp_token; dropped.push('the old MCP URL'); }
  if (state.sessions) { delete state.sessions; dropped.push('dashboard sessions'); }
  if (state.agent_tokens && !keepTokens) { dropped.push(`${state.agent_tokens.length} minted agent token(s)`); delete state.agent_tokens; }
  // Capability links from before schema 2, in case an old file slipped through.
  for (const t of state.tasks || []) { delete t.review_links; delete t.answer_link; delete t.view_token; }
  fs.writeFileSync(path.join(out, 'state.json'), JSON.stringify(state, null, 1), { mode: 0o600 });

  let brain = 'none';
  if (fs.existsSync(path.join(BRAIN, '.git'))) {
    execFileSync('git', ['-C', BRAIN, 'bundle', 'create', path.resolve(out, 'brain.bundle'), '--all'], { stdio: ['ignore', 'ignore', 'pipe'] });
    brain = 'brain.bundle';
  }
  const manifest = {
    format: 1, kind: 'bureau-hub-export', bureau_version: VERSION, schema_version: state.schema_version || 0,
    exported_at: new Date().toISOString(), from: process.env.BUREAU_PUBLIC_URL || null,
    counts: { missions: (state.tasks || []).length, projects: (state.projects || []).length, agents: (state.agents || []).length, apps: (state.oauth_apps || []).length },
    brain, left_out: [...dropped, 'the pairing with OMAKO', 'the work store'],
  };
  fs.writeFileSync(path.join(out, 'manifest.json'), JSON.stringify(manifest, null, 1));
  console.log(`Exported to ${out}: ${manifest.counts.missions} missions, ${manifest.counts.projects} projects, brain ${brain}.`);
  console.log(`Left out: ${manifest.left_out.join(', ')}.`);
}
try { main(); } catch (e) { console.error(`export: ${e.message}`); process.exit(1); }

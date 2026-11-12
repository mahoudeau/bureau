#!/usr/bin/env node
// hub/tools/omako.js: pair this hub with OMAKO Accounts (doc 30, contract C1),
// so people sign in to it with OMAKO and its agents get sign-in addresses.
// Run it on the hub's server, beside the hub:
//
//   node hub/tools/omako.js pair     start a pairing; open the link it prints
//   node hub/tools/omako.js status   paired or not, verified, which agents
//   node hub/tools/omako.js sync     tell OMAKO every agent whose sign-in is on
//   node hub/tools/omako.js unpair   revoke the hub's client at OMAKO
//
// Needs BUREAU_PUBLIC_URL (the hub's own https address), from the environment
// or hub/.env. The secret OMAKO hands back goes straight to
// <data dir>/omako.json (mode 0600). It is never printed. Point at another
// OMAKO with BUREAU_OMAKO_URL (development).
'use strict';
require('../lib/env').load();
const fs = require('fs');
const path = require('path');
const omako = require('../lib/omako');
const oidc = require('../lib/oidc');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function pair() {
  const hubUrl = (process.env.BUREAU_PUBLIC_URL || '').replace(/\/$/, '');
  if (!/^https:\/\//.test(hubUrl) && !/^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(hubUrl))
    throw new Error('BUREAU_PUBLIC_URL must be the hub\'s https address (http only for localhost)');
  if (oidc.pairing()) throw new Error('this hub is already paired: run unpair first to start again');
  const start = await omako.startPairing(hubUrl);
  omako.writeChallenge(start.challenge);
  console.log(`Pairing ${hubUrl} with ${omako.omakoUrl()}.`);
  console.log('Open this link, sign in, and confirm the workspace this hub belongs to:');
  console.log(`  ${start.verify_url}`);
  console.log('Waiting for you to confirm...');
  let interval = Math.max(2, Number(start.interval) || 5) * 1000;
  const deadline = Date.now() + (Number(start.expires_in) || 600) * 1000;
  try {
    while (Date.now() < deadline) {
      await sleep(interval);
      const r = await omako.pollPairing(start.pairing_id);
      if (r.slow_down) { interval += 5000; continue; }
      if (r.pending) continue;
      const d = r.done;
      omako.writePairing({ hub_id: d.hub_id, client_id: d.client_id, client_secret: d.client_secret, issuer: d.issuer, workspace_id: d.workspace_id || null, hub_url: hubUrl, paired_at: new Date().toISOString() });
      console.log(`Paired: hub ${d.hub_id}, workspace ${d.workspace_id || 'personal'}. The client is in ${oidc.PAIRING_FILE} (0600).`);
      console.log('Next: turn on sign-in for an agent in Settings (or run sync if some already are), then sign in to the dashboard.');
      return;
    }
    throw new Error('the pairing expired before it was confirmed; run pair again');
  } finally {
    omako.clearChallenge();
  }
}

function agentsOn() {
  const dir = process.env.BUREAU_DATA_DIR || path.join(__dirname, '..', 'data');
  let s = {};
  try { s = JSON.parse(fs.readFileSync(path.join(dir, 'state.json'), 'utf8')); } catch { /* fresh hub */ }
  const agents = (s.settings && s.settings.agents) || {};
  return Object.entries(agents).filter(([, v]) => v && v.oauth).map(([name]) => name);
}

async function main() {
  const cmd = process.argv[2];
  if (cmd === 'pair') return pair();
  if (cmd === 'status') { console.log(JSON.stringify(await omako.status(), null, 1)); return; }
  if (cmd === 'sync') {
    const r = await omako.syncAgents(agentsOn().map((name) => ({ name, on: true })));
    console.log(r ? JSON.stringify(r, null, 1) : 'not paired');
    return;
  }
  if (cmd === 'unpair') { console.log(JSON.stringify(await omako.unpair())); return; }
  console.log('usage: node hub/tools/omako.js pair | status | sync | unpair');
  process.exitCode = 1;
}
main().catch((e) => { console.error(`omako: ${e.message}`); process.exit(1); });

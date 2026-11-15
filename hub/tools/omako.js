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
// The setup guide and Settings do the same from the browser, with no terminal.
// A hub on a server needs BUREAU_PUBLIC_URL (its own https address), from the
// environment or hub/.env. With none set, the hub is a hub on this computer,
// at http://localhost:<PORT>. The secret OMAKO hands back goes straight to
// <data dir>/omako.json (mode 0600). It is never printed. Point at another
// OMAKO with BUREAU_OMAKO_URL (development).
'use strict';
require('../lib/env').load();
const fs = require('fs');
const path = require('path');
const omako = require('../lib/omako');
const oidc = require('../lib/oidc');


async function pair() {
  // The hub's https address, or, with none set, this computer: a local hub.
  const hubUrl = (process.env.BUREAU_PUBLIC_URL || oidc.localOrigin()).replace(/\/$/, '');
  if (!/^https:\/\//.test(hubUrl) && !/^http:\/\/localhost(:\d+)?$/.test(hubUrl))
    throw new Error('BUREAU_PUBLIC_URL must be the hub\'s https address; leave it unset for a hub on this computer');
  if (oidc.pairing()) throw new Error('this hub is already paired: run unpair first to start again');
  const start = await omako.startPairing(hubUrl);
  omako.writeChallenge(start.challenge);
  console.log(`Pairing ${start.hub_url || hubUrl} with ${omako.omakoUrl()}.`);
  console.log('Open this link, sign in, and confirm the workspace this hub belongs to:');
  console.log(`  ${start.verify_url}`);
  console.log('Waiting for you to confirm...');
  const p = await omako.waitForPairing(start, hubUrl, { log: (l) => console.log(l) });
  if (!p) throw new Error('the pairing expired before it was confirmed; run pair again');
  console.log('Next: turn on sign-in for an agent in Settings (or run sync if some already are), then sign in to the dashboard.');
  console.log('A hub already running picks the pairing up by itself: no restart needed.');
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

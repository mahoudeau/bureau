#!/usr/bin/env node
// hub/tools/sign-in-link.js: a one-time link that signs a browser in to this
// hub as its owner, for when the first-run link is lost, or a new browser
// needs to get in without the token being pasted. Run it on the server,
// beside the hub:
//
//   node tools/sign-in-link.js          (from hub/)
//   docker compose exec bureau node tools/sign-in-link.js
//
// The link works once, for an hour. Anyone who can run this already holds the
// hub's data folder, so it gives nothing they didn't have.
'use strict';
require('../lib/env').load();
const firstRun = require('../lib/firstrun');

const from = firstRun.ensureBossToken();
if (from.source === 'none') {
  console.error('This hub has no boss token: it runs on the old shared token alone (legacy) or as a local demo. Set BUREAU_BOSS_TOKEN, or start it once with no token at all, see UPGRADING.md.');
  process.exit(1);
}
const link = firstRun.linkFor(firstRun.mintKey(firstRun.TOOL_LINK_MS), process.env.PORT || 8100);
console.log('Open this link to sign in as the owner. It works once, for an hour:');
console.log(`  ${link}`);

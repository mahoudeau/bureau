#!/usr/bin/env node
// hub/tools/hub-identity.js: the identity a SQLite hub's database records
// (hub_id, public URL). A hub refuses to boot on a database whose identity
// does not match its BUREAU_HUB_ID or BUREAU_PUBLIC_URL. Stop the hub first.
//
//   node hub/tools/hub-identity.js <data-dir>                      print it
//   node hub/tools/hub-identity.js <data-dir> --public-url <url>   the hub moved
'use strict';
const fs = require('fs');
const path = require('path');

function main() {
  const dir = process.argv[2];
  if (!dir) throw new Error('usage: node hub/tools/hub-identity.js <data-dir> [--public-url <url>]');
  const db = path.join(dir, 'bureau.db');
  if (!fs.existsSync(db)) throw new Error(`no database at ${db}`);
  const sql = require('../lib/sqlite-store');
  const i = process.argv.indexOf('--public-url');
  if (i > 0) {
    const url = process.argv[i + 1];
    if (!url || !/^https?:\/\//.test(url)) throw new Error('--public-url takes the hub\'s new address, http:// or https://');
    sql.open(db);
    try {
      const before = sql.identity();
      if (!before.hub_id) throw new Error(`${db} has no identity yet: start the hub once`);
      sql.setPublicUrl(url);
      console.log(`${before.hub_id}: public URL ${before.public_url || '(none)'} -> ${sql.identity().public_url}`);
    } finally { sql.close(); }
    return;
  }
  sql.open(db, { readOnly: true });
  try { console.log(JSON.stringify(sql.identity(), null, 2)); } finally { sql.close(); }
}
try { main(); } catch (e) { console.error(`hub-identity: ${e.message}`); process.exit(1); }

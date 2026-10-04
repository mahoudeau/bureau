// lib/env.js: hub/.env into process.env, before anything reads it. Zero
// dependencies. Plain `node server.js` is then enough on any OS, Windows
// included (no sh there to run start.sh, which used to do this).
//
// The rules start.sh followed, kept: a variable the host already set wins over
// the file. Blank lines, # comments and keys that are not [A-Za-z_][A-Za-z0-9_]*
// are skipped. A leading "export ", a UTF-8 BOM and a trailing \r (a file
// saved by Notepad) are dropped, and so are matching outer quotes. An unquoted
// value ends before a " #" comment, as in sh. A relative BUREAU_*_DIR from the
// file is read from the file's folder, which is where start.sh ran the hub.
//
// Then the listen address: the host's IP (set before the file is read) wins,
// then HOST, then IP from the file, then :: (all interfaces).
//
// BUREAU_ENV_FILE names another file to load instead (the tests use it, a
// missing file loads nothing).
'use strict';
const fs = require('fs');
const path = require('path');

const KEY_RE = /^[A-Za-z_][A-Za-z0-9_]*$/;
const DIR_KEY_RE = /^BUREAU_[A-Z_]*DIR$/;

function value(raw) {
  const q = raw.match(/^(["'])(.*)\1\s*(?:#.*)?$/);
  if (q) return q[2];
  return raw.replace(/\s+#.*$/, '').trim();
}

// KEY=value text to { KEY: value }, nothing else touched
function parse(text) {
  const out = {};
  for (let line of String(text).replace(/^﻿/, '').split('\n')) {
    line = line.replace(/\r$/, '').replace(/^\s+/, '');
    if (line.startsWith('export ')) line = line.slice(7);
    const eq = line.indexOf('=');
    if (eq < 1) continue;
    const key = line.slice(0, eq);
    if (!KEY_RE.test(key)) continue;
    out[key] = value(line.slice(eq + 1));
  }
  return out;
}

function load(file = process.env.BUREAU_ENV_FILE || path.join(__dirname, '..', '.env')) {
  const hostIp = process.env.IP;
  let vars = {};
  try { vars = parse(fs.readFileSync(file, 'utf8')); } catch (e) {
    if (e.code !== 'ENOENT') console.error(`[env] cannot read ${file}: ${e.message}`);
  }
  const loaded = [];
  for (const [k, v] of Object.entries(vars)) {
    if (process.env[k] !== undefined) continue;
    process.env[k] = DIR_KEY_RE.test(k) && v && !path.isAbsolute(v) ? path.resolve(path.dirname(file), v) : v;
    loaded.push(k);
  }
  if (hostIp) process.env.HOST = hostIp;
  else if (!process.env.HOST) process.env.HOST = process.env.IP || '::';
  return { file, loaded };
}

module.exports = { load, parse };

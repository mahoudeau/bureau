// lib/firstrun.js: a hub started with no token at all sets itself up (t-541).
// It makes its own boss token, keeps it in its data folder, and until someone
// has opened it, prints a one-time link that hands that token to the browser
// that opens it. Nothing to copy, nothing to paste, and the hub never runs open:
// before the link is opened, the token is the only way in and nobody has it.
//
//   <data>/boss-token      the token, mode 0600. BUREAU_BOSS_TOKEN in the
//                          environment always wins over it.
//   <data>/setup-key.json  the hash of the one live link key, and when it ends.
//   <data>/setup-done      written when a first-run link is opened: from then
//                          on the boot prints no link. hub/tools/sign-in-link.js
//                          makes a new one any time (shell access to the server
//                          is ownership already).
//
// A hub on the old shared token alone (legacy), on the local demo opt-in, or
// one that already holds data, is left exactly as it was.
'use strict';
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const DATA_DIR = process.env.BUREAU_DATA_DIR || path.join(__dirname, '..', 'data');
const TOKEN_FILE = path.join(DATA_DIR, 'boss-token');
const KEY_FILE = path.join(DATA_DIR, 'setup-key.json');
const DONE_FILE = path.join(DATA_DIR, 'setup-done');
const DEMO_VAR = 'BUREAU_ALLOW_INSECURE_LOCAL';
const BOOT_LINK_MS = 24 * 60 * 60 * 1000;
const TOOL_LINK_MS = 60 * 60 * 1000;

const sha = (s) => crypto.createHash('sha256').update(String(s)).digest('hex');

// Written 0600 from birth, then renamed into place, like the OMAKO pairing.
function writeSecret(file, text) {
  fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
  const tmp = `${file}.tmp`;
  const fd = fs.openSync(tmp, 'w', 0o600);
  try {
    if (process.platform !== 'win32') fs.fchmodSync(fd, 0o600);
    fs.writeSync(fd, text);
    fs.fsyncSync(fd);
  } finally { fs.closeSync(fd); }
  fs.renameSync(tmp, file);
}
function readTrim(file) {
  try { return fs.readFileSync(file, 'utf8').trim(); } catch { return ''; }
}

// Called once at boot, before anything reads the tokens. Fills
// BUREAU_BOSS_TOKEN from the data folder, making the token on the very first
// boot. Returns { source: 'env' | 'file' | 'none', made }.
function ensureBossToken(env = process.env) {
  if (env.BUREAU_BOSS_TOKEN) return { source: 'env', made: false };
  if (env.BUREAU_TOKEN || env[DEMO_VAR] === '1') return { source: 'none', made: false };
  let token = readTrim(TOKEN_FILE);
  let made = false;
  if (!token) {
    // Only on a brand-new hub. A hub that already holds data and lost its
    // tokens (an env file gone missing) refuses to start, as it always has,
    // rather than come up with a new owner link in its log.
    if (['state.json', 'bureau.db'].some((f) => fs.existsSync(path.join(DATA_DIR, f)))) return { source: 'none', made: false };
    token = crypto.randomBytes(32).toString('hex');
    writeSecret(TOKEN_FILE, `${token}\n`);
    made = true;
  }
  env.BUREAU_BOSS_TOKEN = token;
  return { source: 'file', made };
}

// The token the hub made itself, without making one: for the tools.
const readBossToken = () => readTrim(TOKEN_FILE);

// Has a first-run link been opened on this hub?
const setupDone = () => fs.existsSync(DONE_FILE);

// A new one-time key, replacing any earlier one. Only its hash is kept.
function mintKey(ttlMs) {
  const key = crypto.randomBytes(24).toString('base64url');
  writeSecret(KEY_FILE, JSON.stringify({ hash: sha(key), expires_at: new Date(Date.now() + ttlMs).toISOString() }));
  return key;
}

// The key from a link: true once, when it is the live one and still in time.
// A wrong key leaves the live one alone; a right one is spent.
function claim(key) {
  if (typeof key !== 'string' || !key || key.length > 200) return false;
  let rec = null;
  try { rec = JSON.parse(fs.readFileSync(KEY_FILE, 'utf8')); } catch { return false; }
  if (!rec || typeof rec.hash !== 'string' || !(Date.parse(rec.expires_at) > Date.now())) return false;
  const a = Buffer.from(sha(key)), b = Buffer.from(rec.hash);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return false;
  try { fs.unlinkSync(KEY_FILE); } catch { /* spent either way */ }
  try { fs.writeFileSync(DONE_FILE, `${new Date().toISOString()}\n`); } catch { /* the next boot prints a link again, no harm */ }
  return true;
}

// Where the link points: the hub's public address, else this machine.
function linkFor(key, port, env = process.env) {
  const base = (env.BUREAU_PUBLIC_URL || `http://localhost:${port}`).replace(/\/$/, '');
  return `${base}/setup#key=${key}`;
}

module.exports = { ensureBossToken, readBossToken, setupDone, mintKey, claim, linkFor, TOKEN_FILE, KEY_FILE, DONE_FILE, BOOT_LINK_MS, TOOL_LINK_MS };

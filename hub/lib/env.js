// lib/env.js: hub/.env into process.env, before anything reads it. Zero
// dependencies. Plain `node server.js` is then enough on any OS, Windows
// included (no sh there to run start.sh, which used to do this).
//
// The rules start.sh followed, kept: a variable the host already set wins over
// the file. Blank lines, # comments and keys that are not [A-Za-z_][A-Za-z0-9_]*
// are skipped. A leading "export ", a UTF-8 BOM and \r line ends (a file saved
// by Notepad) are dropped. A relative BUREAU_*_DIR from the file is read from
// the file's folder, which is where start.sh ran the hub.
//
// Values are read the way sh read them when start.sh sourced the file, since
// real .env files lean on it (a BUREAU_POKES built from POKE_* lines above
// it): 'single quotes' are literal and may span lines; "double quotes" may
// span lines, take \" \\ \$ \` escapes and expand $NAME and ${NAME}; an
// unquoted value expands too and ends at a space, so " # note" is a comment
// and "a#b" is not. $NAME is the file's own earlier value, else the
// environment's, else empty. No command substitution, no arithmetic.
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

const ASSIGN_RE = /^[ \t]*(?:export[ \t]+)?([A-Za-z_][A-Za-z0-9_]*)=/;
const NAME_RE = /^\$(?:\{([A-Za-z_][A-Za-z0-9_]*)\}|([A-Za-z_][A-Za-z0-9_]*))/;

// $NAME or ${NAME} at s[i]: its value, and where reading goes on
function expand(s, i, get) {
  const m = NAME_RE.exec(s.slice(i, i + 256));
  if (!m) return { text: '$', next: i + 1 };
  return { text: get(m[1] || m[2]), next: i + m[0].length };
}

// KEY=value text to { KEY: value }, nothing else touched. env answers a
// $NAME the file has not set itself.
function parse(text, env = process.env) {
  const s = String(text).replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n');
  const out = {};
  const get = name => (Object.prototype.hasOwnProperty.call(out, name) ? out[name] : env[name] !== undefined ? env[name] : '');
  let i = 0;
  while (i < s.length) {
    const eol = s.indexOf('\n', i);
    const m = ASSIGN_RE.exec(s.slice(i, eol < 0 ? s.length : eol));
    if (!m) { i = eol < 0 ? s.length : eol + 1; continue; }
    i += m[0].length;
    let val = '';
    // one sh word: quoted and unquoted pieces, up to a space or a line end
    while (i < s.length && !/[ \t\n]/.test(s[i])) {
      const c = s[i];
      if (c === "'") {
        const end = s.indexOf("'", i + 1);
        val += s.slice(i + 1, end < 0 ? s.length : end);
        i = end < 0 ? s.length : end + 1;
      } else if (c === '"') {
        i++;
        while (i < s.length && s[i] !== '"') {
          if (s[i] === '\\' && '"\\$`\n'.includes(s[i + 1] || '')) { if (s[i + 1] !== '\n') val += s[i + 1]; i += 2; }
          else if (s[i] === '$') { const r = expand(s, i, get); val += r.text; i = r.next; }
          else val += s[i++];
        }
        i++; // the closing quote
      } else if (c === '\\' && i + 1 < s.length) {
        if (s[i + 1] !== '\n') val += s[i + 1];
        i += 2;
      } else if (c === '$') {
        const r = expand(s, i, get); val += r.text; i = r.next;
      } else val += s[i++];
    }
    out[m[1]] = val;
    const next = s.indexOf('\n', i); // the rest of the line is a comment, if anything
    i = next < 0 ? s.length : next + 1;
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

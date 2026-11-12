#!/usr/bin/env node
// bureau.js: sign in to a Bureau hub from a terminal. Licensed Apache-2.0
// (LICENSE-APACHE at the repo root). Node 18 or newer, no dependencies.
//
//   bureau login [--agent consul] [--hub URL] [--no-browser]
//   bureau logout | token | whoami | status   [--agent NAME] [--hub URL]
//
// login runs the OAuth device flow against the issuer the hub names at
// /.well-known/bureau and keeps the result where only programs read it: the
// macOS Keychain (service bureau-login, account <hub host>/<agent>), or off a
// Mac a 0600 file, ~/.config/bureau/login.json. No command prints a token,
// except `token`, and only into a pipe.
//
// Hub: --hub, else BUREAU_URL, else the first line of ~/.bureau-url.
// Agent: --agent, else BUREAU_AGENT, else consul.
// BUREAU_LOGIN_STORE=file uses the file on a Mac too.
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { spawn, spawnSync } = require('child_process');

const SERVICE = process.env.BUREAU_LOGIN_SERVICE || 'bureau-login'; // another name is for tests
const SCOPE = 'openid email offline_access bureau';
const REFRESH_EARLY = 60; // seconds before expiry
const AGENT_RE = /^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/;
// Tests only: shrinks the device flow's waits so a run takes seconds, not minutes.
const SLEEP_SCALE = Number(process.env.BUREAU_CLI_TEST_SLEEP_SCALE) > 0 ? Number(process.env.BUREAU_CLI_TEST_SLEEP_SCALE) : 1;

class Fail extends Error {}

// ---- output: every line goes through clean(), which hides any secret seen ----
const secrets = new Set();
function hide(v) { if (typeof v === 'string' && v.length >= 6) secrets.add(v); return v; }
function hideRecord(rec) { if (rec) { hide(rec.access_token); hide(rec.refresh_token); } return rec; }
function clean(text) {
  let s = String(text);
  for (const v of secrets) s = s.split(v).join('[hidden]');
  return s;
}
function say(msg) { process.stdout.write(clean(msg) + '\n'); }
function warn(msg) { process.stderr.write(clean(msg) + '\n'); }

const now = () => Math.floor(Date.now() / 1000);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const strip = (u) => String(u || '').replace(/\/+$/, '');

function isLoopback(host) { return host === 'localhost' || host === '127.0.0.1' || host === '[::1]' || host === '::1'; }
// https everywhere, except plain http to this machine (a hub in development).
function checkUrl(value, what) {
  let u;
  try { u = new URL(String(value)); } catch { throw new Fail(`${what} is not a valid address.`); }
  if (u.protocol === 'https:' || (u.protocol === 'http:' && isLoopback(u.hostname))) return u;
  throw new Fail(`${what} must use https (got ${u.protocol}//${u.host}).`);
}

// What a server said went wrong: its error code and a short description, no more.
function oauthError(r) {
  const j = r && r.json;
  if (!j || typeof j !== 'object') return `answered ${r ? r.status : 'nothing'}`;
  const code = typeof j.error === 'string' ? j.error.slice(0, 60) : `status ${r.status}`;
  const desc = typeof j.error_description === 'string' ? j.error_description.replace(/[^\x20-\x7e]/g, ' ').slice(0, 200) : '';
  return desc ? `${code}: ${desc}` : code;
}

async function call(url, { method = 'GET', form, bearer, timeoutMs = 15000 } = {}) {
  const headers = { accept: 'application/json' };
  let body;
  if (form) { headers['content-type'] = 'application/x-www-form-urlencoded'; body = new URLSearchParams(form).toString(); }
  if (bearer) headers.authorization = `Bearer ${bearer}`;
  let res;
  try {
    // No redirects: a credential is never carried to an address we did not check.
    res = await fetch(url, { method, headers, body, redirect: 'manual', signal: AbortSignal.timeout(timeoutMs) });
  } catch (e) {
    const why = e && e.name === 'TimeoutError' ? 'timed out' : (e && e.cause && e.cause.code) || 'network error';
    throw new Fail(`could not reach ${new URL(url).origin} (${why}).`);
  }
  const text = await res.text().catch(() => '');
  let json = null;
  try { json = JSON.parse(text); } catch { /* not json */ }
  return { status: res.status, json };
}

// ---- where the hub and the agent come from ----
function hubUrl(opt) {
  let b = opt.hub || process.env.BUREAU_URL || '';
  if (!b) {
    const file = process.env.BUREAU_URL_FILE || path.join(os.homedir(), '.bureau-url');
    try { b = fs.readFileSync(file, 'utf8').split(/\r?\n/)[0].trim(); } catch { /* no file */ }
  }
  if (!b) throw new Fail('no hub address. Pass --hub URL, set BUREAU_URL, or put it in ~/.bureau-url.');
  const u = checkUrl(b.trim(), 'the hub address');
  return strip(u.origin + u.pathname);
}
function agentName(opt) {
  const a = opt.agent || process.env.BUREAU_AGENT || 'consul';
  if (!AGENT_RE.test(a)) throw new Fail(`"${String(a).slice(0, 64)}" is not an agent name (letters, digits, - and _).`);
  return a;
}
function accountKey(hub, agent) { return `${new URL(hub).host}/${agent}`; }

// ---- storage ----
function validRecord(r) {
  return !!r && typeof r === 'object' && typeof r.access_token === 'string' && r.access_token
    && Number.isFinite(Number(r.expires_at)) && typeof r.token_endpoint === 'string' && typeof r.client_id === 'string';
}

const fileStore = {
  kind: 'file',
  dir() { return path.join(os.homedir(), '.config', 'bureau'); },
  file() { return path.join(this.dir(), 'login.json'); },
  where() { return this.file(); },
  readAll() {
    try {
      const all = JSON.parse(fs.readFileSync(this.file(), 'utf8'));
      return all && typeof all === 'object' && !Array.isArray(all) ? all : {};
    } catch { return {}; }
  },
  writeAll(all) {
    ensureDir(this.dir());
    const tmp = `${this.file()}.${process.pid}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(all, null, 2) + '\n', { mode: 0o600 });
    fs.renameSync(tmp, this.file());
    try { fs.chmodSync(this.file(), 0o600); } catch { /* Windows */ }
  },
  get(key) { const r = this.readAll()[key]; return validRecord(r) ? r : null; },
  set(key, rec) { const all = this.readAll(); all[key] = rec; this.writeAll(all); },
  del(key) {
    const all = this.readAll();
    if (!(key in all)) return false;
    delete all[key];
    this.writeAll(all);
    return true;
  },
};

// The value is written through `security -i`, fed on stdin, so it never shows
// in a process list. Its output is thrown away: on a failed line it echoes the
// line back, value included. One line holds about 4 KB.
const KEYCHAIN_LINE_MAX = 4000;
const keychainStore = {
  kind: 'keychain',
  where(key) { return `the macOS Keychain (service ${SERVICE}, account ${key})`; },
  get(key, { timeoutMs = 3000 } = {}) {
    const r = spawnSync('security', ['find-generic-password', '-s', SERVICE, '-a', key, '-w'],
      { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], timeout: timeoutMs });
    if (r.status !== 0 || !r.stdout) return null;
    let v = r.stdout.replace(/\r?\n$/, '');
    // security prints the value in hex when it holds bytes outside printable ASCII.
    if (/^[0-9a-fA-F]+$/.test(v) && v.length % 2 === 0) v = Buffer.from(v, 'hex').toString('utf8');
    try { const rec = JSON.parse(v); return validRecord(rec) ? rec : null; } catch { return null; }
  },
  set(key, rec, { timeoutMs = 5000 } = {}) {
    if (!/^[A-Za-z0-9.:[\]_/-]+$/.test(key)) throw new Fail('the hub address cannot name a Keychain item.');
    const json = JSON.stringify(rec);
    const plain = /^[\x20-\x7e]*$/.test(json) && !/['\\]/.test(json);
    const line = plain
      ? `add-generic-password -U -s ${SERVICE} -a ${key} -w '${json}'\n`
      : `add-generic-password -U -s ${SERVICE} -a ${key} -X ${Buffer.from(json, 'utf8').toString('hex')}\n`;
    if (line.length > KEYCHAIN_LINE_MAX) throw new Fail('the sign-in is too large for a Keychain item. Set BUREAU_LOGIN_STORE=file to keep it in ~/.config/bureau/login.json instead.');
    const r = spawnSync('security', ['-i'], { input: line, stdio: ['pipe', 'ignore', 'ignore'], timeout: timeoutMs });
    if (r.status !== 0) throw new Fail('could not save the sign-in in the Keychain.');
    const back = this.get(key, { timeoutMs });
    if (!back || back.access_token !== rec.access_token) throw new Fail('the Keychain did not keep the sign-in.');
  },
  del(key) {
    const r = spawnSync('security', ['delete-generic-password', '-s', SERVICE, '-a', key], { stdio: 'ignore', timeout: 5000 });
    return r.status === 0;
  },
};

function storeFor() {
  return process.env.BUREAU_LOGIN_STORE === 'file' || process.platform !== 'darwin' ? fileStore : keychainStore;
}

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  try { fs.chmodSync(dir, 0o700); } catch { /* Windows */ }
}

// One refresh at a time per sign-in: with rotation, two at once would spend the
// same refresh token twice, and an issuer may end the whole sign-in for that.
async function lock(key, wait) {
  const dir = path.join(os.homedir(), '.config', 'bureau');
  ensureDir(dir);
  const file = path.join(dir, `refresh-${crypto.createHash('sha256').update(key).digest('hex').slice(0, 16)}.lock`);
  const deadline = Date.now() + 20000;
  for (;;) {
    try {
      fs.closeSync(fs.openSync(file, 'wx', 0o600));
      return () => { try { fs.unlinkSync(file); } catch { /* gone */ } };
    } catch (e) {
      if (e.code !== 'EEXIST') throw new Fail('could not take the refresh lock.');
      try { if (Date.now() - fs.statSync(file).mtimeMs > 30000) { fs.unlinkSync(file); continue; } } catch { continue; }
      if (!wait || Date.now() > deadline) return null;
      await sleep(100);
    }
  }
}

// ---- the issuer ----
async function discover(hub, agent) {
  const r = await call(`${hub}/.well-known/bureau`);
  if (r.status !== 200 || !r.json || typeof r.json !== 'object')
    throw new Fail(`${hub} does not offer sign-in (/.well-known/bureau answered ${r.status}). Use a token from the hub's owner instead.`);
  const { issuer, cli_client_id: clientId, agents_url_template: template } = r.json;
  if (typeof issuer !== 'string' || !issuer) throw new Fail(`${hub} names no issuer at /.well-known/bureau.`);
  if (typeof clientId !== 'string' || !clientId) throw new Fail(`${hub} names no CLI client at /.well-known/bureau.`);
  checkUrl(issuer, 'the issuer');
  let resource = `${hub}/mcp/agent/${agent}`;
  if (typeof template === 'string' && template.includes('{agent}')) {
    const named = template.split('{agent}').join(agent);
    const u = checkUrl(named, 'the agent address');
    // A token is only ever asked for this hub: an address elsewhere is refused.
    if (u.origin !== new URL(hub).origin) throw new Fail(`${hub} names an agent address on another server (${u.origin}). Refusing to sign in.`);
    resource = named;
  }
  return { issuer, client_id: clientId, resource };
}

async function issuerMeta(issuer, { timeoutMs = 15000 } = {}) {
  const u = checkUrl(issuer, 'the issuer');
  const p = strip(u.pathname);
  const tries = [];
  for (const wk of ['oauth-authorization-server', 'openid-configuration']) {
    if (p) tries.push(`${u.origin}/.well-known/${wk}${p}`); // RFC 8414, issuer with a path
    tries.push(`${u.origin}${p}/.well-known/${wk}`);
  }
  for (const url of tries) {
    let r;
    try { r = await call(url, { timeoutMs }); } catch { continue; }
    if (r.status !== 200 || !r.json || typeof r.json !== 'object') continue;
    if (strip(r.json.issuer) !== strip(issuer)) throw new Fail(`the issuer's metadata names another issuer (${String(r.json.issuer).slice(0, 120)}). Refusing to sign in.`);
    for (const k of ['token_endpoint', 'device_authorization_endpoint', 'revocation_endpoint'])
      if (r.json[k] !== undefined) checkUrl(r.json[k], `the issuer's ${k}`);
    return r.json;
  }
  throw new Fail(`could not read the issuer's metadata at ${issuer}.`);
}

function jwtExp(token) {
  try { const exp = JSON.parse(Buffer.from(token.split('.')[1], 'base64url').toString('utf8')).exp; return Number.isFinite(exp) ? exp : 0; } catch { return 0; }
}

function record(tok, ctx, prev) {
  if (typeof tok.access_token !== 'string' || !tok.access_token) throw new Fail('the issuer sent no access token.');
  hide(tok.access_token); hide(tok.refresh_token);
  if (tok.token_type && String(tok.token_type).toLowerCase() !== 'bearer') throw new Fail(`the issuer sent a ${String(tok.token_type).slice(0, 20)} token, not a bearer token.`);
  const life = Number(tok.expires_in);
  return {
    access_token: tok.access_token,
    refresh_token: typeof tok.refresh_token === 'string' && tok.refresh_token ? tok.refresh_token : (prev && prev.refresh_token) || null,
    expires_at: life > 0 ? now() + Math.floor(life) : (jwtExp(tok.access_token) || now() + 3600),
    issuer: ctx.issuer,
    resource: ctx.resource,
    token_endpoint: ctx.token_endpoint,
    client_id: ctx.client_id,
  };
}

// The stored sign-in, refreshed when it has `early` seconds or less left.
// The context hook calls this with a short timeout and wait: false.
async function fresh(hub, agent, { early = REFRESH_EARLY, timeoutMs = 15000, storeTimeoutMs = 5000, wait = true } = {}) {
  const store = storeFor();
  const key = accountKey(hub, agent);
  let rec = hideRecord(store.get(key, { timeoutMs: storeTimeoutMs }));
  if (!rec) throw new Fail(`not signed in to ${hub} as ${agent}. Run: bureau login --agent ${agent}`);
  if (Number(rec.expires_at) - now() > early) return rec;
  if (!rec.refresh_token) throw new Fail(`the sign-in to ${hub} as ${agent} has expired. Run: bureau login --agent ${agent}`);
  const unlock = await lock(key, wait);
  if (!unlock) throw new Fail('another refresh is running.');
  try {
    rec = hideRecord(store.get(key, { timeoutMs: storeTimeoutMs })) || rec; // it may have just been refreshed
    if (Number(rec.expires_at) - now() > early) return rec;
    checkUrl(rec.token_endpoint, 'the token endpoint');
    const t = await call(rec.token_endpoint, { method: 'POST', timeoutMs,
      form: { grant_type: 'refresh_token', refresh_token: rec.refresh_token, client_id: rec.client_id, ...(rec.resource ? { resource: rec.resource } : {}) } });
    if (t.status !== 200 || !t.json || !t.json.access_token) {
      if (t.json && t.json.error === 'invalid_grant') throw new Fail(`the sign-in to ${hub} as ${agent} has ended. Run: bureau login --agent ${agent}`);
      throw new Fail(`the refresh failed: ${oauthError(t)}.`);
    }
    const next = record(t.json, rec, rec);
    // Saved even past the caller's budget: the old refresh token may be spent.
    store.set(key, next, { timeoutMs: Math.max(storeTimeoutMs, 1000) });
    return next;
  } finally { unlock(); }
}

function openBrowser(url) {
  const cmd = process.platform === 'darwin' ? 'open' : process.platform === 'linux' ? 'xdg-open' : null;
  if (!cmd) return;
  try { const c = spawn(cmd, [url], { stdio: 'ignore', detached: true }); c.on('error', () => {}); c.unref(); } catch { /* no browser */ }
}

// ---- commands ----
async function login(opt) {
  const hub = hubUrl(opt), agent = agentName(opt);
  const d = await discover(hub, agent);
  const meta = await issuerMeta(d.issuer);
  if (!meta.device_authorization_endpoint) throw new Fail('the issuer does not offer sign-in from a terminal (no device authorization endpoint).');
  if (!meta.token_endpoint) throw new Fail('the issuer names no token endpoint.');
  const r = await call(meta.device_authorization_endpoint, { method: 'POST', form: { client_id: d.client_id, scope: SCOPE, resource: d.resource } });
  const dev = r.json || {};
  hide(dev.device_code);
  if (r.status !== 200 || typeof dev.device_code !== 'string' || typeof dev.user_code !== 'string' || typeof dev.verification_uri !== 'string')
    throw new Fail(`the issuer would not start the sign-in: ${oauthError(r)}.`);
  checkUrl(dev.verification_uri, 'the sign-in page');
  const page = typeof dev.verification_uri_complete === 'string' && /^https?:/.test(dev.verification_uri_complete) ? dev.verification_uri_complete : dev.verification_uri;
  checkUrl(page, 'the sign-in page');
  say(`Signing in to ${hub} as ${agent}.`);
  say(`Open ${dev.verification_uri} and enter the code ${String(dev.user_code).replace(/[^\x20-\x7e]/g, '').slice(0, 32)}`);
  if (process.stdout.isTTY && !opt['no-browser'] && !process.env.BUREAU_NO_BROWSER) openBrowser(page);
  say('Waiting for you to approve it...');
  let interval = Number(dev.interval) > 0 ? Math.max(1, Number(dev.interval)) : 5; // seconds, RFC 8628 default 5
  const life = Number(dev.expires_in) > 0 ? Number(dev.expires_in) : 600;
  const deadline = Date.now() + life * 1000 * SLEEP_SCALE;
  let misses = 0;
  for (;;) {
    await sleep(interval * 1000 * SLEEP_SCALE);
    if (Date.now() > deadline) throw new Fail('the code expired before it was approved. Run bureau login again.');
    let t;
    try {
      t = await call(meta.token_endpoint, { method: 'POST', form: { grant_type: 'urn:ietf:params:oauth:grant-type:device_code', device_code: dev.device_code, client_id: d.client_id } });
    } catch (e) {
      if (++misses > 5) throw e;
      continue;
    }
    misses = 0;
    if (t.status === 200 && t.json && t.json.access_token) {
      const rec = record(t.json, { issuer: d.issuer, resource: d.resource, token_endpoint: meta.token_endpoint, client_id: d.client_id });
      const store = storeFor(), key = accountKey(hub, agent);
      store.set(key, rec);
      say(`Signed in to ${hub} as ${agent}.`);
      say(`Kept in ${store.where(key)}. The token refreshes itself; this sign-in lasts until bureau logout.`);
      return 0;
    }
    const err = t.json && t.json.error;
    if (err === 'authorization_pending') continue;
    if (err === 'slow_down') { interval += 5; continue; }
    if (err === 'access_denied') throw new Fail('the sign-in was denied.');
    if (err === 'expired_token') throw new Fail('the code expired before it was approved. Run bureau login again.');
    throw new Fail(`the sign-in failed: ${oauthError(t)}.`);
  }
}

async function logout(opt) {
  const hub = hubUrl(opt), agent = agentName(opt);
  const store = storeFor(), key = accountKey(hub, agent);
  const rec = hideRecord(store.get(key));
  if (!rec) { say(`Not signed in to ${hub} as ${agent}. Nothing to do.`); return 0; }
  let revoked = false;
  try {
    const meta = await issuerMeta(rec.issuer, { timeoutMs: 10000 });
    if (meta.revocation_endpoint) {
      const pairs = [[rec.refresh_token, 'refresh_token'], [rec.access_token, 'access_token']].filter(([v]) => v);
      for (const [token, hint] of pairs) {
        const r = await call(meta.revocation_endpoint, { method: 'POST', timeoutMs: 10000, form: { token, token_type_hint: hint, client_id: rec.client_id } });
        if (r.status === 200) revoked = true;
        else warn(`The issuer did not revoke the ${hint.replace('_', ' ')}: ${oauthError(r)}.`);
      }
    } else warn('The issuer has no revocation endpoint: the last access token stays valid until it expires.');
  } catch (e) {
    warn(`Could not revoke at the issuer: ${e instanceof Fail ? e.message : 'unexpected error'}`);
  }
  store.del(key);
  say(`Signed out of ${hub} as ${agent}.${revoked ? ' The issuer revoked the sign-in.' : ''}`);
  return 0;
}

async function token(opt) {
  if (process.stdout.isTTY) {
    warn('bureau token only writes into a pipe, never to a terminal, so the token does not end up on screen or in a log.');
    warn('Use it inside a command, for example: curl -H "Authorization: Bearer $(bureau token)" "$BUREAU_URL/api/health"');
    warn('To see whether you are signed in, run: bureau status');
    return 2;
  }
  const rec = await fresh(hubUrl(opt), agentName(opt));
  process.stdout.write(rec.access_token + '\n');
  return 0;
}

async function whoami(opt) {
  const hub = hubUrl(opt), agent = agentName(opt);
  const rec = await fresh(hub, agent);
  const r = await call(`${hub}/api/health`, { bearer: rec.access_token });
  if (r.status !== 200 || !r.json || !r.json.credential)
    throw new Fail(`${hub} refused the sign-in (${r.status}${r.json && typeof r.json.error === 'string' ? `: ${r.json.error.slice(0, 200)}` : ''}).`);
  const c = r.json.credential;
  say(`${c.name} (${c.kind}) on ${hub}`);
  if (Array.isArray(c.projects) && c.projects.length) say(`Projects: ${c.projects.join(', ')}`);
  return 0;
}

async function status(opt) {
  const hub = hubUrl(opt), agent = agentName(opt);
  const store = storeFor(), key = accountKey(hub, agent);
  const rec = store.get(key);
  if (!rec) { say(`Not signed in to ${hub} as ${agent}.`); return 1; }
  const exp = Number(rec.expires_at), left = exp - now();
  say(`Signed in to ${hub} as ${agent}.`);
  say(`Issuer: ${rec.issuer}`);
  say(left > 0
    ? `Access token expires at ${new Date(exp * 1000).toISOString()} (in ${Math.round(left / 60)} min).`
    : `Access token expired at ${new Date(exp * 1000).toISOString()}.${rec.refresh_token ? ' It refreshes on next use.' : ' Run bureau login again.'}`);
  say(`Kept in ${store.where(key)}.`);
  return 0;
}

const HELP = `bureau: sign in to a Bureau hub from a terminal.

  bureau login  [--agent NAME] [--hub URL] [--no-browser]
  bureau status [--agent NAME] [--hub URL]   signed in or not, and until when
  bureau whoami [--agent NAME] [--hub URL]   who the hub sees
  bureau token  [--agent NAME] [--hub URL]   a fresh access token, into a pipe only
  bureau logout [--agent NAME] [--hub URL]   revoke at the issuer and forget it

Hub: --hub, else BUREAU_URL, else the first line of ~/.bureau-url.
Agent: --agent, else BUREAU_AGENT, else consul.
Storage: the macOS Keychain (service bureau-login); off a Mac, or with
BUREAU_LOGIN_STORE=file, ~/.config/bureau/login.json (mode 0600).
`;

function parse(argv) {
  const opt = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '-h' || a === '--help') opt.help = true;
    else if (a === '--no-browser') opt['no-browser'] = true;
    else if (a.startsWith('--agent=') || a.startsWith('--hub=')) { const at = a.indexOf('='); opt[a.slice(2, at)] = a.slice(at + 1); }
    else if (a === '--agent' || a === '--hub') {
      if (i + 1 >= argv.length) throw new Fail(`${a} needs a value.`);
      opt[a.slice(2)] = argv[++i];
    } else if (a.startsWith('-')) throw new Fail(`unknown option ${a.slice(0, 40)}. See bureau --help.`);
    else opt._.push(a);
  }
  return opt;
}

const COMMANDS = { login, logout, token, whoami, status };

async function main(argv) {
  let opt;
  try { opt = parse(argv); } catch (e) { warn(`bureau: ${e.message}`); return 2; }
  const cmd = opt._[0];
  if (opt.help || !cmd || cmd === 'help') { process.stdout.write(HELP); return cmd || opt.help ? 0 : 2; }
  if (!COMMANDS[cmd]) { warn(`bureau: unknown command ${String(cmd).slice(0, 40)}. See bureau --help.`); return 2; }
  try { return await COMMANDS[cmd](opt); }
  catch (e) {
    warn(`bureau: ${e instanceof Fail ? e.message : `unexpected error (${e && e.name ? e.name : 'unknown'})`}`);
    return 1;
  }
}

module.exports = { fresh, storeFor, accountKey, fileStore, keychainStore };

if (require.main === module) main(process.argv.slice(2)).then((code) => { process.exitCode = code; });

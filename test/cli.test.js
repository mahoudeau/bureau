// test/cli.test.js: the terminal sign-in (connectors/cli/bureau.js), hub.sh and
// the context hook on top of it, against a fake issuer and a fake hub. The
// sign-in is kept in the file store under a temporary home, never the Keychain.
// Usage: node test/cli.test.js
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');
const crypto = require('crypto');
const { spawn } = require('child_process');

const CLI = path.join(__dirname, '..', 'connectors', 'cli', 'bureau.js');
const HUBSH = path.join(__dirname, '..', 'connectors', 'claude-code', 'hub.sh');
const HOOK = path.join(__dirname, '..', 'connectors', 'claude-code', 'context-hook.js');
const ISSUER_PORT = 8196, HUB_PORT = 8197;
const ISSUER = `http://127.0.0.1:${ISSUER_PORT}`;
const HUB = `http://127.0.0.1:${HUB_PORT}`;
const HOST = `127.0.0.1:${HUB_PORT}`;
const home = fs.mkdtempSync(path.join(os.tmpdir(), 'bureau-cli-'));
const LOGIN_FILE = path.join(home, '.config', 'bureau', 'login.json');
const FALLBACK = 'fallback-token-from-the-file';
const WIN = process.platform === 'win32';

let PASS = 0, FAIL = 0;
function check(label, ok, got) {
  if (ok) { PASS++; console.log(`  ok: ${label}`); }
  else { FAIL++; console.log(`  FAIL: ${label}${got !== undefined ? ` (got: ${JSON.stringify(got).slice(0, 300)})` : ''}`); }
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const now = () => Math.floor(Date.now() / 1000);
const rand = (p) => `${p}-${crypto.randomBytes(18).toString('hex')}`;

// ---- the fake issuer: device flow, refresh with rotation, revocation ----
const issued = new Set();          // every token value handed out, for the leak check
const access = new Map();          // access token -> resource
const refresh = new Map();         // refresh token -> {resource, used}
const devices = new Map();         // device code -> {scenario, polls, times, resource}
const seen = { device: [], refresh: [], revoked: [] };
const issuerCfg = { scenario: 'ok', expiresIn: 3600, tokenDelay: 0, issuerName: ISSUER };
function mint(resource) {
  const a = rand('at'), r = rand('rt');
  issued.add(a); issued.add(r);
  access.set(a, resource);
  refresh.set(r, { resource, used: false });
  return { access_token: a, refresh_token: r, token_type: 'Bearer', expires_in: issuerCfg.expiresIn, scope: 'openid email offline_access bureau' };
}
function form(req) {
  return new Promise((resolve) => { let b = ''; req.on('data', (d) => { b += d; }); req.on('end', () => resolve(Object.fromEntries(new URLSearchParams(b)))); });
}
const issuer = http.createServer(async (req, res) => {
  const out = (code, obj) => { res.writeHead(code, { 'content-type': 'application/json' }); res.end(JSON.stringify(obj)); };
  if (req.url === '/.well-known/oauth-authorization-server')
    return out(200, { issuer: issuerCfg.issuerName, device_authorization_endpoint: `${ISSUER}/device`, token_endpoint: `${ISSUER}/token`, revocation_endpoint: `${ISSUER}/revoke` });
  if (req.method !== 'POST') return out(404, {});
  const f = await form(req);
  if (req.url === '/device') {
    seen.device.push(f);
    if (f.client_id !== 'bureau-cli') return out(401, { error: 'invalid_client' });
    const code = rand('dc');
    issued.add(code);
    const d = { scenario: issuerCfg.scenario, polls: 0, times: [], resource: f.resource };
    devices.set(code, d);
    if (d.scenario === 'slow') seen.slowTimes = d.times; // when each poll came in
    return out(200, { device_code: code, user_code: 'WDJB-MJHT', verification_uri: `${ISSUER}/activate`, verification_uri_complete: `${ISSUER}/activate?user_code=WDJB-MJHT`, expires_in: 600, interval: 1 });
  }
  if (req.url === '/token') {
    if (issuerCfg.tokenDelay) await sleep(issuerCfg.tokenDelay);
    if (f.grant_type === 'urn:ietf:params:oauth:grant-type:device_code') {
      const d = devices.get(f.device_code);
      if (!d || f.client_id !== 'bureau-cli') return out(400, { error: 'invalid_grant' });
      d.polls++; d.times.push(Date.now());
      if (d.scenario === 'denied') return out(400, { error: 'access_denied' });
      if (d.scenario === 'expired') return out(400, { error: 'expired_token' });
      if (d.scenario === 'slow' && d.polls === 1) return out(400, { error: 'slow_down' });
      if (d.polls === 1 || (d.scenario === 'slow' && d.polls === 2)) return out(400, { error: 'authorization_pending' });
      devices.delete(f.device_code);
      return out(200, mint(d.resource));
    }
    if (f.grant_type === 'refresh_token') {
      seen.refresh.push(f);
      const r = refresh.get(f.refresh_token);
      if (!r || r.used || f.client_id !== 'bureau-cli' || f.resource !== r.resource) return out(400, { error: 'invalid_grant' });
      r.used = true;
      return out(200, mint(r.resource));
    }
    return out(400, { error: 'unsupported_grant_type' });
  }
  if (req.url === '/revoke') { seen.revoked.push(f); return out(200, {}); }
  out(404, {});
});

// ---- the fake hub: discovery, and /api/* taking an agent's access token ----
const hubCfg = { template: `${HUB}/mcp/agent/{agent}` };
const bearers = [];
const hub = http.createServer((req, res) => {
  const out = (code, obj) => { res.writeHead(code, { 'content-type': 'application/json' }); res.end(JSON.stringify(obj)); };
  if (req.url === '/.well-known/bureau') return out(200, { issuer: ISSUER, cli_client_id: 'bureau-cli', agents_url_template: hubCfg.template });
  const t = (req.headers.authorization || '').replace(/^Bearer /, '');
  bearers.push({ url: req.url, token: t });
  const resource = access.get(t);
  if (!resource || !resource.startsWith(`${HUB}/mcp/agent/`)) return out(401, { error: 'unauthorized' });
  const name = resource.slice(`${HUB}/mcp/agent/`.length);
  if (req.url === '/api/health') return out(200, { ok: true, credential: { kind: 'agent', name, projects: ['general'] } });
  if (req.url === '/api/context') { req.resume(); return out(200, { rendered: `passages for ${name}` }); }
  out(404, { error: 'not found' });
});

// ---- running the CLI, hub.sh and the hook ----
const outputs = []; // every stdout and stderr the user could see, for the leak check
// The node running this test comes first: hub.sh calls `node`, and a version
// manager's shim may not work under the temporary home.
const baseEnv = { PATH: `${path.dirname(process.execPath)}${path.delimiter}${process.env.PATH}`, SystemRoot: process.env.SystemRoot, TEMP: process.env.TEMP, TMP: process.env.TMP,
  HOME: home, USERPROFILE: home, BUREAU_LOGIN_STORE: 'file', BUREAU_CLI_TEST_SLEEP_SCALE: '0.05', BUREAU_URL: HUB,
  BUREAU_KEYCHAIN_SERVICE: 'bureau-test-no-such-item', BUREAU_TOKEN_FILE: path.join(home, 'fallback-token'), BUREAU_HOOK_LOG: path.join(home, 'hook.log') };
function run(cmd, args, { env = {}, input, keep = true, stdin = 'pipe' } = {}) {
  return new Promise((resolve) => {
    const c = spawn(cmd, args, { env: { ...baseEnv, ...env }, stdio: [stdin, 'pipe', 'pipe'] });
    let stdout = '', stderr = '';
    c.stdout.on('data', (d) => { stdout += d; });
    c.stderr.on('data', (d) => { stderr += d; });
    c.on('error', () => {});
    c.on('close', (code) => { if (keep) outputs.push(stdout, stderr); resolve({ code, stdout, stderr }); });
    if (c.stdin) c.stdin.end(input || '');
  });
}
const bureau = (args, opts) => run(process.execPath, [CLI, ...args], opts);
const saved = () => { try { return JSON.parse(fs.readFileSync(LOGIN_FILE, 'utf8')); } catch { return {}; } };
function setExpiry(key, at) { const all = saved(); all[key].expires_at = at; fs.writeFileSync(LOGIN_FILE, JSON.stringify(all)); }
const hookInput = JSON.stringify({ prompt: 'what is the plan', session_id: 'cli-1', cwd: home, hook_event_name: 'UserPromptSubmit' });

async function main() {
  await new Promise((r) => issuer.listen(ISSUER_PORT, '127.0.0.1', r));
  await new Promise((r) => hub.listen(HUB_PORT, '127.0.0.1', r));
  fs.writeFileSync(path.join(home, 'fallback-token'), FALLBACK);

  console.log('1. before login');
  let r = await bureau(['status']);
  check('status: not signed in, exit 1', r.code === 1 && /Not signed in/.test(r.stdout), r);
  r = await bureau(['token']);
  check('token: refuses with no sign-in, empty stdout', r.code === 1 && r.stdout === '' && /not signed in/.test(r.stderr), r);
  r = await bureau(['login', '--agent', '../evil']);
  check('a bad agent name is refused', r.code === 1 && /not an agent name/.test(r.stderr), r);
  r = await bureau(['login'], { env: { BUREAU_URL: 'http://hub.example.com' } });
  check('a plain http hub off this machine is refused', r.code === 1 && /https/.test(r.stderr), r);

  console.log('2. login, pending then approved');
  r = await bureau(['login']);
  check('exit 0', r.code === 0, r);
  check('prints the page and the code', r.stdout.includes(`${ISSUER}/activate`) && r.stdout.includes('WDJB-MJHT'), r.stdout);
  const dev = seen.device[seen.device.length - 1];
  check('asks for the agent address as the resource', dev.resource === `${HUB}/mcp/agent/consul`, dev);
  check('with the scope and the CLI client', dev.scope === 'openid email offline_access bureau' && dev.client_id === 'bureau-cli', dev);
  let all = saved();
  let rec = all[`${HOST}/consul`];
  check('kept under <hub host>/<agent>', !!rec && access.get(rec.access_token) === `${HUB}/mcp/agent/consul`, Object.keys(all));
  check('with every field', rec && rec.refresh_token && rec.expires_at > now() + 3000 && rec.issuer === ISSUER && rec.resource === `${HUB}/mcp/agent/consul` && rec.token_endpoint === `${ISSUER}/token` && rec.client_id === 'bureau-cli', rec);
  if (!WIN) {
    check('the file is 0600', (fs.statSync(LOGIN_FILE).mode & 0o777) === 0o600, (fs.statSync(LOGIN_FILE).mode & 0o777).toString(8));
    check('its folder is 0700', (fs.statSync(path.dirname(LOGIN_FILE)).mode & 0o777) === 0o700);
  }

  console.log('3. status, token, whoami');
  r = await bureau(['status']);
  check('status: signed in, hub, agent, expiry', r.code === 0 && /Signed in to/.test(r.stdout) && r.stdout.includes('consul') && r.stdout.includes(HUB) && /expires at \d{4}-/.test(r.stdout), r.stdout);
  r = await bureau(['token'], { keep: false });
  check('token into a pipe: the access token', r.code === 0 && r.stdout === `${rec.access_token}\n`, r.code);
  r = await bureau(['whoami']);
  check('whoami: name and kind from the hub', r.code === 0 && /consul \(agent\)/.test(r.stdout), r.stdout);
  check('the hub saw the access token', bearers[bearers.length - 1].token === rec.access_token);

  if (!WIN) {
    console.log('3b. token on a terminal');
    const script = process.platform === 'darwin'
      ? ['-q', '/dev/null', process.execPath, CLI, 'token']
      : ['-qec', `"${process.execPath}" "${CLI}" token`, '/dev/null'];
    r = await run('script', script, { stdin: 'ignore' });
    if (r.code === null || r.code === 127 || /not found|illegal option|usage|tcgetattr|ioctl/i.test(r.stderr)) console.log('  skip: no usable script(1) here');
    else check('refuses on a terminal and prints no token', /only writes into a pipe/.test(r.stdout + r.stderr) && !(r.stdout + r.stderr).includes(rec.access_token), r);
  }

  console.log('4. refresh near expiry');
  const oldAccess = rec.access_token, oldRefresh = rec.refresh_token;
  setExpiry(`${HOST}/consul`, now() + 30);
  r = await bureau(['token'], { keep: false });
  rec = saved()[`${HOST}/consul`];
  check('a new access token', r.code === 0 && r.stdout.trim() === rec.access_token && rec.access_token !== oldAccess, r.code);
  check('the rotated refresh token is kept', rec.refresh_token !== oldRefresh && refresh.has(rec.refresh_token) && refresh.get(oldRefresh).used);
  const lastRefresh = seen.refresh[seen.refresh.length - 1];
  check('the refresh names the resource and the client', lastRefresh.resource === `${HUB}/mcp/agent/consul` && lastRefresh.client_id === 'bureau-cli', lastRefresh.resource);
  r = await bureau(['token'], { keep: false });
  check('a fresh token is not refreshed again', r.stdout.trim() === rec.access_token && seen.refresh.length === 1, seen.refresh.length);

  console.log('5. slow_down, denied, expired');
  issuerCfg.scenario = 'slow';
  r = await bureau(['login', '--agent', 'sol']);
  check('slow_down: still signs in', r.code === 0 && !!saved()[`${HOST}/sol`], r);
  // Scaled by 0.05: 1 s before the first poll is 50 ms, 1 + 5 s after slow_down is 300 ms.
  const sd = seen.slowTimes;
  check('slow_down: waits 5 s longer after it', !!sd && sd.length === 3 && sd[1] - sd[0] >= 250, sd && sd.map((t) => t - sd[0]));
  issuerCfg.scenario = 'denied';
  r = await bureau(['login', '--agent', 'kassad']);
  check('denied: exit 1, says so, keeps nothing', r.code === 1 && /denied/.test(r.stderr) && !saved()[`${HOST}/kassad`], r);
  issuerCfg.scenario = 'expired';
  r = await bureau(['login', '--agent', 'kassad']);
  check('expired: exit 1, says so', r.code === 1 && /expired/.test(r.stderr) && !saved()[`${HOST}/kassad`], r);
  issuerCfg.scenario = 'ok';

  console.log('6. discovery that does not add up is refused');
  hubCfg.template = 'http://127.0.0.1:8199/mcp/agent/{agent}';
  r = await bureau(['login', '--agent', 'kassad']);
  check('an agent address on another server', r.code === 1 && /another server/.test(r.stderr), r.stderr);
  hubCfg.template = `${HUB}/mcp/agent/{agent}`;
  issuerCfg.issuerName = 'https://someone-else.example';
  r = await bureau(['login', '--agent', 'kassad']);
  check('issuer metadata naming another issuer', r.code === 1 && /another issuer/.test(r.stderr), r.stderr);
  issuerCfg.issuerName = ISSUER;

  if (!WIN) {
    console.log('7. hub.sh');
    r = await run('sh', [HUBSH, 'GET', '/api/health'], { keep: false });
    check('hub.sh calls the hub with the sign-in', r.code === 0 && /"name":"consul"/.test(r.stdout), r);
    check('the hub saw the access token', bearers[bearers.length - 1].token === saved()[`${HOST}/consul`].access_token);
    r = await run('sh', [HUBSH, 'GET', '/api/health'], { env: { BUREAU_AGENT: 'nobody' }, keep: false });
    check('no sign-in for the agent: falls back to the token file', bearers[bearers.length - 1].token === FALLBACK, bearers[bearers.length - 1].url);
  }

  console.log('8. the context hook');
  let h = await run(process.execPath, [HOOK], { input: hookInput });
  rec = saved()[`${HOST}/consul`];
  check('exit 0, hands back the passages', h.code === 0 && /passages for consul/.test(h.stdout), h);
  check('with the signed-in token', bearers[bearers.length - 1].token === rec.access_token);
  setExpiry(`${HOST}/consul`, now() + 20);
  const before = rec.access_token;
  h = await run(process.execPath, [HOOK], { input: hookInput });
  rec = saved()[`${HOST}/consul`];
  check('under 30 s left: refreshes and saves', h.code === 0 && rec.access_token !== before && bearers[bearers.length - 1].token === rec.access_token, h);
  setExpiry(`${HOST}/consul`, now() - 100);
  issuerCfg.tokenDelay = 1500;
  const t0 = Date.now();
  h = await run(process.execPath, [HOOK], { input: hookInput });
  const took = Date.now() - t0;
  issuerCfg.tokenDelay = 0;
  check('a slow issuer: gives up and uses the token file', h.code === 0 && bearers[bearers.length - 1].token === FALLBACK, bearers[bearers.length - 1].token === FALLBACK);
  check('without waiting for it', took < 1400, took);
  check('and keeps the stored sign-in as it was', saved()[`${HOST}/consul`].refresh_token === rec.refresh_token);
  h = await run(process.execPath, [HOOK], { input: hookInput, env: { BUREAU_URL: 'not a url' } });
  check('a bad hub address: exit 0, no output', h.code === 0 && h.stdout === '', h);
  all = saved();
  fs.writeFileSync(LOGIN_FILE, '{ not json');
  h = await run(process.execPath, [HOOK], { input: hookInput });
  check('a broken store: exit 0, the token file', h.code === 0 && bearers[bearers.length - 1].token === FALLBACK, h);
  all[`${HOST}/consul`].expires_at = now() + 3600;
  fs.writeFileSync(LOGIN_FILE, JSON.stringify(all));

  console.log('9. logout');
  const last = saved()[`${HOST}/consul`];
  r = await bureau(['logout']);
  check('exit 0, says so', r.code === 0 && /Signed out/.test(r.stdout), r);
  check('the refresh token is revoked at the issuer', seen.revoked.some((f) => f.token === last.refresh_token && f.token_type_hint === 'refresh_token' && f.client_id === 'bureau-cli'), seen.revoked.length);
  check('and the access token', seen.revoked.some((f) => f.token === last.access_token));
  check('the stored sign-in is gone', !saved()[`${HOST}/consul`] && !!saved()[`${HOST}/sol`], Object.keys(saved()));
  r = await bureau(['status']);
  check('status: not signed in', r.code === 1 && /Not signed in/.test(r.stdout));
  r = await bureau(['logout']);
  check('logout again: nothing to do, exit 0', r.code === 0 && /Nothing to do/.test(r.stdout));
  r = await bureau(['logout', '--agent', 'sol']);

  // Opt-in, macOS only: the real Keychain, under a test service, with the fake
  // issuer's tokens. Off by default so CI and other runs never touch a keychain.
  if (process.platform === 'darwin' && process.env.BUREAU_TEST_KEYCHAIN === '1') {
    console.log('9b. the Keychain store (BUREAU_TEST_KEYCHAIN=1)');
    // security finds the login keychain through HOME, so the real one here. No
    // refresh runs in this part, so nothing is written under it.
    const kc = { BUREAU_LOGIN_STORE: '', BUREAU_LOGIN_SERVICE: 'bureau-login-test', HOME: os.homedir() };
    r = await bureau(['login', '--agent', 'kctest'], { env: kc });
    check('login into the Keychain', r.code === 0 && /macOS Keychain \(service bureau-login-test, account 127\.0\.0\.1:8197\/kctest\)/.test(r.stdout), r);
    check('nothing written to the file', !saved()[`${HOST}/kctest`]);
    r = await bureau(['token', '--agent', 'kctest'], { env: kc, keep: false });
    check('token reads it back', r.code === 0 && access.get(r.stdout.trim()) === `${HUB}/mcp/agent/kctest`, r.code);
    r = await bureau(['whoami', '--agent', 'kctest'], { env: kc });
    check('whoami with it', r.code === 0 && /kctest \(agent\)/.test(r.stdout), r);
    h = await run(process.execPath, [HOOK], { input: hookInput, env: { ...kc, BUREAU_AGENT: 'kctest' } });
    check('the hook reads the Keychain item', h.code === 0 && /passages for kctest/.test(h.stdout), h);
    r = await bureau(['logout', '--agent', 'kctest'], { env: kc });
    check('logout deletes the item', r.code === 0 && (await bureau(['status', '--agent', 'kctest'], { env: kc })).code === 1, r);
  }

  console.log('10. no secret on screen');
  const leaks = [];
  for (const text of outputs) for (const v of issued) if (text.includes(v)) leaks.push(v.slice(0, 3));
  check(`no token, refresh token or device code in ${outputs.length} captured outputs`, leaks.length === 0, leaks);
}

main()
  .catch((e) => { FAIL++; console.log(`  FAIL: ${e.stack}`); })
  .finally(() => {
    issuer.close(); hub.close();
    try { fs.rmSync(home, { recursive: true, force: true }); } catch { /* best effort */ }
    console.log(`\n${PASS} passed, ${FAIL} failed`);
    process.exit(FAIL ? 1 : 0);
  });

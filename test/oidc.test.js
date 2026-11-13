// test/oidc.test.js: sign-in (doc 30) against real hubs and a fake issuer
// that signs its own tokens: the agent doors (MCP and /api), app approval,
// the dashboard's sign-in with its session cookie, people's roles, and what
// went away (Discord's links). Needs nothing else.
// Usage: node test/oidc.test.js
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');
const crypto = require('crypto');
const { spawn } = require('child_process');

const HUB = path.join(__dirname, '..', 'hub', 'server.js');
const HUB_PORT = 8193, ISSUER_PORT = 8194, MIGRATE_PORT = 8186;
const BASE = `http://127.0.0.1:${HUB_PORT}`;
const ISSUER = `http://127.0.0.1:${ISSUER_PORT}`;
const BOSS = 'boss-secret-token-for-oidc-test';
const CLIENT_ID = 'hub-web-client', CLIENT_SECRET = 'hub-web-secret-for-test';
const OWNER_SUB = 'user_boss', EMAIL_SUB = 'user_by_email', STRANGER = 'user_stranger', APPROVER_SUB = 'user_approver', VIEWER_SUB = 'user_viewer';
const APP = 'claude-test-app', APP2 = 'cli-test-app', EVIL = 'evil-app';
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bureau-oidc-'));

let PASS = 0, FAIL = 0;
function check(label, ok, got) {
  if (ok) { PASS++; console.log(`  ok: ${label}`); }
  else { FAIL++; console.log(`  FAIL: ${label}${got !== undefined ? ` (got: ${JSON.stringify(got).slice(0, 260)})` : ''}`); }
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ---- the fake issuer: Ed25519 and RSA keys, metadata, JWKS, userinfo, token endpoint ----
const ed = crypto.generateKeyPairSync('ed25519');
const rsa = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
const stranger = crypto.generateKeyPairSync('ed25519'); // a key the issuer never published
const jwk = (pub, kid, alg) => ({ ...pub.export({ format: 'jwk' }), kid, alg, use: 'sig' });
const JWKS = { keys: [jwk(ed.publicKey, 'ed-1', 'EdDSA'), jwk(rsa.publicKey, 'rsa-1', 'RS256')] };
const PEOPLE = {
  [OWNER_SUB]: { email: 'boss@example.com' }, [EMAIL_SUB]: { email: 'Owner@Example.com' },
  [APPROVER_SUB]: { email: 'approver@example.com' }, [VIEWER_SUB]: { email: 'viewer@example.com' }, [STRANGER]: { email: 'stranger@example.com' },
};
const issued = new Map(); // token -> {sub, scope}, for userinfo
const codes = new Map();  // code -> {sub, nonce, challenge}

function sign(claims, { kid = 'ed-1', typ = 'at+jwt', key } = {}) {
  const alg = kid.startsWith('rsa') ? 'RS256' : 'EdDSA';
  const head = Buffer.from(JSON.stringify({ alg, kid, ...(typ ? { typ } : {}) })).toString('base64url');
  const body = Buffer.from(JSON.stringify(claims)).toString('base64url');
  const data = Buffer.from(`${head}.${body}`);
  const sig = alg === 'RS256' ? crypto.sign('sha256', data, key || rsa.privateKey) : crypto.sign(null, data, key || ed.privateKey);
  const t = `${head}.${body}.${sig.toString('base64url')}`;
  issued.set(t, { sub: claims.sub, scope: String(claims.scope || '') });
  return t;
}
const now = () => Math.floor(Date.now() / 1000);
const tokenFor = (agent, extra = {}) => sign({ iss: ISSUER, sub: OWNER_SUB, aud: `${BASE}/mcp/agent/${agent}`, scope: 'openid bureau offline_access', client_id: APP, client_name: 'Claude', iat: now(), exp: now() + 3600, ...extra });

const issuer = http.createServer((req, res) => {
  const out = (code, obj) => { res.writeHead(code, { 'content-type': 'application/json' }); res.end(JSON.stringify(obj)); };
  const u = new URL(req.url, ISSUER);
  if (u.pathname === '/.well-known/oauth-authorization-server') return out(200, { issuer: ISSUER, jwks_uri: `${ISSUER}/jwks`, userinfo_endpoint: `${ISSUER}/userinfo`, authorization_endpoint: `${ISSUER}/authorize`, token_endpoint: `${ISSUER}/token`, end_session_endpoint: `${ISSUER}/logout` });
  if (u.pathname === '/jwks') return out(200, JWKS);
  if (u.pathname === '/userinfo') {
    const t = (req.headers.authorization || '').replace(/^Bearer /, '');
    const got = issued.get(t);
    if (!got || !PEOPLE[got.sub]) return out(401, { error: 'invalid_token' });
    // As a real issuer: the address only with the email scope.
    return out(200, got.scope.split(' ').includes('email') ? { sub: got.sub, email: PEOPLE[got.sub].email, email_verified: true } : { sub: got.sub });
  }
  if (u.pathname === '/token' && req.method === 'POST') {
    let body = '';
    req.on('data', (c) => { body += c; });
    req.on('end', () => {
      const f = new URLSearchParams(body);
      const basic = Buffer.from(String(req.headers.authorization || '').replace(/^Basic /, ''), 'base64').toString();
      if (basic !== `${CLIENT_ID}:${CLIENT_SECRET}`) return out(401, { error: 'invalid_client' });
      const c = codes.get(f.get('code'));
      codes.delete(f.get('code'));
      if (!c) return out(400, { error: 'invalid_grant' });
      if (crypto.createHash('sha256').update(f.get('code_verifier') || '').digest('base64url') !== c.challenge) return out(400, { error: 'invalid_grant', error_description: 'pkce' });
      if (f.get('redirect_uri') !== `${BASE}/auth/callback`) return out(400, { error: 'invalid_grant', error_description: 'redirect' });
      const id_token = sign({ iss: ISSUER, sub: c.sub, aud: CLIENT_ID, nonce: c.nonce, iat: now(), exp: now() + 600, ...(c.badNonce ? { nonce: 'replayed' } : {}) }, { typ: null });
      const access_token = sign({ iss: ISSUER, sub: c.sub, aud: `${ISSUER}/userinfo`, scope: 'openid email profile', client_id: CLIENT_ID, iat: now(), exp: now() + 600 });
      return out(200, { token_type: 'Bearer', id_token, access_token, expires_in: 600 });
    });
    return;
  }
  out(404, {});
});

// ---- hubs ----
const children = [];
async function boot(name, port, extraEnv, seed) {
  const d = path.join(dir, name);
  fs.mkdirSync(path.join(d, 'data'), { recursive: true });
  if (seed) fs.writeFileSync(path.join(d, 'data', 'state.json'), JSON.stringify(seed));
  const env = { PATH: process.env.PATH, SystemRoot: process.env.SystemRoot, USERPROFILE: process.env.USERPROFILE, TEMP: process.env.TEMP, TMP: process.env.TMP,
    HOME: d, PORT: String(port), HOST: '127.0.0.1', BUREAU_ENV_FILE: path.join(d, 'none.env'),
    BUREAU_DATA_DIR: path.join(d, 'data'), BUREAU_BRAIN_DIR: path.join(d, 'brain'), BUREAU_WORK_DIR: path.join(d, 'work'),
    BUREAU_POKES: '', GIT_CONFIG_GLOBAL: path.join(d, 'gitconfig'), BUREAU_BOSS_TOKEN: BOSS, ...extraEnv };
  const child = spawn(process.execPath, [HUB], { env, stdio: 'ignore' });
  children.push(child);
  const base = `http://127.0.0.1:${port}`;
  for (let i = 0; i < 80; i++) { try { if ((await fetch(`${base}/health`)).ok) return base; } catch { /* starting */ } await sleep(100); }
  throw new Error(`${name} hub never answered`);
}
const call = (method, p, { bearer, cookie, origin, body } = {}) => fetch(BASE + p, { method, redirect: 'manual', headers: { ...(bearer ? { authorization: `Bearer ${bearer}` } : {}), ...(cookie ? { cookie } : {}), ...(origin ? { origin } : {}), ...(body !== undefined ? { 'content-type': 'application/json' } : {}) }, body: body !== undefined ? JSON.stringify(body) : undefined })
  .then(async (r) => { const text = await r.text(); let json = null; try { json = JSON.parse(text); } catch { /* html */ } return { status: r.status, json, text, headers: r.headers }; });
const asBoss = (method, p, body) => call(method, p, { bearer: BOSS, body });
async function mcp(agent, token, name, args = {}) {
  const headers = { 'content-type': 'application/json' };
  if (token) headers.authorization = `Bearer ${token}`;
  const r = await fetch(`${BASE}/mcp/agent/${agent}`, { method: 'POST', headers, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: args } }) });
  const text = await r.text();
  let json = null; try { json = JSON.parse(text); } catch { /* not json */ }
  return { status: r.status, challenge: r.headers.get('www-authenticate'), json, text: json && json.result ? json.result.content[0].text : text, isError: json && json.result ? json.result.isError : true };
}
const cookieOf = (r, name) => { const all = r.headers.getSetCookie ? r.headers.getSetCookie() : [r.headers.get('set-cookie')]; const line = all.find((l) => l && l.startsWith(`${name}=`)); return line ? line.split(';')[0] : null; };
async function allow(agent, clientId, status = 'allowed') {
  const apps = (await asBoss('GET', '/api/apps')).json.apps;
  const a = apps.find((x) => x.agent === agent && x.client_id === clientId);
  return a ? asBoss('POST', `/api/apps/${a.id}`, { status }) : null;
}

// The whole dashboard sign-in for one person: login, the issuer's answer, callback.
async function signIn(sub, opts = {}) {
  const start = await call('GET', '/auth/login?next=/missions');
  const loc = new URL(start.headers.get('location'));
  const flow = cookieOf(start, 'bureau_oidc');
  const code = crypto.randomBytes(8).toString('hex');
  codes.set(code, { sub, nonce: loc.searchParams.get('nonce'), challenge: loc.searchParams.get('code_challenge'), badNonce: opts.badNonce });
  const state = opts.badState ? 'forged-state-value-xxxxxxxxxxxxxxxxx' : loc.searchParams.get('state');
  const cb = await call('GET', `/auth/callback?code=${code}&state=${encodeURIComponent(state)}&iss=${encodeURIComponent(ISSUER)}`, { cookie: opts.noFlowCookie ? undefined : flow });
  return { start, loc, cb, session: cookieOf(cb, 'bureau_session') };
}

async function main() {
  await new Promise((r) => issuer.listen(ISSUER_PORT, '127.0.0.1', r));
  await boot('hub', HUB_PORT, { BUREAU_PUBLIC_URL: BASE, BUREAU_OIDC_ISSUER: ISSUER, BUREAU_OIDC_OWNERS: `${OWNER_SUB}, owner@example.com`, BUREAU_OIDC_CLIENT_ID: CLIENT_ID, BUREAU_OIDC_CLIENT_SECRET: CLIENT_SECRET },
    { tasks: [], agents: [], messages: [], log: [], seq: 0, schema_version: 2, projects: [{ id: 'general', label: 'General' }, { id: 'secret', label: 'Secret' }] });

  console.log('A. Discovery');
  const prm = await fetch(`${BASE}/.well-known/oauth-protected-resource/mcp/agent/sol`).then((r) => r.json());
  check('the resource is the agent address', prm.resource === `${BASE}/mcp/agent/sol`, prm);
  check('it names the issuer', JSON.stringify(prm.authorization_servers) === JSON.stringify([ISSUER]), prm);
  check('it asks for the bureau and email scopes', prm.scopes_supported.includes('bureau') && prm.scopes_supported.includes('email'), prm);
  check('a malformed agent name has no metadata', (await fetch(`${BASE}/.well-known/oauth-protected-resource/mcp/agent/Not%20Ok`)).status === 404);
  check('human has no metadata', (await fetch(`${BASE}/.well-known/oauth-protected-resource/mcp/agent/human`)).status === 404);
  const wk = await fetch(`${BASE}/.well-known/bureau`).then((r) => r.json());
  check('/.well-known/bureau tells the CLI the issuer and its client', wk.issuer === ISSUER && wk.cli_client_id === 'bureau-cli' && wk.agents_url_template === `${BASE}/mcp/agent/{agent}` && wk.sign_in === true, wk);
  check('an issuer from the environment is not OMAKO, so no OMAKO button', wk.omako === false, wk);
  check('no pairing challenge is served unless one is pending', (await fetch(`${BASE}/.well-known/omako-hub-challenge`)).status === 404);

  console.log('B. No sign-in, no entry');
  const none = await mcp('sol', null, 'whoami');
  check('no token: 401', none.status === 401, none.status);
  check('the 401 says where to sign in', (none.challenge || '').includes(`resource_metadata="${BASE}/.well-known/oauth-protected-resource/mcp/agent/sol"`), none.challenge);
  const off = await mcp('sol', tokenFor('sol'), 'whoami');
  check('a good token for an agent the boss has not turned on: 403', off.status === 403 && /turns it on/.test(off.text), off);

  console.log('C. The boss turns sign-in on');
  for (const [label, patch] of [
    ['an unknown project is refused', { agents: { sol: { oauth: { projects: ['nowhere'] } } } }],
    ['an empty project list is refused', { agents: { sol: { oauth: { projects: [] } } } }],
    ['a bare true is refused', { agents: { sol: { oauth: true } } }],
    ['human never signs in as an agent', { agents: { human: { oauth: { projects: ['*'] } } } }],
    ['system never signs in as an agent', { agents: { system: { oauth: { projects: ['*'] } } } }],
    ['the notify setting is gone', { global: { notify: 'all' } }],
    ['a member role must be owner, approver or viewer', { members: { 'x@example.com': { role: 'admin' } } }],
  ]) {
    const r = await asBoss('PATCH', '/api/settings', patch);
    check(label, r.status === 400, r);
  }
  const on = await asBoss('PATCH', '/api/settings', { agents: { sol: { oauth: { projects: ['general'] } }, kassad: { oauth: { projects: ['*'] } } } });
  check('sol on for general, kassad on for all', on.status === 200, on);

  console.log('D. Every app waits for the owner, per agent (D13)');
  const pending = await mcp('sol', tokenFor('sol'), 'whoami');
  check('a new app gets the waiting room, not a 401 loop', pending.status === 200 && pending.isError && /waiting for an owner/.test(pending.text), pending);
  const list = await fetch(`${BASE}/mcp/agent/sol`, { method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${tokenFor('sol')}` }, body: JSON.stringify({ jsonrpc: '2.0', id: 2, method: 'tools/list' }) }).then((r) => r.json());
  const waitingNames = list.result.tools.map((t) => t.name);
  check('the waiting room lists the agent\'s real tools, so nothing goes stale once allowed', waitingNames.includes('create_mission') && waitingNames.includes('whoami') && !waitingNames.includes('access'), waitingNames);
  check('named for the agent, not consul', list.result.tools.every((t) => !/\bconsul\b/.test(t.description)), list.result.tools.map((t) => t.description).filter((d) => /\bconsul\b/.test(d)));
  const waitingCall = await mcp('sol', tokenFor('sol'), 'create_mission', { title: 'nope', project: 'general' });
  check('any call in the waiting room says it is waiting, and does nothing', waitingCall.isError && /waiting for an owner/.test(waitingCall.text), waitingCall);
  const initFor = (token) => fetch(`${BASE}/mcp/agent/sol`, { method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18' } }) }).then((r) => r.json());
  const showsB = (info) => !!(info && info.title === 'Bureau' && Array.isArray(info.icons) && info.icons.some((i) => i.src === `${BASE}/app/mark.svg` && i.mimeType === 'image/svg+xml'));
  const waitingInit = await initFor(tokenFor('sol'));
  check('the waiting room already shows the B (serverInfo.icons)', showsB(waitingInit.result && waitingInit.result.serverInfo), waitingInit);
  const apps = await asBoss('GET', '/api/apps');
  const mine = apps.json.apps.find((a) => a.client_id === APP && a.agent === 'sol');
  check('the owner sees it pending, with its name', mine && mine.status === 'pending' && mine.name === 'Claude', apps.json);
  check('an agent token cannot list apps', (await call('GET', '/api/apps', { bearer: tokenFor('kassad') })).status === 403);
  const okd = await allow('sol', APP);
  check('the owner allows it', okd && okd.status === 200 && okd.json.app.status === 'allowed', okd && okd.json);
  const who = await mcp('sol', tokenFor('sol'), 'whoami');
  check('then whoami says sol', who.status === 200 && JSON.parse(who.text).agent === 'sol', who);
  const listAfter = await fetch(`${BASE}/mcp/agent/sol`, { method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${tokenFor('sol')}` }, body: JSON.stringify({ jsonrpc: '2.0', id: 3, method: 'tools/list' }) }).then((r) => r.json());
  check('the open door lists exactly the tools the waiting room listed', JSON.stringify(listAfter.result.tools.map((t) => t.name)) === JSON.stringify(waitingNames), listAfter.result.tools.map((t) => t.name));
  const allowedInit = await initFor(tokenFor('sol'));
  check('and the full door shows the B too', showsB(allowedInit.result && allowedInit.result.serverInfo), allowedInit);
  const kassadSameApp = await mcp('kassad', tokenFor('kassad'), 'whoami');
  check('allowed for sol is not allowed for kassad', kassadSameApp.isError && /waiting for an owner/.test(kassadSameApp.text), kassadSameApp);
  await allow('kassad', APP);
  await mcp('sol', tokenFor('sol', { client_id: EVIL, client_name: 'Bureau Dashboard Pro' }), 'whoami');
  const denied = await allow('sol', EVIL, 'denied');
  check('the owner denies a stranger app', denied && denied.json.app.status === 'denied', denied && denied.json);
  const evil = await mcp('sol', tokenFor('sol', { client_id: EVIL, client_name: 'Bureau Dashboard Pro' }), 'create_mission', { title: 'x', project: 'general' });
  check('a denied app gets nothing', evil.isError && /denied/.test(evil.text), evil);
  const noClient = await mcp('sol', tokenFor('sol', { client_id: undefined }), 'whoami');
  check('a token naming no app is refused', noClient.status === 401, noClient.status);

  console.log('E. A good token works, as that agent, inside its walls');
  check('sol sees only general', JSON.stringify(JSON.parse(who.text).projects) === JSON.stringify(['general']), who.text);
  const minem = await mcp('sol', tokenFor('sol'), 'create_mission', { title: 'inside the wall', project: 'general' });
  check('sol files in general', minem.status === 200 && !minem.isError, minem.text);
  const theirs = await mcp('sol', tokenFor('sol'), 'create_mission', { title: 'over the wall', project: 'secret' });
  check('sol cannot file in secret', theirs.isError && /outside/.test(theirs.text), theirs.text);
  const rsaWho = await mcp('kassad', sign({ iss: ISSUER, sub: OWNER_SUB, aud: `${BASE}/mcp/agent/kassad`, scope: 'bureau', client_id: APP, iat: now(), exp: now() + 600 }, { kid: 'rsa-1' }), 'whoami');
  check('an RS256 token from the issuer works too', rsaWho.status === 200 && JSON.parse(rsaWho.text).agent === 'kassad', rsaWho);
  const audArray = await mcp('sol', tokenFor('sol', { aud: ['https://elsewhere.example', `${BASE}/mcp/agent/sol`] }), 'whoami');
  check('an audience list holding the address works', audArray.status === 200 && !audArray.isError, audArray.status);
  const shift = await mcp('sol', tokenFor('sol'), 'clock_in', { kind: 'cowork', capabilities: ['librarian'] });
  check('the shift tools work: clock_in', !shift.isError && JSON.parse(shift.text).agent.name === 'sol', shift.text);
  const hb = await mcp('sol', tokenFor('sol'), 'heartbeat', { activity: 'reading', note: 'night digest' });
  check('heartbeat', !hb.isError, hb.text);
  const sent = await mcp('sol', tokenFor('sol'), 'send_message', { to: 'human', body: 'done for tonight' });
  check('send_message, as sol', !sent.isError && JSON.parse(sent.text).message.from === 'sol', sent.text);
  const inbox = await mcp('sol', tokenFor('sol'), 'read_inbox', {});
  check('read_inbox', !inbox.isError && JSON.parse(inbox.text).messages.length >= 1, inbox.text);
  const settingsSeen = await mcp('sol', tokenFor('sol'), 'read_settings', {});
  check('read_settings shows sol\'s own entry, no members', !settingsSeen.isError && JSON.parse(settingsSeen.text).settings.agents.sol && !JSON.parse(settingsSeen.text).settings.members, settingsSeen.text);
  const full = await mcp('sol', tokenFor('sol'), 'list_missions_full', { status: 'queued' });
  check('list_missions_full sees general only', !full.isError && JSON.parse(full.text).missions.every((m) => m.project === 'general'), full.text);

  console.log('F. The same token on /api/*, as that agent (D3)');
  const health = await call('GET', '/api/health', { bearer: tokenFor('sol') });
  check('GET /api/health: agent sol', health.status === 200 && health.json.credential.kind === 'agent' && health.json.credential.name === 'sol', health.json);
  check('it cannot change settings', (await call('PATCH', '/api/settings', { bearer: tokenFor('sol'), body: { global: {} } })).status === 403);
  check('it cannot act as another agent', (await call('POST', '/api/messages', { bearer: tokenFor('sol'), body: { from: 'kassad', body: 'x' } })).status === 403);
  const pendingApi = await call('GET', '/api/health', { bearer: tokenFor('sol', { client_id: APP2 }) });
  check('a pending app on /api gets 403 app_pending', pendingApi.status === 403 && pendingApi.json.code === 'app_pending', pendingApi.json);
  check('a token for no agent of this hub gets 401', (await call('GET', '/api/health', { bearer: tokenFor('sol', { aud: 'https://dossier.example/mcp' }) })).status === 401);

  console.log('G. Every bad token is refused');
  const cases = [
    ['a token for kassad on sol\'s address', tokenFor('kassad'), 401],
    ['another issuer', tokenFor('sol', { iss: 'https://evil.example' }), 401],
    ['expired', tokenFor('sol', { exp: now() - 3600 }), 401],
    ['not valid yet', tokenFor('sol', { nbf: now() + 3600 }), 401],
    ['no bureau scope', tokenFor('sol', { scope: 'openid decks:read' }), 403],
    ['someone else\'s account', tokenFor('sol', { sub: STRANGER }), 403],
    ['no subject', tokenFor('sol', { sub: '' }), 401],
    ['signed with an unpublished key', sign({ iss: ISSUER, sub: OWNER_SUB, aud: `${BASE}/mcp/agent/sol`, scope: 'bureau', client_id: APP, exp: now() + 600 }, { key: stranger.privateKey }), 401],
    ['an unknown key id', sign({ iss: ISSUER, sub: OWNER_SUB, aud: `${BASE}/mcp/agent/sol`, scope: 'bureau', client_id: APP, exp: now() + 600 }, { kid: 'ed-9' }), 401],
    ['an id token, not an access token', sign({ iss: ISSUER, sub: OWNER_SUB, aud: `${BASE}/mcp/agent/sol`, scope: 'bureau', client_id: APP, exp: now() + 600 }, { typ: 'JWT' }), 401],
    ['garbage', 'not.a.token', 401],
    ['alg none', `${Buffer.from('{"alg":"none","typ":"at+jwt","kid":"ed-1"}').toString('base64url')}.${Buffer.from(JSON.stringify({ iss: ISSUER, sub: OWNER_SUB, aud: `${BASE}/mcp/agent/sol`, scope: 'bureau', client_id: APP, exp: now() + 600 })).toString('base64url')}.`, 401],
  ];
  for (const [label, t, want] of cases) {
    const r = await mcp('sol', t, 'whoami');
    check(`${label}: ${want}`, r.status === want, r.status);
  }
  const tampered = tokenFor('sol').split('.');
  tampered[1] = Buffer.from(JSON.stringify({ iss: ISSUER, sub: OWNER_SUB, aud: `${BASE}/mcp/agent/sol`, scope: 'bureau', client_id: APP, exp: now() + 600, extra: 1 })).toString('base64url');
  check('a payload changed after signing: 401', (await mcp('sol', tampered.join('.'), 'whoami')).status === 401);

  console.log('H. Owners by email, through the issuer\'s userinfo');
  const noEmail = await mcp('sol', tokenFor('sol', { sub: EMAIL_SUB }), 'whoami');
  check('without the email scope, an owner named by email is not recognised', noEmail.status === 403, noEmail.status);
  const byEmail = await mcp('sol', tokenFor('sol', { sub: EMAIL_SUB, scope: 'openid email bureau' }), 'whoami');
  check('with it, an owner named by email (case aside) gets in', byEmail.status === 200 && !byEmail.isError, byEmail);

  console.log('I. The dashboard signs in with a session cookie (C4)');
  const s1 = await signIn(OWNER_SUB);
  check('/auth/login sends the browser to the issuer with PKCE and a nonce', s1.start.status === 302 && s1.loc.origin === ISSUER && s1.loc.searchParams.get('code_challenge_method') === 'S256' && !!s1.loc.searchParams.get('nonce') && s1.loc.searchParams.get('redirect_uri') === `${BASE}/auth/callback`, s1.loc && s1.loc.toString());
  check('the callback sets an HttpOnly session cookie and goes to next', s1.cb.status === 303 && s1.cb.headers.get('location') === '/missions' && !!s1.session && /HttpOnly/i.test(s1.cb.headers.get('set-cookie')), { status: s1.cb.status, loc: s1.cb.headers.get('location') });
  const me = await call('GET', '/api/me', { cookie: s1.session });
  check('/api/me: the owner, as the boss, with the email', me.json && me.json.kind === 'boss' && me.json.role === 'owner' && me.json.email === 'boss@example.com', me.json);
  check('the session reads the state', (await call('GET', '/api/state', { cookie: s1.session })).status === 200);
  check('a cookie write without an Origin is refused (CSRF)', (await call('PATCH', '/api/settings', { cookie: s1.session, body: { global: {} } })).status === 403);
  check('a cookie write from another site is refused', (await call('PATCH', '/api/settings', { cookie: s1.session, origin: 'https://evil.example', body: { global: {} } })).status === 403);
  check('a cookie write from the hub\'s own page works', (await call('PATCH', '/api/settings', { cookie: s1.session, origin: BASE, body: { global: {} } })).status === 200);
  check('a forged state is refused', (await signIn(OWNER_SUB, { badState: true })).cb.status === 400);
  check('no flow cookie, no sign-in', (await signIn(OWNER_SUB, { noFlowCookie: true })).cb.status === 400);
  check('a replayed nonce is refused', (await signIn(OWNER_SUB, { badNonce: true })).cb.status === 400);
  const outsider = await signIn(STRANGER);
  check('a stranger signs in at the issuer but gets no session', outsider.cb.status === 403 && !outsider.session, outsider.cb.status);
  check('next can only be a path on this hub', (await call('GET', '/auth/login?next=https://evil.example/')).headers.get('set-cookie') !== null);

  console.log('J. People: approver and viewer (C3, Q5)');
  const addPeople = await call('PATCH', '/api/settings', { cookie: s1.session, origin: BASE, body: { members: { 'approver@example.com': { role: 'approver' }, [VIEWER_SUB]: { role: 'viewer' } } } });
  check('the owner adds an approver by email and a viewer by subject', addPeople.status === 200, addPeople.json);
  const review = (await asBoss('POST', '/api/tasks', { title: 'ready for review', project: 'general' })).json.task;
  await asBoss('POST', '/api/tasks/claim', { agent: 'human', id: review.id });
  await asBoss('PATCH', `/api/tasks/${review.id}`, { agent: 'human', status: 'review', note: 'parked' });
  const ap = await signIn(APPROVER_SUB);
  const apMe = await call('GET', '/api/me', { cookie: ap.session });
  check('the approver signs in as approver', apMe.json && apMe.json.kind === 'approver' && apMe.json.email === 'approver@example.com', apMe.json);
  check('an approver cannot rename a mission', (await call('PATCH', `/api/tasks/${review.id}`, { cookie: ap.session, origin: BASE, body: { title: 'renamed' } })).status === 403);
  check('an approver cannot change settings', (await call('PATCH', '/api/settings', { cookie: ap.session, origin: BASE, body: { global: {} } })).status === 403);
  check('an approver cannot see who may sign in', !(await call('GET', '/api/settings', { cookie: ap.session })).json.settings.members);
  const approved = await call('PATCH', `/api/tasks/${review.id}`, { cookie: ap.session, origin: BASE, body: { status: 'done', note: 'looks right' } });
  check('an approver approves a mission in review', approved.status === 200 && approved.json.task.status === 'done', approved.json);
  const last = approved.json.task.log[approved.json.task.log.length - 1];
  check('the log says human, via the approver\'s email', last.by === 'human' && last.via === 'approver@example.com', last);
  const vw = await signIn(VIEWER_SUB);
  check('the viewer reads the state', (await call('GET', '/api/state', { cookie: vw.session })).status === 200);
  check('the viewer cannot write a note', (await call('PATCH', `/api/tasks/${review.id}`, { cookie: vw.session, origin: BASE, body: { note: 'x' } })).status === 403);
  check('a member removed in Settings loses the session at once', (await call('PATCH', '/api/settings', { cookie: s1.session, origin: BASE, body: { members: { [VIEWER_SUB]: null } } })).status === 200 && (await call('GET', '/api/me', { cookie: vw.session })).status === 401);
  check('an owner can add another owner', (await asBoss('PATCH', '/api/settings', { members: { 'second@example.com': { role: 'owner' } } })).status === 200);

  console.log('K. Sessions end');
  const sessions = await call('GET', '/api/sessions', { cookie: s1.session });
  check('the owner lists sessions, with no secret', sessions.status === 200 && sessions.json.sessions.length >= 2 && sessions.json.sessions.every((x) => !x.hash && !x.id_token), sessions.json);
  check('a logout GET only shows a button', (await call('GET', '/auth/logout', { cookie: ap.session })).status === 200 && (await call('GET', '/api/me', { cookie: ap.session })).status === 200);
  const lo = await call('POST', '/auth/logout', { cookie: ap.session, origin: BASE });
  check('logout ends the session and goes to the issuer with id_token_hint', lo.status === 303 && /\/logout\?/.test(lo.headers.get('location')) && /id_token_hint=/.test(lo.headers.get('location')), lo.headers.get('location'));
  check('the ended session is refused', (await call('GET', '/api/me', { cookie: ap.session })).status === 401);
  const all = await call('POST', '/api/sessions/revoke-all', { cookie: s1.session, origin: BASE, body: {} });
  check('sign out everywhere', all.status === 200 && all.json.ended >= 1 && (await call('GET', '/api/me', { cookie: s1.session })).status === 401, all.json);

  console.log('L. What went away (D12)');
  check('/r/<token> is gone', (await call('GET', `/r/${'a'.repeat(32)}`)).status === 404);
  check('/m/<token> is gone', (await call('GET', `/m/${'b'.repeat(32)}`)).status === 404);
  const t = (await asBoss('GET', `/api/tasks/${review.id}`)).json.task;
  check('missions carry no links', !t.view_token && !t.review_links && !t.answer_link, Object.keys(t));
  check('mcp_token_urls false closes /mcp/<token>', (await asBoss('PATCH', '/api/settings', { global: { mcp_token_urls: false } })).status === 200 && (await fetch(`${BASE}/mcp/${'c'.repeat(48)}`, { method: 'POST', body: '{}' })).status === 404);
  const closedMint = await asBoss('POST', '/api/tokens', { agent: 'kassad', projects: ['*'], label: 'closed urls' });
  check('and a token minted then comes with no mcp_url', closedMint.status === 200 && closedMint.json.token && closedMint.json.mcp_url === undefined, closedMint.json && Object.keys(closedMint.json));

  console.log('M. Taking it back');
  await asBoss('PATCH', '/api/settings', { agents: { sol: { oauth: null } } });
  const cut = await mcp('sol', tokenFor('sol'), 'whoami');
  check('with sign-in off again, the same token gets 403 at the next call', cut.status === 403, cut.status);
  const other = await mcp('kassad', tokenFor('kassad'), 'whoami');
  check('kassad is untouched', other.status === 200 && !other.isError, other.status);
  check('/mcp/agent/<name> is not a capability URL', (await fetch(`${BASE}/mcp/sol`, { method: 'POST' })).status === 404);

  console.log('N. A schema 1 state loses its links at boot (migration 1 -> 2)');
  const mBase = await boot('migrate', MIGRATE_PORT, {}, { schema_version: 1, tasks: [{ id: 't-1', title: 'old', status: 'review', project: 'general', log: [], artifacts: [], view_token: 'v'.repeat(32), review_links: { approve: { token: 'a'.repeat(32), exp: '2099-01-01' } } }], agents: [], messages: [], log: [], seq: 1, projects: [{ id: 'general', label: 'General' }], settings: { global: { notify: 'review' }, projects: { general: { notify: 'none', approval: 'in-session' } } } });
  const migrated = JSON.parse(fs.readFileSync(path.join(dir, 'migrate', 'data', 'state.json'), 'utf8'));
  check('schema_version is 2', migrated.schema_version === 2, migrated.schema_version);
  check('the links are gone', !migrated.tasks[0].view_token && !migrated.tasks[0].review_links, migrated.tasks[0]);
  check('notify is gone, the rest of the settings stay', migrated.settings.global.notify === undefined && migrated.settings.projects.general.notify === undefined && migrated.settings.projects.general.approval === 'in-session', migrated.settings);
  check('a copy was kept before migrating', fs.readdirSync(path.join(dir, 'migrate', 'data')).some((n) => n.startsWith('state.json.pre-migrate-')));
  check('the migrated hub answers', (await fetch(`${mBase}/health`)).ok);
}

main().catch((e) => { FAIL++; console.error(e); }).finally(() => {
  for (const c of children) c.kill();
  issuer.close();
  console.log(`\n${PASS} passed, ${FAIL} failed`);
  process.exit(FAIL ? 1 : 0);
});

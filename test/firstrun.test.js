// The first run (lib/firstrun.js): a hub started with no token makes its own,
// prints a one-time link that signs its owner in, and never runs open. A
// restart prints no link; tools/sign-in-link.js makes a new one. Legacy hubs,
// and hubs that already hold data, stay as they were.
// Run: node test/firstrun.test.js
'use strict';
const { spawn, spawnSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'bureau-firstrun-'));
const PORT = 8391;
const env = { PATH: process.env.PATH, SYSTEMROOT: process.env.SYSTEMROOT, HOME: DIR, USERPROFILE: DIR, PORT: String(PORT), HOST: '127.0.0.1',
  BUREAU_ENV_FILE: path.join(DIR, 'no.env'), BUREAU_DATA_DIR: path.join(DIR, 'data'), BUREAU_BRAIN_DIR: path.join(DIR, 'brain'), BUREAU_WORK_DIR: path.join(DIR, 'work'),
  GIT_CONFIG_GLOBAL: process.platform === 'win32' ? 'NUL' : '/dev/null', BUREAU_STORE: process.env.BUREAU_STORE, BUREAU_OMAKO_URL: 'http://127.0.0.1:9' };
for (const k of Object.keys(env)) if (env[k] === undefined) delete env[k];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let passed = 0, failed = 0;
function check(name, ok, info) {
  if (ok) { passed++; console.log(`  ok: ${name}`); } else { failed++; console.log(`  FAIL: ${name}${info === undefined ? '' : ` (got: ${JSON.stringify(info)})`}`); }
}

async function start() {
  let log = '';
  const p = spawn(process.execPath, [path.join(ROOT, 'hub/server.js')], { env });
  p.stdout.on('data', (d) => { log += d; }); p.stderr.on('data', (d) => { log += d; });
  for (let i = 0; i < 150 && p.exitCode === null; i++) { if (/listening/.test(log) && (/sign-in-link/.test(log) || i > 40)) break; await sleep(100); }
  await sleep(300);
  return { p, log: () => log };
}
async function stop(h) { h.p.kill(); for (let i = 0; i < 50 && h.p.exitCode === null && h.p.signalCode === null; i++) await sleep(100); }
const post = (body) => fetch(`http://127.0.0.1:${PORT}/api/setup/claim`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })
  .then(async (r) => ({ code: r.status, json: await r.json().catch(() => null) }));
const keyIn = (text) => (/\/setup#key=([A-Za-z0-9_-]+)/.exec(text) || [])[1];

(async () => {
  console.log('A. a brand-new hub with no token');
  let h = await start();
  check('it boots', h.p.exitCode === null, h.log().slice(0, 300));
  check('in strict mode', /Auth mode: strict/.test(h.log()), h.log().slice(0, 300));
  const key = keyIn(h.log());
  check('and prints a one-time link', !!key, h.log().slice(-300));
  check('to this computer when no public address is set', /http:\/\/localhost:8391\/setup#key=/.test(h.log()));
  const tokenFile = path.join(DIR, 'data', 'boss-token');
  check('its token is in the data folder', fs.existsSync(tokenFile));
  if (process.platform !== 'win32') check('readable only by the hub\'s account', (fs.statSync(tokenFile).mode & 0o777) === 0o600, (fs.statSync(tokenFile).mode & 0o777).toString(8));
  const open = await fetch(`http://127.0.0.1:${PORT}/api/tasks`).then((r) => r.status);
  check('with no credential, nothing opens', open === 401, open);

  console.log('B. the link, once');
  let r = await post({ key: 'wrong' });
  check('a wrong key is refused', r.code === 403, r);
  r = await post({});
  check('no key is refused', r.code === 403, r);
  r = await post({ key });
  const tok = r.json && r.json.token;
  check('the key gives the boss token', r.code === 200 && tok === fs.readFileSync(tokenFile, 'utf8').trim(), r.code);
  const me = await fetch(`http://127.0.0.1:${PORT}/api/me`, { headers: { authorization: `Bearer ${tok}` } }).then((x) => x.json());
  check('which is the owner', me.kind === 'boss' && me.role === 'owner', me);
  r = await post({ key });
  check('the same key twice is refused', r.code === 403, r);
  check('the key is kept only as a hash', !fs.readFileSync(path.join(DIR, 'data', 'setup-done'), 'utf8').includes(key) && !fs.existsSync(path.join(DIR, 'data', 'setup-key.json')));
  await stop(h);

  console.log('C. a restart, and the tool');
  h = await start();
  check('a restart prints no link', !/setup#key=/.test(h.log()), h.log().slice(-300));
  const t = spawnSync(process.execPath, [path.join(ROOT, 'hub/tools/sign-in-link.js')], { env, encoding: 'utf8' });
  const key2 = keyIn(t.stdout);
  check('the tool prints a new link', !!key2, t.stdout + t.stderr);
  r = await post({ key: key2 });
  check('and it signs in as the same owner', r.code === 200 && r.json.token === tok, r.code);
  const minted = spawnSync(process.execPath, [path.join(ROOT, 'hub/tools/token.js'), 'mint', 'first', 'general'], { env, encoding: 'utf8' });
  check('token.js acts as the boss with the hub\'s own token', /minted tok-/.test(minted.stdout), minted.stdout + minted.stderr);
  await stop(h);

  console.log('D. what stays as it was');
  const legacy = spawnSync(process.execPath, [path.join(ROOT, 'hub/tools/sign-in-link.js')], { env: { ...env, BUREAU_DATA_DIR: path.join(DIR, 'legacy'), BUREAU_TOKEN: 'a'.repeat(64) }, encoding: 'utf8' });
  check('a legacy hub: the tool says why it can\'t', legacy.status === 1, legacy.stdout + legacy.stderr);
  check('and no token is made', !fs.existsSync(path.join(DIR, 'legacy', 'boss-token')));
  const d3 = path.join(DIR, 'old');
  fs.mkdirSync(d3, { recursive: true });
  fs.copyFileSync(path.join(DIR, 'data', 'state.json'), path.join(d3, 'state.json'));
  const old = spawnSync(process.execPath, [path.join(ROOT, 'hub/server.js')], { env: { ...env, BUREAU_DATA_DIR: d3, BUREAU_BRAIN_DIR: path.join(DIR, 'brain-old') }, encoding: 'utf8', timeout: 10000 });
  check('a hub that holds data and lost its tokens still refuses to boot', old.status === 1 && /will not start/.test(old.stderr + old.stdout), (old.stderr + old.stdout).slice(0, 300));
  check('and makes no token', !fs.existsSync(path.join(d3, 'boss-token')));
  const own = await (async () => {
    const e2 = { ...env, BUREAU_DATA_DIR: path.join(DIR, 'own'), BUREAU_BRAIN_DIR: path.join(DIR, 'brain-own'), BUREAU_BOSS_TOKEN: 'b'.repeat(64) };
    let log = '';
    const p = spawn(process.execPath, [path.join(ROOT, 'hub/server.js')], { env: e2 });
    p.stdout.on('data', (d) => { log += d; }); p.stderr.on('data', (d) => { log += d; });
    for (let i = 0; i < 150 && !/listening/.test(log); i++) await sleep(100);
    await sleep(300);
    p.kill();
    return log;
  })();
  check('a hub with its own BUREAU_BOSS_TOKEN prints no link', /listening/.test(own) && !/setup#key=/.test(own), own.slice(-300));
  check('and makes no token file', !fs.existsSync(path.join(DIR, 'own', 'boss-token')));

  console.log(`passed ${passed}, failed ${failed}`);
  try { fs.rmSync(DIR, { recursive: true, force: true }); } catch { /* a Windows lock: the temp dir goes later */ }
  process.exit(failed ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });

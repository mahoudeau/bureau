// test/backup.test.js: the nightly off-server backup (doc 31). The encryption
// and its file format, the rules (retention, the 03:30 clock, the operator's
// red line, the settings), then real hubs on SQLite against a WebDAV stand-in
// in this file (no real Nextcloud): a full run, the byte comparison catching
// a changed upload, retention, the operator-only routes, and the CLI's
// keygen, verify and decrypt under a temporary home with the file key store,
// never the Keychain. The hub parts are skipped on a Node without node:sqlite.
// Usage: node test/backup.test.js    (ports 8241 and 8242, and one the system picks)
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');
const zlib = require('zlib');
const { spawn } = require('child_process');

const ROOT = path.join(__dirname, '..');
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bureau-backup-'));
// Required in this process for the unit parts: point them at nothing real.
Object.assign(process.env, { BUREAU_DATA_DIR: path.join(dir, 'unit-data'), BUREAU_BRAIN_DIR: path.join(dir, 'unit-brain'), BUREAU_WORK_DIR: path.join(dir, 'unit-work'), BUREAU_ENV_FILE: path.join(dir, 'none.env') });
delete process.env.BUREAU_STORE;
const bc = require(path.join(ROOT, 'hub', 'lib', 'backup-crypto'));
const backup = require(path.join(ROOT, 'hub', 'lib', 'backup'));
const auth = require(path.join(ROOT, 'hub', 'lib', 'auth'));
const cli = require(path.join(ROOT, 'connectors', 'cli', 'bureau.js'));

const CLI = path.join(ROOT, 'connectors', 'cli', 'bureau.js');
const HUB = path.join(ROOT, 'hub', 'server.js');
const PORT = 8241, HALF_PORT = 8242;
const BOSS = 'boss-secret-token-for-backup-test';
const DAV_USER = 'u', DAV_PW = 'app-pw-very-secret-1234';
const HUB_ID = 'hub-backup-test';
let PASS = 0, FAIL = 0;
function check(label, ok, got) {
  if (ok) { PASS++; console.log(`  ok: ${label}`); }
  else { FAIL++; console.log(`  FAIL: ${label}${got !== undefined ? ` (got: ${JSON.stringify(got).slice(0, 300)})` : ''}`); }
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const throwsWith = (fn, re) => { try { fn(); return false; } catch (e) { return re.test(e.message); } };

// ---------- the encryption ----------
function cryptoPart() {
  console.log('1. encryption: round trip, the format, tampering refused');
  const pair = bc.generateKeyPair();
  check('a public key reads x25519:, a private one x25519-private:', /^x25519:[A-Za-z0-9+/]{43}=$/.test(pair.publicKey) && /^x25519-private:/.test(pair.privateKey), pair.publicKey);
  check('the public key follows from the private one', bc.publicKeyOf(pair.privateKey) === pair.publicKey);
  const plain = Buffer.concat([Buffer.from('SQLite format 3\0'), require('crypto').randomBytes(5000)]);
  const blob = bc.encrypt(plain, pair.publicKey);
  check('round trip, byte for byte', bc.decrypt(blob, pair.privateKey).equals(plain));
  check('the file: magic BRBK, version 1, then 57 header bytes, ciphertext and a 16-byte tag', blob.subarray(0, 4).toString() === 'BRBK' && blob[4] === 1 && blob.length === 57 + plain.length + 16, blob.length);
  check('two encryptions of the same bytes differ (a fresh key each time)', !bc.encrypt(plain, pair.publicKey).equals(blob));
  check('an empty input round-trips', bc.decrypt(bc.encrypt(Buffer.alloc(0), pair.publicKey), pair.privateKey).length === 0);
  const flip = (i) => { const b = Buffer.from(blob); b[i] ^= 1; return b; };
  check('a changed byte of ciphertext is refused', throwsWith(() => bc.decrypt(flip(100), pair.privateKey), /changed or damaged/));
  check('a changed tag is refused', throwsWith(() => bc.decrypt(flip(blob.length - 1), pair.privateKey), /changed or damaged/));
  check('a changed nonce is refused', throwsWith(() => bc.decrypt(flip(50), pair.privateKey), /changed or damaged/));
  check('a changed ephemeral key is refused', throwsWith(() => bc.decrypt(flip(20), pair.privateKey), /damaged/));
  check('a cut file is refused', throwsWith(() => bc.decrypt(blob.subarray(0, blob.length - 5), pair.privateKey), /changed or damaged/));
  check('a file that is not a backup is refused', throwsWith(() => bc.decrypt(Buffer.from('hello world, not a backup at all, nothing to see here, really not'), pair.privateKey), /not a Bureau backup/));
  check('a newer format is named', throwsWith(() => bc.decrypt(flip(4), pair.privateKey), /format 0 is unknown/));
  check('another key is named as such', throwsWith(() => bc.decrypt(blob, bc.generateKeyPair().privateKey), /another key/));
  check('a bad public key is refused in plain words', throwsWith(() => bc.encrypt(plain, 'x25519:abc'), /32 bytes/) && throwsWith(() => bc.parsePublicKey('ssh-ed25519 AAAA'), /start with x25519:/));

  console.log('2. the CLI reads what the hub writes');
  const fromCli = cli.backupKeyPair();
  check('a pair made by the CLI encrypts on the hub and decrypts in the CLI', cli.backupDecrypt(bc.encrypt(plain, fromCli.public_key), fromCli.private_key).equals(plain));
  check('a pair made by the hub decrypts in the CLI', cli.backupDecrypt(blob, pair.privateKey).equals(plain));
  check('the CLI derives the same public key', cli.backupPublicOf(pair.privateKey) === pair.publicKey);
  check('the CLI refuses a changed file too', throwsWith(() => cli.backupDecrypt(flip(100), pair.privateKey), /changed or damaged/));
  check('and a file for another key', throwsWith(() => cli.backupDecrypt(blob, fromCli.private_key), /another key/));
}

// ---------- the rules ----------
function rulesPart() {
  console.log('3. retention, the clock, the settings');
  const names = ['bureau-2026-10-08.db.gz.enc', 'bureau-2026-09-09.db.gz.enc', 'bureau-2026-09-07.db.gz.enc', 'bureau-2026-03-01.db.gz.enc', 'bureau-2025-09-01.db.gz.enc', 'notes.txt'];
  const { keep, drop } = backup.keepRemote(names, '2026-10-08');
  check('the remote keeps 30 days and the 1st of each month for a year', JSON.stringify(keep) === JSON.stringify(['bureau-2026-10-08.db.gz.enc', 'bureau-2026-09-09.db.gz.enc', 'bureau-2026-03-01.db.gz.enc']), keep);
  check('and drops the rest, never a file that is not a copy', JSON.stringify(drop) === JSON.stringify(['bureau-2026-09-07.db.gz.enc', 'bureau-2025-09-01.db.gz.enc']), drop);
  check('the next run is at 03:30 Paris time (summer)', backup.msUntilNext(new Date('2026-07-01T01:00:00Z')) === 30 * 60_000);
  check('and tomorrow once past it', backup.msUntilNext(new Date('2026-07-01T02:00:00Z')) === 23.5 * 3600_000);
  check('winter: 02:00 UTC is 03:00 in Paris', backup.msUntilNext(new Date('2026-01-15T02:00:00Z')) === 30 * 60_000);
  check('the day is Paris\'s', backup.parisDay(new Date('2026-11-14T23:30:00Z')) === '2026-11-15');
  const pub = bc.generateKeyPair().publicKey;
  const full = { BUREAU_BACKUP_PUBLIC_KEY: pub, BUREAU_NEXTCLOUD_URL: 'https://cloud.example', BUREAU_NEXTCLOUD_USER: 'u', BUREAU_NEXTCLOUD_PASSWORD: 'p' };
  check('nothing set: off, nothing to say', JSON.stringify(backup.configFromEnv({}, 'sqlite')) === JSON.stringify({ on: false, problem: null }));
  const on = backup.configFromEnv(full, 'sqlite');
  check('everything set on SQLite: on, folder Bureau-backup by default', on.on && on.remote.dir === 'Bureau-backup', on.problem);
  check('a folder of its own', backup.configFromEnv({ ...full, BUREAU_NEXTCLOUD_DIR: '/Other/' }, 'sqlite').remote.dir === 'Other');
  check('on the file store it says it needs SQLite', /SQLite/.test(backup.configFromEnv(full, 'json').problem || ''));
  check('half set: names what is missing', /BUREAU_NEXTCLOUD_PASSWORD missing/.test(backup.configFromEnv({ ...full, BUREAU_NEXTCLOUD_PASSWORD: '' }, 'sqlite').problem || ''));
  check('a bad public key is named', /BUREAU_BACKUP_PUBLIC_KEY/.test(backup.configFromEnv({ ...full, BUREAU_BACKUP_PUBLIC_KEY: 'nope' }, 'sqlite').problem || ''));
  check('plain http is refused off this machine', /https/.test(backup.configFromEnv({ ...full, BUREAU_NEXTCLOUD_URL: 'http://cloud.example' }, 'sqlite').problem || ''));
  check('and allowed to it (the tests)', backup.configFromEnv({ ...full, BUREAU_NEXTCLOUD_URL: 'http://127.0.0.1:9' }, 'sqlite').on);
  check('a folder with .. in it is refused', !backup.configFromEnv({ ...full, BUREAU_NEXTCLOUD_DIR: 'a/../b' }, 'sqlite').on);

  console.log('4. the Desk notice: what the operator hears about');
  const now = new Date('2026-11-14T12:00:00Z');
  const ago = (h) => new Date(now.getTime() - h * 3600_000).toISOString();
  const base = { configured: true, problem: null, lastRun: null, lastOkAt: ago(10), lastOkCheckAt: ago(24 * 10), since: ago(24 * 100) };
  check('all good: nothing', backup.alertsFor(base, now).length === 0);
  const stale = backup.alertsFor({ ...base, lastOkAt: ago(37), lastRun: { ok: 0, detail: 'sending failed: 500' } }, now);
  check('no good backup in 36 hours: one line, with the last run\'s reason', stale.length === 1 && /36 hours/.test(stale[0]) && /sending failed: 500/.test(stale[0]), stale);
  check('35 hours is still fine', backup.alertsFor({ ...base, lastOkAt: ago(35) }, now).length === 0);
  const late = backup.alertsFor({ ...base, lastOkCheckAt: ago(24 * 36) }, now);
  check('no good check on the Mac in 35 days: one line, saying what to run', late.length === 1 && /35 days/.test(late[0]) && /bureau backup verify/.test(late[0]), late);
  check('both at once: two lines', backup.alertsFor({ ...base, lastOkAt: null, lastOkCheckAt: null }, now).length === 2);
  check('a hub set up an hour ago is not late yet', backup.alertsFor({ ...base, lastOkAt: null, lastOkCheckAt: null, since: ago(1) }, now).length === 0);
  check('a half-set backup says so, and only that', JSON.stringify(backup.alertsFor({ ...base, configured: false, problem: 'half' }, now)) === '["half"]');
  check('a hub without the backup: nothing', backup.alertsFor({ configured: false, problem: null }, now).length === 0);
  const desk = fs.readFileSync(path.join(ROOT, 'hub', 'public', 'app', 'desk', 'backup.js'), 'utf8');
  check('the Desk shows the hub\'s alerts in an alarm banner, and stops asking on a 404', /\/api\/backups/.test(desk) && /status\.alerts/.test(desk) && /om-banner-edge om-cross/.test(desk) && /404/.test(desk));
  check('and the Desk page carries it', /backupNotice/.test(fs.readFileSync(path.join(ROOT, 'hub', 'public', 'app', 'pages', 'desk.js'), 'utf8')));

  console.log('5. who the operator is');
  const keep2 = { o: process.env.BUREAU_OPERATORS, w: process.env.BUREAU_OIDC_OWNERS };
  process.env.BUREAU_OIDC_OWNERS = 'Owner@Example.com';
  delete process.env.BUREAU_OPERATORS;
  const sess = (email, kind = 'boss') => ({ kind, name: 'human', session: true, email, via: email, projects: '*' });
  check('the boss token is the operator', auth.isOperator({ kind: 'boss', name: 'human', projects: '*' }));
  check('without BUREAU_OPERATORS, the owners on the server are', auth.isOperator(sess('owner@example.com')));
  check('a signed-in owner from Settings is not', !auth.isOperator(sess('customer@example.com')));
  process.env.BUREAU_OPERATORS = 'ops@host.example, other@host.example';
  check('BUREAU_OPERATORS replaces the owners', auth.isOperator(sess('OPS@host.example')) && !auth.isOperator(sess('owner@example.com')));
  check('an agent, the shared token, a viewer are not', !auth.isOperator({ kind: 'agent', name: 'w', projects: '*' }) && !auth.isOperator({ kind: 'shared', name: null, projects: '*' }) && !auth.isOperator(sess('x@y.z', 'viewer')));
  check('a refusal is a 404, judged before any other rule', JSON.stringify(auth.checkRule('operator', sess('x@y.z', 'viewer'), 'POST', '/api/backups/verified')) === JSON.stringify({ status: 404, error: 'not found' }));
  if (keep2.o === undefined) delete process.env.BUREAU_OPERATORS; else process.env.BUREAU_OPERATORS = keep2.o;
  if (keep2.w === undefined) delete process.env.BUREAU_OIDC_OWNERS; else process.env.BUREAU_OIDC_OWNERS = keep2.w;
}

// ---------- a Nextcloud stand-in ----------
// The WebDAV verbs the backup uses, files in memory. mode: 'ok', 'fail'
// (every answer a 500), 'corrupt' (a GET hands back one byte changed).
function fakeDav() {
  const files = new Map();
  const dirs = new Set(['/remote.php/dav/files/u']);
  const log = [];
  const state = { mode: 'ok' };
  const server = http.createServer((req, res) => {
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => {
      const p = decodeURIComponent(new URL(req.url, 'http://x').pathname).replace(/\/+$/, '');
      log.push(`${req.method} ${p}`);
      if (req.headers.authorization !== `Basic ${Buffer.from(`${DAV_USER}:${DAV_PW}`).toString('base64')}`) return void res.writeHead(401).end();
      if (state.mode === 'fail') return void res.writeHead(500).end();
      const parent = p.slice(0, p.lastIndexOf('/'));
      switch (req.method) {
        case 'MKCOL':
          if (dirs.has(p)) return void res.writeHead(405).end();
          if (!dirs.has(parent)) return void res.writeHead(409).end();
          dirs.add(p);
          return void res.writeHead(201).end();
        case 'PUT':
          if (!dirs.has(parent)) return void res.writeHead(409).end();
          files.set(p, Buffer.concat(chunks));
          return void res.writeHead(201).end();
        case 'GET': {
          if (!files.has(p)) return void res.writeHead(404).end();
          let body = files.get(p);
          if (state.mode === 'corrupt') { body = Buffer.from(body); body[body.length >> 1] ^= 0xff; }
          return void res.writeHead(200).end(body);
        }
        case 'DELETE':
          if (!files.delete(p)) return void res.writeHead(404).end();
          return void res.writeHead(204).end();
        case 'PROPFIND': {
          if (!dirs.has(p)) return void res.writeHead(404).end();
          const kids = [...files.keys(), ...dirs].filter((k) => k.slice(0, k.lastIndexOf('/')) === p);
          const hrefs = [p + '/', ...kids].map((h) => `<d:response><d:href>${encodeURI(h)}</d:href></d:response>`).join('');
          return void res.writeHead(207, { 'content-type': 'application/xml' }).end(`<?xml version="1.0"?><d:multistatus xmlns:d="DAV:">${hrefs}</d:multistatus>`);
        }
      }
      res.writeHead(405).end();
    });
  });
  const ROOT_DIR = '/remote.php/dav/files/u/Bureau-backup';
  return {
    server, log, state, files,
    at: (rel) => files.get(`${ROOT_DIR}/${rel}`),
    put: (rel, body) => { const p = `${ROOT_DIR}/${rel}`; let d = p.slice(0, p.lastIndexOf('/')); const need = []; while (!dirs.has(d)) { need.push(d); d = d.slice(0, d.lastIndexOf('/')); } need.reverse().forEach((x) => dirs.add(x)); files.set(p, body); },
    names: (rel) => [...files.keys()].filter((k) => k.startsWith(`${ROOT_DIR}/${rel}/`)).map((k) => k.slice(k.lastIndexOf('/') + 1)).sort(),
  };
}

// ---------- real hubs ----------
const children = [];
async function boot(name, port, extraEnv) {
  const d = path.join(dir, name);
  fs.mkdirSync(path.join(d, 'data'), { recursive: true });
  const env = { PATH: process.env.PATH, SystemRoot: process.env.SystemRoot, TEMP: process.env.TEMP, TMP: process.env.TMP, HOME: d, PORT: String(port), HOST: '127.0.0.1',
    BUREAU_ENV_FILE: path.join(d, 'none.env'), BUREAU_DATA_DIR: path.join(d, 'data'), BUREAU_BRAIN_DIR: path.join(d, 'brain'), BUREAU_WORK_DIR: path.join(d, 'work'), BUREAU_POKES: '',
    GIT_CONFIG_GLOBAL: path.join(d, 'gitconfig'), BUREAU_STORE: 'sqlite', BUREAU_HUB_ID: HUB_ID, BUREAU_TOKEN: 'shared-token-for-backup-test', BUREAU_BOSS_TOKEN: BOSS, ...extraEnv };
  const logFile = path.join(d, 'hub.log');
  const out = fs.openSync(logFile, 'a');
  const child = spawn(process.execPath, [HUB], { env, stdio: ['ignore', out, out] });
  children.push(child);
  const base = `http://127.0.0.1:${port}`;
  for (let i = 0; i < 100; i++) { try { const r = await fetch(`${base}/health`); if (r.ok) return { base, dir: d, logFile }; } catch { /* starting */ } await sleep(100); }
  throw new Error(`hub never answered /health: ${fs.readFileSync(logFile, 'utf8').slice(-500)}`);
}
const client = (hub, token) => async (method, p, body) => {
  const headers = { 'content-type': 'application/json' };
  if (token) headers.authorization = `Bearer ${token}`;
  const r = await fetch(hub.base + p, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
  const text = await r.text();
  let json = null; try { json = JSON.parse(text); } catch { /* not json */ }
  return { status: r.status, json, text };
};

const outputs = [];
function runCli(args, { env = {}, input } = {}) {
  return new Promise((resolve) => {
    const c = spawn(process.execPath, [CLI, ...args], { env: { PATH: process.env.PATH, SystemRoot: process.env.SystemRoot, TEMP: process.env.TEMP, TMP: process.env.TMP, ...env }, stdio: ['pipe', 'pipe', 'pipe'] });
    let stdout = '', stderr = '';
    c.stdout.on('data', (d) => { stdout += d; });
    c.stderr.on('data', (d) => { stderr += d; });
    c.on('close', (code) => { outputs.push(stdout, stderr); resolve({ code, stdout, stderr }); });
    c.stdin.end(input || '');
  });
}

async function hubPart() {
  try { require('node:sqlite'); } catch { console.log(`node:sqlite is not available on Node ${process.version}: the hub parts are skipped`); return; }
  const { DatabaseSync } = require('node:sqlite');
  const dav = fakeDav();
  await new Promise((r) => dav.server.listen(0, '127.0.0.1', r));
  const davUrl = `http://127.0.0.1:${dav.server.address().port}`;
  const home = path.join(dir, 'mac');
  fs.mkdirSync(home, { recursive: true });
  const hubUrl = `http://127.0.0.1:${PORT}`;
  const macEnv = { HOME: home, USERPROFILE: home, BUREAU_BACKUP_STORE: 'file', BUREAU_LOGIN_STORE: 'file', BUREAU_URL: hubUrl };

  console.log('6. bureau backup keygen, on the Mac');
  let r = await runCli(['backup', 'keygen'], { env: macEnv });
  const pub = r.stdout.trim().split('\n').pop();
  const keyFile = path.join(home, '.config', 'bureau', 'backup.json');
  const kept = JSON.parse(fs.readFileSync(keyFile, 'utf8'))[`127.0.0.1:${PORT}`];
  check('keygen succeeds and prints the public key last', r.code === 0 && /^x25519:/.test(pub) && kept.public_key === pub, r);
  check('the private key is kept, under the hub host, in a 0600 file', !!kept.private_key && (process.platform === 'win32' || (fs.statSync(keyFile).mode & 0o777) === 0o600));
  check('and never printed', !r.stdout.includes(kept.private_key.slice(16)) && !r.stderr.includes(kept.private_key.slice(16)));
  r = await runCli(['backup', 'keygen'], { env: macEnv });
  check('a second keygen refuses to replace the key', r.code === 1 && /already/.test(r.stderr) && JSON.parse(fs.readFileSync(keyFile, 'utf8'))[`127.0.0.1:${PORT}`].private_key === kept.private_key, r);
  r = await runCli(['backup', 'export-key'], { env: macEnv });
  check('export-key writes the private key into a pipe', r.code === 0 && r.stdout.trim() === kept.private_key);

  console.log('7. a full run');
  const hub = await boot('main', PORT, { BUREAU_BACKUP_PUBLIC_KEY: pub, BUREAU_NEXTCLOUD_URL: davUrl, BUREAU_NEXTCLOUD_USER: DAV_USER, BUREAU_NEXTCLOUD_PASSWORD: DAV_PW });
  const boss = client(hub, BOSS);
  await boss('POST', '/api/projects', { id: 'alpha', label: 'Alpha' });
  for (const t of ['first mission', 'second mission', 'third mission']) await boss('POST', '/api/tasks', { title: t, project: 'alpha' });
  const minted = (await boss('POST', '/api/tokens', { agent: 'worker', projects: ['*'] })).json;
  await sleep(300);
  const day = backup.parisDay(new Date());
  // Seed the remote: copies past 30 days, a monthly one, a stranger.
  const old = new Date(Date.parse(`${day}T00:00:00Z`) - 40 * 86400_000).toISOString().slice(0, 10).replace(/-01$/, '-02');
  const recent = new Date(Date.parse(`${day}T00:00:00Z`) - 3 * 86400_000).toISOString().slice(0, 10);
  const monthly = `${new Date(Date.parse(`${day}T00:00:00Z`) - 70 * 86400_000).toISOString().slice(0, 7)}-01`;
  for (const d of [old, recent, monthly]) dav.put(`${HUB_ID}/db/bureau-${d}.db.gz.enc`, Buffer.from('older copy'));
  dav.put(`${HUB_ID}/db/readme.txt`, Buffer.from('mine'));
  r = await boss('POST', '/api/backups/run');
  const run = r.json && r.json.run;
  check('the run is good: sent, fetched back identical', r.status === 200 && run.ok === 1 && run.offsite === 1 && run.verified === 1, r.json);
  check('its detail counts the state and says it compared', /3 missions/.test(run.detail) && /fetched back identical/.test(run.detail), run.detail);
  const name = `bureau-${day}.db.gz.enc`;
  const sent = dav.at(`${HUB_ID}/db/${name}`);
  check(`the copy is at Bureau-backup/${HUB_ID}/db/${name}`, !!sent);
  check('encrypted: no SQLite header, no mission title in it', !!sent && !sent.includes(Buffer.from('SQLite format 3')) && !sent.includes(Buffer.from('first mission')) && sent.subarray(0, 4).toString() === 'BRBK');
  const restored = path.join(dir, 'restored.db');
  fs.writeFileSync(restored, zlib.gunzipSync(bc.decrypt(sent, kept.private_key)));
  const rdb = new DatabaseSync(restored, { readOnly: true });
  check('decrypted with the private key, it is the database, whole', rdb.prepare('PRAGMA integrity_check').get().integrity_check === 'ok' && rdb.prepare("SELECT COUNT(*) AS n FROM tasks WHERE project = 'alpha'").get().n === 3);
  check('of this hub', JSON.parse(rdb.prepare("SELECT doc FROM meta WHERE key = '_hub_id'").get().doc) === HUB_ID);
  rdb.close();
  const current = dav.names(`${HUB_ID}/current`);
  check('current/ holds missions, agents, projects, settings and a manifest, all encrypted', JSON.stringify(current) === JSON.stringify(['agents.json.enc', 'manifest.json.enc', 'missions.json.enc', 'projects.json.enc', 'settings.json.enc']), current);
  const readable = (n) => JSON.parse(bc.decrypt(dav.at(`${HUB_ID}/current/${n}.json.enc`), kept.private_key).toString('utf8'));
  check('missions.json reads as JSON once decrypted', readable('missions').length === 3 && readable('missions')[0].title === 'first mission');
  check('projects.json and the manifest too', readable('projects').some((p) => p.id === 'alpha') && readable('manifest').hub_id === HUB_ID && readable('manifest').counts.missions === 3);
  const allCurrent = current.map((n) => bc.decrypt(dav.at(`${HUB_ID}/current/${n}`), kept.private_key).toString('utf8')).join('\n');
  check('no token, hash or session in the readable export', !allCurrent.includes(BOSS) && !allCurrent.includes(minted.token) && !/"hash"|"id_token"|agent_tokens|sessions"/.test(allCurrent));
  const left = dav.names(`${HUB_ID}/db`);
  check('retention: the copy past 30 days is gone', !left.includes(`bureau-${old}.db.gz.enc`), left);
  check('the recent and the monthly copies stay, and the stranger file', left.includes(`bureau-${recent}.db.gz.enc`) && left.includes(`bureau-${monthly}.db.gz.enc`) && left.includes('readme.txt') && left.includes(name), left);
  check('no temporary copy is left in the data folder', !fs.readdirSync(path.join(hub.dir, 'data')).some((f) => f.startsWith('offsite-')));

  console.log('8. the byte comparison catches a changed upload');
  dav.state.mode = 'corrupt';
  r = await boss('POST', '/api/backups/run');
  dav.state.mode = 'ok';
  check('sent, but fetched back different: not good', r.status === 200 && r.json.run.ok === 0 && r.json.run.offsite === 1 && r.json.run.verified === 0, r.json && r.json.run);
  check('the detail says it differs', /differs from what was sent/.test(r.json.run.detail), r.json.run.detail);
  dav.state.mode = 'fail';
  r = await boss('POST', '/api/backups/run');
  dav.state.mode = 'ok';
  check('Nextcloud down: not good, nothing claimed as verified', r.json.run.ok === 0 && r.json.run.offsite === 0 && r.json.run.verified === null && /500/.test(r.json.run.detail), r.json.run);
  check('the password is in no detail', !JSON.stringify(r.json).includes(DAV_PW));
  check('the failure reaches the server log loudly', /OFF-SERVER BACKUP FAILED/.test(fs.readFileSync(hub.logFile, 'utf8')));
  const s = (await boss('GET', '/api/state')).json;
  check('and never the event log the hub\'s users read', !JSON.stringify(s.log).includes('backup'));
  r = await boss('POST', '/api/backups/run');
  check('a good run again', r.json.run.ok === 1);

  console.log('9. the operator\'s routes');
  const agent = client(hub, minted.token), shared = client(hub, 'shared-token-for-backup-test'), anon = client(hub, null);
  r = await boss('GET', '/api/backups');
  check('the operator reads the status and the runs', r.status === 200 && r.json.status.configured === true && r.json.status.hub_id === HUB_ID && r.json.runs.length === 4, r.json && r.json.status);
  check('the status says where, never the password', /Bureau-backup\/hub-backup-test$/.test(r.json.status.where) && !r.text.includes(DAV_PW), r.json.status.where);
  check('a good run, so no alert yet (the check on the Mac is not due)', r.json.status.alerts.length === 0, r.json.status.alerts);
  for (const [who, c] of [['an agent token that sees every project', agent], ['the shared token', shared]]) {
    for (const [m, p] of [['GET', '/api/backups'], ['POST', '/api/backups/verified'], ['POST', '/api/backups/run']]) {
      const x = await c(m, p, m === 'POST' ? { ok: true } : undefined);
      check(`${who}: ${m} ${p} is a 404, as if it did not exist`, x.status === 404 && x.json && x.json.error === 'not found', x);
    }
  }
  check('no credential: 401, like any route', (await anon('GET', '/api/backups')).status === 401);
  r = await boss('GET', '/api/health');
  check('/api/health carries the backup for the operator', r.json.backup && r.json.backup.configured === true && Array.isArray(r.json.backup.alerts) && !!r.json.backup.last_ok_at, r.json.backup);
  r = await agent('GET', '/api/health');
  check('and not for anyone else', r.status === 200 && r.json.backup === undefined);
  r = await boss('POST', '/api/backups/verified', { ok: 'yes' });
  check('a check must say ok true or false', r.status === 400, r);

  console.log('10. bureau backup verify, on the Mac');
  r = await runCli(['backup', 'set-nextcloud', '--url', davUrl, '--user', DAV_USER], { env: macEnv, input: `${DAV_PW}\n` });
  check('set-nextcloud keeps the app password from the pipe', r.code === 0 && JSON.parse(fs.readFileSync(keyFile, 'utf8'))[`127.0.0.1:${PORT}/nextcloud`].password === DAV_PW, r);
  r = await runCli(['backup', 'set-operator'], { env: macEnv, input: BOSS });
  check('set-operator keeps the hub token', r.code === 0, r);
  r = await runCli(['backup', 'verify'], { env: macEnv });
  check('verify fetches the newest copy, decrypts it, opens it: good', r.code === 0 && new RegExp(`Good: ${name}: decrypted, integrity_check ok, 3 missions`).test(r.stdout) && /Reported to the hub/.test(r.stdout), r);
  r = await boss('GET', '/api/backups');
  const lastCheck = r.json.status.last_check;
  check('the hub records the good check', lastCheck && lastCheck.ok === 1 && lastCheck.file === name && !!r.json.status.last_ok_check_at, lastCheck);
  check('the check is recorded as the boss\'s', lastCheck && lastCheck.by === 'human', lastCheck);
  // A copy changed in Nextcloud, after it was sent.
  const good = dav.at(`${HUB_ID}/db/${name}`);
  const bad = Buffer.from(good); bad[200] ^= 1;
  dav.put(`${HUB_ID}/db/${name}`, bad);
  r = await runCli(['backup', 'verify'], { env: macEnv });
  check('a changed copy fails verify, exit 1, and says why', r.code === 1 && /FAILED: .*changed or damaged/.test(r.stdout), r);
  r = await boss('GET', '/api/backups');
  check('the hub records the failed check, and keeps the last good one', r.json.status.last_check.ok === 0 && !!r.json.status.last_ok_check_at, r.json.status);
  dav.put(`${HUB_ID}/db/${name}`, good);
  r = await runCli(['backup', 'verify', '--no-report', '--hub-id', HUB_ID], { env: { ...macEnv, BUREAU_NEXTCLOUD_URL: davUrl, BUREAU_NEXTCLOUD_USER: DAV_USER, BUREAU_NEXTCLOUD_PASSWORD: DAV_PW } });
  check('verify takes Nextcloud from the environment, and --no-report reports nothing', r.code === 0 && /^Good:/.test(r.stdout) && !/Reported/.test(r.stdout), r);
  r = await runCli(['backup', 'verify'], { env: { ...macEnv, BUREAU_URL: `http://127.0.0.1:${HALF_PORT}` } });
  check('no key for a hub: a plain refusal naming keygen', r.code === 1 && /no backup key for 127\.0\.0\.1:8242/.test(r.stderr) && /keygen/.test(r.stderr), r);

  console.log('11. bureau backup decrypt, for a restore');
  const enc = path.join(dir, 'missions.json.enc');
  fs.writeFileSync(enc, dav.at(`${HUB_ID}/current/missions.json.enc`));
  r = await runCli(['backup', 'decrypt', enc], { env: macEnv });
  check('a readable file decrypts beside it', r.code === 0 && JSON.parse(fs.readFileSync(path.join(dir, 'missions.json'), 'utf8')).length === 3, r);
  const dbEnc = path.join(dir, name);
  fs.writeFileSync(dbEnc, good);
  r = await runCli(['backup', 'decrypt', dbEnc], { env: macEnv });
  const out = path.join(dir, name.replace(/\.gz\.enc$/, ''));
  check('the database copy comes out unpacked, ready to open', r.code === 0 && fs.existsSync(out) && fs.readFileSync(out).subarray(0, 15).toString() === 'SQLite format 3', r);
  r = await runCli(['backup', 'decrypt', dbEnc], { env: macEnv });
  check('and it never overwrites a file', r.code === 1 && /already exists/.test(r.stderr), r);
  check('no secret in anything the CLI printed', !outputs.some((o) => o.includes(DAV_PW) || o.includes(BOSS)) && outputs.filter((o) => o.includes(kept.private_key)).length === 1);

  console.log('12. a half-set backup tells the operator');
  const half = await boot('half', HALF_PORT, { BUREAU_BACKUP_PUBLIC_KEY: pub, BUREAU_NEXTCLOUD_URL: davUrl, BUREAU_NEXTCLOUD_USER: DAV_USER });
  r = await client(half, BOSS)('GET', '/api/backups');
  check('the status names what is missing, as the one alert', r.status === 200 && r.json.status.configured === false && r.json.status.alerts.length === 1 && /BUREAU_NEXTCLOUD_PASSWORD missing/.test(r.json.status.alerts[0]), r.json && r.json.status);
  r = await client(half, BOSS)('POST', '/api/backups/run');
  check('and a run is refused with the same words', r.status === 409 && /BUREAU_NEXTCLOUD_PASSWORD/.test(r.json.error), r);
  dav.server.close();
}

async function main() {
  cryptoPart();
  rulesPart();
  await hubPart();
}

main().catch((e) => { FAIL++; console.log(`  FAIL: harness: ${e.stack}`); }).finally(async () => {
  for (const c of children) { try { c.kill('SIGKILL'); } catch { /* gone */ } }
  await sleep(200);
  try { fs.rmSync(dir, { recursive: true, force: true }); } catch { /* best effort */ }
  console.log(`\npassed ${PASS}, failed ${FAIL}`);
  process.exit(FAIL ? 1 : 0);
});

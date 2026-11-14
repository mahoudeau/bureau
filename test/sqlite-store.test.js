// test/sqlite-store.test.js: BUREAU_STORE=sqlite. The store itself (every
// key round-trips, the event log, scoped saves, backups, identity), then real
// hubs: importing a state.json, surviving a restart, the way back, backups
// that restore to the same state, the silo guard, and two hubs side by side.
// Skipped on a Node without node:sqlite. Self-contained, zero deps.
// Usage: node test/sqlite-store.test.js    (ports 8231 to 8234)
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn, spawnSync } = require('child_process');

try { require('node:sqlite'); } catch { console.log(`node:sqlite is not available on Node ${process.version}: skipped`); process.exit(0); }
const { DatabaseSync } = require('node:sqlite');

const ROOT = path.join(__dirname, '..');
const sql = require(path.join(ROOT, 'hub', 'lib', 'sqlite-store'));
const BOSS = 'boss-secret-token-for-sqlite-test';
const PORTS = [8231, 8232, 8233, 8234];
let PASS = 0, FAIL = 0;
function check(label, ok, got) {
  if (ok) { PASS++; console.log(`  ok: ${label}`); }
  else { FAIL++; console.log(`  FAIL: ${label}${got !== undefined ? ` (got: ${JSON.stringify(got).slice(0, 300)})` : ''}`); }
}
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bureau-sqlite-'));

// ---------- the store, in this process ----------
function fullState() {
  const ts = (i) => new Date(Date.UTC(2026, 10, 1, 0, 0, i)).toISOString();
  return {
    schema_version: 2,
    seq: 7,
    tasks: [
      { id: 't-1', title: 'first', status: 'done', project: 'alpha', assignee: 'worker', created_at: ts(1), log: [{ ts: ts(2), by: 'worker', note: 'claimed', from: 'queued', to: 'claimed' }, { ts: ts(3), by: 'human', note: 'back', from: 'review', to: 'queued', kind: 'send_back' }, { ts: ts(4), by: 'human', note: 'ok', from: 'review', to: 'done', kind: 'approve' }], artifacts: [] },
      { id: 't-2', title: 'second', status: 'queued', project: 'alpha', assignee: null, created_at: ts(5), log: [], artifacts: [], items: [{ id: 'i1', title: 'x', verdict: 'proposed', payload: { ops: [{ op: 'write', file: 'knowledge/a.md', content: 'é "quotes" \n  and emoji 😀' }] } }] },
    ],
    agents: [{ name: 'worker', kind: 'claude-code', capabilities: ['critic'], registered_at: ts(1), last_seen: ts(9) }],
    messages: [{ id: 'm-3', ts: ts(6), from: 'worker', to: 'human', body: 'hello', task_id: null }],
    projects: [{ id: 'alpha', label: 'Alpha', capacity: 2, entity: 'acme' }, { id: 'general', label: 'General', capacity: 1 }],
    log: [{ ts: ts(1), type: 'task.created', id: 't-1' }, { ts: ts(2), type: 'task.updated', id: 't-1' }],
    settings: { global: { approval: 'in-session', store_prompts_days: 7 }, projects: { alpha: { default_gate: 'critic' } }, agents: { worker: { roles: ['critic'] } }, members: { 'boss@example.com': { role: 'owner' } } },
    agent_tokens: [{ id: 'tok-1', agent: 'worker', projects: ['alpha'], label: null, hash: 'ab'.repeat(32), created_at: ts(1), revoked_at: null, last_used: null }],
    oauth_apps: [{ id: 'app-1', client_id: 'claude', agent: 'worker', name: 'Claude', verified: true, status: 'allowed', first_seen: ts(1), last_used: ts(2), seen_by: 'sub', ruled_by: 'boss', ruled_at: ts(2) }],
    sessions: [{ id: 'ses-1', hash: 'cd'.repeat(32), sub: 'u1', email: 'boss@example.com', name: 'Boss', role: 'owner', issuer: 'https://id.example', id_token: 'x.y.z', created_at: ts(1), last_seen: ts(1), expires_at: ts(99) }],
    mcp_token: 'f'.repeat(48),
    a_key_from_a_later_version: { nested: [1, 2, { deep: true }] },
  };
}

function unit() {
  console.log('1. every top-level key round-trips');
  const file = path.join(dir, 'unit.db');
  sql.open(file);
  check('a new database holds no state', sql.load() === null);
  const s = fullState();
  sql.save(s);
  sql.close();
  sql.open(file);
  let back = sql.load();
  check('the same state, keys in the same order', same(back, s), back);
  for (const k of Object.keys(s)) check(`key ${k}`, same(back[k], s[k]), back[k]);

  console.log('2. changes, deletions and new keys');
  back.tasks[0].title = 'first, renamed';
  back.tasks.push({ id: 't-3', title: 'third', status: 'queued', project: 'general', created_at: 'z', log: [], artifacts: [] });
  back.agents = [];
  back.sessions = back.sessions.filter(() => false);
  delete back.mcp_token;
  back.settings.global.approval = 'critic';
  back.seq = 8;
  sql.save(back);
  sql.close();
  sql.open(file);
  const again = sql.load();
  check('the rename, the new mission, the emptied lists and the dropped key', same(again, back), again);
  check('a key that was dropped stays dropped', !('mcp_token' in again));
  let db = new DatabaseSync(file, { readOnly: true });
  const row = db.prepare('SELECT status, project, assignee, claimed_at, closed_at, send_backs FROM tasks WHERE id = ?').get('t-1');
  check('real columns: status, project, assignee', row.status === 'done' && row.project === 'alpha' && row.assignee === 'worker', row);
  check('real columns: claimed_at, closed_at and send_backs from the log', !!row.claimed_at && row.closed_at === s.tasks[0].log[2].ts && row.send_backs === 1, row);
  check('an open mission has no closed_at', db.prepare('SELECT closed_at FROM tasks WHERE id = ?').get('t-2').closed_at === null);
  db.close();

  console.log('3. the event log: append-only, capped');
  const big = again;
  big.log = [];
  for (let i = 0; i < 2000; i++) big.log.push({ ts: `e${i}`, type: 'x.y', n: i });
  sql.save(big);
  db = new DatabaseSync(file, { readOnly: true });
  const before = db.prepare('SELECT min(seq) lo, max(seq) hi, count(*) n FROM events').get();
  db.close();
  // logEvent's way: push, then cut the front to 2000
  for (let i = 2000; i < 2010; i++) { big.log.push({ ts: `e${i}`, type: 'x.y', n: i }); big.log.splice(0, big.log.length - 2000); }
  sql.save(big);
  db = new DatabaseSync(file, { readOnly: true });
  const after = db.prepare('SELECT min(seq) lo, max(seq) hi, count(*) n FROM events').get();
  db.close();
  check('2000 rows, never more', after.n === 2000, after);
  check('a save inserts only the new events', after.hi - before.hi === 10 && after.lo - before.lo === 10, { before, after });
  sql.close(); sql.open(file);
  let loaded = sql.load();
  check('the log reads back whole and in order', same(loaded.log, big.log) && loaded.log[0].n === 10 && loaded.log[1999].n === 2009);
  // More than 2000 events between two saves: the newest written one is gone.
  for (let i = 0; i < 2500; i++) { loaded.log.push({ ts: `f${i}`, type: 'x.z', n: i }); loaded.log.splice(0, loaded.log.length - 2000); }
  sql.save(loaded);
  sql.close(); sql.open(file);
  const reread = sql.load();
  check('a burst past the cap is still saved whole', same(reread.log, loaded.log) && reread.log.length === 2000, reread.log.length);

  console.log('4. a scoped save looks at its table only');
  reread.sessions = [{ id: 'ses-9', hash: '00', sub: 'u', expires_at: 'z', last_seen: 'a' }];
  reread.tasks[1].title = 'changed but not in scope';
  sql.save(reread, new Set(['sessions']));
  db =new DatabaseSync(file, { readOnly: true });
  check('the session row is written', !!db.prepare('SELECT 1 FROM sessions WHERE id = ?').get('ses-9'));
  check('the mission outside the scope is not', !JSON.parse(db.prepare('SELECT doc FROM tasks WHERE id = ?').get('t-2').doc).title.startsWith('changed'));
  db.close();
  sql.save(reread);
  sql.close(); sql.open(file);
  check('the next full save catches up', sql.load().tasks[1].title === 'changed but not in scope');
  const peek = sql.load();

  console.log('5. a failed save writes nothing and is tried again whole');
  peek.tasks.push({ id: 't-1', title: 'a duplicate' });
  peek.agents.push({ name: 'new-agent' });
  let threw = null;
  try { sql.save(peek); } catch (e) { threw = e.message; }
  check('two records with one id are refused', /share the id t-1/.test(threw || ''), threw);
  peek.tasks.pop();
  sql.save(peek);
  sql.close(); sql.open(file);
  check('the retry writes what the failed save had', sql.load().agents.some((a) => a.name === 'new-agent'));

  console.log('6. backups: VACUUM INTO, checked');
  const copy = path.join(dir, 'unit.db.bak.1');
  sql.copyTo(copy);
  check('the copy exists and passes quick_check', fs.existsSync(copy) && sql.verify(copy) === null, sql.verify(copy));
  let failed = null;
  try { sql.copyTo(path.join(dir, 'unit.db.bad'), () => 'simulated corruption'); } catch (e) { failed = e.message; }
  check('a copy that fails its check is deleted', /simulated corruption/.test(failed || '') && !fs.existsSync(path.join(dir, 'unit.db.bad')), failed);
  fs.writeFileSync(path.join(dir, 'junk.db'), 'SQLite format 3\0' + 'x'.repeat(5000));
  check('a garbage file fails verify', sql.verify(path.join(dir, 'junk.db')) !== null);
  const live = sql.load();
  sql.close();
  check('the copy holds the same state', same(sql.readFile(copy), live));

  console.log('7. identity');
  const idFile = path.join(dir, 'id.db');
  sql.open(idFile);
  const made = sql.claimIdentity({ hubId: null, publicUrl: 'https://a.example/' });
  check('a new database records a random hub_id', made.created && /^hub-[0-9a-f]{16}$/.test(made.hub_id), made);
  check('the same URL, trailing slash or not, is accepted', !sql.claimIdentity({ publicUrl: 'https://a.example' }).error);
  check('the same hub_id is accepted', !sql.claimIdentity({ hubId: made.hub_id }).error);
  const wrongId = sql.claimIdentity({ hubId: 'hub-other' });
  check('another hub_id is refused, naming both', wrongId.error && wrongId.error.includes(made.hub_id) && wrongId.error.includes('hub-other'), wrongId);
  const wrongUrl = sql.claimIdentity({ publicUrl: 'https://b.example' });
  check('another public URL is refused, naming both', wrongUrl.error && wrongUrl.error.includes('https://a.example') && wrongUrl.error.includes('https://b.example'), wrongUrl);
  check('no URL configured is not a mismatch', !sql.claimIdentity({}).error);
  sql.close();
}

// ---------- real hubs ----------
const envFor = (name, port, extra = {}) => ({ PATH: process.env.PATH, SystemRoot: process.env.SystemRoot, USERPROFILE: process.env.USERPROFILE, TEMP: process.env.TEMP, TMP: process.env.TMP,
  HOME: path.join(dir, name), NODE_NO_WARNINGS: '1', PORT: String(port), HOST: '127.0.0.1', BUREAU_ENV_FILE: path.join(dir, 'none.env'), BUREAU_BOSS_TOKEN: BOSS,
  BUREAU_DATA_DIR: path.join(dir, name, 'data'), BUREAU_BRAIN_DIR: path.join(dir, name, 'brain'), BUREAU_WORK_DIR: path.join(dir, name, 'work'),
  BUREAU_POKES: '', GIT_CONFIG_GLOBAL: path.join(dir, 'gitconfig'), ...extra });
const SQL = { BUREAU_STORE: 'sqlite' };
const running = new Set();
async function boot(name, port, extra) {
  const out = [];
  const child = spawn(process.execPath, [path.join(ROOT, 'hub', 'server.js')], { env: envFor(name, port, extra), stdio: ['ignore', 'pipe', 'pipe'] });
  child.stdout.on('data', (d) => out.push(String(d)));
  child.stderr.on('data', (d) => out.push(String(d)));
  child.output = () => out.join('');
  running.add(child);
  child.on('exit', () => running.delete(child));
  for (let i = 0; i < 100; i++) {
    if (child.exitCode !== null) return child;
    try { if ((await fetch(`http://127.0.0.1:${port}/health`)).ok) return child; } catch { /* starting */ }
    await sleep(100);
  }
  throw new Error(`${name} never answered: ${child.output()}`);
}
const stop = (child) => new Promise((r) => { if (child.exitCode !== null) return r(); child.once('exit', r); child.kill('SIGTERM'); });
async function refused(name, port, extra) {
  const child = await boot(name, port, extra);
  for (let i = 0; i < 50 && child.exitCode === null; i++) await sleep(100);
  if (child.exitCode === null) { await stop(child); return { code: 'still running', out: child.output() }; }
  return { code: child.exitCode, out: child.output() };
}
const api = async (port, method, p, body, token = BOSS) => {
  const r = await fetch(`http://127.0.0.1:${port}${p}`, { method, headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });
  return { code: r.status, body: await r.json() };
};
const dataOf = (name) => path.join(dir, name, 'data');
const tool = (name, args) => spawnSync(process.execPath, [path.join(ROOT, 'hub', 'tools', name), ...args], { env: { ...envFor('tools', 0), BUREAU_STORE: '' }, encoding: 'utf8' });

async function hubs() {
  const [P1, P2, P3, P4] = PORTS;
  console.log('8. a hub on the file store, with real history');
  let hub = await boot('a', P1);
  await api(P1, 'POST', '/api/projects', { id: 'alpha', label: 'alpha' });
  const a = (await api(P1, 'POST', '/api/tasks', { title: 'first', project: 'alpha' })).body.task.id;
  const b = (await api(P1, 'POST', '/api/tasks', { title: 'second', project: 'alpha' })).body.task.id;
  const minted = (await api(P1, 'POST', '/api/tokens', { agent: 'worker', projects: ['alpha'] })).body;
  await api(P1, 'POST', '/api/agents/register', { name: 'worker', kind: 'claude-code' }, minted.token);
  await api(P1, 'POST', '/api/tasks/claim', { agent: 'worker', id: a }, minted.token);
  await api(P1, 'PATCH', `/api/tasks/${a}`, { agent: 'worker', status: 'in_progress', note: 'working' }, minted.token);
  await api(P1, 'POST', '/api/messages', { from: 'worker', to: 'human', body: 'hello' }, minted.token);
  await api(P1, 'PATCH', '/api/settings', { global: { store_prompts_days: 7 } });
  check('it says it is on the file store', (await api(P1, 'GET', '/api/health')).body.store === 'json');
  await stop(hub);
  const before = JSON.parse(fs.readFileSync(path.join(dataOf('a'), 'state.json'), 'utf8'));

  console.log('9. the first boot on SQLite imports it');
  hub = await boot('a', P1, SQL);
  check('it says it is on SQLite', (await api(P1, 'GET', '/api/health')).body.store === 'sqlite');
  check('the state file is kept aside', fs.readdirSync(dataOf('a')).some((n) => n.startsWith('state.json.imported-')) && !fs.existsSync(path.join(dataOf('a'), 'state.json')));
  check('the boot says so', /imported .*state\.json into .*bureau\.db/.test(hub.output()), hub.output());
  check('the minted token still works', (await api(P1, 'GET', `/api/tasks/${a}`, null, minted.token)).code === 200);
  check('the settings came along', (await api(P1, 'GET', '/api/settings')).body.settings.global.store_prompts_days === 7);
  await stop(hub);
  const imported = sql.readFile(path.join(dataOf('a'), 'bureau.db'));
  const strip = (s) => { const c = structuredClone(s); for (const t of c.agent_tokens || []) t.last_used = null; return c; };
  check('every key of state.json is in the database, unchanged', same(strip(imported), strip(before)), Object.keys(imported));

  console.log('10. work carries on and survives a restart');
  hub = await boot('a', P1, SQL);
  await api(P1, 'PATCH', `/api/tasks/${a}`, { agent: 'worker', status: 'review', note: 'finished' }, minted.token);
  await api(P1, 'PATCH', `/api/tasks/${a}`, { agent: 'human', status: 'done', note: 'approved' });
  const c = (await api(P1, 'POST', '/api/tasks', { title: 'third', project: 'alpha' })).body.task.id;
  await stop(hub);
  hub = await boot('a', P1, SQL);
  check('a change is still there', (await api(P1, 'GET', `/api/tasks/${a}`)).body.task.status === 'done');
  check('so is a new mission', (await api(P1, 'GET', `/api/tasks/${c}`)).code === 200);
  check('and ids keep counting', Number(c.slice(2)) > Number(b.slice(2)));
  await stop(hub);
  const db = new DatabaseSync(path.join(dataOf('a'), 'bureau.db'), { readOnly: true });
  const row = db.prepare('SELECT status, project, assignee, claimed_at, closed_at FROM tasks WHERE id = ?').get(a);
  const ev = db.prepare('SELECT count(*) n FROM events').get().n;
  db.close();
  check('real columns, for queries', row.status === 'done' && row.project === 'alpha' && !!row.claimed_at && !!row.closed_at, row);
  check('the event log has its own table', ev > 0, ev);

  console.log('11. the way back to the file store');
  const out = tool('state-export.js', [dataOf('a')]);
  check('the tool writes state.json', out.status === 0 && fs.existsSync(path.join(dataOf('a'), 'state.json')), out.stderr);
  check('the same state as the database', same(JSON.parse(fs.readFileSync(path.join(dataOf('a'), 'state.json'), 'utf8')), sql.readFile(path.join(dataOf('a'), 'bureau.db'))));
  check('and it never overwrites one', tool('state-export.js', [dataOf('a')]).status === 1);
  hub = await boot('a', P1);
  check('a file-store hub boots on it', (await api(P1, 'GET', '/api/health')).body.store === 'json');
  check('with everything', (await api(P1, 'GET', `/api/tasks/${a}`)).body.task.status === 'done' && (await api(P1, 'GET', `/api/tasks/${c}`)).code === 200);
  await stop(hub);

  console.log('12. backups on SQLite: hourly and daily copies, checked, and a JSON export');
  const fast = { ...SQL, BUREAU_BACKUP_INTERVAL_MS: '400', BUREAU_BACKUP_KEEP: '3', BUREAU_DAILY_KEEP: '7' };
  hub = await boot('k', P2, fast);
  await api(P2, 'POST', '/api/projects', { id: 'kiln', label: 'Kiln' });
  for (let i = 0; i < 5; i++) await api(P2, 'POST', '/api/tasks', { title: `fire ${i}`, project: 'kiln' });
  await api(P2, 'POST', '/api/messages', { from: 'human', to: '*', body: 'hot' });
  await sleep(2200);
  const ls = fs.readdirSync(dataOf('k'));
  check('bureau.db.bak.1 to bak.3', ['bureau.db.bak.1', 'bureau.db.bak.2', 'bureau.db.bak.3'].every((n) => ls.includes(n)), ls);
  check('bak.4 never kept (keep 3)', !ls.includes('bureau.db.bak.4'), ls);
  check('a daily copy and its JSON export', ls.some((n) => /^bureau\.db\.daily-\d{4}-\d{2}-\d{2}$/.test(n)) && ls.some((n) => /^state\.json\.daily-/.test(n)), ls);
  check('no state.json hourly backups on SQLite', !ls.some((n) => n.startsWith('state.json.bak.')), ls);
  check('no half-made copy left behind', !ls.some((n) => n.endsWith('.new')), ls);
  const bak = path.join(dataOf('k'), 'bureau.db.bak.1');
  check('the newest backup passes quick_check', sql.verify(bak) === null, sql.verify(bak));
  const daily = ls.find((n) => /^state\.json\.daily-/.test(n));
  // Taken at boot, once a day, like the file store's daily snapshot.
  const exported = JSON.parse(fs.readFileSync(path.join(dataOf('k'), daily), 'utf8'));
  check('the JSON export reads with no SQLite tool', exported.schema_version === 2 && Array.isArray(exported.tasks), Object.keys(exported));
  const viewK = (await api(P2, 'GET', '/api/state')).body;
  await stop(hub);
  const stateK = sql.readFile(path.join(dataOf('k'), 'bureau.db'));
  check('the backup holds the same state as the database', same(sql.readFile(bak), stateK));

  console.log('13. a hub boots on a restored backup, with identical state');
  fs.mkdirSync(dataOf('r'), { recursive: true });
  fs.copyFileSync(bak, path.join(dataOf('r'), 'bureau.db'));
  hub = await boot('r', P3, SQL);
  const viewR = (await api(P3, 'GET', '/api/state')).body;
  const drop = (v) => ({ tasks: v.tasks, agents: v.agents, projects: v.projects, log: v.log });
  check('the same missions, roster, projects and log', same(drop(viewR), drop(viewK)), drop(viewR));
  await stop(hub);
  check('the same state, key for key', same(sql.readFile(path.join(dataOf('r'), 'bureau.db')), stateK));

  console.log('14. export.js reads the database');
  const exp = spawnSync(process.execPath, [path.join(ROOT, 'hub', 'tools', 'export.js'), path.join(dir, 'k-export')], { env: { ...envFor('k', 0), BUREAU_STORE: 'sqlite' }, encoding: 'utf8' });
  check('export runs on a SQLite hub', exp.status === 0, exp.stderr);
  const man = exp.status === 0 ? JSON.parse(fs.readFileSync(path.join(dir, 'k-export', 'manifest.json'), 'utf8')) : {};
  check('with every mission', man.counts && man.counts.missions === 5, man);
  const imp = spawnSync(process.execPath, [path.join(ROOT, 'hub', 'tools', 'import.js'), path.join(dir, 'k-export')], { env: { ...envFor('r', 0), BUREAU_STORE: 'sqlite' }, encoding: 'utf8' });
  check('import refuses a data dir that holds a bureau.db', imp.status !== 0 && /bureau\.db/.test(imp.stderr), imp.stderr);

  console.log('15. a schema 0 state.json migrates as it is imported');
  fs.mkdirSync(dataOf('v'), { recursive: true });
  fs.writeFileSync(path.join(dataOf('v'), 'state.json'), JSON.stringify({ tasks: [{ id: 't-1', title: 'Legacy mission', status: 'queued', priority: 3, project: 'old', created_at: '2026-01-01T00:00:00.000Z', log: [], artifacts: [] }], seq: 1, projects: ['old'] }));
  hub = await boot('v', P3, SQL);
  check('the legacy mission is there', (await api(P3, 'GET', '/api/tasks/t-1')).body.task.title === 'Legacy mission');
  check('a pre-migrate copy of the file is kept', fs.readdirSync(dataOf('v')).some((n) => n.startsWith('state.json.pre-migrate-')));
  await stop(hub);
  const v = sql.readFile(path.join(dataOf('v'), 'bureau.db'));
  check('the database is at schema 2, projects as records', v.schema_version === 2 && v.projects.some((p) => p.id === 'old' && p.capacity === 1) && Array.isArray(v.messages), v);

  console.log('16. a database at an older schema migrates, with a copy kept; a newer one refuses');
  fs.mkdirSync(dataOf('o'), { recursive: true });
  sql.open(path.join(dataOf('o'), 'bureau.db'));
  sql.save({ schema_version: 1, seq: 1, tasks: [{ id: 't-1', title: 'old links', status: 'queued', project: 'general', created_at: 'x', log: [], artifacts: [], review_links: { a: 1 } }], agents: [], messages: [], log: [], projects: [{ id: 'general', label: 'General', capacity: 1 }] });
  sql.close();
  hub = await boot('o', P3, SQL);
  check('the migration is logged', /migrating state from schema 1 to 2; previous database kept/.test(hub.output()), hub.output());
  await stop(hub);
  const pre = fs.readdirSync(dataOf('o')).find((n) => n.startsWith('bureau.db.pre-migrate-'));
  check('a pre-migrate copy of the database is kept, at schema 1', pre && sql.readFile(path.join(dataOf('o'), pre)).schema_version === 1, pre);
  const o = sql.readFile(path.join(dataOf('o'), 'bureau.db'));
  check('the database is at schema 2, the old field gone', o.schema_version === 2 && !('review_links' in o.tasks[0]), o.tasks[0]);
  sql.open(path.join(dataOf('o'), 'bureau.db'));
  const newer = sql.load(); newer.schema_version = 99; sql.save(newer);
  sql.close();
  const tooNew = await refused('o', P3, SQL);
  check('a database from a newer Bureau refuses to boot', tooNew.code === 1 && /schema_version 99/.test(tooNew.out), tooNew.out);

  console.log('17. an empty database next to backups refuses to boot');
  fs.mkdirSync(dataOf('e'), { recursive: true });
  fs.copyFileSync(bak, path.join(dataOf('e'), 'bureau.db.bak.1'));
  const empty = await refused('e', P3, SQL);
  check('boot refused', empty.code === 1, empty);
  check('the refusal points at the backups', /backups exist/.test(empty.out), empty.out);

  console.log('18. silos: two hubs side by side, and a swapped database');
  const X = { ...SQL, BUREAU_HUB_ID: 'hub-x', BUREAU_PUBLIC_URL: `http://127.0.0.1:${P3}` };
  const Y = { ...SQL, BUREAU_HUB_ID: 'hub-y', BUREAU_PUBLIC_URL: `http://127.0.0.1:${P4}` };
  const hx = await boot('x', P3, X);
  const hy = await boot('y', P4, Y);
  await api(P3, 'POST', '/api/tasks', { title: 'only on x' });
  await api(P4, 'POST', '/api/tasks', { title: 'only on y' });
  await api(P3, 'POST', '/api/messages', { from: 'human', to: '*', body: 'x speaking' });
  const tx = JSON.stringify((await api(P3, 'GET', '/api/state')).body);
  const ty = JSON.stringify((await api(P4, 'GET', '/api/state')).body);
  check('x sees its own mission and not y\'s', tx.includes('only on x') && !tx.includes('only on y'));
  check('y sees its own mission and not x\'s', ty.includes('only on y') && !ty.includes('only on x'));
  check('y\'s inbox has none of x\'s messages', !JSON.stringify((await api(P4, 'GET', '/api/messages')).body).includes('x speaking'));
  await stop(hx); await stop(hy);
  const fx = fs.readFileSync(path.join(dataOf('x'), 'bureau.db')).toString('latin1');
  check('x\'s file holds nothing of y', fx.includes('only on x') && !fx.includes('only on y'));
  // y's settings pointed at x's folder
  const swapped = await refused('x', P4, Y);
  check('a hub refuses another hub\'s database', swapped.code === 1, swapped);
  check('the refusal names both hub ids', swapped.out.includes('hub-x') && swapped.out.includes('hub-y'), swapped.out);
  // the same id, but the database belongs to another address
  const moved = await refused('x', P3, { ...X, BUREAU_PUBLIC_URL: 'https://elsewhere.example' });
  check('another public URL is refused', moved.code === 1 && moved.out.includes(`http://127.0.0.1:${P3}`) && moved.out.includes('https://elsewhere.example'), moved.out);
  // and a copy of x's database in y's folder
  fs.rmSync(dataOf('y'), { recursive: true, force: true });
  fs.mkdirSync(dataOf('y'), { recursive: true });
  fs.copyFileSync(path.join(dataOf('x'), 'bureau.db'), path.join(dataOf('y'), 'bureau.db'));
  const copied = await refused('y', P4, Y);
  check('a database copied into another hub\'s folder is refused', copied.code === 1 && /belongs to hub hub-x/.test(copied.out), copied.out);
  const ident = tool('hub-identity.js', [dataOf('x')]);
  check('hub-identity prints the identity', ident.status === 0 && JSON.parse(ident.stdout).hub_id === 'hub-x', ident.stdout + ident.stderr);
  const okAgain = await boot('x', P3, X);
  check('x itself still boots on its own database', okAgain.exitCode === null && (await api(P3, 'GET', '/api/health')).body.store === 'sqlite');
  await stop(okAgain);
}

async function main() {
  try {
    unit();
    await hubs();
  } catch (e) { FAIL++; console.error(e); }
  finally {
    for (const c of running) await stop(c);
    try { fs.rmSync(dir, { recursive: true, force: true }); } catch { /* best effort */ }
  }
  console.log(`\npassed ${PASS}, failed ${FAIL}`);
  process.exit(FAIL ? 1 : 0);
}
main();

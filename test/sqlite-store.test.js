// test/sqlite-store.test.js: BUREAU_STORE=sqlite. Importing a state.json,
// surviving a restart, and writing the state back out to go home again.
// Skipped on a Node without node:sqlite. Self-contained, zero deps.
// Usage: node test/sqlite-store.test.js
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn, spawnSync } = require('child_process');

try { require('node:sqlite'); } catch { console.log('node:sqlite is not available on this Node: skipped'); process.exit(0); }

const HUB_PORT = +process.env.HUB_PORT || 8191;
const TOKEN = 'sqlitetest';
const BASE = `http://127.0.0.1:${HUB_PORT}`;
let PASS = 0, FAIL = 0;
function check(label, ok, got) {
  if (ok) { PASS++; console.log(`  ok: ${label}`); }
  else { FAIL++; console.log(`  FAIL: ${label}${got !== undefined ? ` (got: ${JSON.stringify(got).slice(0, 300)})` : ''}`); }
}
const sleep = ms => new Promise(r => setTimeout(r, ms));

async function main() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bureau-sqlite-'));
  const data = path.join(dir, 'data');
  const env = extra => ({ ...process.env, NODE_NO_WARNINGS: '1', PORT: String(HUB_PORT), HOST: '127.0.0.1', BUREAU_TOKEN: TOKEN, BUREAU_DATA_DIR: data, BUREAU_BRAIN_DIR: path.join(dir, 'brain'), BUREAU_WORK_DIR: path.join(dir, 'work'), BUREAU_POKES: '', DISCORD_WEBHOOK_URL: '', BUREAU_ENV_FILE: path.join(dir, 'no.env'), ...extra });
  let hub = null;
  const start = async extra => {
    hub = spawn(process.execPath, [path.join(__dirname, '..', 'hub', 'server.js')], { env: env(extra), stdio: 'ignore' });
    for (let i = 0; i < 40; i++) { try { await fetch(`${BASE}/health`); return; } catch { await sleep(250); } }
    throw new Error('hub never answered');
  };
  const stop = () => new Promise(r => { hub.once('exit', r); hub.kill('SIGTERM'); });
  const api = async (method, p, body) => {
    const r = await fetch(BASE + p, { method, headers: { authorization: `Bearer ${TOKEN}`, 'content-type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });
    return { code: r.status, body: await r.json() };
  };
  const SQL = { BUREAU_STORE: 'sqlite' };
  try {
    console.log('1. a hub on the file store, with real history');
    await start({});
    await api('POST', '/api/projects', { id: 'alpha', label: 'alpha' });
    const a = (await api('POST', '/api/tasks', { title: 'first', project: 'alpha' })).body.task.id;
    const b = (await api('POST', '/api/tasks', { title: 'second', project: 'alpha' })).body.task.id;
    await api('POST', '/api/tasks/claim', { agent: 'worker', id: a });
    await api('PATCH', `/api/tasks/${a}`, { agent: 'worker', status: 'in_progress', note: 'working' });
    await api('POST', '/api/messages', { from: 'worker', to: 'boss', body: 'hello' });
    await api('PATCH', '/api/settings', { global: { store_prompts_days: 7 } });
    const before = (await api('GET', '/api/state')).body;
    check('it says it is on the file store', (await api('GET', '/api/health')).body.store === 'json');
    await stop();

    console.log('2. the first boot on SQLite imports it');
    await start(SQL);
    const health = (await api('GET', '/api/health')).body;
    check('it says it is on SQLite', health.store === 'sqlite', health);
    const after = (await api('GET', '/api/state')).body;
    check('the same missions', JSON.stringify(after.tasks) === JSON.stringify(before.tasks), after.tasks);
    check('the same roster', after.agents.length === before.agents.length, after.agents);
    check('the same projects', JSON.stringify(after.projects.map(p => p.id)) === JSON.stringify(before.projects.map(p => p.id)));
    check('the settings came along', (await api('GET', '/api/settings')).body.settings.global.store_prompts_days === 7);
    check('the state file is kept aside', fs.readdirSync(data).some(n => n.startsWith('state.json.imported-')) && !fs.existsSync(path.join(data, 'state.json')));

    console.log('3. work carries on and survives a restart');
    await api('PATCH', `/api/tasks/${a}`, { agent: 'worker', status: 'done', note: 'finished' });
    const c = (await api('POST', '/api/tasks', { title: 'third', project: 'alpha' })).body.task.id;
    await sleep(300);
    await stop();
    await start(SQL);
    const t = (await api('GET', `/api/tasks/${a}`)).body.task;
    check('a change is still there', t.status === 'done', t);
    check('so is a new mission', (await api('GET', `/api/tasks/${c}`)).code === 200);
    check('and ids keep counting', Number(c.slice(2)) > Number(b.slice(2)));
    const exp = await api('GET', '/api/export');
    check('the export is the whole state', exp.code === 200 && exp.body.tasks.length === 3 && Array.isArray(exp.body.messages), exp.body);
    await stop();

    console.log('4. real columns, for queries');
    const { DatabaseSync } = require('node:sqlite');
    const db = new DatabaseSync(path.join(data, 'bureau.db'), { readOnly: true });
    const row = db.prepare('SELECT status, project, assignee, claimed_at, closed_at FROM tasks WHERE id=?').get(a);
    db.close();
    check('status and project', row.status === 'done' && row.project === 'alpha', row);
    check('claimed_at and closed_at from the log', !!row.claimed_at && !!row.closed_at, row);

    console.log('5. going back to the file store');
    const tool = path.join(__dirname, '..', 'hub', 'tools', 'state-export.js');
    const out = spawnSync(process.execPath, [tool, data], { env: env({}), encoding: 'utf8' });
    check('the tool writes state.json', out.status === 0 && fs.existsSync(path.join(data, 'state.json')), out);
    const refused = spawnSync(process.execPath, [tool, data], { env: env({}), encoding: 'utf8' });
    check('and never overwrites one', refused.status === 1, refused.stdout);
    await start({});
    check('a file-store hub boots on it', (await api('GET', '/api/health')).body.store === 'json');
    check('with everything', (await api('GET', `/api/tasks/${a}`)).body.task.status === 'done' && (await api('GET', `/api/tasks/${c}`)).code === 200);
    await stop();
  } finally {
    if (hub && hub.exitCode === null && hub.signalCode === null) await stop();
    fs.rmSync(dir, { recursive: true, force: true });
  }
  console.log(`\npassed ${PASS}, failed ${FAIL}`);
  process.exit(FAIL ? 1 : 0);
}
main().catch(e => { console.error(e); process.exit(1); });

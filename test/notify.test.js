// test/notify.test.js: the notify setting (S2-f) decides which Discord pings fire.
// Self-contained, zero deps: a local sink stands in for the Discord webhook,
// and a scratch hub posts to it. Usage: node test/notify.test.js
'use strict';
const http = require('http');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');
const { notifyAllows } = require('../hub/lib/discord');

const HUB_PORT = +process.env.HUB_PORT || 8194;
const TOKEN = 'notifytest';
const BASE = `http://127.0.0.1:${HUB_PORT}`;
let PASS = 0, FAIL = 0;
function check(label, ok, got) {
  if (ok) { PASS++; console.log(`  ok: ${label}`); }
  else { FAIL++; console.log(`  FAIL: ${label}${got !== undefined ? ` (got: ${String(got).slice(0, 200)})` : ''}`); }
}
const sleep = ms => new Promise(r => setTimeout(r, ms));

async function main() {
  console.log('1. the decision, unit level');
  const types = ['task.created', 'task.review', 'task.blocked', 'task.done', 'message.posted'];
  const want = {
    all: [1, 1, 1, 1, 1], review: [0, 1, 0, 0, 0], blocked: [0, 0, 1, 0, 0], none: [0, 0, 0, 0, 0],
  };
  for (const [policy, row] of Object.entries(want))
    check(`${policy}: ${row.join('')}`, types.every((t, i) => notifyAllows(policy, t) === !!row[i]));
  check('unset means all, as before', types.every(t => notifyAllows(undefined, t)));

  console.log('2. end to end: a sink in place of Discord');
  const pings = [];
  const sink = http.createServer((req, res) => {
    let b = ''; req.on('data', c => { b += c; });
    req.on('end', () => { try { pings.push(JSON.parse(b).content); } catch { } res.end('{}'); });
  });
  await new Promise(r => sink.listen(0, '127.0.0.1', r));
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bureau-notify-'));
  const hub = spawn(process.execPath, [path.join(__dirname, '..', 'hub', 'server.js')], {
    env: { ...process.env, PORT: String(HUB_PORT), BUREAU_TOKEN: TOKEN, BUREAU_DATA_DIR: path.join(dir, 'data'),
      BUREAU_BRAIN_DIR: path.join(dir, 'brain'), DISCORD_WEBHOOK_URL: `http://127.0.0.1:${sink.address().port}/hook`, BUREAU_POKES: '' },
    stdio: 'ignore',
  });
  const api = async (method, p, body) => {
    const r = await fetch(BASE + p, { method, headers: { authorization: `Bearer ${TOKEN}`, 'content-type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });
    return r.json();
  };
  // Pings are fire-and-forget: take what arrived after a short wait.
  const pingsDuring = async fn => { const n = pings.length; await fn(); await sleep(400); return pings.slice(n); };
  try {
    for (let i = 0; i < 40; i++) { try { await fetch(`${BASE}/health`); break; } catch { await sleep(250); } }
    await api('POST', '/api/projects', { label: 'loud' });
    await api('POST', '/api/agents/register', { name: 'lead-1', kind: 'dummy', capabilities: ['lead'] });
    const mission = async (project, title) => {
      const t = (await api('POST', '/api/tasks', { title, project })).task;
      await api('POST', '/api/tasks/claim', { agent: 'lead-1', id: t.id });
      return t.id;
    };

    let got = await pingsDuring(() => api('POST', '/api/tasks', { title: 'no settings ping', project: 'general' }));
    check('no settings: task.created pings as today', got.some(c => /New task/.test(c)), got);

    await api('PATCH', '/api/settings', { global: { notify: 'none' } });
    got = await pingsDuring(async () => {
      await api('POST', '/api/tasks', { title: 'silent', project: 'general' });
      await api('POST', '/api/messages', { from: 'lead-1', to: 'boss', body: 'hello boss' });
    });
    check('none: nothing pings, messages to the boss included', got.length === 0, got);

    await api('PATCH', '/api/settings', { global: { notify: 'review' }, projects: { loud: { notify: 'all' } } });
    const g1 = await mission('general', 'review policy, blocked');
    const g2 = await mission('general', 'review policy, review');
    got = await pingsDuring(() => api('PATCH', `/api/tasks/${g1}`, { agent: 'lead-1', status: 'blocked', note: 'waiting on: boss' }));
    check('review: a blocked mission does not ping', got.length === 0, got);
    got = await pingsDuring(() => api('PATCH', `/api/tasks/${g2}`, { agent: 'lead-1', status: 'review' }));
    check('review: a boss-gate review pings', got.length === 1 && /Review needed/.test(got[0]), got);
    got = await pingsDuring(() => api('POST', '/api/tasks', { title: 'loud project', project: 'loud' }));
    check('project override all wins over global review', got.some(c => /loud project/.test(c)), got);

    await api('PATCH', '/api/settings', { global: { notify: 'blocked' }, projects: { loud: null } });
    const g3 = await mission('general', 'blocked policy, blocked');
    const g4 = await mission('general', 'blocked policy, review');
    got = await pingsDuring(() => api('PATCH', `/api/tasks/${g3}`, { agent: 'lead-1', status: 'blocked', note: 'waiting on: boss' }));
    check('blocked: a blocked mission pings', got.length === 1 && /Waiting on the boss/.test(got[0]), got);
    got = await pingsDuring(() => api('PATCH', `/api/tasks/${g4}`, { agent: 'lead-1', status: 'review' }));
    check('blocked: a review does not ping', got.length === 0, got);

    await api('PATCH', '/api/settings', { global: { notify: null } });
    got = await pingsDuring(() => api('POST', '/api/tasks', { title: 'cleared ping', project: 'general' }));
    check('cleared: pings as today again', got.some(c => /cleared ping/.test(c)), got);
  } finally {
    hub.kill();
    sink.close();
    fs.rmSync(dir, { recursive: true, force: true });
  }
  console.log(`\npassed ${PASS}, failed ${FAIL}`);
  process.exit(FAIL ? 1 : 0);
}
main().catch(e => { console.error(e); process.exit(1); });

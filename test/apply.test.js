// test/apply.test.js: a tampered payload fails the hash (M4).
// The API cannot change a filed payload, so this test does what an attacker
// with disk access would: it stops a scratch hub, edits the payload inside
// state.json, starts the hub again, and asks it to apply. The hub must refuse
// and write nothing. Self-contained, zero deps. Usage: node test/apply.test.js
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { spawn } = require('child_process');
const { payloadHash } = require('../hub/lib/store');

const HUB_PORT = +process.env.HUB_PORT || 8192;
const TOKEN = 'applytest';
const BASE = `http://127.0.0.1:${HUB_PORT}`;
let PASS = 0, FAIL = 0;
function check(label, ok, got) {
  if (ok) { PASS++; console.log(`  ok: ${label}`); }
  else { FAIL++; console.log(`  FAIL: ${label}${got !== undefined ? ` (got: ${JSON.stringify(got).slice(0, 200)})` : ''}`); }
}
const sleep = ms => new Promise(r => setTimeout(r, ms));

async function main() {
  console.log('1. the hash, unit level');
  // a well-formed note: payloads to curated folders are linted when filed
  const ops = [{ op: 'write', file: 'knowledge/pinned.md', content: '---\ntitle: Pinned\ncompartment: knowledge\npermalink: pinned\nversion: 1\n---\n\n- [fact] pinned (fake) (source: t-1)\n' }];
  const want = crypto.createHash('sha256').update(JSON.stringify(ops)).digest('hex');
  check('sha256 of the canonical JSON of ops', payloadHash(ops) === want);
  check('key order does not change it', payloadHash([{ content: ops[0].content, file: ops[0].file, op: 'write' }]) === want);
  check('extra keys do not change it', payloadHash([{ ...ops[0], note: 'x' }]) === want);
  check('one changed byte does', payloadHash([{ ...ops[0], content: ops[0].content + ' ' }]) !== want);

  console.log('2. end to end: tamper with state.json between filing and apply');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bureau-apply-'));
  const env = { ...process.env, PORT: String(HUB_PORT), BUREAU_TOKEN: TOKEN, BUREAU_DATA_DIR: path.join(dir, 'data'),
    BUREAU_BRAIN_DIR: path.join(dir, 'brain'), BUREAU_WORK_DIR: path.join(dir, 'work'), BUREAU_POKES: '', DISCORD_WEBHOOK_URL: '' };
  const api = async (method, p, body) => {
    const r = await fetch(BASE + p, { method, headers: { authorization: `Bearer ${TOKEN}`, 'content-type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });
    return { code: r.status, body: await r.json() };
  };
  let hub = null;
  const start = async () => {
    hub = spawn(process.execPath, [path.join(__dirname, '..', 'hub', 'server.js')], { env, stdio: 'ignore' });
    for (let i = 0; i < 40; i++) { try { await fetch(`${BASE}/health`); return; } catch { await sleep(250); } }
    throw new Error('hub never answered /health');
  };
  // SIGTERM flushes the debounced save, so state.json is whole when it exits.
  const stop = () => new Promise(r => { hub.once('exit', r); hub.kill('SIGTERM'); });
  const stateFile = path.join(dir, 'data', 'state.json');
  const editPayload = content => {
    const s = JSON.parse(fs.readFileSync(stateFile, 'utf8'));
    s.tasks.find(t => t.id === id).items[0].payload.ops[0].content = content;
    fs.writeFileSync(stateFile, JSON.stringify(s, null, 2));
  };
  let id;
  try {
    await start();
    await api('POST', '/api/agents/register', { name: 'lead-1', kind: 'dummy', capabilities: ['lead'] });
    id = (await api('POST', '/api/tasks', { title: 'pinned digest', project: 'general' })).body.task.id;
    await api('POST', '/api/tasks/claim', { agent: 'worker-1', id });
    const filed = await api('PATCH', `/api/tasks/${id}`, { agent: 'worker-1', items: [{ title: 'pin it', payload: { ops } }] });
    check('filed with the expected hash', filed.body.task.items[0].payload_sha256 === want, filed.body);
    await api('PATCH', `/api/tasks/${id}`, { agent: 'lead-1', status: 'review', after_approval: 'return' });
    const ok = await api('PATCH', `/api/tasks/${id}`, { agent: 'human', status: 'done', verdicts: [{ id: 'i1', verdict: 'approved' }] });
    check('approved, back with its holder', ok.body.task && ok.body.task.status === 'approved', ok.body);

    await stop();
    editPayload(ops[0].content.replace('pinned (fake)', 'something the boss never saw'));
    await start();
    const bad = await api('POST', `/api/tasks/${id}/apply`, { agent: 'worker-1', item: 'i1' });
    check('a tampered payload is refused with 409', bad.code === 409, bad);
    check('the refusal names the hash', /does not match the hash/.test(bad.body.error || ''), bad.body);
    const file = await api('GET', '/api/knowledge?file=knowledge/pinned.md');
    check('nothing was written', file.code === 404, file);
    const t = (await api('GET', `/api/tasks/${id}`)).body.task;
    check('the item is not marked applied', !t.items[0].applied_at, t.items[0]);

    await stop();
    editPayload(ops[0].content);
    await start();
    const good = await api('POST', `/api/tasks/${id}/apply`, { agent: 'worker-1', item: 'i1' });
    check('restored to the approved bytes, it applies', good.code === 200 && good.body.item.applied_by === 'worker-1', good);
    const back = await api('GET', '/api/knowledge?file=knowledge/pinned.md');
    check('and the file holds exactly those bytes', back.body.content === ops[0].content, back.body);
  } finally {
    if (hub && hub.exitCode === null && hub.signalCode === null) await stop();
    fs.rmSync(dir, { recursive: true, force: true });
  }
  console.log(`\npassed ${PASS}, failed ${FAIL}`);
  process.exit(FAIL ? 1 : 0);
}
main().catch(e => { console.error(e); process.exit(1); });

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
    BUREAU_BRAIN_DIR: path.join(dir, 'brain'), BUREAU_WORK_DIR: path.join(dir, 'work'), BUREAU_POKES: '', BUREAU_ENV_FILE: path.join(dir, 'no.env') };
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
  // On Unix SIGTERM flushes the debounced save; Windows has no SIGTERM (kill
  // ends the process outright), so the test waits for state.json itself first.
  const stop = () => new Promise(r => { hub.once('exit', r); hub.kill('SIGTERM'); });
  const stateFile = path.join(dir, 'data', 'state.json');
  const flushed = async pred => {
    for (let i = 0; i < 40; i++) {
      try { if (pred(JSON.parse(fs.readFileSync(stateFile, 'utf8')))) return; } catch { }
      await sleep(100);
    }
    throw new Error('state.json never caught up');
  };
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

    await flushed(s => s.tasks.some(t => t.id === id && t.status === 'approved'));
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

    await sleep(300); // past the 100ms debounce of anything the refusal logged
    await stop();
    editPayload(ops[0].content);
    await start();
    const good = await api('POST', `/api/tasks/${id}/apply`, { agent: 'worker-1', item: 'i1' });
    check('restored to the approved bytes, it applies', good.code === 200 && good.body.item.applied_by === 'worker-1', good);
    const back = await api('GET', '/api/knowledge?file=knowledge/pinned.md');
    check('and the file holds exactly those bytes', back.body.content === ops[0].content, back.body);

    console.log('3. an approval cannot overwrite what was written since it was filed');
    const stateFileName = 'projects/general/STATE.md';
    await api('POST', '/api/knowledge', { file: stateFileName, content: 'the state when the item was filed\n', author: 'worker-1' });
    const approveWrite = async content => {
      const tid = (await api('POST', '/api/tasks', { title: 'a compaction', project: 'general' })).body.task.id;
      await api('POST', '/api/tasks/claim', { agent: 'worker-1', id: tid });
      await api('PATCH', `/api/tasks/${tid}`, { agent: 'worker-1', items: [{ title: 'compact it', payload: { ops: [{ op: 'write', file: stateFileName, content }] } }] });
      await api('PATCH', `/api/tasks/${tid}`, { agent: 'lead-1', status: 'review', after_approval: 'return' });
      await api('PATCH', `/api/tasks/${tid}`, { agent: 'human', status: 'done', verdicts: [{ id: 'i1', verdict: 'approved' }] });
      return tid;
    };
    const unchanged = await approveWrite('compacted, nothing moved\n');
    const applied = await api('POST', `/api/tasks/${unchanged}/apply`, { agent: 'worker-1', item: 'i1' });
    check('an unchanged target applies', applied.code === 200, applied);

    const moved = await approveWrite('compacted from an old copy\n');
    await api('POST', '/api/knowledge', { file: stateFileName, content: 'a debrief written after the filing\n', author: 'worker-1', mode: 'append' });
    const refused = await api('POST', `/api/tasks/${moved}/apply`, { agent: 'worker-1', item: 'i1' });
    check('a target that moved is refused with 409', refused.code === 409, refused);
    check('the refusal names the file', (refused.body.error || '').includes(stateFileName), refused.body);
    const kept = await api('GET', `/api/knowledge?file=${stateFileName}`);
    check('the newer text survives', kept.body.content.includes('a debrief written after the filing'), kept.body);
    check('the old payload was not written', !kept.body.content.includes('from an old copy'), kept.body);

    console.log('4. an item that no longer passes lint is caught at approval and at apply, never half-written');
    // t-494: an item filed before project files were linted, refused at its
    // second op on apply after its first had landed. The API refuses such a
    // payload at filing now, so the test plants one as an older hub left it:
    // stored, hashed, and failing today's lint (a summary over 200 characters).
    await api('POST', '/api/projects', { label: 'Lintcase' });
    const archiveFile = 'archive/projects/lintcase/STATE-old.md';
    const notesFile = 'projects/lintcase/STATE.md';
    const stateText = summary => `---\ntitle: Lintcase\nsummary: ${summary}\n---\n\n## Now\n\nNothing yet.\n`;
    const goodOps = [{ op: 'write', file: archiveFile, content: 'the old state, archived\n' },
      { op: 'write', file: notesFile, content: stateText('Short and fine.') }];
    const badOps = [goodOps[0], { op: 'write', file: notesFile, content: stateText('far too long '.repeat(20).trim()) }];
    const plant = async (tid, toStatus) => {
      await flushed(s => s.tasks.some(t => t.id === tid && t.status === toStatus));
      await stop();
      const s = JSON.parse(fs.readFileSync(stateFile, 'utf8'));
      const it = s.tasks.find(t => t.id === tid).items[0];
      it.payload.ops = badOps;
      it.payload_sha256 = payloadHash(badOps);
      fs.writeFileSync(stateFile, JSON.stringify(s, null, 2));
      await start();
    };
    const fileTwoOps = async () => {
      const tid = (await api('POST', '/api/tasks', { title: 'an old digest', project: 'lintcase' })).body.task.id;
      await api('POST', '/api/tasks/claim', { agent: 'worker-1', id: tid });
      const f = await api('PATCH', `/api/tasks/${tid}`, { agent: 'worker-1', items: [{ title: 'archive and rewrite', payload: { ops: goodOps } }] });
      check('a payload that passes lint is filed', f.code === 200, f);
      await api('PATCH', `/api/tasks/${tid}`, { agent: 'lead-1', status: 'review', after_approval: 'return' });
      return tid;
    };

    const atApproval = await fileTwoOps();
    await plant(atApproval, 'review');
    const refusedApproval = await api('PATCH', `/api/tasks/${atApproval}`, { agent: 'human', status: 'done', verdicts: [{ id: 'i1', verdict: 'approved' }] });
    check('approving an item that can no longer be written is refused', refusedApproval.code === 400 && /cannot approve: i1 can no longer be written/.test(refusedApproval.body.error || ''), refusedApproval);
    check('the refusal says why', /summary/.test(refusedApproval.body.error || ''), refusedApproval.body);
    check('the mission stays in review', (await api('GET', `/api/tasks/${atApproval}`)).body.task.status === 'review');
    const rejected = await api('PATCH', `/api/tasks/${atApproval}`, { agent: 'human', status: 'done', verdicts: [{ id: 'i1', verdict: 'rejected', comment: 'summary too long, file it again' }] });
    check('rejecting it lets the approval through', rejected.code === 200 && rejected.body.task.status === 'approved', rejected);
    const closed = await api('PATCH', `/api/tasks/${atApproval}`, { agent: 'worker-1', status: 'done' });
    check('and the holder closes it, nothing left to apply', closed.code === 200 && closed.body.task.status === 'done', closed);

    const atApply = await fileTwoOps();
    const approvedOk = await api('PATCH', `/api/tasks/${atApply}`, { agent: 'human', status: 'done', verdicts: [{ id: 'i1', verdict: 'approved' }] });
    check('a good item is approved', approvedOk.body.task && approvedOk.body.task.status === 'approved', approvedOk.body);
    await plant(atApply, 'approved');
    const preflight = await api('POST', `/api/tasks/${atApply}/apply`, { agent: 'worker-1', item: 'i1' });
    check('apply checks every op first and refuses with 422', preflight.code === 422 && /nothing written/.test(preflight.body.error || ''), preflight);
    const archived = await api('GET', `/api/knowledge?file=${archiveFile}`);
    check('the first op was not written either', archived.code === 404, archived);
    const t2 = (await api('GET', `/api/tasks/${atApply}`)).body.task;
    check('no op is counted as applied', !t2.items[0].applied_ops && !t2.items[0].applied_at, t2.items[0]);
    const unstuck = await api('PATCH', `/api/tasks/${atApply}`, { agent: 'human', verdicts: [{ id: 'i1', verdict: 'rejected' }] });
    check('the boss can still reject it while approved', unstuck.code === 200 && unstuck.body.task.items[0].verdict === 'rejected', unstuck);
    const closed2 = await api('PATCH', `/api/tasks/${atApply}`, { agent: 'worker-1', status: 'done' });
    check('then the holder closes it', closed2.code === 200 && closed2.body.task.status === 'done', closed2);
  } finally {
    if (hub && hub.exitCode === null && hub.signalCode === null) await stop();
    fs.rmSync(dir, { recursive: true, force: true });
  }
  console.log(`\npassed ${PASS}, failed ${FAIL}`);
  process.exit(FAIL ? 1 : 0);
}
main().catch(e => { console.error(e); process.exit(1); });

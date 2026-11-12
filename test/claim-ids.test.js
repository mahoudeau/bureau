// test/claim-ids.test.js: claim ids and the evidence behind them (M3). The
// migration, ids assigned on write, new claims citing what exists, and one
// call for "where does this come from". Self-contained, zero deps, fake data.
// Usage: node test/claim-ids.test.js
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn, spawnSync } = require('child_process');
const { migrate, stampIds } = require('../hub/tools/migrate-claims');
const claims = require('../hub/lib/claims');

const HUB_PORT = +process.env.HUB_PORT || 8195;
const TOKEN = 'claimtest';
const BASE = `http://127.0.0.1:${HUB_PORT}`;
let PASS = 0, FAIL = 0;
function check(label, ok, got) {
  if (ok) { PASS++; console.log(`  ok: ${label}`); }
  else { FAIL++; console.log(`  FAIL: ${label}${got !== undefined ? ` (got: ${JSON.stringify(got).slice(0, 300)})` : ''}`); }
}
const sleep = ms => new Promise(r => setTimeout(r, ms));
const LEGACY = '---\ntitle: Toaster\ncompartment: recipes\nscope: global\npermalink: toaster\nversion: 1\nsummary: About the toaster.\nsource: t-1\n---\n\n## Steps\n\n- [step] Flash the walrus firmware,\n  then wait a minute.\n- [gotcha] A cold cable fails (source: t-1)\n\nA line of prose stays as it is.\n';
const NOTE = '---\ntitle: Kettle\ncompartment: knowledge\nscope: global\npermalink: kettle\nversion: 1\nsummary: About the kettle.\nformat: 0.3\nsource: t-1\n---\n\n- [fact] The kettle whistles at ninety degrees ^c-aaaaaa\n';

async function main() {
  console.log('1. the migration');
  const taken = new Set();
  const m = migrate(LEGACY, 'recipes/toaster.md', taken);
  check('reads back with no errors', m.errors.length === 0, m.errors);
  const p = claims.parseFile(m.content, { path: 'recipes/toaster.md' });
  check('format 0.3 in the frontmatter', p.format === '0.3', p.format);
  check('every claim has an id', p.claims.length === 2 && p.claims.every(c => /^c-[a-z0-9]{6}$/.test(c.id)), p.claims);
  check('a hard-wrapped claim is one line, text intact', p.claims[0].text === 'Flash the walrus firmware, then wait a minute.', p.claims[0].text);
  check('sources survive', p.claims[1].sources[0].ref === 't-1', p.claims[1]);
  check('prose is untouched', m.content.includes('\nA line of prose stays as it is.\n'));
  check('the same text as before, as the parser reads it', JSON.stringify(claims.parseFile(LEGACY, { path: 'recipes/toaster.md' }).claims.map(c => c.text)) === JSON.stringify(p.claims.map(c => c.text)));
  const twice = migrate(m.content, 'recipes/toaster.md', new Set(p.claims.map(c => c.id)));
  check('running it twice changes nothing', twice.content === m.content && !twice.changed);
  const a = migrate(LEGACY, 'recipes/toaster.md', new Set()), b = migrate(LEGACY, 'recipes/toaster.md', new Set());
  check('the ids are the same on every run', a.content === b.content);
  const t = new Set(), one = stampIds('- [fact] Same text', 'x.md', t).content, two = stampIds('- [fact] Same text', 'x.md', t).content;
  check('a collision takes another id', one !== two, [one, two]);

  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bureau-claims-'));
  const env = { ...process.env, PORT: String(HUB_PORT), HOST: '127.0.0.1', BUREAU_TOKEN: TOKEN, BUREAU_DATA_DIR: path.join(dir, 'data'), BUREAU_BRAIN_DIR: path.join(dir, 'brain'),
    BUREAU_WORK_DIR: path.join(dir, 'work'), BUREAU_POKES: '', BUREAU_ENV_FILE: path.join(dir, 'no.env') };
  const hub = spawn(process.execPath, [path.join(__dirname, '..', 'hub', 'server.js')], { env, stdio: 'ignore' });
  const api = async (method, u, body) => {
    const r = await fetch(BASE + u, { method, headers: { authorization: `Bearer ${TOKEN}`, 'content-type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });
    return { code: r.status, body: await r.json() };
  };
  const write = (file, content, mode) => api('POST', '/api/knowledge', { file, content, author: 'human', ...(mode ? { mode } : {}) });
  const read = async file => (await api('GET', `/api/knowledge?file=${file}`)).body.content;

  try {
    for (let i = 0; i < 40; i++) { try { await fetch(`${BASE}/health`); break; } catch { await sleep(250); } }
    await api('POST', '/api/projects', { id: 'alpha', label: 'alpha' });
    const task = (await api('POST', '/api/tasks', { title: 'walrus cable investigation', project: 'alpha' })).body.task.id;
    await api('POST', '/api/agents/register', { name: 'scribe', kind: 'dummy' });
    await api('POST', '/api/tasks/claim', { agent: 'scribe', id: task });
    const rec = (await api('POST', '/api/journal', { agent: 'scribe', kind: 'gotcha', text: 'The kettle lid sticks', evidence: 'tried it' })).body.record.id;

    console.log('2. a format 0.3 note on write');
    // force: this claim leans on the file's source on purpose, as a migrated one does
    let r = await api('POST', '/api/knowledge', { file: 'knowledge/kettle.md', content: NOTE, author: 'human', force: true });
    check('a note with ids is accepted', r.code === 200, r);
    r = await write('knowledge/kettle.md', `- [fact] The kettle lid sticks in winter (source: ${rec})`, 'append');
    check('a new claim citing a real record is accepted', r.code === 200, r);
    let text = await read('knowledge/kettle.md');
    check('the hub gave it an id', /The kettle lid sticks in winter \(source: j-[a-z0-9]{8}\) \^c-[a-z0-9]{6}/.test(text), text);
    r = await write('knowledge/kettle.md', '- [fact] A new claim leaning on the file source', 'append');
    check('a new claim with no source of its own is refused', r.code === 422 && r.body.lint.some(l => /its own source/.test(l)), r);
    r = await write('knowledge/kettle.md', '- [fact] A claim citing a ghost mission (source: t-99999)', 'append');
    check('citing a mission that does not exist is refused', r.code === 422 && r.body.lint.some(l => /not a mission/.test(l)), r);
    r = await write('knowledge/kettle.md', '- [fact] A claim citing a ghost record (source: j-zzzzzzzz)', 'append');
    check('citing a record that does not exist is refused', r.code === 422 && r.body.lint.some(l => /not a journal record/.test(l)), r);
    r = await write('knowledge/kettle.md', `- [fact] A claim citing a real mission (source: ${task})`, 'append');
    check('citing a real mission is accepted', r.code === 200, r);
    text = await read('knowledge/kettle.md');
    r = await write('knowledge/kettle.md', text.replace('whistles at ninety degrees', 'whistles at ninety degrees').replace('\n\n- [fact] The kettle', '\n\nA new line of prose.\n\n- [fact] The kettle'));
    check('rewriting a file keeps its claims legal', r.code === 200, r);
    r = await write('knowledge/kettle-copy.md', NOTE.replace('permalink: kettle', 'permalink: kettle-copy').replace('title: Kettle', 'title: Kettle copy'));
    check('an id used in another note is refused', r.code === 422 && r.body.lint.some(l => /also used in/.test(l)), r);

    console.log('3. a file not yet migrated is left alone');
    r = await write('recipes/toaster.md', LEGACY);
    check('accepted as before', r.code === 200, r);
    check('no id added', !/\^c-/.test(await read('recipes/toaster.md')));

    console.log('4. show me the evidence');
    r = await api('GET', '/api/knowledge?claim=c-aaaaaa');
    check('a claim answers with its text', r.code === 200 && /ninety degrees/.test(r.body.text), r.body);
    check('it says the evidence is the file\'s', r.body.evidence === 'file', r.body);
    check('and resolves it', r.body.sources[0].ref === 't-1', r.body.sources);
    text = await read('knowledge/kettle.md');
    const own = text.match(/lid sticks in winter .*\^(c-[a-z0-9]{6})/)[1];
    r = await api('GET', `/api/knowledge?claim=${own}`);
    check('a record is resolved to its text and evidence', r.body.evidence === 'own' && r.body.sources[0].type === 'record' && r.body.sources[0].found && r.body.sources[0].evidence === 'tried it', r.body);
    const onMission = text.match(/citing a real mission .*\^(c-[a-z0-9]{6})/)[1];
    r = await api('GET', `/api/knowledge?claim=${onMission}`);
    check('a mission is resolved to its title and status', r.body.sources[0].type === 'mission' && r.body.sources[0].title === 'walrus cable investigation', r.body);
    r = await api('GET', '/api/knowledge?claim=c-nothere');
    check('an unknown claim is 404', r.code === 404, r);

    console.log('5. the tool, and the health block');
    const brain = path.join(dir, 'copy');
    fs.mkdirSync(path.join(brain, 'recipes'), { recursive: true });
    fs.writeFileSync(path.join(brain, 'recipes', 'toaster.md'), LEGACY);
    const tool = path.join(__dirname, '..', 'hub', 'tools', 'migrate-claims.js');
    const dry = spawnSync(process.execPath, [tool, brain], { encoding: 'utf8' });
    check('a dry run writes nothing', dry.status === 0 && fs.readFileSync(path.join(brain, 'recipes', 'toaster.md'), 'utf8') === LEGACY, dry.stdout);
    const wet = spawnSync(process.execPath, [tool, brain, '--write'], { encoding: 'utf8' });
    check('--write migrates', wet.status === 0 && /format: 0\.3/.test(fs.readFileSync(path.join(brain, 'recipes', 'toaster.md'), 'utf8')), wet.stdout);
    r = await api('GET', '/api/memory/health');
    check('the health block counts claims with ids', r.body.provenance.with_id >= 3, r.body.provenance);
  } finally {
    hub.kill('SIGTERM');
    await sleep(300);
    fs.rmSync(dir, { recursive: true, force: true });
  }
  console.log(`\npassed ${PASS}, failed ${FAIL}`);
  process.exit(FAIL ? 1 : 0);
}
main().catch(e => { console.error(e); process.exit(1); });

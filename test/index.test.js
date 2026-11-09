// test/index.test.js: brain search and section reads. The walls come first: a
// project never sees another project's files. Self-contained, zero deps, all
// data fake. Usage: node test/index.test.js
'use strict';
const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');
const { tokens } = require('../hub/lib/index');

const HUB_PORT = +process.env.HUB_PORT || 8193;
const TOKEN = 'indextest';
const BASE = `http://127.0.0.1:${HUB_PORT}`;
let PASS = 0, FAIL = 0;
function check(label, ok, got) {
  if (ok) { PASS++; console.log(`  ok: ${label}`); }
  else { FAIL++; console.log(`  FAIL: ${label}${got !== undefined ? ` (got: ${JSON.stringify(got).slice(0, 300)})` : ''}`); }
}
const sleep = ms => new Promise(r => setTimeout(r, ms));
const NOTE = (title, body) => `---\ntitle: ${title}\ncompartment: knowledge\nscope: global\nversion: 1\n---\n\n${body}\n`;

async function main() {
  console.log('1. words');
  check('accents do not matter', tokens('déployer').join() === tokens('deployer').join());
  check('a plural finds its singular', tokens('toasters').join() === tokens('toaster').join());
  check('an identifier stays findable whole', tokens('see t-245 today').includes('t-245'));
  check('and by its parts', tokens('journalFreeText').includes('fre') || tokens('journalFreeText').includes('free'));
  check('French and English stopwords go', tokens('le the et and comment how').length === 0);

  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bureau-index-'));
  // The French shadow: terms for one passage, keyed by the hash of its text.
  const shadowed = 'The gibbon ledger closes on Fridays';
  fs.mkdirSync(path.join(dir, 'brain', '.index'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'brain', '.index', 'shadow-fr.json'), JSON.stringify({ [crypto.createHash('sha256').update(shadowed).digest('hex').slice(0, 16)]: 'registre comptable du singe, cloture hebdomadaire' }));
  const env = { ...process.env, PORT: String(HUB_PORT), HOST: '127.0.0.1', BUREAU_TOKEN: TOKEN, BUREAU_DATA_DIR: path.join(dir, 'data'), BUREAU_BRAIN_DIR: path.join(dir, 'brain'),
    BUREAU_WORK_DIR: path.join(dir, 'work'), BUREAU_POKES: '', DISCORD_WEBHOOK_URL: '', BUREAU_ENV_FILE: path.join(dir, 'no.env') };
  const hub = spawn(process.execPath, [path.join(__dirname, '..', 'hub', 'server.js')], { env, stdio: 'ignore' });
  const api = async (method, p, body) => {
    const r = await fetch(BASE + p, { method, headers: { authorization: `Bearer ${TOKEN}`, 'content-type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });
    return { code: r.status, body: await r.json() };
  };
  // force: these notes are fixtures for search, not for lint
  const put = (file, content, mode) => api('POST', '/api/knowledge', { file, content, author: 'human', force: true, ...(mode ? { mode } : {}) });
  const search = (q, project) => api('GET', `/api/knowledge/search?q=${encodeURIComponent(q)}${project ? `&project=${project}` : ''}`);
  const files = r => (r.body.results || []).map(x => x.file);

  try {
    for (let i = 0; i < 40; i++) { try { await fetch(`${BASE}/health`); break; } catch { await sleep(250); } }
    for (const id of ['alpha', 'beta']) await api('POST', '/api/projects', { id, label: id });

    await put('knowledge/toaster.md', NOTE('The toaster', '- [fact] The toaster needs a firmware flash every spring (source: t-1)\n- [fact] Its crumb tray is decorative (source: t-1)'));
    await put('projects/alpha/STATE.md', '---\ntitle: Alpha state\n---\n\n## Now\n\nStatus: the walrus migration is half done.\n\n## 2026-01-01 a debrief\n\nThe walrus migration moved the penguin ledger.\n');
    await put('projects/beta/STATE.md', '---\ntitle: Beta state\n---\n\n## Now\n\nStatus: the secret narwhal budget is 900 coins.\n');
    await put('projects/alpha/deliverables/narwhal-report.md', '# Report\n\nA long report about walrus deliverables that should only ever reach the map.\n');
    await put('attic/knowledge/old-toaster.md', NOTE('Old toaster', '- [fact] The zeppelin toaster was retired (source: t-1)'));
    await put('daily/2026-01-01.md', 'A daily note about the zeppelin.\n');

    console.log('2. search');
    let r = await search('firmware flash for the toaster');
    check('finds a global note', files(r)[0] === 'knowledge/toaster.md', r.body);
    check('returns the passage, not the file', /firmware flash/.test(r.body.results[0].text) && !/crumb tray/.test(r.body.results[0].text), r.body.results[0]);
    check('says where it came from', r.body.results[0].sources.includes('t-1'), r.body.results[0]);
    r = await api('GET', '/api/knowledge/search');
    check('q is required', r.code === 400, r);
    r = await search('how and the');
    check('a question of stopwords is skipped, not an error', r.code === 200 && r.body.skipped === 'no terms' && r.body.results.length === 0, r.body);

    console.log('3. walls');
    r = await search('walrus migration', 'alpha');
    check('a project sees its own state', files(r).includes('projects/alpha/STATE.md'), r.body);
    check('the scope says which chain', r.body.scope.project === 'alpha' && r.body.scope.resolved === true, r.body.scope);
    r = await search('walrus migration', 'beta');
    check('another project does not', !files(r).includes('projects/alpha/STATE.md'), r.body);
    r = await search('secret narwhal budget', 'alpha');
    check('nor the other way round', !files(r).some(f => f.startsWith('projects/beta/')), r.body);
    r = await search('walrus migration');
    check('no project: global only', !files(r).some(f => f.startsWith('projects/')), r.body);
    check('and the scope says unresolved', r.body.scope.resolved === false, r.body.scope);
    r = await search('walrus migration', 'nosuchproject');
    check('an unknown project is global only, not an error', r.code === 200 && !files(r).some(f => f.startsWith('projects/')), r.body);
    r = await search('walrus migration', 'general');
    check('general is global only', !files(r).some(f => f.startsWith('projects/')), r.body);
    r = await search('zeppelin', 'alpha');
    check('the attic and the dailies never appear', files(r).length === 0, r.body);
    r = await search('walrus deliverables report', 'alpha');
    check('a deliverable is not a passage', !files(r).some(f => f.includes('/deliverables/')), r.body);

    console.log('4. the journal');
    const task = (await api('POST', '/api/tasks', { title: 'walrus work', project: 'alpha', gate: 'critic' })).body.task.id;
    await api('POST', '/api/agents/register', { name: 'scribe', kind: 'dummy' });
    await api('POST', '/api/tasks/claim', { agent: 'scribe', id: task });
    await api('POST', '/api/journal', { agent: 'scribe', kind: 'gotcha', text: 'The quokka importer drops the last row', evidence: 'seen in a test' });
    r = await search('quokka importer', 'alpha');
    check('a record is served to its mission\'s project', files(r).some(f => f.startsWith('journal/')), r.body);
    r = await search('quokka importer', 'beta');
    check('and to nobody else', !files(r).some(f => f.startsWith('journal/')), r.body);
    await api('PATCH', `/api/tasks/${task}`, { agent: 'scribe', status: 'done' });
    await api('POST', '/api/journal', { agent: 'scribe', kind: 'fact', text: 'The ocelot cable is unlabelled', evidence: 'looked at it', tags: ['beta'] });
    r = await search('ocelot cable', 'beta');
    check('a record tagged with a project id goes to that project', files(r).some(f => f.startsWith('journal/')), r.body);
    await api('POST', '/api/journal', { agent: 'scribe', kind: 'fact', text: 'The axolotl invoice was paid', evidence: 'receipt' });
    r = await search('axolotl invoice', 'alpha');
    check('a record with neither is served to nobody', files(r).length === 0, r.body);
    const day = new Date().toISOString().slice(0, 10);
    await put(`journal/${day}.md`, '- 11:40 [chat] the capybara password is written on a sticky note', 'append');
    r = await search('capybara password', 'alpha');
    check('a free-text line is served to nobody', files(r).length === 0, r.body);

    console.log('5. the index follows writes');
    await put('knowledge/brand-new.md', NOTE('Brand new', '- [fact] The marmoset protocol has three steps (source: t-2)'));
    r = await search('marmoset protocol');
    check('a new file is searchable at once', files(r)[0] === 'knowledge/brand-new.md', r.body);
    await put('knowledge/brand-new.md', NOTE('Brand new', '- [fact] The tapir protocol has four steps (source: t-2)'));
    r = await search('marmoset');
    check('an edit removes the old words', !files(r).includes('knowledge/brand-new.md'), r.body);
    r = await search('tapir protocol');
    check('and adds the new ones', files(r)[0] === 'knowledge/brand-new.md', r.body);

    console.log('5a. lint on write reaches project files');
    const longSummary = `---\ntitle: Too long\nsummary: "${'x'.repeat(250)}"\n---\n\n## Now\n\nStatus.\n`;
    r = await api('POST', '/api/knowledge', { file: 'projects/alpha/STATE.md', content: longSummary, author: 'scribe' });
    check('an over-long summary in a project STATE is refused', r.code === 422, r);
    r = await search('walrus migration', 'alpha');
    check('and the file is untouched', files(r).includes('projects/alpha/STATE.md'), r.body);
    r = await api('POST', '/api/knowledge', { file: 'projects/alpha/STATE.md', content: '\n## 2026-02-02 a note\n\nNo frontmatter of its own, and that is fine.\n', author: 'scribe', mode: 'append' });
    check('a normal debrief still lands', r.code === 200, r);

    console.log('5b. French questions, English notes');
    await put('knowledge/lockbox.md', NOTE('Lockbox', '- [fact] Rotate the password on the kumquat server every month (source: t-3)'));
    r = await search('quand changer le mot de passe du kumquat ?');
    check('a phrase finds its English equivalent', files(r)[0] === 'knowledge/lockbox.md', r.body);
    r = await search('le serveur du kumquat');
    check('a word does too', files(r)[0] === 'knowledge/lockbox.md' && r.body.results[0].matched.some(t => t.startsWith('serv')), r.body);
    check('a translated word counts once toward coverage', r.body.results[0].coverage === 1, r.body.results[0]);

    console.log('5c. the French shadow');
    await put('knowledge/gibbon.md', NOTE('Gibbon', `- [fact] ${shadowed} (source: t-4)`));
    r = await search('cloture du registre comptable');
    check('a word only in the shadow finds the passage', files(r)[0] === 'knowledge/gibbon.md', r.body);
    check('and the shadow is never served', r.body.results[0].text === shadowed, r.body.results[0]);
    await put('knowledge/gibbon.md', NOTE('Gibbon', '- [fact] The gibbon ledger closes on Mondays (source: t-4)'));
    r = await search('cloture du registre comptable');
    check('an edited passage loses its terms', !files(r).includes('knowledge/gibbon.md'), r.body);

    console.log('6. section reads');
    r = await api('GET', '/api/knowledge?file=projects/alpha/STATE.md&section=Now');
    check('returns that section', r.code === 200 && /half done/.test(r.body.content) && !/penguin/.test(r.body.content), r.body);
    check('with the frontmatter', /Alpha state/.test(r.body.frontmatter), r.body);
    r = await api('GET', '/api/knowledge?file=projects/alpha/STATE.md&section=debrief');
    check('part of a heading is enough', r.code === 200 && /penguin/.test(r.body.content), r.body);
    r = await api('GET', '/api/knowledge?file=projects/alpha/STATE.md&section=nothing-like-this');
    check('a missing section is 404 and lists what exists', r.code === 404 && r.body.sections.includes('Now'), r.body);
    r = await api('GET', '/api/knowledge?file=projects/alpha/STATE.md');
    check('without section, the whole file as before', /penguin/.test(r.body.content) && /half done/.test(r.body.content), r.body);
  } finally {
    hub.kill('SIGTERM');
    await sleep(300);
    fs.rmSync(dir, { recursive: true, force: true });
  }
  console.log(`\npassed ${PASS}, failed ${FAIL}`);
  process.exit(FAIL ? 1 : 0);
}
main().catch(e => { console.error(e); process.exit(1); });

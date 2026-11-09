// test/context.test.js: the context call (doc 27). Its walls, its budget, its
// silence when nothing is relevant, the claim briefing, the Claude Code hook,
// the log and the capture rule. Self-contained, zero deps, all data fake.
// Usage: node test/context.test.js
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn, spawnSync } = require('child_process');

const HUB_PORT = +process.env.HUB_PORT || 8194;
const TOKEN = 'contexttest';
const BASE = `http://127.0.0.1:${HUB_PORT}`;
let PASS = 0, FAIL = 0;
function check(label, ok, got) {
  if (ok) { PASS++; console.log(`  ok: ${label}`); }
  else { FAIL++; console.log(`  FAIL: ${label}${got !== undefined ? ` (got: ${JSON.stringify(got).slice(0, 400)})` : ''}`); }
}
const sleep = ms => new Promise(r => setTimeout(r, ms));
const note = (title, lines) => `---\ntitle: ${title}\nsummary: About ${title}.\ncompartment: knowledge\nscope: global\nversion: 1\n---\n\n${lines.join('\n')}\n`;

async function main() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bureau-context-'));
  const env = { ...process.env, PORT: String(HUB_PORT), HOST: '127.0.0.1', BUREAU_TOKEN: TOKEN, BUREAU_DATA_DIR: path.join(dir, 'data'), BUREAU_BRAIN_DIR: path.join(dir, 'brain'),
    BUREAU_WORK_DIR: path.join(dir, 'work'), BUREAU_POKES: '', DISCORD_WEBHOOK_URL: '', BUREAU_ENV_FILE: path.join(dir, 'no.env') };
  const hub = spawn(process.execPath, [path.join(__dirname, '..', 'hub', 'server.js')], { env, stdio: 'ignore' });
  const api = async (method, p, body) => {
    const r = await fetch(BASE + p, { method, headers: { authorization: `Bearer ${TOKEN}`, 'content-type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });
    return { code: r.status, body: await r.json() };
  };
  const put = (file, content) => api('POST', '/api/knowledge', { file, content, author: 'human', force: true });
  const ctx = body => api('POST', '/api/context', body);
  const files = r => [...r.body.context.map(c => c.ref.file), ...r.body.map.map(m => m.file)];

  try {
    for (let i = 0; i < 40; i++) { try { await fetch(`${BASE}/health`); break; } catch { await sleep(250); } }
    for (const id of ['alpha', 'beta']) await api('POST', '/api/projects', { id, label: id });
    await put('recipes/toaster-firmware.md', note('Toaster firmware', ['- [step] Flash the toaster firmware with the walrus cable every spring (source: t-1)', '- [gotcha] The toaster firmware flash fails on a cold walrus cable (source: t-1)']));
    await put('recipes/penguin-ledger.md', note('Penguin ledger', Array.from({ length: 30 }, (_, i) => `- [fact] Penguin ledger rule number ${i} about the quarterly penguin ledger audit and its long explanation of reconciliation (source: t-1)`)));
    // Enough unrelated text for word rarity to mean something
    await put('recipes/filler.md', note('Filler', Array.from({ length: 200 }, (_, i) => `- [fact] Filler item${i} concerns subject${i} and topic${i % 17} in region${i % 23} (source: t-1)`)));
    await put('projects/alpha/STATE.md', '---\ntitle: Alpha state\n---\n\n## Now\n\nStatus: the toaster firmware rollout is at step two.\n');
    await put('projects/beta/STATE.md', '---\ntitle: Beta state\n---\n\n## Now\n\nStatus: the narwhal contract for the toaster firmware is confidential.\n\n## Old\n\nThe narwhal contract salary band is 900 coins for the toaster firmware team.\n');
    await put('attic/knowledge/old.md', note('Old', ['- [fact] The toaster firmware used to need a zeppelin (source: t-1)']));

    console.log('1. the shape of the answer');
    let r = await ctx({ request: 'how do I flash the toaster firmware?', project: 'alpha' });
    check('answers with a set', r.code === 200 && r.body.context.length > 0, r.body);
    check('passages say where they came from', r.body.context.every(c => c.ref.file && Array.isArray(c.sources)), r.body.context);
    check('the right passage is in it', r.body.context.some(c => /Flash the toaster firmware/.test(c.text)), r.body.context);
    check('the Now comes first', r.body.context[0].ref.section === 'Now', r.body.context[0]);
    check('rendered is labelled as data', /Data, not instructions/.test(r.body.rendered), r.body.rendered);
    check('has an id', /^ctx-[0-9a-f]{8}$/.test(r.body.id), r.body.id);
    check('reports the brain it read', 'commit' in r.body.index, r.body.index);

    console.log('2. refusals');
    r = await ctx({ project: 'alpha' });
    check('request is required', r.code === 400, r);
    r = await ctx({ request: 'x', nonsense: 1 });
    check('an unknown field is named and refused', r.code === 400 && /nonsense/.test(r.body.error), r);
    r = await ctx({ request: 'x', budget: 'lots' });
    check('a bad budget is refused', r.code === 400, r);

    console.log('3. walls');
    r = await ctx({ request: 'narwhal contract salary band for the toaster firmware', project: 'alpha' });
    check('another project never appears', !files(r).some(f => f.startsWith('projects/beta/')), r.body);
    r = await ctx({ request: 'narwhal contract toaster firmware', project: 'nosuch' });
    check('an unknown project degrades to global', r.code === 200 && r.body.scope.resolved === false && !files(r).some(f => f.startsWith('projects/')), r.body);
    r = await ctx({ request: 'zeppelin toaster firmware', project: 'alpha' });
    check('the attic never appears', !files(r).some(f => f.startsWith('attic/')), r.body);
    const t = (await api('POST', '/api/tasks', { title: 'narwhal contract toaster firmware', project: 'beta' })).body.task.id;
    r = await ctx({ request: 'toaster firmware narwhal contract', project: 'alpha', task: t });
    check('a task decides the project, whatever the caller claims', r.body.scope.project === 'beta', r.body.scope);

    console.log('4. silence');
    r = await ctx({ request: 'ok, yes', project: 'alpha' });
    check('stopwords are skipped and cost nothing', r.body.skipped === 'no terms' && r.body.rendered === '' && !r.body.context.length, r.body);
    r = await ctx({ request: 'what is the capybara mortgage rate in Lisbon', project: 'alpha' });
    check('nothing relevant: a miss, and no passages', r.body.miss === true && !r.body.context.length && !r.body.map.length, r.body);
    check('asked directly, it says it has nothing', r.body.state === 'none' && /has nothing on this/.test(r.body.rendered), r.body);
    check('and names what it could not cover', r.body.uncovered.length > 0, r.body.uncovered);
    r = await ctx({ request: 'what is the capybara mortgage rate in Lisbon', project: 'alpha', surface: 'claude-code' });
    check('a hook call stays silent on nothing', r.body.state === 'none' && r.body.rendered === '', r.body);
    r = await ctx({ request: 'what is the capybara mortgage rate in Lisbon', project: 'alpha', surface: 'claim' });
    check('so does a mission briefing', r.body.rendered === '', r.body);
    r = await ctx({ request: 'how do I flash the toaster firmware?', project: 'alpha' });
    check('a covered question is answered', r.body.state === 'answered' && !/has nothing/.test(r.body.rendered), r.body);
    // Only a map-only file matches and the project has no Now: something near it, nothing to serve.
    await api('POST', '/api/projects', { id: 'gamma', label: 'gamma' });
    await put('projects/gamma/references/orbit.md', '---\ntitle: Orbit\n---\n\nThe orbital plumbing schedule for the station lists every valve inspection.\n');
    r = await ctx({ request: 'orbital plumbing schedule valve inspection', project: 'gamma' });
    check('nearby material is called adjacent', r.body.state === 'adjacent' && r.body.map.length > 0 && !r.body.context.length, r.body);
    check('and says so inside the framed block', /Nearby material only\. Not covered: /.test(r.body.rendered) && /Nearby material only[^]*<\/bureau-context boundary="[0-9a-f]+">$/.test(r.body.rendered), r.body.rendered);

    console.log('5. the budget');
    r = await ctx({ request: 'penguin ledger audit reconciliation rule', project: 'alpha', budget: 200 });
    check('never over budget', r.body.tokens.context <= 200, r.body.tokens);
    check('what did not fit goes to the map', r.body.map.length > 0 || r.body.context.length > 0, r.body);
    r = await ctx({ request: 'penguin ledger audit reconciliation rule', project: 'alpha', budget: 6000, max_chars: 600 });
    check('max_chars caps what is rendered', r.body.rendered.length <= 600, r.body.rendered.length);
    r = await ctx({ request: 'penguin ledger audit', project: 'alpha', budget: 999999 });
    check('the budget has a ceiling', r.body.tokens.budget === 6000, r.body.tokens);

    console.log('6. no repeats');
    const s = { project: 'alpha', session: 'session-1' };
    const a = await ctx({ request: 'flash the toaster firmware', ...s });
    const b = await ctx({ request: 'flash the toaster firmware', ...s });
    check('a passage is not sent twice in a session', a.body.context.length > 0 && b.body.context.length === 0, b.body.context);
    check('all held back as repeats is not a miss', b.body.miss === false && b.body.held_back > 0 && b.body.state !== 'none', b.body);
    check('and renders nothing', b.body.rendered === '', b.body.rendered);
    const c = await ctx({ request: 'flash the toaster firmware', ...s, reset: true });
    check('reset forgets', c.body.context.length === a.body.context.length, c.body.context);
    const d = await ctx({ request: 'flash the toaster firmware', project: 'alpha', session: 'session-2' });
    check('another session gets them', d.body.context.length === a.body.context.length, d.body.context);
    await put('recipes/toaster-firmware.md', note('Toaster firmware', ['- [step] Flash the toaster firmware with the OCELOT cable every spring (source: t-1)', '- [gotcha] The toaster firmware flash fails on a cold walrus cable (source: t-1)']));
    const e = await ctx({ request: 'flash the toaster firmware', ...s });
    check('a changed passage is sent again', e.body.context.some(x => /OCELOT/.test(x.text)), e.body.context);

    console.log('7. a claimed mission arrives briefed');
    const m = (await api('POST', '/api/tasks', { title: 'Flash the toaster firmware', body: 'walrus cable', project: 'alpha' })).body.task.id;
    r = await api('POST', '/api/tasks/claim', { agent: 'worker', id: m });
    check('the claim carries the context', r.body.context && /toaster firmware/i.test(r.body.context.rendered), r.body.context);

    console.log('8. the map');
    r = await api('GET', '/api/knowledge/map?project=alpha');
    const paths = r.body.files.map(f => f.file);
    check('its own project and the global notes', paths.includes('projects/alpha/STATE.md') && paths.includes('recipes/penguin-ledger.md'), paths);
    check('no other project', !paths.some(p => p.startsWith('projects/beta/')), paths);
    check('no attic', !paths.some(p => p.startsWith('attic/')), paths);
    check('a line says what the file is', r.body.files.find(f => f.file === 'recipes/penguin-ledger.md').summary === 'About Penguin ledger.', r.body.files[0]);

    console.log('9. the log');
    const logged = fs.readFileSync(path.join(dir, 'data', 'context-log.jsonl'), 'utf8');
    check('calls are logged', logged.split('\n').filter(Boolean).length > 5);
    check('the request text is not stored', !/capybara/.test(logged));
    await api('GET', '/api/knowledge?file=recipes/penguin-ledger.md&ctx=ctx-00000000');
    r = await api('GET', '/api/memory/health');
    check('the health block counts calls', r.body.reads.tracked === true && r.body.reads.calls_7d > 5, r.body.reads);
    check('and misses', r.body.reads.misses_7d >= 1, r.body.reads);
    check('and map reads', r.body.reads.map_reads_7d === 1, r.body.reads);

    console.log('10. the hook');
    const hook = path.join(__dirname, '..', 'connectors', 'claude-code', 'context-hook.js');
    const tokenFile = path.join(dir, 'token');
    fs.writeFileSync(tokenFile, TOKEN);
    const repo = path.join(dir, 'repo');
    fs.mkdirSync(path.join(repo, '.git'), { recursive: true });
    fs.writeFileSync(path.join(repo, '.bureau'), 'alpha\n');
    const hookEnv = { ...process.env, BUREAU_URL: BASE, BUREAU_TOKEN_FILE: tokenFile, BUREAU_TOKEN: '', BUREAU_HOOK_LOG: path.join(dir, 'hook.log') };
    const run = (input, extra = {}) => spawnSync(process.execPath, [hook], { input, env: { ...hookEnv, ...extra }, encoding: 'utf8' });
    const prompt = (p, sid) => JSON.stringify({ prompt: p, session_id: sid, cwd: repo, hook_event_name: 'UserPromptSubmit' });
    let h = run(prompt('flash the toaster firmware', 'hook-1'));
    check('exits 0', h.status === 0, h);
    const added = JSON.parse(h.stdout).hookSpecificOutput;
    check('hands back the context', added.hookEventName === 'UserPromptSubmit' && /toaster firmware/i.test(added.additionalContext), h.stdout);
    check('found the project from the marker', /project="alpha"/.test(added.additionalContext), added.additionalContext);
    check('stays under the hook output cap', added.additionalContext.length < 10000);
    h = run(prompt('ok', 'hook-1'));
    check('nothing to add: no output', h.status === 0 && h.stdout === '', h.stdout);
    h = run(prompt('what is the capybara mortgage rate in Lisbon', 'hook-1'));
    check('nothing in the brain: no output, no empty block', h.status === 0 && h.stdout === '', h.stdout);
    const start = (source, sid) => JSON.stringify({ session_id: sid, cwd: repo, hook_event_name: 'SessionStart', source });
    const flash = /Flash the toaster firmware/;
    check('the same prompt again: the passage is held back', !flash.test(run(prompt('flash the toaster firmware', 'hook-1')).stdout));
    for (const source of ['startup', 'resume', 'clear']) {
      h = run(start(source, 'hook-1'));
      check(`SessionStart ${source}: exit 0, no output`, h.status === 0 && h.stdout === '', h);
    }
    check('and no reset: the model still holds the passage', !flash.test(run(prompt('flash the toaster firmware', 'hook-1')).stdout));
    const logPath = path.join(dir, 'data', 'context-log.jsonl');
    const logRows = () => fs.readFileSync(logPath, 'utf8').split('\n').filter(Boolean).map(l => JSON.parse(l));
    const callsBefore = logRows().filter(e => e.type === 'call').length;
    h = run(start('compact', 'hook-1'));
    check('SessionStart compact: exit 0, no output', h.status === 0 && h.stdout === '', h);
    check('a reset is not counted as a call', logRows().filter(e => e.type === 'call').length === callsBefore && logRows().some(e => e.type === 'reset'), logRows().slice(-2));
    h = run(prompt('flash the toaster firmware', 'hook-1'));
    check('after a compaction the passage is served again', flash.test(h.stdout), h.stdout);
    h = run(prompt('flash the toaster firmware', 'hook-2'), { BUREAU_URL: 'http://127.0.0.1:1' });
    check('no hub: exit 0, no output', h.status === 0 && h.stdout === '', h);
    check('and one line in its log', /failed/.test(fs.readFileSync(path.join(dir, 'hook.log'), 'utf8')));
    h = run('this is not json');
    check('bad input: exit 0, no output', h.status === 0 && h.stdout === '', h);

    console.log('10b. keeping the text of requests');
    const promptFile = path.join(dir, 'data', 'context-prompts.jsonl');
    check('off by default: no file', !fs.existsSync(promptFile));
    r = await api('PATCH', '/api/settings', { global: { store_prompts_days: 'forever' } });
    check('a bad value is refused', r.code !== 200, r);
    await api('PATCH', '/api/settings', { global: { store_prompts_days: 30 } });
    await ctx({ request: 'the private wombat question', project: 'alpha' });
    check('on: the text is kept, in its own file', /private wombat question/.test(fs.readFileSync(promptFile, 'utf8')));
    check('and still not in the usage log', !/private wombat/.test(fs.readFileSync(path.join(dir, 'data', 'context-log.jsonl'), 'utf8')));
    await api('PATCH', '/api/settings', { global: { store_prompts_days: 0 } });

    console.log('11. capture before closing');
    await api('POST', '/api/agents/register', { name: 'closer', kind: 'dummy' });
    const claimOne = async () => { const id = (await api('POST', '/api/tasks', { title: 'a job', project: 'alpha', gate: 'critic' })).body.task.id; await api('POST', '/api/tasks/claim', { agent: 'closer', id }); return id; };
    let id = await claimOne();
    r = await api('PATCH', `/api/tasks/${id}`, { agent: 'closer', status: 'done' });
    check('off by default', r.code === 200 && r.body.task.status === 'done', r);
    await api('PATCH', '/api/settings', { global: { require_capture: true } });
    id = await claimOne();
    r = await api('PATCH', `/api/tasks/${id}`, { agent: 'closer', status: 'done' });
    check('on: closing with nothing captured is refused', r.code !== 200 && /journal record/.test(r.body.error || ''), r);
    check('and the mission is unchanged', (await api('GET', `/api/tasks/${id}`)).body.task.status === 'claimed');
    await api('POST', '/api/journal', { agent: 'closer', kind: 'fact', text: 'The job taught one thing', evidence: 'did it' });
    r = await api('PATCH', `/api/tasks/${id}`, { agent: 'closer', status: 'done' });
    check('a capture under the mission lets it close', r.code === 200, r);
    id = await claimOne();
    r = await api('PATCH', `/api/tasks/${id}`, { agent: 'closer', status: 'done', nothing_learned: true });
    check('so does saying it learned nothing', r.code === 200, r);
    check('which is logged', r.body.task.log.some(l => /nothing learned/.test(l.note)), r.body.task.log);
    id = await claimOne();
    r = await api('PATCH', `/api/tasks/${id}`, { agent: 'human', status: 'done' });
    check('the boss closes anything', r.code === 200, r);

    console.log('12. MCP sessions that worked without the context call');
    const mcpPath = new URL((await api('GET', '/api/mcp')).body.url).pathname;
    const mcp = async (name, args = {}) => (await (await fetch(BASE + mcpPath, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: args } }) })).json()).result;
    let bump = 0;
    const mcpBlock = async () => { await put('recipes/bump.md', note('Bump', [`- [fact] Cache bump number ${++bump} (source: t-1)`])); return (await api('GET', '/api/memory/health')).body.reads.mcp; };
    const logFile = path.join(dir, 'data', 'context-log.jsonl');
    const ago = hours => new Date(Date.now() - hours * 3600_000).toISOString();
    const addLine = o => fs.appendFileSync(logFile, `${JSON.stringify(o)}\n`);
    let u = await mcpBlock();
    check('no MCP work yet: nothing counted', u.work_sessions_7d === 0 && u.skipped_7d === 0, u);
    check('the block says what a session is', /60 minutes/.test(u.session_rule), u);
    await mcp('whoami');
    await mcp('read_knowledge', { dir: 'recipes' });
    u = await mcpBlock();
    check('read-only tools are not work', u.work_sessions_7d === 0, u);
    r = await mcp('capture', { kind: 'fact', text: 'The secret badger lives at number nine', evidence: 'saw it' });
    check('the work call succeeded', r.isError === false, r);
    u = await mcpBlock();
    check('work with no get_context is a skip', u.work_sessions_7d === 1 && u.skipped_7d === 1 && u.skipped_unbriefed_7d === 1, u);
    check('it names the agent and the tools', u.skipped[0].agent === 'consul' && u.skipped[0].tools.join() === 'capture' && u.skipped[0].work_calls === 1, u.skipped);
    const mcpLine = fs.readFileSync(logFile, 'utf8').split('\n').filter(Boolean).map(l => JSON.parse(l)).find(e => e.type === 'mcp');
    check('the log holds the tool name and nothing it was given', Object.keys(mcpLine).sort().join() === 'agent,tool,ts,type', mcpLine);
    check('so the text is not in it', !/secret badger/.test(fs.readFileSync(logFile, 'utf8')));
    await mcp('capture', { kind: 'nonsense', text: 'x', evidence: 'y' });
    u = await mcpBlock();
    check('a refused call is not counted', u.skipped[0].work_calls === 1, u.skipped);
    await mcp('get_context', { request: 'flash the toaster firmware', project: 'alpha' });
    u = await mcpBlock();
    check('a get_context in the same window clears it', u.work_sessions_7d === 1 && u.skipped_7d === 0, u);
    addLine({ ts: ago(3), type: 'mcp', agent: 'consul', tool: 'write_knowledge' });
    addLine({ ts: ago(5), type: 'mcp', agent: 'consul', tool: 'start_mission' });
    addLine({ ts: ago(5), type: 'mcp', agent: 'consul', tool: 'update_mission' });
    addLine({ ts: ago(8 * 24), type: 'mcp', agent: 'consul', tool: 'capture' });
    u = await mcpBlock();
    check('a gap over the window starts another session', u.work_sessions_7d === 3 && u.skipped_7d === 2, u);
    check('a session that claimed a mission was briefed', u.skipped_unbriefed_7d === 1 && u.skipped.find(x => x.briefed).tools.join() === 'start_mission,update_mission', u.skipped);
    check('oldest first, past the week left out', u.skipped[0].tools.join() === 'start_mission,update_mission' && u.skipped.length === 2, u.skipped);
    addLine({ ts: ago(1), type: 'call', surface: 'claude-code', agent: 'consul', served: [] });
    addLine({ ts: ago(1), type: 'mcp', agent: 'scout', tool: 'write_work' });
    u = await mcpBlock();
    check('agents are told apart, and a hook call is not get_context', u.work_sessions_7d === 4 && u.skipped.some(x => x.agent === 'scout'), u);
  } finally {
    hub.kill('SIGTERM');
    await sleep(300);
    fs.rmSync(dir, { recursive: true, force: true });
  }

  console.log('13. a young brain answers short questions');
  const smallDir = fs.mkdtempSync(path.join(os.tmpdir(), 'bureau-context-small-'));
  const smallPort = HUB_PORT + 1, SMALL = `http://127.0.0.1:${smallPort}`;
  const small = spawn(process.execPath, [path.join(__dirname, '..', 'hub', 'server.js')], { env: { ...env, PORT: String(smallPort), BUREAU_DATA_DIR: path.join(smallDir, 'data'), BUREAU_BRAIN_DIR: path.join(smallDir, 'brain'), BUREAU_WORK_DIR: path.join(smallDir, 'work') }, stdio: 'ignore' });
  try {
    for (let i = 0; i < 40; i++) { try { await fetch(`${SMALL}/health`); break; } catch { await sleep(250); } }
    const post = async (p, body) => (await fetch(SMALL + p, { method: 'POST', headers: { authorization: `Bearer ${TOKEN}`, 'content-type': 'application/json' }, body: JSON.stringify(body) })).json();
    await post('/api/knowledge', { file: 'knowledge/refunds.md', author: 'human', force: true, content: note('Refund policy', ['- [fact] Refunds over 500 euros must be approved by the finance lead before the money leaves the account (source: t-1)', '- [gotcha] Partial refund requests also go through the finance lead queue (source: t-1)']) });
    await post('/api/knowledge', { file: 'knowledge/shipping.md', author: 'human', force: true, content: note('Shipping', ['- [fact] Parcels leave the warehouse on Tuesdays and Fridays (source: t-1)', '- [fact] Returned parcels get a refund label from support (source: t-1)']) });
    await post('/api/knowledge', { file: 'knowledge/onboarding.md', author: 'human', force: true, content: note('Onboarding', ['- [fact] New hires get their laptop on the first Monday (source: t-1)', '- [fact] Payroll closes on the 25th of each month (source: t-1)']) });
    for (const q of ['who has to approve a large refund?', 'Who approves refunds?', 'refund']) {
      const x = await post('/api/context', { request: q });
      check(`found: "${q}"`, x.miss === false && x.context.some(c => /finance lead/.test(c.text)), x);
    }
    let x = await post('/api/context', { request: 'capybara mortgage rate' });
    check('still silent on what is not there', x.miss === true && x.state === 'none', x);
    x = await post('/api/context', { request: 'refund capybara mortgage rate in Lisbon' });
    check('one shared word in a long question is not enough', x.miss === true && !x.context.length, x);
  } finally {
    small.kill('SIGTERM');
    await sleep(300);
    fs.rmSync(smallDir, { recursive: true, force: true });
  }
  console.log(`\npassed ${PASS}, failed ${FAIL}`);
  process.exit(FAIL ? 1 : 0);
}
main().catch(e => { console.error(e); process.exit(1); });

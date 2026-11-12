// test/export.test.js: a whole hub out and back in (doc 30, B5), with what
// must never travel left out. Real hubs, nothing else needed.
// Usage: node test/export.test.js
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn, spawnSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const PORT_A = 8221, PORT_B = 8222;
const BOSS = 'boss-secret-token-for-export-test';
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bureau-export-'));
let PASS = 0, FAIL = 0;
function check(label, ok, got) {
  if (ok) { PASS++; console.log(`  ok: ${label}`); }
  else { FAIL++; console.log(`  FAIL: ${label}${got !== undefined ? ` (got: ${JSON.stringify(got).slice(0, 240)})` : ''}`); }
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const envFor = (name, port) => ({ PATH: process.env.PATH, SystemRoot: process.env.SystemRoot, USERPROFILE: process.env.USERPROFILE, TEMP: process.env.TEMP, TMP: process.env.TMP,
  HOME: path.join(dir, name), PORT: String(port), HOST: '127.0.0.1', BUREAU_ENV_FILE: path.join(dir, 'none.env'), BUREAU_BOSS_TOKEN: BOSS,
  BUREAU_DATA_DIR: path.join(dir, name, 'data'), BUREAU_BRAIN_DIR: path.join(dir, name, 'brain'), BUREAU_WORK_DIR: path.join(dir, name, 'work'),
  BUREAU_POKES: '', GIT_CONFIG_GLOBAL: path.join(dir, 'gitconfig') });
async function boot(name, port) {
  const child = spawn(process.execPath, [path.join(ROOT, 'hub', 'server.js')], { env: envFor(name, port), stdio: 'ignore' });
  for (let i = 0; i < 80; i++) { try { if ((await fetch(`http://127.0.0.1:${port}/health`)).ok) return child; } catch { /* starting */ } await sleep(100); }
  throw new Error(`${name} never answered`);
}
const stop = async (child) => { child.kill('SIGTERM'); await new Promise((r) => child.on('exit', r)); };
const api = (port, method, p, body) => fetch(`http://127.0.0.1:${port}${p}`, { method, headers: { authorization: `Bearer ${BOSS}`, 'content-type': 'application/json' }, body: body && JSON.stringify(body) }).then((r) => r.json());
const tool = (name, args, as) => spawnSync(process.execPath, [path.join(ROOT, 'hub', 'tools', name), ...args], { env: envFor(as, 0), encoding: 'utf8' });

async function main() {
  fs.mkdirSync(path.join(dir, 'a', 'data'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'a', 'data', 'state.json'), JSON.stringify({ schema_version: 2, tasks: [], agents: [], messages: [], log: [], seq: 0, projects: [{ id: 'general', label: 'General' }], mcp_token: 'f'.repeat(48) }));
  const a = await boot('a', PORT_A);
  await api(PORT_A, 'POST', '/api/projects', { label: 'Garden' });
  const t = (await api(PORT_A, 'POST', '/api/tasks', { title: 'Water the plants', project: 'garden' })).task;
  await api(PORT_A, 'POST', '/api/knowledge', { file: 'projects/garden/STATE.md', content: '# Garden\n\nThe ferns like shade (fake).\n', author: 'human' });
  await api(PORT_A, 'POST', '/api/tokens', { agent: 'gardener', projects: ['garden'] });
  // Windows has no SIGTERM: the kill skips the last save, so wait for the
  // token to reach the disk before stopping the hub.
  const stateFile = path.join(dir, 'a', 'data', 'state.json');
  for (let i = 0; i < 50 && !/"agent_tokens"\s*:\s*\[\s*\{/.test(fs.readFileSync(stateFile, 'utf8')); i++) await sleep(100);
  await stop(a);

  console.log('1. export');
  const out = path.join(dir, 'export');
  const ex = tool('export.js', [out], 'a');
  check('export runs', ex.status === 0, ex.stderr);
  const manifest = JSON.parse(fs.readFileSync(path.join(out, 'manifest.json'), 'utf8'));
  check('the manifest counts the missions', manifest.counts.missions === 1, manifest);
  check('it says what was left out', manifest.left_out.some((x) => /MCP URL/.test(x)) && manifest.left_out.some((x) => /token/.test(x)), manifest.left_out);
  const exported = fs.readFileSync(path.join(out, 'state.json'), 'utf8');
  check('the old MCP key is not in the export', !exported.includes('f'.repeat(48)));
  check('minted tokens are not in the export', !/agent_tokens/.test(exported));
  check('the brain travels as a git bundle', fs.existsSync(path.join(out, 'brain.bundle')));
  check('a second export into the same folder is refused', tool('export.js', [out], 'a').status !== 0);

  console.log('2. import into a fresh hub');
  const im = tool('import.js', [out], 'b');
  check('import runs', im.status === 0, im.stderr);
  const b = await boot('b', PORT_B);
  const tb = await api(PORT_B, 'GET', `/api/tasks/${t.id}`);
  check('the mission is there', tb.task && tb.task.title === 'Water the plants', tb);
  const note = await api(PORT_B, 'GET', '/api/knowledge?file=projects/garden/STATE.md');
  check('the brain note is there', /ferns like shade/.test(note.content || ''), note);
  const log = spawnSync('git', ['-C', path.join(dir, 'b', 'brain'), 'log', '--oneline'], { encoding: 'utf8' }).stdout;
  const srcLog = spawnSync('git', ['-C', path.join(dir, 'a', 'brain'), 'log', '--oneline'], { encoding: 'utf8' }).stdout;
  check('with the same git history as the source', log.trim().length > 0 && log === srcLog, { log, srcLog });
  check('no bundle remote is left behind', spawnSync('git', ['-C', path.join(dir, 'b', 'brain'), 'remote'], { encoding: 'utf8' }).stdout.trim() === '');
  check('no minted token came along', (await api(PORT_B, 'GET', '/api/tokens')).tokens.length === 0);
  check('import refuses a running hub', tool('import.js', [out], 'b').status !== 0);
  await stop(b);
  const again = tool('import.js', [out], 'b');
  check('import refuses a hub that already has state', again.status !== 0 && /already holds/.test(again.stderr), again.stderr);
}

main().catch((e) => { FAIL++; console.error(e); }).finally(() => {
  try { fs.rmSync(dir, { recursive: true, force: true }); } catch { /* best effort */ }
  console.log(`\npassed ${PASS}, failed ${FAIL}`);
  process.exit(FAIL ? 1 : 0);
});

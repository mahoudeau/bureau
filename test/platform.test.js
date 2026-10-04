// test/platform.test.js: the hub behaves the same on Windows, macOS and Linux.
// Plain `node server.js` reads the .env beside it (CRLF, BOM, quotes, the host's
// environment first); paths come out with '/'; CRLF and BOM files lint like
// LF ones; names Windows cannot hold are refused on every OS; the brain keeps
// approved bytes exactly; a stale lock with a recycled pid is taken over; a
// fresh hub stopped at once still starts again.
// Runs on every OS in CI. Self-contained, zero deps, free ports, temp dirs.
// Usage: node test/platform.test.js
'use strict';
const fs = require('fs');
const os = require('os');
const net = require('net');
const path = require('path');
const { spawn, execFileSync } = require('child_process');

const HUB = path.join(__dirname, '..', 'hub');
const env = require(path.join(HUB, 'lib', 'env.js'));
const knowledge = require(path.join(HUB, 'lib', 'knowledge.js'));
const brainLint = require(path.join(HUB, 'tools', 'brain-lint.js'));

let PASS = 0, FAIL = 0;
function check(label, ok, got) {
  if (ok) { PASS++; console.log(`  ok: ${label}`); }
  else { FAIL++; console.log(`  FAIL: ${label}${got !== undefined ? ` (got: ${JSON.stringify(got).slice(0, 300)})` : ''}`); }
}
const sleep = ms => new Promise(r => setTimeout(r, ms));
const freePort = () => new Promise((resolve, reject) => {
  const s = net.createServer().once('error', reject);
  s.listen(0, '127.0.0.1', () => { const { port } = s.address(); s.close(() => resolve(port)); });
});
// The runner's own environment, minus anything the hub reads: each case sets its own.
const CLEAN = Object.fromEntries(Object.entries(process.env).filter(([k]) =>
  !/^(BUREAU_|PORT$|HOST$|IP$|DISCORD_)/i.test(k)));

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'bureau-platform-'));
const hubs = [];
// envFile: a .env to load (default: a missing one, so nothing); null: the
// hub's own default, the .env beside server.js.
function startHub({ server = path.join(HUB, 'server.js'), envFile = path.join(TMP, 'none.env'), vars = {} }) {
  const h = { log: '', proc: null };
  const hubEnv = { ...CLEAN, ...vars };
  if (envFile) hubEnv.BUREAU_ENV_FILE = envFile;
  h.proc = spawn(process.execPath, [server], { cwd: TMP, env: hubEnv, stdio: ['ignore', 'pipe', 'pipe'] });
  h.proc.stdout.on('data', d => { h.log += d; });
  h.proc.stderr.on('data', d => { h.log += d; });
  h.exited = new Promise(r => h.proc.once('exit', code => r(code)));
  hubs.push(h);
  return h;
}
async function up(port) {
  for (let i = 0; i < 60; i++) { try { await fetch(`http://127.0.0.1:${port}/health`); return true; } catch { await sleep(250); } }
  return false;
}
async function stop(h) {
  if (h.proc.exitCode !== null || h.proc.signalCode !== null) return;
  h.proc.kill();
  await h.exited;
}
const client = (port, token) => async (method, p, body) => {
  const r = await fetch(`http://127.0.0.1:${port}${p}`, { method, headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });
  const text = await r.text();
  let json = null; try { json = JSON.parse(text); } catch { }
  return { code: r.status, body: json, text };
};
const git = (dir, ...args) => execFileSync('git', args, { cwd: dir });

// Each probe runs lib/env.js in a fresh process, as server.js does first thing.
function envProbe(text, vars = {}) {
  const file = path.join(TMP, `probe-${Math.random().toString(36).slice(2)}.env`);
  fs.writeFileSync(file, text);
  const out = execFileSync(process.execPath, ['-e', `require(${JSON.stringify(path.join(HUB, 'lib', 'env.js'))}).load(); process.stdout.write(JSON.stringify(process.env))`],
    { env: { ...CLEAN, ...vars, BUREAU_ENV_FILE: file } });
  return { env: JSON.parse(out), dir: path.dirname(file) };
}

const BAD_NAMES = [
  'CON.md', 'con.txt', 'Prn.md', 'aux/notes.md', 'NUL.tar.md', 'com1.md', 'LPT9.json', 'conin$.md',
  'a:b.md', 'a<b.md', 'a>b.md', 'a"b.md', 'a|b.md', 'a?b.md', 'a*b.md', 'a\u0001b.md',
  'dot./x.md', 'name.md.', 'name.md ', 'space /x.md', 'PROGRA~1/x.md', 'note~2.md',
];

async function main() {
  console.log('1. lib/env.js reads .env the way start.sh did');
  const p = env.parse('\uFEFFexport A="x y"\r\nB=\'z\'\r\nC=plain # a note\r\n# comment\r\n1BAD=no\r\nBAD-KEY=no\r\n   D=indented\r\nE=\r\nF=a#b\r\nG=x=y\r\n');
  check('BOM, export and double quotes', p.A === 'x y', p);
  check('single quotes', p.B === 'z', p);
  check('an unquoted value stops before " #"', p.C === 'plain', p);
  check('leading whitespace dropped', p.D === 'indented', p);
  check('an empty value is a value', p.E === '', p);
  check('a # inside a word stays', p.F === 'a#b', p);
  check('only the first = splits', p.G === 'x=y', p);
  check('comments and bad keys skipped, no \\r anywhere', !('1BAD' in p) && !('BAD-KEY' in p) && !Object.values(p).some(v => v.includes('\r')), p);
  let r = envProbe('A=file\r\nB=file\r\n', { A: 'host' });
  check('the host environment wins over the file', r.env.A === 'host' && r.env.B === 'file', r.env);
  r = envProbe('HOST=file-host\nIP=file-ip\n', { IP: '10.0.0.7' });
  check('listen address: a host-injected IP wins', r.env.HOST === '10.0.0.7', r.env.HOST);
  r = envProbe('HOST=file-host\nIP=file-ip\n');
  check('then HOST', r.env.HOST === 'file-host', r.env.HOST);
  r = envProbe('IP=file-ip\n', {});
  check('then IP from .env', r.env.HOST === 'file-ip', r.env.HOST);
  r = envProbe('IP=file-ip\n', { HOST: 'host-host' });
  check("the host's HOST beats IP from .env", r.env.HOST === 'host-host', r.env.HOST);
  r = envProbe('PORT=1\n');
  check('then :: (all interfaces)', r.env.HOST === '::', r.env.HOST);
  r = envProbe('BUREAU_DATA_DIR=./data\nBUREAU_BRAIN_DIR=' + path.join(TMP, 'abs') + '\n');
  check('a relative dir in .env is read from its folder', r.env.BUREAU_DATA_DIR === path.join(r.dir, 'data'), r.env.BUREAU_DATA_DIR);
  check('an absolute one is kept', r.env.BUREAU_BRAIN_DIR === path.join(TMP, 'abs'), r.env.BUREAU_BRAIN_DIR);

  console.log('2. path helpers, unit level');
  check('toPosix turns a Windows relative path into a brain path', knowledge.toPosix(path.win32.relative('C:\\hub\\brain', 'C:\\hub\\brain\\knowledge\\x.md')) === 'knowledge/x.md');
  check('normRel reads a backslash as a separator on every OS', knowledge.normRel('\\journal\\..\\knowledge\\x.md') === 'knowledge/x.md', knowledge.normRel('\\journal\\..\\knowledge\\x.md'));
  for (const n of BAD_NAMES) check(`pathError refuses ${JSON.stringify(n)}`, /^bad path/.test(knowledge.pathError(knowledge.normRel('projects/demo/' + n)) || ''));
  check('pathError refuses ../ and .git in any case', ['../x.md', '.git/config', '.GIT/x.md', '.Git/hooks/x.md'].every(n => knowledge.pathError(knowledge.normRel(n)) === 'bad path'));
  check('pathError takes ordinary names', ['knowledge/console.md', 'projects/con-ops/STATE.md', 'journal/2026-10-04.md', 'a.b/c-d_e.md', 'x/.hidden.md'].every(n => knowledge.pathError(knowledge.normRel(n)) === null));
  const { PROJECT_RE } = require(path.join(HUB, 'lib', 'store.js'));
  check('project ids: CON, aux.x and a trailing dot are refused', !PROJECT_RE.test('CON') && !PROJECT_RE.test('aux.x') && !PROJECT_RE.test('ops.'));
  check('project ids: ordinary ones pass', PROJECT_RE.test('acme-site') && PROJECT_RE.test('con-ops') && PROJECT_RE.test('v1.2'));

  console.log('3. brain-lint keys paths with / and reads CRLF and BOM files as LF ones');
  const lb = path.join(TMP, 'lint-brain');
  fs.mkdirSync(path.join(lb, 'projects', 'demo'), { recursive: true });
  fs.mkdirSync(path.join(lb, 'knowledge'), { recursive: true });
  fs.writeFileSync(path.join(lb, 'projects', 'demo', 'STATE.md'), '---\ntitle: Demo\nsummary: Demo.\n---\n\n## Now\n- ok\n');
  const note = (body, eol = '\n', bom = '') => bom + ['---', 'title: Linked', 'summary: A note.', 'compartment: knowledge', 'permalink: linked', 'version: 1', '---', '', body, ''].join(eol);
  let lf = brainLint.lintFile(lb, 'knowledge\\linked.md', note('- [fact] see [[projects/demo/STATE]] (source: t-1)'));
  check('a path wikilink resolves (file named with \\)', lf.errors.length === 0, lf.errors);
  lf = brainLint.lintFile(lb, 'knowledge/linked.md', note('- [fact] see [[projects/demo/GONE]] (source: t-1)'));
  check('a dangling one is still caught, under a / path', lf.errors.some(e => e.startsWith('knowledge/linked.md: dangling wikilink')), lf.errors);
  lf = brainLint.lintFile(lb, 'knowledge/linked.md', note('- [fact] crlf (source: t-1)', '\r\n'));
  check('a CRLF note lints clean', lf.errors.length === 0 && lf.warnings.length === 0, lf);
  lf = brainLint.lintFile(lb, 'knowledge/linked.md', note('- [fact] bom (source: t-1)', '\r\n', '\uFEFF'));
  check('a BOM and CRLF note lints clean', lf.errors.length === 0 && lf.warnings.length === 0, lf);
  lf = brainLint.lintFile(lb, 'knowledge/linked.md', note('- [fact] unsourced', '\r\n', '\uFEFF'));
  check('and its errors are the same as for LF', lf.errors.length === 1 && /unsourced observation/.test(lf.errors[0]), lf.errors);
  const claims = require(path.join(HUB, 'lib', 'claims.js'));
  const day = '\uFEFF---\r\ntitle: Journal\r\ncompartment: journal\r\nformat: 0.3\r\n---\r\n\r\n- [fact] x ^j-abcdefgh\r\n  - evidence: seen\r\n  - by: a\r\n  - at: 2026-10-04T10:00Z\r\n  - confidence: observed\r\n';
  check('claims: a BOM does not hide format 0.3 (no false journal cutover)', claims.parseFile(day, { path: 'journal/2026-10-04.md' }).format === '0.3');

  console.log('4. node server.js reads the .env beside it, from any working directory');
  // A copy of hub/ with its own .env (CRLF, BOM, quotes), started from TMP.
  const copy = path.join(TMP, 'hub-copy');
  fs.cpSync(HUB, copy, { recursive: true, filter: src => !/[\\/](data|brain|work|\.env)$/.test(src) });
  const port = await freePort();
  const A = path.join(TMP, 'a');
  fs.writeFileSync(path.join(copy, '.env'), '\uFEFF' + [
    '# Bureau: environment, saved by Notepad',
    'export BUREAU_TOKEN="tok-from-file"',
    `PORT=${port}`,
    'HOST=127.0.0.1                # loopback',
    `BUREAU_DATA_DIR="${path.join(A, 'data')}"`,
    `BUREAU_BRAIN_DIR='${path.join(A, 'brain')}'`,
    `BUREAU_WORK_DIR=${path.join(A, 'work')}`,
    'BUREAU_POKES=',
    '',
  ].join('\r\n'));
  const hubA = startHub({ server: path.join(copy, 'server.js'), envFile: null });
  check('the hub answers on the port from .env', await up(port), hubA.log);
  const noAuth = await fetch(`http://127.0.0.1:${port}/api/health`);
  check('the token from .env protects the API', noAuth.status === 401, noAuth.status);
  const api = client(port, 'tok-from-file');
  check('and opens it', (await api('GET', '/api/health')).code === 200);
  check('no UNPROTECTED warning at boot', !/UNPROTECTED/.test(hubA.log), hubA.log);
  check('the data dir is the one .env names', fs.existsSync(path.join(A, 'data', 'state.json')) || fs.existsSync(path.join(A, 'data', 'hub.lock')));

  const port2 = await freePort();
  const B = path.join(TMP, 'b');
  const hubB = startHub({ server: path.join(copy, 'server.js'), envFile: null, vars: { BUREAU_TOKEN: 'tok-from-env', PORT: String(port2),
    BUREAU_DATA_DIR: path.join(B, 'data'), BUREAU_BRAIN_DIR: path.join(B, 'brain'), BUREAU_WORK_DIR: path.join(B, 'work') } });
  check('the host environment wins: its PORT', await up(port2), hubB.log);
  check('its token', (await client(port2, 'tok-from-env')('GET', '/api/health')).code === 200);
  check('not the file one', (await client(port2, 'tok-from-file')('GET', '/api/health')).code === 401);
  await stop(hubB);

  console.log('5. paths in API answers, events and commits use /');
  const brainA = path.join(A, 'brain');
  let w = await api('POST', '/api/knowledge', { file: 'projects/demo/notes.md', content: 'hello', author: 'tester' });
  check('write answers a / path', w.code === 200 && w.body.file === 'projects/demo/notes.md', w.body);
  w = await api('POST', '/api/knowledge', { file: 'projects\\demo\\more.md', content: 'more', author: 'tester' });
  check('a \\ path in is a / path out', w.code === 200 && w.body.file === 'projects/demo/more.md', w.body);
  const list = await api('GET', '/api/knowledge?dir=projects');
  check('the listing uses /', list.body.files.includes('projects/demo/notes.md') && !list.body.files.some(f => f.includes('\\')), list.body);
  const st = (await api('GET', '/api/state')).body;
  const written = st.log.filter(e => e.type === 'knowledge.written').map(e => e.file);
  check('events use /', written.includes('projects/demo/notes.md') && !written.some(f => f.includes('\\')), written);
  check('commit messages use /', st.knowledge.recent.some(c => c.message === 'update projects/demo/notes.md'), st.knowledge.recent);

  console.log('6. CRLF and BOM curated files lint clean and take an append');
  fs.mkdirSync(path.join(brainA, 'knowledge'), { recursive: true });
  const curated = (name, eol, bom) => bom + ['---', `title: ${name}`, 'summary: Saved on Windows.', 'compartment: knowledge', `permalink: ${name}`, 'version: 1', '---', '', `- [fact] ${name} exists (source: t-1)`, ''].join(eol);
  fs.writeFileSync(path.join(brainA, 'knowledge', 'crlf-note.md'), curated('crlf-note', '\r\n', ''));
  fs.writeFileSync(path.join(brainA, 'knowledge', 'bom-note.md'), curated('bom-note', '\r\n', '\uFEFF'));
  const sw = await api('POST', '/api/knowledge/sweep');
  const swept = git(brainA, 'ls-files', 'knowledge').toString();
  check('the hand-dropped files are swept in', sw.body.committed >= 1 && /crlf-note\.md/.test(swept) && /bom-note\.md/.test(swept), { sw: sw.body, swept });
  const whole = brainLint.lint(brainA);
  check('the brain lints clean', whole.errors.length === 0, whole.errors);
  for (const f of ['crlf-note', 'bom-note']) {
    const ap = await api('POST', '/api/knowledge', { file: `knowledge/${f}.md`, content: `- [fact] appended to ${f} (source: t-2)`, mode: 'append', author: 'human' });
    check(`an append to ${f}.md passes write-time lint`, ap.code === 200, ap.body);
  }
  const link = await api('POST', '/api/knowledge', { file: 'knowledge/links.md', author: 'human',
    content: curated('links', '\n', '').replace('exists (source: t-1)', 'see [[projects/demo/notes]] and [[knowledge/crlf-note]] (source: t-1)') });
  check('path wikilinks resolve on write', link.code === 200, link.body);

  console.log('7. names Windows cannot hold are refused (400), and the sweep stays healthy');
  for (const n of BAD_NAMES) {
    const b = await api('POST', '/api/knowledge', { file: `projects/demo/${n}`, content: 'x', author: 'human' });
    check(`knowledge refuses ${JSON.stringify(n)}`, b.code === 400 && /bad path/.test(b.body && b.body.error), b);
  }
  for (const n of ['../escape.md', '.GIT/config.md', '.Git/hooks/x.md']) {
    const b = await api('POST', '/api/knowledge', { file: n, content: 'x', author: 'human' });
    check(`knowledge refuses ${n}`, b.code === 400 && b.body.error === 'bad path', b);
  }
  const rd = await api('GET', '/api/knowledge?file=CON.md');
  check('a read of a reserved name is a 400 too', rd.code === 400, rd);
  const task = (await api('POST', '/api/tasks', { title: 'evidence', project: 'general' })).body.task;
  for (const n of ['CON.png', 'a:b.md', 'x./y.md']) {
    const b = await api('POST', '/api/work', { file: `work/${task.id}/${n}`, content: 'x' });
    check(`the work store refuses ${n}`, b.code === 400 && /bad path/.test(b.body.error), b);
  }
  const pj = await api('POST', '/api/projects', { label: 'Console', id: 'con' });
  check('a project id CON is refused', pj.code === 400, pj);
  const tk = await api('POST', '/api/tasks', { title: 'x', project: 'aux' });
  check('a mission in project aux is refused', tk.code === 400, tk);
  await api('POST', '/api/agents/register', { name: 'lead-1', kind: 'dummy', capabilities: ['lead'] });
  await api('POST', '/api/tasks/claim', { agent: 'worker-1', id: task.id });
  const pay = await api('PATCH', `/api/tasks/${task.id}`, { agent: 'worker-1', items: [{ title: 'x', payload: { ops: [{ op: 'write', file: 'projects/demo/LPT1.md', content: 'x' }] } }] });
  check('a review payload naming LPT1.md is refused', pay.code === 400 && /bad path/.test(pay.body.error), pay);
  fs.writeFileSync(path.join(brainA, 'projects', 'demo', 'by-hand.md'), 'dropped by hand\n');
  const sw2 = await api('POST', '/api/knowledge/sweep');
  check('the intake sweep still commits', sw2.body.committed === 1, sw2.body);
  check('and leaves the brain clean', git(brainA, 'status', '--porcelain').toString().trim() === '');

  console.log('8. the brain keeps the bytes the boss approved');
  const tracked = git(brainA, 'ls-files').toString().split('\n');
  check('.gitattributes and .gitignore are committed', tracked.includes('.gitattributes') && tracked.includes('.gitignore'), tracked);
  check('.gitattributes turns conversion off', fs.readFileSync(path.join(brainA, '.gitattributes'), 'utf8').includes('* -text'));
  check('.gitignore keeps OS junk out', ['Thumbs.db', 'desktop.ini', '~$*', '*.swp', '.DS_Store'].every(x => fs.readFileSync(path.join(brainA, '.gitignore'), 'utf8').includes(x)));
  check('the hub committed them as itself', /Bureau/.test(git(brainA, 'log', '-1', '--format=%an', '--', '.gitattributes').toString()));
  check('core.longpaths is on', git(brainA, 'config', 'core.longpaths').toString().trim() === 'true');
  check('the listing does not show them', !(await api('GET', '/api/knowledge')).body.files.some(f => f.startsWith('.git')));
  const content = 'line one\r\nline two, café\nno newline at the end';
  const id = (await api('POST', '/api/tasks', { title: 'exact bytes', project: 'general' })).body.task.id;
  await api('POST', '/api/tasks/claim', { agent: 'worker-1', id });
  await api('PATCH', `/api/tasks/${id}`, { agent: 'worker-1', items: [{ title: 'pin', payload: { ops: [{ op: 'write', file: 'projects/demo/payload.md', content }] } }] });
  await api('PATCH', `/api/tasks/${id}`, { agent: 'lead-1', status: 'review', after_approval: 'return' });
  await api('PATCH', `/api/tasks/${id}`, { agent: 'human', status: 'done', verdicts: [{ id: 'i1', verdict: 'approved' }] });
  const ap = await api('POST', `/api/tasks/${id}/apply`, { agent: 'worker-1', item: 'i1' });
  check('the approved payload applies', ap.code === 200, ap);
  check('the file on disk holds exactly those bytes', fs.readFileSync(path.join(brainA, 'projects', 'demo', 'payload.md')).equals(Buffer.from(content)));
  check('and so does the commit', git(brainA, 'show', 'HEAD:projects/demo/payload.md').equals(Buffer.from(content)));
  await stop(hubA);

  console.log('8b. an existing brain gets the hygiene files once, and what the boss staged stays staged');
  const old = path.join(TMP, 'old-brain');
  fs.mkdirSync(old);
  git(old, 'init', '-q');
  fs.writeFileSync(path.join(old, 'first.md'), 'first\n');
  git(old, 'add', 'first.md');
  git(old, '-c', 'user.name=Boss', '-c', 'user.email=boss@example.com', 'commit', '-q', '-m', 'first');
  fs.writeFileSync(path.join(old, 'staged.md'), 'staged by hand\n');
  git(old, 'add', 'staged.md');
  execFileSync(process.execPath, ['-e', `require(${JSON.stringify(path.join(HUB, 'lib', 'knowledge.js'))}).ensureRepo()`], { env: { ...CLEAN, BUREAU_BRAIN_DIR: old } });
  const last = git(old, 'show', '--name-only', '--format=%an', 'HEAD').toString().trim().split('\n').filter(Boolean);
  check('one hub commit holds the two files and nothing else', last[0] === 'Bureau' && last.slice(1).sort().join(',') === '.gitattributes,.gitignore', last);
  check('the staged file is still staged, not committed', git(old, 'diff', '--cached', '--name-only').toString().trim() === 'staged.md');
  execFileSync(process.execPath, ['-e', `require(${JSON.stringify(path.join(HUB, 'lib', 'knowledge.js'))}).ensureRepo()`], { env: { ...CLEAN, BUREAU_BRAIN_DIR: old } });
  check('a second boot commits nothing more', git(old, 'rev-list', '--count', 'HEAD').toString().trim() === '2');

  console.log('9. the lock: a live pid that stopped touching it is stale');
  const L = path.join(TMP, 'lock');
  fs.mkdirSync(path.join(L, 'data'), { recursive: true });
  const lockFile = path.join(L, 'data', 'hub.lock');
  const lockVars = port3 => ({ BUREAU_TOKEN: 'lock', PORT: String(port3), HOST: '127.0.0.1', BUREAU_DATA_DIR: path.join(L, 'data'), BUREAU_BRAIN_DIR: path.join(L, 'brain'), BUREAU_WORK_DIR: path.join(L, 'work') });
  // This runner's own pid: alive, but no hub, like a pid Windows handed on.
  fs.writeFileSync(lockFile, String(process.pid));
  let port3 = await freePort();
  const fresh = startHub({ vars: lockVars(port3) });
  const code = await Promise.race([fresh.exited, sleep(8000).then(() => 'running')]);
  check('a freshly touched lock with a live pid refuses the boot', code === 1 && /owned by a live hub process/.test(fresh.log), { code, log: fresh.log });
  await stop(fresh);
  const longAgo = new Date(Date.now() - 10 * 60_000);
  fs.writeFileSync(lockFile, String(process.pid));
  fs.utimesSync(lockFile, longAgo, longAgo);
  port3 = await freePort();
  const taker = startHub({ vars: lockVars(port3) });
  check('a lock untouched for 10 minutes is taken over', await up(port3), taker.log);
  check('the takeover is logged', /taking over stale lock from pid \d+: untouched/.test(taker.log), taker.log);
  check('the lock now names the new hub', fs.readFileSync(lockFile, 'utf8').trim() === String(taker.proc.pid));
  check('and was touched just now', Date.now() - fs.statSync(lockFile).mtimeMs < 60_000);
  await stop(taker);

  console.log('10. a fresh hub stopped before its first change starts again');
  const F = path.join(TMP, 'fresh');
  const freshVars = p => ({ BUREAU_TOKEN: 'fresh', PORT: String(p), HOST: '127.0.0.1', BUREAU_DATA_DIR: path.join(F, 'data'), BUREAU_BRAIN_DIR: path.join(F, 'brain'), BUREAU_WORK_DIR: path.join(F, 'work') });
  let port4 = await freePort();
  const first = startHub({ vars: freshVars(port4) });
  check('a fresh hub boots', await up(port4), first.log);
  check('and writes its state.json at once', fs.existsSync(path.join(F, 'data', 'state.json')));
  first.proc.kill('SIGKILL'); // the hardest stop: no exit handler, no flush
  await first.exited;
  port4 = await freePort();
  const second = startHub({ vars: freshVars(port4) });
  check('it boots again after a hard stop', await up(port4), second.log);
  await stop(second);
}

main()
  .catch(e => { FAIL++; console.error(e); })
  .finally(async () => {
    for (const h of hubs) await stop(h).catch(() => { });
    try { fs.rmSync(TMP, { recursive: true, force: true, maxRetries: 3 }); } catch { }
    console.log(`\npassed ${PASS}, failed ${FAIL}`);
    process.exit(FAIL ? 1 : 0);
  });

// test/updates.test.js: the daily check for a newer release (lib/updates.js).
// Versions and tags, the UPGRADING.md sections it keeps (on this repo's own
// file), a check against a stand-in for GitHub, then a real hub with the check
// off: the routes are the operator's alone. Nothing here reaches GitHub.
// Usage: node test/updates.test.js    (port 8243)
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');

const ROOT = path.join(__dirname, '..');
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bureau-updates-'));
const updates = require(path.join(ROOT, 'hub', 'lib', 'updates'));

const HUB = path.join(ROOT, 'hub', 'server.js');
const PORT = 8243;
const BOSS = 'boss-secret-token-for-updates-test';
const SHARED = 'shared-token-for-updates-test';
let PASS = 0, FAIL = 0;
function check(label, ok, got) {
  if (ok) { PASS++; console.log(`  ok: ${label}`); }
  else { FAIL++; console.log(`  FAIL: ${label}${got !== undefined ? ` (got: ${JSON.stringify(got).slice(0, 300)})` : ''}`); }
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function unitPart() {
  console.log('versions and tags');
  check('0.10.0 is after 0.9.0', updates.compare('0.10.0', '0.9.0') > 0);
  check('v0.5.7 equals 0.5.7', updates.compare('v0.5.7', '0.5.7') === 0);
  check('the latest tag is by number, not by name', updates.latestOf(['v0.9.0', 'v0.10.0', 'v0.2.0']) === '0.10.0');
  check('a pre-release or odd tag is skipped', updates.latestOf(['v0.5.7', 'v0.6.0-rc1', 'notes']) === '0.5.7');
  check('no release tag: null', updates.latestOf(['main', 'x']) === null);

  console.log('UPGRADING.md sections');
  const md = fs.readFileSync(path.join(ROOT, 'UPGRADING.md'), 'utf8');
  const found = updates.sectionsOf(md, '0.4.0', '0.5.7');
  const versions = found.sections.map((s) => s.version);
  check('from 0.4.0 to 0.5.7: the 0.5.7 and 0.5.0 sections, newest first', JSON.stringify(versions) === JSON.stringify(['0.5.7', '0.5.0']), versions);
  check('a section keeps its title and its body, not the next one', found.sections[0].title.startsWith('0.5.7') && !/## 0\.5\.0/.test(found.sections[0].markdown) && /Sign in with OMAKO/.test(found.sections[0].markdown));
  check('the general Upgrade steps come along', /Stop the hub/.test(found.steps || ''));
  check('the release you run is not shown again', updates.sectionsOf(md, '0.5.0', '0.5.7').sections.every((s) => s.version !== '0.5.0'));
  check('both 0.3.0 sections from 0.2.0', updates.sectionsOf(md, '0.2.0', '0.3.0').sections.length === 2);
  check('nothing between equal versions', updates.sectionsOf(md, '0.5.7', '0.5.7').sections.length === 0);

  const base = 'https://github.com/mahoudeau/bureau/blob/v0.6.0';
  const abs = updates.absoluteLinks('[c](CHANGELOG.md) [p](docs/protocol.md) [a](#roll-back) [x](https://e.example/y)', base);
  check('relative links point at GitHub at the release', abs.includes(`(${base}/CHANGELOG.md)`) && abs.includes(`(${base}/docs/protocol.md)`) && abs.includes(`(${base}/UPGRADING.md#roll-back)`) && abs.includes('(https://e.example/y)'), abs);
}

// A stand-in for GitHub: the tag list and UPGRADING.md at a tag.
function fakeGitHub({ tags, upgrading, fail }) {
  const calls = [];
  const fetchImpl = async (url, opts) => {
    calls.push({ url, headers: opts.headers });
    if (fail) return { ok: false, status: 503, text: async () => '' };
    if (url.includes('/tags')) return { ok: true, status: 200, text: async () => JSON.stringify(tags.map((name) => ({ name }))) };
    if (url.endsWith('/UPGRADING.md')) return { ok: true, status: 200, text: async () => upgrading };
    return { ok: false, status: 404, text: async () => '' };
  };
  return { fetchImpl, calls };
}

const UPGRADING = [
  '# Upgrading Bureau', '', '## Upgrade', '', '1. Stop the hub.', '',
  '## 0.6.0: something new', '', 'Read [the protocol](docs/protocol.md).', '',
  '## 0.5.8: a fix', '', 'Nothing to do.', '',
  '## 0.5.7: the first run', '', 'Old news.', '',
  '## Roll back', '', 'Not a release.', '',
].join('\n');

async function checkPart() {
  console.log('a check');
  let gh = fakeGitHub({ tags: ['v0.5.7', 'v0.6.0', 'v0.5.8'], upgrading: UPGRADING });
  let u = updates.create({ env: {}, fetchImpl: gh.fetchImpl, current: '0.5.7' });
  check('before the first check: nothing known', u.status().latest === null && !u.status().behind && u.status().enabled);
  let s = await u.check();
  check('behind: 0.6.0 is out, this hub runs 0.5.7', s.behind && s.latest === '0.6.0' && s.current === '0.5.7', s);
  check('the sections between, newest first', JSON.stringify(s.sections.map((x) => x.version)) === JSON.stringify(['0.6.0', '0.5.8']), s.sections);
  check('their links point at the release', s.sections[0].markdown.includes('https://github.com/mahoudeau/bureau/blob/v0.6.0/docs/protocol.md'));
  check('UPGRADING.md is read at the new tag', gh.calls.some((c) => c.url === 'https://raw.githubusercontent.com/mahoudeau/bureau/v0.6.0/UPGRADING.md'));
  check('the requests carry no version and no token', gh.calls.every((c) => c.headers['user-agent'] === 'bureau-hub' && !c.headers.authorization));
  check('the links name the release', s.upgrading_url.endsWith('/blob/v0.6.0/UPGRADING.md') && s.changelog_url.endsWith('/blob/v0.6.0/CHANGELOG.md'));

  gh = fakeGitHub({ tags: ['v0.5.6', 'v0.5.7'], upgrading: UPGRADING });
  u = updates.create({ env: {}, fetchImpl: gh.fetchImpl, current: '0.5.7' });
  s = await u.check();
  check('up to date: not behind, UPGRADING.md not fetched', !s.behind && s.latest === '0.5.7' && s.sections.length === 0 && gh.calls.length === 1, s);

  gh = fakeGitHub({ tags: ['v0.5.7'], upgrading: UPGRADING });
  u = updates.create({ env: {}, fetchImpl: gh.fetchImpl, current: '0.6.0' });
  s = await u.check();
  check('a hub ahead of the latest tag is not behind', !s.behind);

  // A failed check keeps what the last good one found.
  let failing = false;
  const good = fakeGitHub({ tags: ['v0.6.0'], upgrading: UPGRADING });
  u = updates.create({ env: {}, fetchImpl: (url, o) => (failing ? fakeGitHub({ fail: true }).fetchImpl(url, o) : good.fetchImpl(url, o)), current: '0.5.7' });
  await u.check();
  failing = true;
  s = await u.check();
  check('a failed check says so and keeps the release it saw', s.behind && s.latest === '0.6.0' && /503/.test(s.error) && s.sections.length === 2, s);

  gh = fakeGitHub({ tags: ['v0.6.0'], upgrading: UPGRADING });
  u = updates.create({ env: { BUREAU_UPDATE_CHECK: 'off' }, fetchImpl: gh.fetchImpl, current: '0.5.7' });
  s = await u.check();
  check('BUREAU_UPDATE_CHECK=off: no request, and it says so', gh.calls.length === 0 && !s.enabled && !u.enabled && u.schedule && !s.behind);

  gh = fakeGitHub({ tags: ['v0.6.0'], upgrading: 'x'.repeat(600 * 1024) });
  u = updates.create({ env: {}, fetchImpl: gh.fetchImpl, current: '0.5.7' });
  s = await u.check();
  check('an oversized answer is refused', /more than/.test(s.error || ''), s);
}

let child = null;
async function hubPart() {
  console.log('a real hub, check off');
  const d = path.join(dir, 'hub');
  fs.mkdirSync(path.join(d, 'data'), { recursive: true });
  const env = { PATH: process.env.PATH, SystemRoot: process.env.SystemRoot, TEMP: process.env.TEMP, TMP: process.env.TMP, HOME: d, PORT: String(PORT), HOST: '127.0.0.1',
    BUREAU_ENV_FILE: path.join(d, 'none.env'), BUREAU_DATA_DIR: path.join(d, 'data'), BUREAU_BRAIN_DIR: path.join(d, 'brain'), BUREAU_WORK_DIR: path.join(d, 'work'), BUREAU_POKES: '',
    GIT_CONFIG_GLOBAL: path.join(d, 'gitconfig'), BUREAU_TOKEN: SHARED, BUREAU_BOSS_TOKEN: BOSS, BUREAU_UPDATE_CHECK: 'off' };
  const logFile = path.join(d, 'hub.log');
  const out = fs.openSync(logFile, 'a');
  child = spawn(process.execPath, [HUB], { env, stdio: ['ignore', out, out] });
  const base = `http://127.0.0.1:${PORT}`;
  let up = false;
  for (let i = 0; i < 100 && !up; i++) { try { up = (await fetch(`${base}/health`)).ok; } catch { /* starting */ } if (!up) await sleep(100); }
  if (!up) throw new Error(`hub never answered /health: ${fs.readFileSync(logFile, 'utf8').slice(-500)}`);
  const call = async (method, p, token) => {
    const r = await fetch(base + p, { method, headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' }, body: method === 'POST' ? '{}' : undefined });
    let json = null; try { json = await r.json(); } catch { /* not json */ }
    return { status: r.status, json };
  };
  let r = await call('GET', '/api/updates', BOSS);
  check('the operator reads the status', r.status === 200 && r.json.enabled === false && r.json.current && r.json.behind === false, r);
  r = await call('POST', '/api/updates/check', BOSS);
  check('check now with the check off: 409', r.status === 409, r);
  r = await call('GET', '/api/updates', SHARED);
  check('an agent credential gets 404', r.status === 404, r);
  r = await call('POST', '/api/updates/check', SHARED);
  check('and 404 on check now', r.status === 404, r);
  check('the boot log says the check is off', /release check is off/.test(fs.readFileSync(logFile, 'utf8')));
}

async function main() {
  try {
    unitPart();
    await checkPart();
    await hubPart();
  } catch (e) { FAIL++; console.log(`  FAIL: ${e.stack || e}`); }
  if (child) child.kill('SIGTERM');
  await sleep(300);
  fs.rmSync(dir, { recursive: true, force: true });
  console.log(`\n${PASS} passed, ${FAIL} failed`);
  process.exit(FAIL ? 1 : 0);
}
main();

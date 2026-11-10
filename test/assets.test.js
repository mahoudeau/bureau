// test/assets.test.js: every file the app shell and the stylesheets name exists
// on disk and is served by a real hub, and every module the app imports does
// too. A .gitignore rule nearly dropped six modules once; this makes a missing
// file fail CI. Zero deps, all data fake, its own hub on port 8215.
// Usage: node test/assets.test.js
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');

const ROOT = path.join(__dirname, '..');
const PUBLIC = path.join(ROOT, 'hub', 'public');
const PORT = 8215;
const BASE = `http://127.0.0.1:${PORT}`;
const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'bureau-assets-'));

let pass = 0, fail = 0;
function check(label, ok, got) {
  if (ok) { pass++; console.log(`  ok: ${label}`); }
  else { fail++; console.log(`  FAIL: ${label}${got !== undefined ? ` (got: ${JSON.stringify(got).slice(0, 300)})` : ''}`); }
}
const read = (rel) => fs.readFileSync(path.join(PUBLIC, rel), 'utf8');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const isAsset = (url) => /^\/(app|omako-ds)\//.test(url);

// What a file names, as paths from the hub's root.
function urlsInHtml(text) {
  return [...text.matchAll(/\b(?:href|src)="(\/[^"#?]+)"/g)].map((m) => m[1]);
}
function urlsInCss(text, fromUrl) {
  const clean = text.replace(/\/\*[\s\S]*?\*\//g, '');
  return [...clean.matchAll(/url\(\s*["']?([^"')]+?)["']?\s*\)/g)]
    .map((m) => m[1])
    .filter((u) => !/^(data:|https?:|#)/.test(u))
    .map((u) => new URL(u, `http://x${fromUrl}`).pathname);
}
function urlsInModule(text, fromUrl) {
  const clean = text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
  const statics = [...clean.matchAll(/^\s*(?:import|export)\b[^'"\n]*\bfrom\s*['"]([^'"]+)['"]|^\s*import\s*['"]([^'"]+)['"]/gm)].map((m) => m[1] || m[2]);
  const dynamics = [...clean.matchAll(/\bimport\(\s*['"]([^'"]+)['"]\s*\)/g)].map((m) => m[1]);
  return [...statics, ...dynamics].map((u) => new URL(u, `http://x${fromUrl}`).pathname);
}

// Follows the shell and all.css outward, so a file only a stylesheet or a lazy
// page names is held to the same rule.
function collect() {
  const seen = new Map(); // url -> who named it
  const queue = [];
  const add = (url, by) => { if (isAsset(url) && !seen.has(url)) { seen.set(url, by); queue.push(url); } };
  for (const url of urlsInHtml(read('app/index.html'))) add(url, 'app/index.html');
  add('/omako-ds/all.css', 'the link pages');
  add('/app/css/link-pages.css', 'the link pages');
  while (queue.length) {
    const url = queue.shift();
    const file = path.join(PUBLIC, url);
    if (!fs.existsSync(file)) continue;
    const text = fs.readFileSync(file, 'utf8');
    if (url.endsWith('.css')) urlsInCss(text, url).forEach((u) => add(u, url));
    else if (url.endsWith('.js')) urlsInModule(text, url).forEach((u) => add(u, url));
  }
  return seen;
}

// Every path segment under a folder, files and folders alike.
function segments(dir, prefix = '') {
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const rel = prefix ? `${prefix}/${entry.name}` : entry.name;
    out.push(rel);
    if (entry.isDirectory()) out.push(...segments(path.join(dir, entry.name), rel));
  }
  return out;
}

async function main() {
  console.log('0. nothing under hub/public/ has a name the deploy deletes');
  // The deploy's rsync --delete excludes data, brain, work and .env, unanchored,
  // to protect production's data: a segment with one of those names never ships.
  const forbidden = new Set(['brain', 'data', 'work', '.env']);
  const banned = segments(PUBLIC).filter((p) => p.split('/').some((seg) => forbidden.has(seg)));
  check('no path segment under hub/public/ is exactly brain, data, work or .env', banned.length === 0, banned);

  console.log('1. everything the shell and the stylesheets name');
  const assets = collect();
  check('the walk found the shell\'s assets', assets.has('/app/main.js') && assets.has('/omako-ds/tokens.css') && assets.has('/app/pages/mission.js'), [...assets.keys()]);
  check('the walk reached the fonts through all.css', [...assets.keys()].some((u) => u.endsWith('.woff2')), [...assets.keys()]);

  const env = { PATH: process.env.PATH, SystemRoot: process.env.SystemRoot, TEMP: process.env.TEMP, TMP: process.env.TMP, HOME: scratch, USERPROFILE: scratch, PORT: String(PORT), HOST: '127.0.0.1', BUREAU_TOKEN: 'assets-test-token-0123456789',
    BUREAU_ENV_FILE: path.join(scratch, 'none.env'), BUREAU_DATA_DIR: path.join(scratch, 'data'), BUREAU_BRAIN_DIR: path.join(scratch, 'brain'), BUREAU_WORK_DIR: path.join(scratch, 'work'), GIT_CONFIG_GLOBAL: process.platform === 'win32' ? 'NUL' : '/dev/null' };
  const hub = spawn(process.execPath, [path.join(ROOT, 'hub', 'server.js')], { env, stdio: 'ignore' });
  try {
    let up = false;
    for (let i = 0; i < 120 && !up; i++) {
      try { up = (await fetch(`${BASE}/health`, { signal: AbortSignal.timeout(1000) })).ok; } catch { await sleep(100); }
    }
    check('(setup) the hub answers', up);
    if (!up) return;
    for (const [url, by] of assets) {
      check(`${url} is on disk (named by ${by})`, fs.existsSync(path.join(PUBLIC, url)));
      const r = await fetch(BASE + url);
      await r.arrayBuffer();
      check(`${url} is served`, r.status === 200, r.status);
    }

    console.log('2. what the hub must not serve from those folders');
    for (const url of ['/app/index.html', '/omako-ds/README.md', '/app/../office.html', '/app/%2e%2e/office.html']) {
      const r = await fetch(BASE + url);
      const body = await r.text();
      check(`${url} is not a static file`, !body.includes('office-assets') && !body.startsWith('# omako-ds'), r.status);
    }

    console.log('3. the old dashboards are gone and their links redirect');
    for (const file of ['index.html', 'v2.html', 'v2']) check(`hub/public/${file} is gone`, !fs.existsSync(path.join(PUBLIC, file)));
    for (const url of ['/v2', '/v2/styleguide']) {
      const r = await fetch(BASE + url, { redirect: 'manual' });
      check(`${url} redirects to /`, r.status === 301 && r.headers.get('location') === '/', r.status);
    }
    const old = await fetch(`${BASE}/v2/tokens.css`);
    await old.text();
    check('an old asset path is a 404', old.status === 404, old.status);
  } finally {
    hub.kill('SIGKILL');
  }

  console.log('4. the status words and patterns match on both surfaces');
  const look = (text) => Object.fromEntries([...text.matchAll(/^\s*(\w+): \{ word: '([^']+)', dither: '([^']+)'/gm)].map((m) => [m[1], `${m[2]}/${m[3]}`]));
  const app = read('app/status.js');
  const fromApp = look(app.slice(app.indexOf('export const STATUSES'), app.indexOf('export const LANES')));
  const server = fs.readFileSync(path.join(ROOT, 'hub', 'server.js'), 'utf8');
  const fromServer = look(server.slice(server.indexOf('const STATUS_LOOK'), server.indexOf('function statusMark')));
  check('the app lists statuses', Object.keys(fromApp).length === 9, fromApp);
  check('server.js maps each status as app/status.js does', JSON.stringify(Object.entries(fromApp).sort()) === JSON.stringify(Object.entries(fromServer).sort()), { fromApp, fromServer });

  console.log(`\npassed ${pass}, failed ${fail}`);
}

main().then(() => { fs.rmSync(scratch, { recursive: true, force: true }); process.exit(fail ? 1 : 0); })
  .catch((e) => { console.error(e); process.exit(1); });

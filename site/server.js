// site/server.js: the public site's server. Zero dependencies.
// Static files, plus four small endpoints:
//
//   POST /api/waitlist           save a signup, returns its slot number
//   GET  /api/waitlist/export    CSV of signups (needs WAITLIST_TOKEN)
//   GET  /api/stars              the repo's GitHub star count, cached
//   GET  /api/github/login       "star without leaving" (needs a GitHub
//   GET  /api/github/callback     App with only the Starring permission)
//
// The office art library and its font are served straight from
// hub/public, so the site and the office share one copy.
//
//   node site/server.js                 -> http://localhost:4600
//
// Environment (all optional; features switch off cleanly without them):
//   PORT, SITE_DATA_DIR (default site/.data), WAITLIST_TOKEN,
//   GITHUB_TOKEN (raises the API rate limit for the star count),
//   GITHUB_APP_CLIENT_ID, GITHUB_APP_CLIENT_SECRET, SITE_PUBLIC_URL,
//   BREVO_API_KEY, BREVO_LIST_ID, BREVO_API_URL (see "Brevo" below),
//   ASSET_VERSION (see "caching" below)
'use strict';
const http = require('http');
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');

const PORT = +process.env.PORT || 4600;
const HOST = process.env.IP || '0.0.0.0'; // alwaysdata injects IP; locally, every interface (phone testing)
const SITE = __dirname;
const HUB_PUBLIC = path.join(__dirname, '..', 'hub', 'public');
const DATA_DIR = process.env.SITE_DATA_DIR || path.join(SITE, '.data');
const WAITLIST_FILE = path.join(DATA_DIR, 'waitlist.jsonl');
const REPO = 'mahoudeau/bureau';
const APP_ID = process.env.GITHUB_APP_CLIENT_ID || '';
const APP_SECRET = process.env.GITHUB_APP_CLIENT_SECRET || '';

const SHARED = {
  '/assets/office-assets.js': path.join(HUB_PUBLIC, 'office-assets.js'),
  '/assets/office-font.ttf': path.join(HUB_PUBLIC, 'office-font.ttf'),
};
const PRIVATE = new Set(['server.js', 'start.sh', 'mcp.js', 'mcp-registry.json']);
const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json', '.svg': 'image/svg+xml',
  '.png': 'image/png', '.ttf': 'font/ttf', '.woff2': 'font/woff2', '.ico': 'image/x-icon',
  '.jpg': 'image/jpeg', '.webp': 'image/webp',
  '.txt': 'text/plain; charset=utf-8', '.xml': 'application/xml; charset=utf-8',
  '.md': 'text/markdown; charset=utf-8', '.webmanifest': 'application/manifest+json',
};

// ---- helpers ------------------------------------------------------------
function send(res, code, body, headers) {
  const isStr = typeof body === 'string';
  res.writeHead(code, Object.assign({
    'Content-Type': isStr ? 'text/plain; charset=utf-8' : 'application/json',
    'Cache-Control': 'no-store',
  }, headers || {}));
  res.end(isStr ? body : JSON.stringify(body));
}
function readJson(req, limit) {
  return new Promise((resolve, reject) => {
    let size = 0, chunks = [];
    req.on('data', (c) => { size += c.length; if (size > limit) { reject(new Error('too large')); req.destroy(); } else chunks.push(c); });
    req.on('end', () => { try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}')); } catch (e) { reject(new Error('bad json')); } });
    req.on('error', reject);
  });
}
function clientIp(req) { return (req.headers['x-forwarded-for'] || '').split(',')[0].trim() || req.socket.remoteAddress || '?'; }

// ---- waitlist -----------------------------------------------------------
// Append-only JSONL. A repeat email appends its new answers but keeps the
// slot it first got. Nothing identifying beyond the email is stored.
const CHOICES = {
  use: ['pro', 'personal'],
  role: ['dev', 'product', 'design', 'other'],
  interest: ['self-host', 'hosted', 'both'],
};
const signups = new Map(); // email -> { slot, latest record }
function loadWaitlist() {
  if (!fs.existsSync(WAITLIST_FILE)) return;
  for (const line of fs.readFileSync(WAITLIST_FILE, 'utf8').split('\n')) {
    if (!line.trim()) continue;
    try {
      const r = JSON.parse(line);
      const prev = signups.get(r.email);
      signups.set(r.email, { slot: prev ? prev.slot : signups.size + 1, rec: r });
    } catch (e) { /* a torn line never blocks the rest */ }
  }
}
const recent = new Map(); // ip -> timestamps, for a light rate limit
function rateLimited(ip) {
  const now = Date.now(), list = (recent.get(ip) || []).filter((t) => now - t < 10 * 60 * 1000);
  list.push(now); recent.set(ip, list);
  return list.length > 8;
}
async function postWaitlist(req, res) {
  let b;
  try { b = await readJson(req, 4096); } catch (e) { return send(res, 400, { error: 'Could not read that.' }); }
  // the honeypot: people never fill a field they cannot see
  if (b.website) return send(res, 200, { slot: signups.size + 1 });
  if (rateLimited(clientIp(req))) return send(res, 429, { error: 'Easy there. Try again in a few minutes.' });
  const email = String(b.email || '').trim().toLowerCase();
  if (email.length > 254 || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return send(res, 400, { error: 'That email looks off.' });
  for (const k of Object.keys(CHOICES)) if (!CHOICES[k].includes(b[k])) return send(res, 400, { error: 'Pick one in each row.' });
  if (b.consent !== true) return send(res, 400, { error: 'Tick the box so I can keep your email.' });
  const rec = { ts: new Date().toISOString(), email, use: b.use, role: b.role, interest: b.interest, consent: true, source: String(b.source || '').slice(0, 40) };
  fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.appendFileSync(WAITLIST_FILE, JSON.stringify(rec) + '\n');
  const prev = signups.get(email);
  const slot = prev ? prev.slot : signups.size + 1;
  signups.set(email, { slot, rec });
  send(res, 200, { slot, again: !!prev });
  toBrevo(rec);
}

// ---- Brevo ----------------------------------------------------------------
// The JSONL file stays the source of truth. Once a signup is saved, a copy
// goes to a Brevo contact list so the opening email can be sent from there.
// Fire and forget: the visitor never waits on Brevo, and a failure only
// leaves a line in .data/brevo.log (status and reason, never the key or
// the email). Without BREVO_API_KEY this does nothing.
//
//   BREVO_API_KEY   the API key (Brevo: SMTP & API, API keys)
//   BREVO_LIST_ID   the id of the waitlist list (Contacts, Lists)
//   BREVO_API_URL   optional, default https://api.brevo.com/v3 (tests point
//                   it at a local fake)
//
// Create these four contact attributes in Brevo first, all of type Text
// (Contacts, Settings, Contact attributes): USE, ROLE, INTEREST, SOURCE.
// A repeat signup updates the contact (updateEnabled).
const BREVO_URL = (process.env.BREVO_API_URL || 'https://api.brevo.com/v3').replace(/\/$/, '');
function brevoFail(why) {
  console.error('brevo: ' + why);
  try { fs.mkdirSync(DATA_DIR, { recursive: true }); fs.appendFileSync(path.join(DATA_DIR, 'brevo.log'), new Date().toISOString() + ' ' + why + '\n'); } catch (e) {}
}
function toBrevo(rec) {
  const key = process.env.BREVO_API_KEY;
  if (!key) return;
  const body = {
    email: rec.email,
    attributes: { USE: rec.use, ROLE: rec.role, INTEREST: rec.interest, SOURCE: rec.source },
    updateEnabled: true,
  };
  const list = Number(process.env.BREVO_LIST_ID);
  if (list) body.listIds = [list];
  fetch(BREVO_URL + '/contacts', {
    method: 'POST',
    headers: { 'api-key': key, 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(8000),
  }).then(async (r) => {
    // 201 created, 204 updated; anything else is worth a line in the log
    if (r.status === 201 || r.status === 204) return;
    let reason = '';
    try { const j = await r.json(); reason = (j.code || '') + ' ' + (j.message || ''); } catch (e) {}
    brevoFail('contacts answered ' + r.status + ': ' + reason.split(rec.email).join('<email>').slice(0, 300));
  }).catch((e) => brevoFail('request failed: ' + (e.name === 'TimeoutError' ? 'timeout' : e.message)));
}
function exportWaitlist(req, res, url) {
  const token = process.env.WAITLIST_TOKEN;
  if (!token || url.searchParams.get('token') !== token) return send(res, 401, 'unauthorized');
  const rows = [['slot', 'email', 'use', 'role', 'interest', 'ts', 'source']];
  [...signups.values()].sort((a, b) => a.slot - b.slot).forEach(({ slot, rec }) => rows.push([slot, rec.email, rec.use, rec.role, rec.interest, rec.ts, rec.source]));
  const csv = rows.map((r) => r.map((v) => '"' + String(v).replace(/"/g, '""') + '"').join(',')).join('\n');
  send(res, 200, csv, { 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': 'attachment; filename="bureau-waitlist.csv"' });
}

// ---- GitHub star count, cached so visitors never hit the rate limit -----
const stars = { count: null, at: 0 };
// Re-read the true count right after a star, at least `atLeast`.
async function freshStars(atLeast) {
  try {
    const headers = { 'User-Agent': 'bureau-site', Accept: 'application/vnd.github+json' };
    if (process.env.GITHUB_TOKEN) headers.Authorization = 'Bearer ' + process.env.GITHUB_TOKEN;
    const r = await fetch('https://api.github.com/repos/' + REPO, { headers });
    if (r.ok) stars.count = Math.max((await r.json()).stargazers_count, atLeast || 0);
    stars.at = Date.now();
  } catch (e) { /* keep what we had */ }
  return stars.count;
}
async function getStars(res) {
  if (Date.now() - stars.at > 10 * 60 * 1000) {
    stars.at = Date.now();
    try {
      const headers = { 'User-Agent': 'bureau-site', Accept: 'application/vnd.github+json' };
      if (process.env.GITHUB_TOKEN) headers.Authorization = 'Bearer ' + process.env.GITHUB_TOKEN;
      const r = await fetch('https://api.github.com/repos/' + REPO, { headers });
      if (r.ok) stars.count = (await r.json()).stargazers_count;
    } catch (e) { /* keep the last known count */ }
  }
  send(res, 200, { count: stars.count, starApp: !!(APP_ID && APP_SECRET) });
}

// ---- star without leaving (GitHub App, Starring permission only) --------
// The visitor's token is used once to star the repo, then dropped.
const states = new Map();
function githubLogin(res) {
  if (!APP_ID || !APP_SECRET) return send(res, 404, 'not configured');
  const state = crypto.randomBytes(16).toString('hex');
  states.set(state, Date.now());
  for (const [s, t] of states) if (Date.now() - t > 10 * 60 * 1000) states.delete(s);
  const q = new URLSearchParams({ client_id: APP_ID, state });
  if (process.env.SITE_PUBLIC_URL) q.set('redirect_uri', process.env.SITE_PUBLIC_URL.replace(/\/$/, '') + '/api/github/callback');
  res.writeHead(302, { Location: 'https://github.com/login/oauth/authorize?' + q, 'Cache-Control': 'no-store' });
  res.end();
}
function closePopup(res, result, count) {
  const text = result === 'ok' ? 'Starred. Thank you.' : result === 'already' ? 'Already starred. Thank you.' : 'That did not work. You can star on GitHub instead.';
  const msg = { bureauStar: result, count: typeof count === 'number' ? count : null };
  const html = '<!doctype html><meta charset="utf-8"><title>Bureau</title><body style="background:#1c1b22;color:#e8e6f0;font:16px system-ui">' +
    '<p style="padding:24px">' + text + '</p>' +
    '<script>try{opener.postMessage(' + JSON.stringify(msg) + ',location.origin)}catch(e){}setTimeout(function(){close()},700)</script>';
  send(res, 200, html, { 'Content-Type': 'text/html; charset=utf-8' });
}
// Failures are logged with GitHub's own reason (never the code or token),
// so a broken star flow can be diagnosed from the site log.
function starFail(res, why) {
  console.error('star flow failed: ' + why);
  try { fs.mkdirSync(DATA_DIR, { recursive: true }); fs.appendFileSync(path.join(DATA_DIR, 'star.log'), new Date().toISOString() + ' ' + why + '\n'); } catch (e) {}
  closePopup(res, 'fail');
}
async function githubCallback(res, url) {
  const state = url.searchParams.get('state'), code = url.searchParams.get('code');
  if (url.searchParams.get('error')) return starFail(res, 'github said ' + url.searchParams.get('error') + ': ' + url.searchParams.get('error_description'));
  if (!code) return starFail(res, 'no code in the callback');
  if (!state || !states.has(state)) return starFail(res, 'unknown or expired state (server restarted mid-flow?)');
  states.delete(state);
  try {
    const tok = await fetch('https://github.com/login/oauth/access_token', {
      method: 'POST',
      headers: { Accept: 'application/json', 'Content-Type': 'application/json', 'User-Agent': 'bureau-site' },
      body: JSON.stringify({ client_id: APP_ID, client_secret: APP_SECRET, code }),
    }).then((r) => r.json());
    if (!tok.access_token) return starFail(res, 'token exchange: ' + (tok.error || 'no token') + ' ' + (tok.error_description || ''));
    const gh = { Authorization: 'Bearer ' + tok.access_token, Accept: 'application/vnd.github+json', 'User-Agent': 'bureau-site', 'X-GitHub-Api-Version': '2022-11-28' };
    // Starring twice is a no-op on GitHub; ask first so the count never
    // goes up for a visitor who already starred.
    const had = await fetch('https://api.github.com/user/starred/' + REPO, { headers: gh });
    if (had.status === 204) return closePopup(res, 'already', await freshStars(0));
    const r = await fetch('https://api.github.com/user/starred/' + REPO, { method: 'PUT', headers: Object.assign({ 'Content-Length': '0' }, gh) });
    if (r.status !== 204) return starFail(res, 'star call answered ' + r.status + ': ' + (await r.text()).slice(0, 300));
    // GitHub's own count can lag a moment behind the star: never show less
    // than the count we had plus this one.
    const before = typeof stars.count === 'number' ? stars.count : 0;
    closePopup(res, 'ok', await freshStars(before + 1));
  } catch (e) { starFail(res, 'exception: ' + e.message); }
}

// ---- static files and caching -------------------------------------------
// Assets (scripts, styles, images, fonts) are cached for a day; HTML pages,
// robots and every /api/ route are no-store. Deploys keep file names, so
// the pages and stylesheets link assets as name?v=__V__ and the server
// swaps __V__ for ASSET_VERSION: a short hash of every asset's content,
// taken at start. A deploy that changes any asset (and restarts the
// server, as deploys do) changes the version, so there is nothing to bump
// by hand. Set ASSET_VERSION in the environment to pin it instead.
const CACHEABLE = new Set(['.js', '.css', '.svg', '.png', '.jpg', '.webp', '.ttf', '.woff2', '.ico']);
const VERSIONED = new Set(['.html', '.css', '.txt', '.xml', '.webmanifest']); // text files where __V__ and __SITE__ are replaced
function assetVersion() {
  const h = crypto.createHash('sha1');
  const files = Object.values(SHARED);
  for (const dir of [SITE, path.join(SITE, 'shots')]) {
    try { for (const f of fs.readdirSync(dir).sort()) files.push(path.join(dir, f)); } catch (e) {}
  }
  for (const f of files) {
    if (!CACHEABLE.has(path.extname(f)) || PRIVATE.has(path.basename(f))) continue;
    try { h.update(f).update(fs.readFileSync(f)); } catch (e) {}
  }
  return h.digest('hex').slice(0, 8);
}
const ASSET_VERSION = process.env.ASSET_VERSION || assetVersion();
// The public address, for the share preview tags and the canonical link
// (pages write it as __SITE__). Change it here when the domain moves.
const SITE_URL = 'https://www.getbureau.dev';
// Other addresses of the same site send visitors to SITE_URL for good. Only
// GET and HEAD move, so a form posted to an old address is never turned
// into a GET by the browser.
const REDIRECT_HOSTS = new Set(['getbureau.dev', 'getbureau.mathieu.dev']);
const versioned = new Map(); // file -> { mtime, body with the tokens replaced }
function resolve(urlPath) {
  if (SHARED[urlPath]) return SHARED[urlPath];
  let rel = urlPath === '/' ? 'index.html' : decodeURIComponent(urlPath).replace(/^\/+/, '').replace(/\/+$/, '');
  if (rel && !path.extname(rel)) rel += '.html'; // clean URLs: /inside serves inside.html
  const abs = path.normalize(path.join(SITE, rel));
  if (!abs.startsWith(SITE + path.sep)) return null; // no traversal
  if (PRIVATE.has(path.basename(abs)) || abs.startsWith(DATA_DIR) || rel.split(/[\\/]/).some((p) => p.startsWith('.'))) return null;
  if (rel.startsWith('i18n/') || rel.startsWith('tools/')) return null; // read by the server, not served
  return abs;
}
// Unknown pages get the empty-slot page; unknown API paths stay plain text.
const NOT_FOUND_PAGE = path.join(SITE, '404.html');
function notFound(res, pathname) {
  if (pathname.startsWith('/api/') || !fs.existsSync(NOT_FOUND_PAGE)) return send(res, 404, 'not found');
  sendFile(res, 404, NOT_FOUND_PAGE);
}
function sendFile(res, code, file) {
  const ext = path.extname(file);
  res.writeHead(code, {
    'Content-Type': MIME[ext] || 'application/octet-stream',
    'Cache-Control': CACHEABLE.has(ext) ? 'public, max-age=86400' : 'no-store',
  });
  if (!VERSIONED.has(ext)) return fs.createReadStream(file).pipe(res);
  const share = shareTexts();
  const mtime = fs.statSync(file).mtimeMs + '|' + share.mtime, hit = versioned.get(file);
  if (hit && hit.mtime === mtime) return res.end(hit.body);
  let body = fs.readFileSync(file, 'utf8').split('__V__').join(ASSET_VERSION).split('__SITE__').join(SITE_URL);
  if (body.includes('__FAQ_LD__')) body = body.replace('__FAQ_LD__', faqLd(body));
  body = fillShare(body, ext, share.texts);
  versioned.set(file, { mtime, body });
  res.end(body);
}

// ---- i18n: the site's texts, site/i18n/<lang>.json ------------------------------
// One object per section, keys starting with _ are notes. Pages say
// {{section.key}} where a text goes. English only for now; a translation is
// the same file under another language code. Read at start (an invalid file
// stops the boot, so a typo can't ship), re-read when it changes (an invalid
// save keeps the last good version and says so in the log).
const LANG = 'en';
const I18N_FILE = path.join(SITE, 'i18n', LANG + '.json');
function flatten(obj, prefix, out) {
  for (const [k, v] of Object.entries(obj)) {
    if (k.startsWith('_')) continue;
    if (v && typeof v === 'object' && !Array.isArray(v)) flatten(v, prefix + k + '.', out);
    else if (typeof v === 'string') out[prefix + k] = v;
  }
  return out;
}
function loadI18n() {
  const mtime = fs.statSync(I18N_FILE).mtimeMs;
  return { mtime, texts: flatten(JSON.parse(fs.readFileSync(I18N_FILE, 'utf8')), '', {}) };
}
let shareCache;
try { shareCache = loadI18n(); } catch (e) { console.error('site/i18n/' + LANG + '.json: ' + e.message); process.exit(1); }
function shareTexts() {
  let mtime;
  try { mtime = fs.statSync(I18N_FILE).mtimeMs; } catch (e) { return shareCache; }
  if (mtime === shareCache.mtime) return shareCache;
  try { shareCache = loadI18n(); } catch (e) { console.error('site/i18n/' + LANG + '.json is invalid, keeping the last good one: ' + e.message); shareCache.mtime = mtime; }
  return shareCache;
}
const escHtml = (s) => s.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
function fillShare(body, ext, texts) {
  return body.replace(/\{\{([\w-]+\.[\w-]+)\}\}/g, (m, key) => {
    if (!(key in texts)) { console.error('i18n/' + LANG + '.json has no ' + key); return m; }
    const v = texts[key];
    return ext === '.html' ? escHtml(v) : ext === '.webmanifest' ? JSON.stringify(v).slice(1, -1) : v;
  });
}

// ---- the questions, for search engines and AI assistants -------------------
// The FAQ is written once, as <details> in inside.html. Its structured data
// (FAQPage JSON-LD) and the plain-text copy in /llms-full.txt are both built
// from that markup when served, so they can never drift from the page.
const FAQ_RE = /<details id="([^"]+)"><summary>([\s\S]*?)<\/summary><div class="faq-a">([\s\S]*?)<\/div><\/details>/g;
const ENTITIES = { '&amp;': '&', '&lt;': '<', '&gt;': '>', '&quot;': '"', '&#39;': "'", '&nbsp;': ' ', '&middot;': '·', '&rarr;': '→', '&larr;': '←', '&times;': '×' };
function textOf(html) {
  return html.replace(/<[^>]+>/g, '').replace(/&[a-z#0-9]+;/g, (e) => ENTITIES[e] || e).replace(/\s+/g, ' ').trim();
}
function faqLd(html) {
  const qs = [...html.matchAll(FAQ_RE)].map((m) => ({
    '@type': 'Question', name: textOf(m[2]),
    acceptedAnswer: { '@type': 'Answer', text: textOf(m[3]) },
  }));
  return JSON.stringify({ '@context': 'https://schema.org', '@type': 'FAQPage', mainEntity: qs }).replace(/</g, '\\u003c');
}
// /llms-full.txt: llms.txt, then the whole of /inside as plain markdown.
function insideAsText() {
  const html = fs.readFileSync(path.join(SITE, 'inside.html'), 'utf8').split('__SITE__').join(SITE_URL);
  let main = (html.match(/<main>([\s\S]*?)<\/main>/) || ['', ''])[1];
  main = main
    .replace(/<form[\s\S]*?<\/form>/g, '').replace(/<figure[\s\S]*?<\/figure>/g, '').replace(/<button[\s\S]*?<\/button>/g, '')
    .replace(/<div class="faq-search">[\s\S]*?<\/div>/, '').replace(/<p class="faq-empty"[\s\S]*?<\/p>/, '')
    .replace(/<a [^>]*href="([^"#][^"]*)"[^>]*>([\s\S]*?)<\/a>/g, (m, href, t) => '[' + textOf(t) + '](' + (href.startsWith('/') ? SITE_URL + href : href) + ')')
    .replace(/<pre[^>]*><code>([\s\S]*?)<\/code><\/pre>/g, (m, c) => '\n```\n' + c.replace(/<[^>]+>/g, '') + '\n```\n')
    .replace(/<h1[^>]*>([\s\S]*?)<\/h1>/g, (m, t) => '\n# ' + textOf(t) + '\n')
    .replace(/<h2[^>]*>([\s\S]*?)<\/h2>/g, (m, t) => '\n## ' + textOf(t) + '\n')
    .replace(/<h3[^>]*>([\s\S]*?)<\/h3>/g, (m, t) => '\n### ' + textOf(t) + '\n')
    .replace(/<summary>([\s\S]*?)<\/summary>/g, (m, t) => '\n#### ' + textOf(t) + '\n')
    .replace(/<li>([\s\S]*?)<\/li>/g, (m, t) => '- ' + textOf(t) + '\n')
    .replace(/<p[^>]*>([\s\S]*?)<\/p>/g, (m, t) => '\n' + textOf(t) + '\n')
    .replace(/<div><b>([\s\S]*?)<\/b><span>([\s\S]*?)<\/span><\/div>/g, (m, a, b) => '- ' + textOf(a) + ': ' + textOf(b) + '\n')
    .replace(/<[^>]+>/g, '').replace(/&[a-z#0-9]+;/g, (e) => ENTITIES[e] || e)
    .split('\n').map((l) => l.trim()).join('\n').replace(/\n{3,}/g, '\n\n').trim();
  return main;
}
let llmsFull = null;
function getLlmsFull(res) {
  const files = [path.join(SITE, 'llms.txt'), path.join(SITE, 'inside.html')];
  const key = files.map((f) => fs.statSync(f).mtimeMs).join('|');
  if (!llmsFull || llmsFull.key !== key) {
    const head = fs.readFileSync(files[0], 'utf8').split('__SITE__').join(SITE_URL).trim();
    llmsFull = { key, body: head + '\n\n---\n\n# The full page (' + SITE_URL + '/inside), as text\n\n' + insideAsText() + '\n' };
  }
  res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(llmsFull.body);
}
// ---- /mcp: the public, read-only MCP server about Bureau (mcp.js) ---------
// The product version comes from the hub's version.js when it sits next to
// the site (the repo, and the deploy, which syncs it), else the last release.
let PRODUCT_VERSION = '0.2.0';
try { PRODUCT_VERSION = require('../hub/version.js').VERSION; } catch (e) {}
const mcp = require('./mcp.js')({ SITE, SITE_URL, textOf, FAQ_RE, insideAsText, version: PRODUCT_VERSION });
const MCP_CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, GET, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Accept, Authorization, MCP-Protocol-Version, Mcp-Method, Mcp-Name, Mcp-Session-Id, Last-Event-ID',
  'Access-Control-Expose-Headers': 'Mcp-Session-Id',
};
const mcpCalls = new Map(); // ip -> timestamps: 120 calls a minute is plenty for a reader
function mcpLimited(ip) {
  const now = Date.now(), list = (mcpCalls.get(ip) || []).filter((t) => now - t < 60 * 1000);
  list.push(now); mcpCalls.set(ip, list);
  if (mcpCalls.size > 5000) mcpCalls.clear();
  return list.length > 120;
}
async function serveMcp(req, res) {
  if (req.method === 'OPTIONS') { res.writeHead(204, MCP_CORS); return res.end(); }
  if (req.method !== 'POST') {
    // No server-sent stream: this server never pushes. A browser landing
    // here gets a line on what this is.
    res.writeHead(405, Object.assign({ Allow: 'POST, OPTIONS', 'Content-Type': 'application/json' }, MCP_CORS));
    return res.end(JSON.stringify({ name: 'getbureau', about: 'Public, read-only MCP server about Bureau. POST JSON-RPC here (Streamable HTTP).', docs: SITE_URL + '/inside#faq' }));
  }
  const reply = (code, body) => { res.writeHead(code, Object.assign({ 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }, MCP_CORS)); res.end(body === null ? '' : JSON.stringify(body)); };
  if (mcpLimited(clientIp(req))) return reply(429, { jsonrpc: '2.0', id: null, error: { code: -32000, message: 'too many requests, slow down' } });
  let msg;
  try { msg = await readJson(req, 64 * 1024); } catch (e) { return reply(400, { jsonrpc: '2.0', id: null, error: { code: -32700, message: 'parse error' } }); }
  const out = mcp.handle(msg, req.headers);
  if (out.body === null) { res.writeHead(202, MCP_CORS); return res.end(); } // notifications only
  reply(out.status, out.body);
}

// ---- markdown versions of the pages, for agents ----------------------------
// llms.txt v2 (llmstxt.org) points agents at page.md versions; some clients
// ask for markdown with Accept: text/markdown instead. Both get the same text.
const MARKDOWN = { '/index.md': 'home', '/inside.md': 'inside' };
const MARKDOWN_OF = { '/': 'home', '/inside': 'inside' };
function wantsMarkdown(req) {
  const a = String(req.headers.accept || '');
  // only when markdown is asked for ahead of HTML, never for a browser
  return /text\/markdown/.test(a) && (!/text\/html/.test(a) || a.indexOf('text/markdown') < a.indexOf('text/html'));
}
function sendMarkdown(res, which) {
  let body;
  try {
    const llms = fs.readFileSync(path.join(SITE, 'llms.txt'), 'utf8').split('__SITE__').join(SITE_URL).trim();
    body = which === 'home' ? llms : '# Bureau: features, roadmap and FAQ\n\nSource: ' + SITE_URL + '/inside\n\n' + insideAsText() + '\n';
  } catch (e) { return send(res, 500, 'markdown unavailable'); }
  res.writeHead(200, { 'Content-Type': 'text/markdown; charset=utf-8', 'Cache-Control': 'no-store', Vary: 'Accept', 'X-Markdown-Tokens': String(Math.round(body.length / 4)) });
  res.end(body);
}
// The sitemap, with each page's last change taken from its file.
function sendSitemap(res) {
  const pages = [['/', 'index.html', '1.0'], ['/inside', 'inside.html', '0.9'], ['/privacy', 'privacy.html', '0.3'], ['/llms.txt', 'llms.txt', '0.5'], ['/llms-full.txt', 'inside.html', '0.4']];
  const urls = pages.map(([loc, file, pri]) => {
    let mod = '';
    try { mod = '<lastmod>' + fs.statSync(path.join(SITE, file)).mtime.toISOString().slice(0, 10) + '</lastmod>'; } catch (e) {}
    return '  <url><loc>' + SITE_URL + loc + '</loc>' + mod + '<priority>' + pri + '</priority></url>';
  });
  res.writeHead(200, { 'Content-Type': 'application/xml; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end('<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n' + urls.join('\n') + '\n</urlset>\n');
}

// Public proofs of ownership. Both values are public by design: the MCP
// Registry checks the ed25519 public key (the private half lives in
// ~/.config/getbureau on the publisher's machine), and IndexNow checks that
// the key in a ping is served from the site.
const INDEXNOW_KEY = '7c88e4e9ff376587e120760c193c2e83';
const PROOFS = {
  '/.well-known/mcp-registry-auth': 'v=MCPv1; k=ed25519; p=+l5rX4eVJ3P94rVH6jaaV0l0wpoo8kkhObEqhZeJSt8=',
  ['/' + INDEXNOW_KEY + '.txt']: INDEXNOW_KEY,
};

// ---- the MCP server card (proposal SEP-2127, not yet in the spec) -------------
// So a client that only knows the domain can find /mcp: a list of cards at
// /.well-known/mcp/server-cards.json, and the single card at server-card.json
// (the path early adopters serve). Built from mcp-registry.json and mcp.js,
// so it says exactly what the registry and the server say.
function serverCard() {
  const reg = JSON.parse(fs.readFileSync(path.join(SITE, 'mcp-registry.json'), 'utf8'));
  const card = {
    name: reg.name, title: reg.title, description: reg.description, version: reg.version,
    websiteUrl: reg.websiteUrl, repository: reg.repository,
    icons: [{ src: SITE_URL + '/icon-512.png', mimeType: 'image/png', sizes: ['512x512'] }],
    remotes: reg.remotes.map((r) => Object.assign({}, r, { supportedProtocolVersions: mcp.SUPPORTED })),
    capabilities: { tools: { listChanged: false }, resources: { listChanged: false } },
    tools: mcp.TOOLS, resources: mcp.RESOURCES, prompts: [],
  };
  delete card.$schema;
  return card;
}
function sendCard(res, list) {
  let body;
  try { const card = serverCard(); body = JSON.stringify(list ? [card] : card, null, 1); } catch (e) { return send(res, 500, 'server card unavailable'); }
  res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'public, max-age=3600', 'Access-Control-Allow-Origin': '*' });
  res.end(body);
}

// Short addresses for the two sections people link to.
const ALIASES = { '/faq': '/inside#faq', '/roadmap': '/inside#roadmap' };
function serveStatic(res, pathname) {
  let file;
  try { file = resolve(pathname); } catch (e) { file = null; } // a malformed %-escape is a 404, not a crash
  if (!file || !fs.existsSync(file) || fs.statSync(file).isDirectory()) return notFound(res, pathname);
  sendFile(res, 200, file);
}

// ---- routes ---------------------------------------------------------------
loadWaitlist();
http.createServer((req, res) => {
  // Proof files for directories and search engines, answered on every host
  // (the registry checks getbureau.dev itself, before any redirect).
  const bare = req.url.split('?')[0], proof = PROOFS[bare];
  if (proof && (req.method === 'GET' || req.method === 'HEAD')) {
    res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'public, max-age=3600' });
    return res.end(proof);
  }
  if (req.method === 'GET' || req.method === 'HEAD') {
    if (bare === '/.well-known/mcp/server-cards.json') return sendCard(res, true);
    if (bare === '/.well-known/mcp/server-card.json') return sendCard(res, false);
  }
  const host = String(req.headers.host || '').toLowerCase().replace(/:\d+$/, '');
  if (REDIRECT_HOSTS.has(host) && (req.method === 'GET' || req.method === 'HEAD')) {
    res.writeHead(301, { Location: SITE_URL + req.url, 'Cache-Control': 'public, max-age=3600' });
    return res.end();
  }
  const url = new URL(req.url, 'http://local');
  const p = url.pathname;
  if (req.method === 'POST' && p === '/api/waitlist') return postWaitlist(req, res);
  if (req.method === 'GET' && p === '/api/waitlist/export') return exportWaitlist(req, res, url);
  if (req.method === 'GET' && p === '/api/stars') return getStars(res);
  if (req.method === 'GET' && p === '/api/github/login') return githubLogin(res);
  if (req.method === 'GET' && p === '/api/github/callback') return githubCallback(res, url);
  if (p === '/mcp') return serveMcp(req, res);
  if (req.method !== 'GET' && req.method !== 'HEAD') return send(res, 405, 'method not allowed');
  if (ALIASES[p]) { res.writeHead(301, { Location: ALIASES[p], 'Cache-Control': 'public, max-age=3600' }); return res.end(); }
  // One address per page: /index.html and /inside.html move to / and /inside.
  if (/^\/[\w-]+\.html$/.test(p) && p !== '/404.html') {
    const clean = p === '/index.html' ? '/' : p.slice(0, -5);
    res.writeHead(301, { Location: clean + url.search, 'Cache-Control': 'public, max-age=3600' });
    return res.end();
  }
  if (p === '/llms-full.txt') { try { return getLlmsFull(res); } catch (e) { return notFound(res, p); } }
  if (p === '/sitemap.xml') return sendSitemap(res);
  // Markdown for agents: /index.md and /inside.md, or the page itself when
  // a client asks for markdown (Accept: text/markdown).
  const md = MARKDOWN[p] || (wantsMarkdown(req) && MARKDOWN_OF[p]);
  if (md) return sendMarkdown(res, md);
  serveStatic(res, p);
}).listen(PORT, HOST, () => {
  console.log(`Bureau site on http://localhost:${PORT} (${signups.size} on the waitlist)`);
  for (const list of Object.values(os.networkInterfaces())) {
    for (const i of list || []) if (i.family === 'IPv4' && !i.internal) console.log(`  phone: http://${i.address}:${PORT}`);
  }
});

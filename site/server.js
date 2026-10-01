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
//   GITHUB_APP_CLIENT_ID, GITHUB_APP_CLIENT_SECRET, SITE_PUBLIC_URL
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
const PRIVATE = new Set(['server.js', 'start.sh']);
const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json', '.svg': 'image/svg+xml',
  '.png': 'image/png', '.ttf': 'font/ttf', '.woff2': 'font/woff2', '.ico': 'image/x-icon',
  '.jpg': 'image/jpeg', '.webp': 'image/webp',
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

// ---- static files -------------------------------------------------------
function resolve(urlPath) {
  if (SHARED[urlPath]) return SHARED[urlPath];
  let rel = urlPath === '/' ? 'index.html' : decodeURIComponent(urlPath).replace(/^\/+/, '').replace(/\/+$/, '');
  if (rel && !path.extname(rel)) rel += '.html'; // clean URLs: /inside serves inside.html
  const abs = path.normalize(path.join(SITE, rel));
  if (!abs.startsWith(SITE + path.sep)) return null; // no traversal
  if (PRIVATE.has(path.basename(abs)) || abs.startsWith(DATA_DIR) || rel.split(/[\\/]/).some((p) => p.startsWith('.'))) return null;
  return abs;
}
// Unknown pages get the empty-slot page; unknown API paths stay plain text.
const NOT_FOUND_PAGE = path.join(SITE, '404.html');
function notFound(res, pathname) {
  if (pathname.startsWith('/api/') || !fs.existsSync(NOT_FOUND_PAGE)) return send(res, 404, 'not found');
  res.writeHead(404, { 'Content-Type': MIME['.html'], 'Cache-Control': 'no-store' });
  fs.createReadStream(NOT_FOUND_PAGE).pipe(res);
}
function serveStatic(res, pathname) {
  let file;
  try { file = resolve(pathname); } catch (e) { file = null; } // a malformed %-escape is a 404, not a crash
  if (!file || !fs.existsSync(file) || fs.statSync(file).isDirectory()) return notFound(res, pathname);
  res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-store' });
  fs.createReadStream(file).pipe(res);
}

// ---- routes ---------------------------------------------------------------
loadWaitlist();
http.createServer((req, res) => {
  const url = new URL(req.url, 'http://local');
  const p = url.pathname;
  if (req.method === 'POST' && p === '/api/waitlist') return postWaitlist(req, res);
  if (req.method === 'GET' && p === '/api/waitlist/export') return exportWaitlist(req, res, url);
  if (req.method === 'GET' && p === '/api/stars') return getStars(res);
  if (req.method === 'GET' && p === '/api/github/login') return githubLogin(res);
  if (req.method === 'GET' && p === '/api/github/callback') return githubCallback(res, url);
  if (req.method !== 'GET' && req.method !== 'HEAD') return send(res, 405, 'method not allowed');
  serveStatic(res, p);
}).listen(PORT, HOST, () => {
  console.log(`Bureau site on http://localhost:${PORT} (${signups.size} on the waitlist)`);
  for (const list of Object.values(os.networkInterfaces())) {
    for (const i of list || []) if (i.family === 'IPv4' && !i.internal) console.log(`  phone: http://${i.address}:${PORT}`);
  }
});

// site/stats.js: what the site counts about its own traffic, and the private
// dashboard at /stats. No cookies, no script, nothing kept per person: the
// server counts what it already sees (the page asked for, the site that sent
// the visitor, the country Cloudflare reports, the kind of device, which bot
// it is) into daily totals. Unique visitors are counted with a one-way code of
// IP and browser that changes every day and only lives in memory.
//
// Stored in SQLite (node:sqlite, built into Node): one table of daily
// counters, site/.data/stats.db. Each request adds to its counters right
// away, so a crash loses nothing. Without node:sqlite, stats switch off and
// the site carries on.
'use strict';
const path = require('path');
const crypto = require('crypto');
const fs = require('fs');

// Crawlers and fetchers worth naming. Order matters: the first match wins.
const BOTS = [
  ['OAI-SearchBot', /OAI-SearchBot/i], ['ChatGPT-User', /ChatGPT-User/i], ['GPTBot', /GPTBot/i],
  ['Claude-SearchBot', /Claude-SearchBot/i], ['Claude-User', /Claude-User/i], ['ClaudeBot', /ClaudeBot|anthropic-ai/i],
  ['PerplexityBot', /PerplexityBot/i], ['Perplexity-User', /Perplexity-User/i],
  ['meta-webindexer', /meta-webindexer/i], ['meta-externalagent', /meta-externalagent/i], ['meta-externalfetcher', /meta-externalfetcher/i], ['facebookexternalhit', /facebookexternalhit/i],
  ['Googlebot', /Googlebot/i], ['Google-Extended', /Google-Extended/i], ['Bingbot', /bingbot/i], ['Applebot', /Applebot/i],
  ['DuckAssistBot', /DuckAssistBot/i], ['MistralAI-User', /MistralAI/i], ['CCBot', /CCBot/i], ['Bytespider', /Bytespider/i], ['Amazonbot', /Amazonbot/i],
  ['LinkedInBot', /LinkedInBot/i], ['Twitterbot', /Twitterbot/i], ['Slackbot', /Slackbot/i], ['Discordbot', /Discordbot/i], ['WhatsApp', /WhatsApp/i], ['TelegramBot', /TelegramBot/i],
  ['other bot', /bot|crawl|spider|slurp|curl|wget|python|node-fetch|go-http|axios|headless|scrapy|httpclient|java\//i],
];
const AI_BOTS = new Set(['OAI-SearchBot', 'ChatGPT-User', 'GPTBot', 'Claude-SearchBot', 'Claude-User', 'ClaudeBot', 'PerplexityBot', 'Perplexity-User', 'meta-webindexer', 'meta-externalagent', 'meta-externalfetcher', 'Google-Extended', 'DuckAssistBot', 'MistralAI-User', 'CCBot', 'Bytespider', 'Amazonbot']);
// Pages people read; files agents read.
const PAGES = new Set(['/', '/inside', '/privacy']);
const FOR_AGENTS = new Set(['/llms.txt', '/llms-full.txt', '/index.md', '/inside.md', '/robots.txt', '/sitemap.xml', '/.well-known/mcp/server-cards.json', '/.well-known/mcp/server-card.json']);
const KEEP_DAYS = 400;

module.exports = function makeStats({ DATA_DIR, SITE_URL }) {
  let db = null, up = null;
  try {
    const { DatabaseSync } = require('node:sqlite');
    fs.mkdirSync(DATA_DIR, { recursive: true });
    db = new DatabaseSync(path.join(DATA_DIR, 'stats.db'));
    db.exec(`PRAGMA journal_mode = WAL;
      CREATE TABLE IF NOT EXISTS counts (
        day TEXT NOT NULL,      -- YYYY-MM-DD, UTC
        metric TEXT NOT NULL,   -- total, page, referrer, country, device, bot, botpath, agentfile, mcp-method, mcp-tool, mcp-client
        key TEXT NOT NULL,      -- what was counted: a path, a host, a bot name...
        n INTEGER NOT NULL,
        PRIMARY KEY (day, metric, key)
      ) WITHOUT ROWID;`);
    up = db.prepare('INSERT INTO counts (day, metric, key, n) VALUES (?, ?, ?, ?) ON CONFLICT (day, metric, key) DO UPDATE SET n = n + excluded.n');
  } catch (e) {
    console.error('stats: off (' + e.message + ')');
  }

  const today = () => new Date().toISOString().slice(0, 10);
  let pruned = '';
  function inc(metric, key, n) {
    if (!up) return;
    const d = today();
    try {
      up.run(d, metric, String(key).slice(0, 120), n || 1);
      if (pruned !== d) { // once a day, drop what's older than KEEP_DAYS
        pruned = d;
        db.prepare('DELETE FROM counts WHERE day < ?').run(new Date(Date.now() - KEEP_DAYS * 864e5).toISOString().slice(0, 10));
      }
    } catch (e) { console.error('stats: ' + e.message); }
  }

  // the daily code for unique visitors: a fresh random salt each day, never saved
  let saltDay = '', salt = '', seen = new Set();
  function newVisitor(req, ua) {
    const d = today();
    if (d !== saltDay) { saltDay = d; salt = crypto.randomBytes(16).toString('hex'); seen = new Set(); }
    const ip = (req.headers['cf-connecting-ip'] || req.headers['x-forwarded-for'] || '').split(',')[0].trim() || req.socket.remoteAddress || '';
    const id = crypto.createHash('sha256').update(salt + ip + ua).digest('hex').slice(0, 16);
    if (seen.has(id)) return false;
    seen.add(id);
    return true;
  }
  function botName(ua) {
    if (!ua) return 'other bot';
    for (const [name, re] of BOTS) if (re.test(ua)) return name;
    return null;
  }
  const ownHost = new URL(SITE_URL).hostname.replace(/^www\./, '');
  function referrer(req) {
    const r = req.headers.referer || req.headers.referrer;
    if (!r) return '(direct)';
    try { const h = new URL(r).hostname.replace(/^www\./, ''); return h === ownHost ? '(direct)' : h; } catch (e) { return '(direct)'; }
  }

  // Called for every request; counts only what is worth counting.
  function request(req, pathname) {
    if (req.method !== 'GET' && req.method !== 'HEAD') return;
    const isPage = PAGES.has(pathname), forAgents = FOR_AGENTS.has(pathname);
    if (!isPage && !forAgents) return;
    const ua = String(req.headers['user-agent'] || ''), bot = botName(ua);
    if (bot) { inc('bot', bot); inc('botpath', bot + ' ' + pathname); return; }
    if (forAgents) { inc('agentfile', pathname); return; }
    inc('total', 'views');
    inc('page', pathname);
    if (newVisitor(req, ua)) inc('total', 'visitors');
    inc('referrer', referrer(req));
    inc('country', req.headers['cf-ipcountry'] || '??');
    inc('device', /Mobi|Android|iPhone|iPad/i.test(ua) ? 'mobile' : 'desktop');
  }
  function mcp(req, msg) {
    for (const m of Array.isArray(msg) ? msg : [msg]) {
      if (!m || typeof m.method !== 'string' || m.id === undefined) continue;
      inc('total', 'mcp');
      inc('mcp-method', m.method);
      const p = m.params || {};
      if (m.method === 'tools/call' && p.name) inc('mcp-tool', p.name);
      const info = p.clientInfo || (p._meta && p._meta['io.modelcontextprotocol/clientInfo']);
      if (info && info.name && (m.method === 'initialize' || m.method === 'server/discover')) inc('mcp-client', info.name);
    }
  }
  function signup() { inc('total', 'signups'); }

  // ---- the dashboard -------------------------------------------------------
  function top(metric, from, to, limit) {
    return db.prepare('SELECT key, SUM(n) AS n FROM counts WHERE metric = ? AND day BETWEEN ? AND ? GROUP BY key ORDER BY n DESC LIMIT ?').all(metric, from, to, limit || 12).map((r) => [r.key, r.n]);
  }
  function total(key, from, to) {
    return db.prepare("SELECT COALESCE(SUM(n), 0) AS n FROM counts WHERE metric = 'total' AND key = ? AND day BETWEEN ? AND ?").get(key, from, to).n;
  }
  const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  function table(title, rows, note) {
    const peak = rows.length ? rows[0][1] : 1;
    return `<section><h2>${title}</h2>${note ? `<p class="note">${note}</p>` : ''}${rows.length ? `<table>${rows.map(([k, v]) =>
      `<tr><td>${esc(k)}</td><td class="n">${v}</td><td class="bar"><i style="width:${Math.max(2, Math.round(v / peak * 100))}%"></i></td></tr>`).join('')}</table>` : '<p class="note">Nothing yet.</p>'}</section>`;
  }
  function page(span, extra) {
    if (!db) return '<p>Stats are off on this server (no node:sqlite).</p>';
    const range = [];
    for (let i = span - 1; i >= 0; i--) range.push(new Date(Date.now() - i * 864e5).toISOString().slice(0, 10));
    const from = range[0], to = range[range.length - 1];
    const series = {};
    for (const r of db.prepare("SELECT day, key, n FROM counts WHERE metric = 'total' AND key IN ('views', 'visitors') AND day BETWEEN ? AND ?").all(from, to)) {
      (series[r.day] = series[r.day] || {})[r.key] = r.n;
    }
    const peak = Math.max(1, ...range.map((d) => (series[d] && series[d].views) || 0));
    const chart = range.map((d) => {
      const v = (series[d] && series[d].views) || 0, u = (series[d] && series[d].visitors) || 0;
      return `<div class="col" title="${d}: ${v} views, ${u} visitors"><i class="v" style="height:${v / peak * 100}%"></i><i class="u" style="height:${u / peak * 100}%"></i></div>`;
    }).join('');
    const bots = top('bot', from, to, 60);
    const aiBots = bots.filter(([b]) => AI_BOTS.has(b)), otherBots = bots.filter(([b]) => !AI_BOTS.has(b));
    const spans = [1, 7, 30, 90].map((n) => `<a href="?token=${encodeURIComponent(extra.token)}&days=${n}"${n === span ? ' class="on"' : ''}>${n === 1 ? 'Today' : n + ' days'}</a>`).join('');
    return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex">
<title>Bureau site stats</title><style>
  :root { --bg: #f3f1ea; --panel: #fff; --fg: #1d1c22; --muted: #5d5a68; --line: #d9d5c8; --v: #306230; --u: #8bac0f; }
  @media (prefers-color-scheme: dark) { :root { --bg: #1c1b22; --panel: #262430; --fg: #ecebf2; --muted: #a8a5b8; --line: #3d3a4a; --v: #8bac0f; --u: #306230; } }
  body { margin: 0; background: var(--bg); color: var(--fg); font: 15px/1.5 system-ui, -apple-system, sans-serif; }
  main { max-width: 1080px; margin: 0 auto; padding: 24px 16px 60px; }
  h1 { font-size: 22px; margin: 0 0 4px; } h2 { font-size: 15px; margin: 0 0 8px; }
  .spans { display: flex; gap: 6px; margin: 12px 0 20px; flex-wrap: wrap; }
  .spans a { padding: 5px 12px; border: 1px solid var(--line); border-radius: 6px; color: var(--fg); text-decoration: none; }
  .spans a.on { background: var(--fg); color: var(--bg); }
  .kpis { display: grid; grid-template-columns: repeat(auto-fit, minmax(150px, 1fr)); gap: 10px; margin-bottom: 18px; }
  .kpi { background: var(--panel); border: 1px solid var(--line); border-radius: 8px; padding: 12px 14px; }
  .kpi b { display: block; font-size: 26px; } .kpi span { color: var(--muted); font-size: 13px; }
  .chart { display: flex; align-items: flex-end; gap: 2px; height: 140px; background: var(--panel); border: 1px solid var(--line); border-radius: 8px; padding: 12px; margin-bottom: 6px; }
  .col { flex: 1; height: 100%; position: relative; } .col i { position: absolute; bottom: 0; left: 0; right: 0; } .col .v { background: var(--v); } .col .u { background: var(--u); left: 30%; right: 30%; }
  .legend { color: var(--muted); font-size: 13px; margin-bottom: 18px; }
  .grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(320px, 1fr)); gap: 12px; }
  section { background: var(--panel); border: 1px solid var(--line); border-radius: 8px; padding: 14px; }
  table { width: 100%; border-collapse: collapse; } td { padding: 3px 0; font-size: 14px; word-break: break-all; } td.n { text-align: right; padding: 3px 10px; font-variant-numeric: tabular-nums; width: 1%; white-space: nowrap; word-break: normal; }
  td.bar { width: 35%; } td.bar i { display: block; height: 8px; border-radius: 4px; background: var(--u); }
  .note { color: var(--muted); font-size: 13px; margin: 0 0 8px; }
</style></head><body><main>
<h1>getbureau.dev</h1><p class="note">Counted on the server: no cookies, no script, nothing kept per person. People only in the views; bots counted apart. Days in UTC.</p>
<nav class="spans">${spans}</nav>
<div class="kpis">
  <div class="kpi"><b>${total('views', from, to)}</b><span>page views</span></div>
  <div class="kpi"><b>${total('visitors', from, to)}</b><span>visitors (unique per day)</span></div>
  <div class="kpi"><b>${total('signups', from, to)}</b><span>waitlist signups</span></div>
  <div class="kpi"><b>${extra.stars == null ? '--' : extra.stars}</b><span>GitHub stars (now)</span></div>
  <div class="kpi"><b>${aiBots.reduce((n, [, v]) => n + v, 0)}</b><span>AI crawler requests</span></div>
  <div class="kpi"><b>${total('mcp', from, to)}</b><span>MCP calls</span></div>
</div>
<div class="chart">${chart}</div><p class="legend">Per day: dark bar, page views; light bar, visitors.</p>
<div class="grid">
  ${table('Pages', top('page', from, to))}
  ${table('Where they came from', top('referrer', from, to))}
  ${table('Countries', top('country', from, to), 'From Cloudflare.')}
  ${table('Devices', top('device', from, to))}
  ${table('AI crawlers and assistants', aiBots)}
  ${table('Other bots (search, link previews, scripts)', otherBots)}
  ${table('What the bots read', top('botpath', from, to, 15))}
  ${table('Files for agents, read by people or unnamed clients', top('agentfile', from, to))}
  ${table('MCP tools called', top('mcp-tool', from, to))}
  ${table('MCP clients', top('mcp-client', from, to), 'The name each assistant gives when it connects.')}
</div></main></body></html>`;
  }

  return { request, mcp, signup, page, enabled: !!db };
};

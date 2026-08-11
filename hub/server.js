// Agent HQ — coordination hub for AI agents. Zero-dependency Node server.
// API + SSE event stream + dashboard. Deployable on alwaysdata (Node.js site).
'use strict';
const http = require('http');
const fs = require('fs');
const path = require('path');
const store = require('./lib/store');
const knowledge = require('./lib/knowledge');
const discord = require('./lib/discord');

const PORT = process.env.PORT || 8100;
const HOST = process.env.HOST || '::';           // alwaysdata expects IPv6 bind
const TOKEN = process.env.HQ_TOKEN || '';
if (!TOKEN) console.warn('⚠️  HQ_TOKEN not set — API is UNPROTECTED. Set it in production.');

// ---------- SSE ----------
const sseClients = new Set();
function broadcast(type, data) {
  store.logEvent(type, summarize(type, data));
  discord.mirror(type, data);
  const payload = `event: ${type}\ndata: ${JSON.stringify(data)}\n\n`;
  for (const res of sseClients) { try { res.write(payload); } catch { sseClients.delete(res); } }
}
function summarize(type, d) {
  // keep the persisted activity log compact
  return {
    id: d.id, name: d.name, title: d.title, assignee: d.assignee, status: d.status,
    from: d.from, to: d.to, file: d.file, author: d.author, note: d.note, kind: d.kind,
    body: typeof d.body === 'string' ? d.body.slice(0, 300) : undefined,
  };
}

// ---------- helpers ----------
function send(res, code, obj) {
  const body = JSON.stringify(obj, null, 1);
  res.writeHead(code, { 'content-type': 'application/json', 'access-control-allow-origin': '*' });
  res.end(body);
}
function readBody(req) {
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', c => { data += c; if (data.length > 2e6) { reject(new Error('body too large')); req.destroy(); } });
    req.on('end', () => { try { resolve(data ? JSON.parse(data) : {}); } catch { reject(new Error('invalid JSON')); } });
    req.on('error', reject);
  });
}
function authed(req, url) {
  if (!TOKEN) return true;
  const h = req.headers['authorization'] || '';
  if (h === `Bearer ${TOKEN}`) return true;
  if (url.searchParams.get('token') === TOKEN) return true; // for SSE/browser
  return false;
}

// ---------- routing ----------
const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://x');
  const p = url.pathname;

  try {
    // Static dashboard (no token needed to load the shell; API calls need it)
    if (req.method === 'GET' && (p === '/' || p === '/index.html')) {
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
      return res.end(fs.readFileSync(path.join(__dirname, 'public', 'index.html')));
    }
    if (p === '/health') return send(res, 200, { ok: true, uptime: process.uptime() });

    if (!p.startsWith('/api/')) return send(res, 404, { error: 'not found' });
    if (!authed(req, url)) return send(res, 401, { error: 'unauthorized' });

    // ----- SSE stream -----
    if (req.method === 'GET' && p === '/api/events') {
      res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache', connection: 'keep-alive', 'access-control-allow-origin': '*' });
      res.write('retry: 3000\n\n');
      sseClients.add(res);
      req.on('close', () => sseClients.delete(res));
      return;
    }

    // ----- snapshot for dashboard -----
    if (req.method === 'GET' && p === '/api/state') {
      store.expireLeases();
      const s = store.load();
      return send(res, 200, {
        agents: s.agents, tasks: s.tasks,
        log: s.log.slice(-200),
        brain: { recent: knowledge.recentCommits(15) },
        now: new Date().toISOString(),
      });
    }

    // ----- agents -----
    if (req.method === 'POST' && p === '/api/agents/register') {
      const b = await readBody(req);
      if (!b.name) return send(res, 400, { error: 'name required' });
      const a = store.upsertAgent(b);
      broadcast('agent.registered', a);
      return send(res, 200, { agent: a });
    }
    if (req.method === 'POST' && p === '/api/agents/heartbeat') {
      const b = await readBody(req);
      const a = store.heartbeat(b.name, b.note);
      if (!a) return send(res, 404, { error: 'unknown agent; register first' });
      broadcast('agent.heartbeat', a);
      return send(res, 200, { agent: a });
    }

    // ----- tasks -----
    if (req.method === 'GET' && p === '/api/tasks') {
      store.expireLeases();
      let tasks = store.load().tasks;
      const status = url.searchParams.get('status');
      const assignee = url.searchParams.get('assignee');
      if (status) tasks = tasks.filter(t => t.status === status);
      if (assignee) tasks = tasks.filter(t => t.assignee === assignee);
      return send(res, 200, { tasks });
    }
    if (req.method === 'POST' && p === '/api/tasks') {
      const b = await readBody(req);
      if (!b.title) return send(res, 400, { error: 'title required' });
      const t = store.createTask(b);
      broadcast('task.created', t);
      return send(res, 200, { task: t });
    }
    if (req.method === 'POST' && p === '/api/tasks/claim') {
      const b = await readBody(req);
      if (!b.agent) return send(res, 400, { error: 'agent required' });
      const r = store.claimTask(b);
      if (r.error) return send(res, 409, r);
      store.upsertAgent({ name: b.agent });
      broadcast('task.claimed', r.task);
      return send(res, 200, r);
    }
    const mTask = p.match(/^\/api\/tasks\/(t-\d+)$/);
    if (req.method === 'PATCH' && mTask) {
      const b = await readBody(req);
      const r = store.updateTask({ ...b, id: mTask[1] });
      if (r.error) return send(res, r.error === 'not_found' ? 404 : 400, r);
      const evt = { done: 'task.done', failed: 'task.failed', review: 'task.review' }[b.status] || 'task.updated';
      broadcast(evt, { ...r.task, note: b.note });
      return send(res, 200, r);
    }

    // ----- messages -----
    if (req.method === 'POST' && p === '/api/messages') {
      const b = await readBody(req);
      if (!b.from || !b.body) return send(res, 400, { error: 'from and body required' });
      const m = store.postMessage(b);
      broadcast(b.from === 'human' ? 'message.human' : 'message.posted', m);
      return send(res, 200, { message: m });
    }
    if (req.method === 'GET' && p === '/api/messages') {
      const msgs = store.getMessages({ forAgent: url.searchParams.get('for'), since: url.searchParams.get('since') });
      return send(res, 200, { messages: msgs.slice(-200) });
    }

    // ----- knowledge (the brain) -----
    if (req.method === 'POST' && p === '/api/knowledge') {
      const b = await readBody(req);
      if (!b.file || b.content === undefined) return send(res, 400, { error: 'file and content required' });
      const r = knowledge.writeKnowledge(b);
      broadcast('knowledge.written', { ...r, author: b.author || 'agent' });
      return send(res, 200, r);
    }
    if (req.method === 'GET' && p === '/api/knowledge') {
      const file = url.searchParams.get('file');
      if (file) {
        const content = knowledge.readKnowledge(file);
        return content === null ? send(res, 404, { error: 'not found' }) : send(res, 200, { file, content });
      }
      return send(res, 200, { files: knowledge.listKnowledge(url.searchParams.get('dir') || '') });
    }

    return send(res, 404, { error: 'not found' });
  } catch (e) {
    return send(res, 500, { error: e.message });
  }
});

// Periodic lease sweep so expired work re-queues even with no traffic.
setInterval(() => {
  for (const t of store.expireLeases()) broadcast('task.requeued', t);
}, 60_000);

knowledge.ensureRepo();
server.listen(PORT, HOST, () => console.log(`Agent HQ listening on [${HOST}]:${PORT}`));

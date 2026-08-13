// Bureau: coordination hub for AI agents. Zero-dependency Node server.
// API + SSE event stream + dashboard. Runs on minimal shared Node hosting.
'use strict';
const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const store = require('./lib/store');
const knowledge = require('./lib/knowledge');
const discord = require('./lib/discord');

const PORT = process.env.PORT || 8100;
const HOST = process.env.HOST || '::';           // some shared hosts expect an IPv6 bind
const TOKEN = process.env.BUREAU_TOKEN || '';
if (!TOKEN) console.warn('⚠️  BUREAU_TOKEN not set: API is UNPROTECTED. Set it in production.');

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
    activity: d.activity,
    body: typeof d.body === 'string' ? d.body.slice(0, 300) : undefined,
  };
}

// ---------- helpers ----------
function send(res, code, obj) {
  const body = JSON.stringify(obj, null, 1);
  // no-store on everything: agents must always see fresh state, whatever proxy sits between
  res.writeHead(code, { 'content-type': 'application/json', 'access-control-allow-origin': '*', 'cache-control': 'no-store' });
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
function escHtml(s) { return String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])); }
function sendPage(res, code, title, bodyHtml) {
  const html = `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Bureau · review</title><style>body{font:16px/1.5 system-ui,sans-serif;max-width:480px;margin:12vh auto;padding:0 20px;color:#111}h1{font-size:18px}textarea{width:100%;min-height:90px;font:inherit;padding:8px;box-sizing:border-box}button{font:inherit;font-weight:600;padding:10px 18px;border:none;border-radius:8px;background:#2a78d6;color:#fff;cursor:pointer}p.err{color:#c22}</style></head><body><h1>${title}</h1>${bodyHtml}</body></html>`;
  res.writeHead(code, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' });
  res.end(html);
}
function reviewForm(task, action, token, err) {
  const noteField = action === 'queued'
    ? `<p>A note is required: the agent reads it as its correction.</p><textarea name="note" placeholder="What should change?"></textarea>`
    : '';
  const verb = action === 'done' ? 'Approve' : 'Send back';
  return `${err ? `<p class="err">${escHtml(err)}</p>` : ''}<p>${escHtml(task.id)} · ${escHtml(task.title)}</p><form method="POST" action="/r/${token}">${noteField}<button>${verb} ${escHtml(task.id)}</button></form>`;
}

// Constant-time comparison via digests: no timing oracle on the single secret,
// and equal-length inputs for timingSafeEqual whatever the caller sent.
function tokenMatch(candidate) {
  if (typeof candidate !== 'string' || !candidate) return false;
  const a = crypto.createHash('sha256').update(candidate).digest();
  const b = crypto.createHash('sha256').update(TOKEN).digest();
  return crypto.timingSafeEqual(a, b);
}
function authed(req, url) {
  if (!TOKEN) return true;
  const h = req.headers['authorization'] || '';
  if (h.startsWith('Bearer ') && tokenMatch(h.slice(7))) return true;
  if (tokenMatch(url.searchParams.get('token'))) return true; // for SSE/browser (EventSource cannot set headers)
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

    // ----- review capability links (the token IS the auth; GET renders, POST acts) -----
    // GET must never mutate: chat clients unfurl links, and a side-effecting GET
    // would let a preview fetch approve a mission.
    const mReview = p.match(/^\/r\/([a-f0-9]{32})$/);
    if (mReview) {
      const found = store.findByReviewToken(mReview[1]);
      if (!found || found.task.status !== 'review')
        return sendPage(res, 410, 'Link no longer valid', '<p>This link was already used, or the mission has moved on.</p>');
      if (found.exp < new Date().toISOString())
        return sendPage(res, 410, 'Link expired', '<p>This link has expired. Review the mission from the dashboard.</p>');
      const { task, action } = found;
      if (req.method === 'GET')
        return sendPage(res, 200, action === 'done' ? 'Approve this mission?' : 'Send this mission back?', reviewForm(task, action, mReview[1]));
      if (req.method === 'POST') {
        const raw = await new Promise((resolve, reject) => {
          let d = ''; req.on('data', c => { d += c; if (d.length > 1e5) req.destroy(); });
          req.on('end', () => resolve(d)); req.on('error', reject);
        });
        const note = (new URLSearchParams(raw).get('note') || '').trim();
        if (action === 'queued' && !note)
          return sendPage(res, 400, 'Send this mission back?', reviewForm(task, action, mReview[1], 'The note is required.'));
        const r = store.updateTask({ id: task.id, agent: 'human', status: action, note: note || 'approved via link' });
        if (r.error) return sendPage(res, 400, 'Something went wrong', `<p>${escHtml(r.error)}</p>`);
        broadcast(action === 'done' ? 'task.done' : 'task.requeued', { ...r.task, note: note || 'approved via link' });
        return sendPage(res, 200, action === 'done' ? 'Approved' : 'Sent back',
          `<p>${escHtml(task.id)} · ${escHtml(task.title)}</p><p>${action === 'done' ? 'Filed to done. The team keeps moving.' : 'Back on the board with your note attached.'}</p>`);
      }
    }

    // ----- mission record page (read-only capability; linked from pings) -----
    const mView = p.match(/^\/m\/([a-f0-9]{32})$/);
    if (req.method === 'GET' && mView) {
      const t = store.findByViewToken(mView[1]);
      if (!t) return sendPage(res, 404, 'Not found', '<p>No mission record behind this link.</p>');
      const logs = (t.log || []).map(l =>
        `<p style="border-bottom:1px solid #eee;padding:6px 0;margin:0"><span style="color:#888;font-size:13px">${escHtml(l.ts.slice(5, 16).replace('T', ' '))}</span> <b>${escHtml(l.by)}</b><br>${escHtml(l.note).replace(/\n/g, '<br>')}</p>`).join('') || '<p>No log yet.</p>';
      const arts = (t.artifacts || []).map(a => {
        const linkable = a.url && /^https?:\/\//i.test(a.url);
        return `<p>📎 ${linkable ? `<a href="${escHtml(a.url)}" target="_blank" rel="noopener">${escHtml(a.label || a.url)}</a>` : escHtml(a.label || a.url || '')}</p>`;
      }).join('');
      return sendPage(res, 200, `${escHtml(t.id)} · ${escHtml(t.title)}`,
        `<p style="color:#666">${escHtml(t.status)} · P${t.priority}${t.assignee ? ' · ' + escHtml(t.assignee) : ''} · ${escHtml(t.project || '')}</p>` +
        (t.body ? `<p>${escHtml(t.body).replace(/\n/g, '<br>')}</p>` : '') + arts + logs);
    }

    if (!p.startsWith('/api/')) return send(res, 404, { error: 'not found' });
    if (!authed(req, url)) return send(res, 401, { error: 'unauthorized' });

    // ----- SSE stream -----
    if (req.method === 'GET' && p === '/api/events') {
      res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-store', connection: 'keep-alive', 'access-control-allow-origin': '*' });
      res.write('retry: 3000\n\n');
      sseClients.add(res);
      req.on('close', () => sseClients.delete(res));
      return;
    }

    // ----- snapshot for dashboard (GET or POST: POST for cache-proof polling) -----
    if ((req.method === 'GET' || req.method === 'POST') && p === '/api/state') {
      store.expireLeases();
      const s = store.load();
      return send(res, 200, {
        agents: s.agents, tasks: s.tasks, projects: s.projects || [],
        log: s.log.slice(-200),
        knowledge: { recent: knowledge.recentCommits(15) },
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
      const a = store.heartbeat(b.name, b.note, b.activity);
      if (!a) return send(res, 404, { error: 'unknown agent; register first' });
      if (a.error) return send(res, 400, a);
      broadcast('agent.heartbeat', { ...a, activity: a.activity });
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
      if (b.project && !store.PROJECT_RE.test(b.project)) return send(res, 400, { error: 'bad project name: letters, digits, dot, dash, underscore, max 40' });
      const t = store.createTask(b);
      broadcast('task.created', t);
      return send(res, 200, { task: t });
    }

    // ----- projects -----
    if (req.method === 'GET' && p === '/api/projects') {
      const s = store.load();
      const counts = {};
      for (const t of s.tasks) if (t.project) counts[t.project] = (counts[t.project] || 0) + 1;
      return send(res, 200, { projects: s.projects.map(pj => ({ ...pj, tasks: counts[pj.id] || 0 })) });
    }
    if (req.method === 'POST' && p === '/api/projects') {
      const b = await readBody(req);
      const label = b.label || b.name;
      if (!label) return send(res, 400, { error: 'label required' });
      const r = store.createProject(label, b.id);
      if (r.error) return send(res, 400, r);
      if (r.exists) return send(res, 409, { error: 'project already exists', project: r.project });
      broadcast('project.created', { note: `${r.project.label} (${r.project.id})` });
      return send(res, 200, r);
    }
    const mProj = p.match(/^\/api\/projects\/([A-Za-z0-9._-]+)$/);
    if (req.method === 'PATCH' && mProj) {
      const b = await readBody(req);
      if (b.label === undefined && b.capacity === undefined) return send(res, 400, { error: 'label or capacity required' });
      const pj = store.updateProject(mProj[1], b);
      if (!pj) return send(res, 404, { error: 'not_found' });
      if (pj.error) return send(res, 400, pj);
      broadcast('project.renamed', { note: `${pj.id}: label ${pj.label}, capacity ${pj.capacity}` });
      return send(res, 200, { project: pj });
    }
    if (req.method === 'DELETE' && mProj) {
      const r = store.deleteProject(mProj[1]);
      if (r.error) return send(res, r.error === 'not_found' ? 404 : 409, r);
      broadcast('project.deleted', { note: mProj[1] });
      return send(res, 200, r);
    }
    if (req.method === 'POST' && p === '/api/projects/rename') {
      const b = await readBody(req);
      if (!b.from || !b.to) return send(res, 400, { error: 'from and to required' });
      if (!store.PROJECT_RE.test(b.from) || !store.PROJECT_RE.test(b.to)) return send(res, 400, { error: 'bad project name' });
      if (b.from === b.to) return send(res, 400, { error: 'same name' });
      const brain = knowledge.renameProjectDir(b.from, b.to);
      if (brain.error) return send(res, 409, brain);
      const renamed = store.renameProject(b.from, b.to);
      broadcast('project.renamed', { note: `${b.from} → ${b.to} (${renamed} missions${brain.moved ? ', brain folder moved' : ''})` });
      return send(res, 200, { renamed, brain });
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
    if (req.method === 'GET' && mTask) {
      const t = store.load().tasks.find(x => x.id === mTask[1]);
      return t ? send(res, 200, { task: t }) : send(res, 404, { error: 'not_found' });
    }
    if (req.method === 'PATCH' && mTask) {
      const b = await readBody(req);
      const r = store.updateTask({ ...b, id: mTask[1] });
      if (r.error) return send(res, r.error === 'not_found' ? 404 : 400, r);
      const evt = { done: 'task.done', failed: 'task.failed', review: 'task.review', blocked: 'task.blocked', queued: 'task.requeued' }[b.status] || 'task.updated';
      broadcast(evt, { ...r.task, note: b.note });
      return send(res, 200, r);
    }

    // ----- messages -----
    if (req.method === 'POST' && p === '/api/messages') {
      const b = await readBody(req);
      if (!b.from || !b.body) return send(res, 400, { error: 'from and body required' });
      const m = store.postMessage(b);
      broadcast('message.posted', m);
      return send(res, 200, { message: m });
    }
    if (req.method === 'GET' && p === '/api/messages') {
      const msgs = store.getMessages({ forAgent: url.searchParams.get('for'), since: url.searchParams.get('since') });
      return send(res, 200, { messages: msgs.slice(-200) });
    }
    // POST inbox variant: same read, cache-proof for agents that poll
    if (req.method === 'POST' && p === '/api/messages/inbox') {
      const b = await readBody(req);
      const msgs = store.getMessages({ forAgent: b.for, since: b.since });
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

const lock = store.acquireLock();
if (lock.error) { console.error(lock.error); process.exit(1); }
knowledge.ensureRepo();
// Prefer the configured host ('::' for hosts that want IPv6); fall back to IPv4 where IPv6 is absent.
server.on('error', (e) => {
  if (e.code === 'EAFNOSUPPORT' && HOST === '::') {
    console.log('IPv6 unavailable, falling back to 0.0.0.0');
    server.listen(PORT, '0.0.0.0', () => console.log(`Bureau hub listening on 0.0.0.0:${PORT}`));
  } else { throw e; }
});
server.listen(PORT, HOST, () => console.log(`Bureau hub listening on [${HOST}]:${PORT}`));

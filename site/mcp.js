// site/mcp.js: a public, read-only MCP server about Bureau, at /mcp.
// Any assistant that speaks MCP (Streamable HTTP) can ask what Bureau is,
// search the FAQ, read the roadmap and get the install steps. No token, no
// writes, no state: every answer is built from the same files as the site
// (llms.txt and inside.html), so it says exactly what the pages say.
// This is not the hub's MCP door, which works missions on your own hub.
'use strict';
const fs = require('fs');
const path = require('path');

const VERSIONS = ['2025-11-25', '2025-06-18', '2025-03-26', '2024-11-05'];

module.exports = function makeMcp({ SITE, SITE_URL, textOf, FAQ_RE, insideAsText, version }) {
  // ---- the corpus, rebuilt when the files change --------------------------
  let corpus = null;
  function load() {
    const files = ['llms.txt', 'inside.html'].map((f) => path.join(SITE, f));
    const key = files.map((f) => fs.statSync(f).mtimeMs).join('|');
    if (corpus && corpus.key === key) return corpus;
    const llms = fs.readFileSync(files[0], 'utf8').split('__SITE__').join(SITE_URL).trim();
    const html = fs.readFileSync(files[1], 'utf8');
    const faq = [...html.matchAll(FAQ_RE)].map((m) => ({
      kind: 'faq', title: textOf(m[2]), text: textOf(m[3]), url: SITE_URL + '/inside#' + m[1],
    }));
    const roadmap = {};
    for (const m of html.matchAll(/<div class="road-col road-(\w+)">([\s\S]*?)<\/ul>/g)) {
      roadmap[m[1]] = [...m[2].matchAll(/<li>([\s\S]*?)<\/li>/g)].map((l) => textOf(l[1]));
    }
    const road = Object.keys(roadmap).flatMap((k) => roadmap[k].map((t) => ({
      kind: 'roadmap', title: k === 'now' ? 'Available now' : k === 'next' ? 'Coming next' : 'Later', text: t, url: SITE_URL + '/inside#roadmap',
    })));
    // the feature sections of the page, one entry per h2
    const features = [...html.matchAll(/<section class="(?:feature[^"]*|office)">([\s\S]*?)<\/section>/g)].map((m) => ({
      kind: 'feature', title: textOf((m[1].match(/<h2>([\s\S]*?)<\/h2>/) || ['', ''])[1]),
      text: [...m[1].matchAll(/<p[^>]*>([\s\S]*?)<\/p>/g)].map((p) => textOf(p[1])).join(' '), url: SITE_URL + '/inside',
    }));
    // llms.txt, one entry per ## section
    const guide = llms.split(/\n(?=## )/).slice(1).map((s) => ({
      kind: 'overview', title: s.split('\n')[0].replace(/^##\s*/, ''), text: s.split('\n').slice(1).join(' ').replace(/\s+/g, ' ').trim(), url: SITE_URL + '/llms.txt',
    }));
    corpus = { key, llms, roadmap, docs: [...faq, ...road, ...features, ...guide] };
    return corpus;
  }

  // ---- search: BM25 over the passages ------------------------------------------
  // Words are stemmed lightly and a few synonyms folded together, so "who
  // made it" finds "Who makes it?" and "is it free" finds the cost answer.
  // A title counts as three copies of itself. Rare words (codex, docker)
  // weigh more than common ones (agent, work), and long generic passages
  // don't win just by containing everything.
  const STOP = new Set('a an the and or for with to of in on at by is it its be are was i me my you your we our do does did can could would should will this that there these from into about any not no bureau'.split(' '));
  const SYN = { made: 'make', makes: 'make', maker: 'make', built: 'build', builds: 'build', free: 'cost', price: 'cost', pricing: 'cost', paid: 'cost', pay: 'cost', costs: 'cost',
    stored: 'store', storage: 'store', saved: 'store', kept: 'store', licence: 'license', licensed: 'license', setup: 'install', deploys: 'deploy', approved: 'approve', approval: 'approve',
    llm: 'model', llms: 'model', models: 'model', ai: 'ai', selfhost: 'self', hosting: 'host', hosted: 'host' };
  function stem(w) {
    if (SYN[w]) return SYN[w];
    if (w.length > 5 && w.endsWith('ing')) return w.slice(0, -3);
    if (w.length > 4 && w.endsWith('ies')) return w.slice(0, -3) + 'y';
    if (w.length > 4 && w.endsWith('es') && /(ch|sh|x|ss)es$/.test(w)) return w.slice(0, -2);
    if (w.length > 3 && w.endsWith('s') && !w.endsWith('ss')) return w.slice(0, -1);
    if (w.length > 4 && w.endsWith('ed')) return w.slice(0, -2);
    return w;
  }
  function tokens(s) {
    return String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').split(/[^a-z0-9]+/)
      .filter((w) => w.length > 1 && !STOP.has(w)).map(stem);
  }
  let index = null;
  function bm25() {
    const c = load();
    if (index && index.key === c.key) return index;
    const docs = c.docs.map((d) => {
      const toks = tokens(d.title + ' ' + d.title + ' ' + d.title + ' ' + d.text), tf = new Map();
      for (const t of toks) tf.set(t, (tf.get(t) || 0) + 1);
      return { d, tf, len: toks.length };
    });
    const df = new Map();
    for (const x of docs) for (const t of x.tf.keys()) df.set(t, (df.get(t) || 0) + 1);
    const avg = docs.reduce((n, x) => n + x.len, 0) / docs.length;
    index = { key: c.key, docs, df, avg, n: docs.length };
    return index;
  }
  function search(query, limit) {
    const q = [...new Set(tokens(query))];
    if (!q.length) return [];
    const ix = bm25(), k1 = 1.2, b = 0.75;
    return ix.docs.map((x) => {
      let s = 0;
      for (const t of q) {
        const f = x.tf.get(t);
        if (!f) continue;
        const idf = Math.log(1 + (ix.n - ix.df.get(t) + 0.5) / (ix.df.get(t) + 0.5));
        s += idf * (f * (k1 + 1)) / (f + k1 * (1 - b + b * x.len / ix.avg));
      }
      return { d: x.d, s: s + (s && x.d.kind === 'faq' ? 0.3 : 0) };
    }).filter((x) => x.s > 0).sort((a, z) => z.s - a.s).slice(0, limit).map((x) => x.d);
  }

  const INSTALL = [
    '# Install Bureau', '',
    'You need Node 18 or newer and git, or Docker. No npm install, no build step.', '',
    '## With Node', '```',
    'git clone https://github.com/mahoudeau/bureau', 'cd bureau/hub',
    'cp .env.example .env    # set BUREAU_TOKEN, e.g. openssl rand -hex 32',
    'sh start.sh             # listens on PORT (8100 in the example)', '```',
    'Check: `curl http://localhost:8100/health` answers `"ok": true`. Dashboard at http://localhost:8100/, pixel office at /office.', '',
    '## With Docker', '```',
    'echo "BUREAU_TOKEN=$(openssl rand -hex 32)" > .env', 'docker compose up -d    # listens on 8100', '```',
    'Prebuilt images: ghcr.io/mahoudeau/bureau (amd64, arm64).', '',
    '## Connect an agent',
    'Any HTTP client works (curl is the reference). Chat apps join through the hub\'s own MCP link: GET /api/mcp on your hub, with your token, prints it.', '',
    'Full guide for AI assistants: https://github.com/mahoudeau/bureau/blob/main/llms-install.md',
    'README: https://github.com/mahoudeau/bureau#run-it',
  ].join('\n');

  const RO = { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false };
  const TOOLS = [
    { name: 'about_bureau', title: 'What Bureau is',
      description: 'Overview of Bureau, the open-source, self-hosted AI OS for your agents: what it is, the problem it solves, how it works, what is available now, what is coming, and links. Start here.',
      inputSchema: { type: 'object', properties: {}, additionalProperties: false }, annotations: RO },
    { name: 'search_bureau', title: 'Search Bureau\'s FAQ, roadmap and features',
      description: 'Search everything getbureau.dev says about Bureau (FAQ answers, roadmap items, feature descriptions). Returns the best matching passages with their URL, to quote and cite.',
      inputSchema: { type: 'object', properties: { query: { type: 'string', description: 'What you want to know, e.g. "which agents work with it" or "is it free"' }, limit: { type: 'integer', minimum: 1, maximum: 10, default: 5 } }, required: ['query'], additionalProperties: false },
      annotations: RO },
    { name: 'get_roadmap', title: 'Bureau roadmap',
      description: 'What Bureau can do today, what is being built next, and what comes later (including the hosted version the waitlist is for).',
      inputSchema: { type: 'object', properties: {}, additionalProperties: false }, annotations: RO },
    { name: 'get_faq', title: 'Bureau FAQ',
      description: 'All frequently asked questions about Bureau with their answers and links.',
      inputSchema: { type: 'object', properties: {}, additionalProperties: false }, annotations: RO },
    { name: 'how_to_install', title: 'Install Bureau',
      description: 'Step-by-step instructions to run a Bureau hub with Node or Docker and connect a first agent.',
      inputSchema: { type: 'object', properties: {}, additionalProperties: false }, annotations: RO },
  ];
  const RESOURCES = [
    { uri: SITE_URL + '/llms.txt', name: 'llms.txt', title: 'Bureau for language models', description: 'A short, linked overview of Bureau.', mimeType: 'text/markdown' },
    { uri: SITE_URL + '/llms-full.txt', name: 'llms-full.txt', title: 'Bureau, the full page as text', description: 'The overview plus the whole features, roadmap and FAQ page.', mimeType: 'text/markdown' },
  ];

  function call(name, a) {
    const c = load();
    switch (name) {
      case 'about_bureau': return c.llms;
      case 'search_bureau': {
        const hits = search(a.query, Math.min(10, Math.max(1, a.limit || 5)));
        if (!hits.length) return 'Nothing on getbureau.dev matches "' + a.query + '". Try about_bureau, or ask on GitHub: https://github.com/mahoudeau/bureau/issues';
        return hits.map((h) => '### ' + h.title + (h.kind === 'roadmap' ? '' : '') + '\n' + h.text + '\nSource: ' + h.url).join('\n\n');
      }
      case 'get_roadmap': {
        const sec = (k, t) => '## ' + t + '\n' + (c.roadmap[k] || []).map((x) => '- ' + x).join('\n');
        return ['# Bureau roadmap (' + SITE_URL + '/inside#roadmap)', sec('now', 'Available now (v' + version + ')'), sec('next', 'Coming next'), sec('later', 'Later'),
          'The waitlist (' + SITE_URL + '/#waitlist) is for the hosted version. Self-hosting is open now, and free.'].join('\n\n');
      }
      case 'get_faq': return '# Bureau FAQ (' + SITE_URL + '/inside#faq)\n\n' + c.docs.filter((d) => d.kind === 'faq').map((d) => '## ' + d.title + '\n' + d.text + '\n' + d.url).join('\n\n');
      case 'how_to_install': return INSTALL;
      default: throw Object.assign(new Error('unknown tool: ' + name), { code: -32602 });
    }
  }
  function read(uri) {
    if (uri === SITE_URL + '/llms.txt') return load().llms;
    if (uri === SITE_URL + '/llms-full.txt') return load().llms + '\n\n---\n\n' + insideAsText();
    throw Object.assign(new Error('unknown resource: ' + uri), { code: -32002 });
  }

  const INSTRUCTIONS = 'This server describes Bureau (getbureau.dev), an open-source, self-hosted AI OS: an office where AI agents get better with every task, briefed before they start, with what they learn kept. It has a mission queue, a critic, a review gate the server enforces, and a memory in markdown and git. Use about_bureau for an overview and search_bureau to answer specific questions; cite the URLs it returns. It only describes the product: to run missions, a user installs their own hub (how_to_install).';

  // ---- the protocol, both eras -----------------------------------------------
  // Modern clients (2026-07-28 on) send no handshake: every request carries
  // its version in params._meta and in the MCP-Protocol-Version header, and
  // the server answers each one on its own. Legacy clients (2025-11-25 and
  // earlier) open with `initialize`. This server speaks both, statelessly:
  // it never mints a session, which every legacy revision allows.
  const MODERN = ['2026-07-28'];
  const SUPPORTED = MODERN.concat(VERSIONS);
  const META_V = 'io.modelcontextprotocol/protocolVersion';
  const SERVER_INFO = { name: 'getbureau', title: 'Bureau (about)', version, websiteUrl: SITE_URL, icons: [{ src: SITE_URL + '/icon-512.png', mimeType: 'image/png', sizes: ['512x512'] }] };
  const CAPS = { tools: { listChanged: false }, resources: { listChanged: false } };
  const CACHE = { ttlMs: 3600000, cacheScope: 'public' }; // the answers change only on a deploy
  const err = (id, code, message, data, status) => ({ status: status || 200, body: { jsonrpc: '2.0', id: id === undefined ? null : id, error: data ? { code, message, data } : { code, message } } });

  // Base64 sentinel values in Mcp-Name: =?base64?...?=
  function headerValue(v) {
    const m = /^=\?base64\?(.*)\?=$/.exec(v || '');
    return m ? Buffer.from(m[1], 'base64').toString('utf8') : v;
  }

  function result(method, p, modern) {
    const cacheable = modern ? CACHE : {};
    switch (method) {
      case 'server/discover': return Object.assign({ supportedVersions: SUPPORTED, capabilities: CAPS, instructions: INSTRUCTIONS }, CACHE);
      case 'tools/list': return Object.assign({ tools: TOOLS }, cacheable);
      case 'tools/call': {
        if (!TOOLS.some((t) => t.name === p.name)) throw Object.assign(new Error('unknown tool: ' + p.name), { code: -32602 });
        const a = p.arguments || {};
        if (p.name === 'search_bureau' && (typeof a.query !== 'string' || !a.query.trim())) return { content: [{ type: 'text', text: 'query is required' }], isError: true };
        return { content: [{ type: 'text', text: call(p.name, a) }], isError: false };
      }
      case 'resources/list': return Object.assign({ resources: RESOURCES }, cacheable);
      case 'resources/templates/list': return Object.assign({ resourceTemplates: [] }, cacheable);
      case 'resources/read': {
        try { return Object.assign({ contents: [{ uri: p.uri, mimeType: 'text/markdown', text: read(p.uri) }] }, cacheable); }
        catch (e) { throw Object.assign(e, { code: modern ? -32602 : -32002 }); } // not-found code changed in 2026-07-28
      }
      case 'prompts/list': return Object.assign({ prompts: [] }, cacheable);
      default: return undefined;
    }
  }

  // handle(message, headers) -> { status, body } (body null: 202, nothing to say)
  function handle(msg, headers) {
    headers = headers || {};
    if (Array.isArray(msg)) {
      // batches exist only in 2025-03-26; answer each as a legacy request
      const out = msg.map((m) => handle(m, {}).body).filter(Boolean);
      return { status: out.length ? 200 : 202, body: out.length ? out : null };
    }
    if (!msg || msg.jsonrpc !== '2.0' || typeof msg.method !== 'string') return err(msg && msg.id, -32600, 'invalid request', null, 400);
    if (msg.id === undefined) return { status: 202, body: null }; // a notification
    const p = msg.params || {}, meta = p._meta || {};
    const asked = meta[META_V];
    const modern = asked !== undefined || (headers['mcp-protocol-version'] && MODERN.includes(headers['mcp-protocol-version']) && msg.method !== 'initialize');

    if (modern) {
      // header and body must agree (servers that read the body MUST check)
      const hv = headers['mcp-protocol-version'];
      if (!hv) return err(msg.id, -32020, 'Header mismatch: MCP-Protocol-Version header is missing', null, 400);
      if (hv !== asked) return err(msg.id, -32020, 'Header mismatch: MCP-Protocol-Version header value \'' + hv + '\' does not match body value \'' + asked + '\'', null, 400);
      if (!MODERN.includes(asked)) return err(msg.id, -32022, 'Unsupported protocol version', { supported: SUPPORTED, requested: asked }, 400);
      if (headers['mcp-method'] !== msg.method) return err(msg.id, -32020, 'Header mismatch: Mcp-Method header value \'' + (headers['mcp-method'] || '') + '\' does not match body value \'' + msg.method + '\'', null, 400);
      if (msg.method === 'tools/call' || msg.method === 'resources/read' || msg.method === 'prompts/get') {
        const want = msg.method === 'resources/read' ? p.uri : p.name;
        if (headerValue(headers['mcp-name']) !== want) return err(msg.id, -32020, 'Header mismatch: Mcp-Name header does not match body value \'' + want + '\'', null, 400);
      }
      try {
        const r = result(msg.method, p, true);
        if (r === undefined) return err(msg.id, -32601, 'Method not found: ' + msg.method, null, 404);
        r.resultType = 'complete';
        r._meta = Object.assign({}, r._meta, { 'io.modelcontextprotocol/serverInfo': SERVER_INFO });
        return { status: 200, body: { jsonrpc: '2.0', id: msg.id, result: r } };
      } catch (e) {
        return err(msg.id, e.code || -32603, String(e.message || e));
      }
    }

    // legacy: the initialize handshake, then plain requests
    try {
      if (msg.method === 'initialize') {
        return { status: 200, body: { jsonrpc: '2.0', id: msg.id, result: {
          protocolVersion: VERSIONS.includes(p.protocolVersion) ? p.protocolVersion : VERSIONS[0],
          capabilities: CAPS, serverInfo: SERVER_INFO, instructions: INSTRUCTIONS,
        } } };
      }
      if (msg.method === 'ping') return { status: 200, body: { jsonrpc: '2.0', id: msg.id, result: {} } };
      const r = result(msg.method, p, false);
      if (r === undefined) return err(msg.id, -32601, 'method not found: ' + msg.method);
      return { status: 200, body: { jsonrpc: '2.0', id: msg.id, result: r } };
    } catch (e) {
      return err(msg.id, e.code || -32603, String(e.message || e));
    }
  }

  return { handle, TOOLS, RESOURCES, INSTRUCTIONS, SUPPORTED, search };
};

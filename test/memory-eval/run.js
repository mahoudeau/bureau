#!/usr/bin/env node
// test/memory-eval/run.js: measures brain retrieval, so every later change to
// retrieval or scoring is compared against a number instead of a feeling.
// Zero dependencies. Read-only: every hub call this file makes is a GET.
//
// Two measures:
//   recall@k   for each question, the share of its expected files found in the
//              top k results of a retrieval method; then the mean over questions.
//   clock-in   the token cost of the files a clock-in reads (bytes / 4).
//
// Methods:
//   list        the naive baseline an agent has today: list the brain, read
//               every file, rank by keyword overlap between the question and
//               the file's path + title + first lines. Client-side only.
//   api-search  GET /api/knowledge/search?q=&k= (roadmap R4). Reported as
//               "not available" while the hub answers 404.
//
// Questions file: [{ id, question, expected: [{ file, section? }], tags? }]
// Run with --help for the flags.
'use strict';
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const HELP = `Usage: node test/memory-eval/run.js [options]

  --questions FILE    questions JSON (required unless only --clockin is given)
  --method NAME       list | api-search | all (default all)
  --k N               cutoff for recall (default 5)
  --url URL           hub base URL (default $BUREAU_URL or http://localhost:8100)
  --token TOKEN       bearer token (default $BUREAU_TOKEN, else --token-file)
  --token-file FILE   file holding the token (default $BUREAU_TOKEN_FILE)
  --hub-sh PATH       send every GET through this hub.sh instead of HTTP
                      (it brings its own URL and token)
  --include LIST      comma list of path prefixes the list method may rank
                      (default: everything)
  --exclude LIST      comma list of path prefixes never read
                      (default entities/,attic/,archive/; pass "" for none)
  --lines N           body lines the list method reads after the title (default 8)
  --clockin LIST      comma list of files and folder prefixes (ending in /) a
                      clock-in reads; prints their size in tokens (bytes / 4)
  --min-recall X      exit 1 when an available method scores below X (CI)
  --json              machine-readable output
  --verbose           print each method's top k for every question`;

// ---------- arguments ----------
function parseArgs(argv) {
  const o = { method: 'all', k: 5, lines: 8, exclude: 'entities/,attic/,archive/' };
  const flags = new Set(['json', 'verbose', 'help']);
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith('--')) throw new Error(`unexpected argument: ${a}`);
    const key = a.slice(2);
    if (flags.has(key)) { o[key] = true; continue; }
    if (i + 1 >= argv.length) throw new Error(`${a} needs a value`);
    o[key.replace(/-([a-z])/g, (_, c) => c.toUpperCase())] = argv[++i];
  }
  o.k = Number(o.k);
  o.lines = Number(o.lines);
  if (!Number.isInteger(o.k) || o.k < 1) throw new Error('--k must be a positive integer');
  return o;
}
const list = s => String(s || '').split(',').map(x => x.trim()).filter(Boolean);

// ---------- transport (GET only) ----------
function makeHub(o) {
  if (o.hubSh) {
    return {
      label: `hub.sh (${o.hubSh})`,
      async get(p) {
        const out = execFileSync('sh', [o.hubSh, 'GET', p], { encoding: 'utf8', maxBuffer: 256 * 1024 * 1024 });
        let body;
        try { body = JSON.parse(out); } catch { throw new Error(`GET ${p}: not JSON: ${out.slice(0, 200)}`); }
        // hub.sh runs curl without -f, so the status only survives in the body.
        const status = body && body.error === 'not found' ? 404
          : body && body.error === 'unauthorized' ? 401
          : body && body.error ? 500 : 200;
        return { status, body };
      },
    };
  }
  const base = (o.url || process.env.BUREAU_URL || 'http://localhost:8100').replace(/\/$/, '');
  let token = o.token || process.env.BUREAU_TOKEN || '';
  const tf = o.tokenFile || process.env.BUREAU_TOKEN_FILE;
  if (!token && tf) token = fs.readFileSync(tf, 'utf8').trim();
  return {
    label: base,
    async get(p) {
      const res = await fetch(base + p, { headers: token ? { authorization: `Bearer ${token}` } : {} });
      const text = await res.text();
      let body = null;
      try { body = JSON.parse(text); } catch { body = { raw: text }; }
      return { status: res.status, body };
    },
  };
}

// ---------- the brain, as the hub serves it ----------
function makeBrain(hub, o) {
  const include = list(o.include);
  const exclude = list(o.exclude);
  const allowed = f => !exclude.some(x => f.startsWith(x));
  const cache = new Map();
  let listing = null;
  return {
    include, exclude,
    async files() {
      if (!listing) {
        const r = await hub.get('/api/knowledge');
        if (r.status !== 200 || !Array.isArray(r.body.files)) throw new Error(`GET /api/knowledge: HTTP ${r.status} ${JSON.stringify(r.body).slice(0, 200)}`);
        listing = r.body.files.filter(f => /\.(md|txt|json|csv)$/i.test(f)).filter(allowed).sort();
      }
      return listing;
    },
    async rankable() {
      return (await this.files()).filter(f => /\.(md|txt)$/i.test(f)).filter(f => !include.length || include.some(x => f.startsWith(x)));
    },
    async read(file) {
      if (!allowed(file)) throw new Error(`refusing to read excluded path ${file}`);
      if (!cache.has(file)) {
        const r = await hub.get('/api/knowledge?file=' + encodeURIComponent(file));
        if (r.status !== 200 || typeof r.body.content !== 'string') throw new Error(`GET ${file}: HTTP ${r.status}`);
        cache.set(file, r.body.content);
      }
      return cache.get(file);
    },
  };
}

// ---------- text ----------
const STOP = new Set(('a an and are as at be by can could did do does for from had has have how i if in into is it its '
  + 'me my of on or our should so than that the their them then there these this to was we were what when where which '
  + 'who why will with would you your about any all also after before not no use used using get got').split(' '));
function terms(text) {
  return String(text).toLowerCase().split(/[^a-z0-9]+/)
    .filter(t => t.length >= 2 && !STOP.has(t))
    .map(t => (t.length > 3 && t.endsWith('s') && !t.endsWith('ss') ? t.slice(0, -1) : t));
}
function splitFront(content) {
  const m = content.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?/);
  if (!m) return { front: {}, body: content };
  const front = {};
  for (const line of m[1].split(/\r?\n/)) {
    const kv = line.match(/^([A-Za-z_]+):\s*(.*)$/);
    if (kv) front[kv[1]] = kv[2].replace(/^["']|["']$/g, '');
  }
  return { front, body: content.slice(m[0].length) };
}
// What a naive agent looks at: the path, the title, the first lines.
function surface(file, content, lines) {
  const { front, body } = splitFront(content);
  const bodyLines = body.split(/\r?\n/).map(l => l.trim()).filter(Boolean);
  let title = front.title || '';
  if (!title && bodyLines[0] && bodyLines[0].startsWith('#')) title = bodyLines[0].replace(/^#+\s*/, '');
  return `${file} ${title} ${bodyLines.slice(0, lines).join(' ')}`;
}

// ---------- methods ----------
// Each returns { available: false, reason } or { available: true, rank(q) -> [{file, section?, score}] }.
const METHODS = {
  async list(brain, o) {
    // The baseline has to read every file to see its first lines, so its cost
    // is the whole corpus: worth printing next to its recall.
    const docs = [];
    let bytes = 0;
    for (const f of await brain.rankable()) {
      const content = await brain.read(f);
      bytes += Buffer.byteLength(content, 'utf8');
      docs.push({ file: f, terms: new Set(terms(surface(f, content, o.lines))) });
    }
    return {
      available: true,
      note: `${docs.length} files ranked on path + title + first ${o.lines} lines; reading them costs ~${Math.ceil(bytes / 4)} tokens`,
      rank(question) {
        const q = [...new Set(terms(question))];
        return docs
          .map(d => ({ file: d.file, score: q.filter(t => d.terms.has(t)).length }))
          .filter(r => r.score > 0)
          .sort((a, b) => b.score - a.score || a.file.localeCompare(b.file))
          .slice(0, o.k);
      },
    };
  },
  async 'api-search'(brain, o, hub) {
    const probe = await hub.get(`/api/knowledge/search?q=probe&k=${o.k}`);
    if (probe.status === 404) return { available: false, reason: 'GET /api/knowledge/search answers 404; roadmap R4 adds it' };
    if (probe.status !== 200) return { available: false, reason: `GET /api/knowledge/search answers HTTP ${probe.status}` };
    const results = {};
    return {
      available: true,
      note: 'hub search endpoint',
      async prepare(questions) {
        for (const q of questions) {
          const r = await hub.get(`/api/knowledge/search?q=${encodeURIComponent(q.question)}&k=${o.k}`);
          const rows = Array.isArray(r.body) ? r.body : (r.body.results || r.body.hits || []);
          results[q.id] = rows.slice(0, o.k).map(x => ({ file: x.file, section: x.section, score: x.score }));
        }
      },
      rank(question, id) { return results[id] || []; },
    };
  },
};

// ---------- scoring ----------
const norm = s => String(s || '').toLowerCase().replace(/^#+\s*/, '').trim();
function score(q, top) {
  const found = q.expected.filter(e => top.some(r => r.file === e.file));
  const out = { recall: found.length / q.expected.length, hit: found.length > 0 };
  const withSection = q.expected.filter(e => e.section);
  if (withSection.length && top.some(r => r.section !== undefined)) {
    const secFound = withSection.filter(e => top.some(r => r.file === e.file && norm(r.section).includes(norm(e.section))));
    out.sectionRecall = secFound.length / withSection.length;
  }
  return out;
}
function validate(questions) {
  if (!Array.isArray(questions) || !questions.length) throw new Error('questions file must be a non-empty array');
  const ids = new Set();
  for (const q of questions) {
    if (!q.id || !q.question || !Array.isArray(q.expected) || !q.expected.length || q.expected.some(e => !e.file))
      throw new Error(`malformed question: ${JSON.stringify(q).slice(0, 120)}`);
    if (ids.has(q.id)) throw new Error(`duplicate question id ${q.id}`);
    ids.add(q.id);
  }
}
const mean = xs => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);
const fmt = x => x.toFixed(3);

async function evaluate(name, brain, o, hub, questions) {
  const m = await METHODS[name](brain, o, hub);
  if (!m.available) return { available: false, reason: m.reason };
  if (m.prepare) await m.prepare(questions);
  const per = [];
  for (const q of questions) {
    const top = await m.rank(q.question, q.id);
    per.push({ id: q.id, question: q.question, tags: q.tags || [], expected: q.expected.map(e => e.file), top: top.map(r => r.file + (r.section ? '#' + r.section : '')), ...score(q, top) });
  }
  const tags = {};
  for (const p of per) for (const t of p.tags) (tags[t] = tags[t] || []).push(p.recall);
  const sec = per.filter(p => p.sectionRecall !== undefined).map(p => p.sectionRecall);
  return {
    available: true, note: m.note,
    recall: mean(per.map(p => p.recall)),
    hit_rate: mean(per.map(p => (p.hit ? 1 : 0))),
    section_recall: sec.length ? mean(sec) : null,
    by_tag: Object.fromEntries(Object.entries(tags).sort().map(([t, v]) => [t, { n: v.length, recall: mean(v) }])),
    per_question: per,
  };
}

async function clockin(brain, spec) {
  const all = await brain.files();
  const files = [];
  for (const item of list(spec)) {
    const matches = item.endsWith('/') ? all.filter(f => f.startsWith(item)) : all.filter(f => f === item);
    if (!matches.length) files.push({ file: item, missing: true, bytes: 0, tokens: 0 });
    for (const f of matches) {
      const bytes = Buffer.byteLength(await brain.read(f), 'utf8');
      files.push({ file: f, bytes, tokens: Math.ceil(bytes / 4) });
    }
  }
  const bytes = files.reduce((a, f) => a + f.bytes, 0);
  return { files, bytes, tokens: Math.ceil(bytes / 4) };
}

// ---------- main ----------
async function main() {
  const o = parseArgs(process.argv.slice(2));
  if (o.help) { console.log(HELP); return 0; }
  if (!o.questions && !o.clockin) { console.error(HELP); return 2; }
  const hub = makeHub(o);
  const brain = makeBrain(hub, o);
  const report = { hub: hub.label, k: o.k, include: brain.include, exclude: brain.exclude, methods: {} };
  let failed = false;

  if (o.questions) {
    const questions = JSON.parse(fs.readFileSync(path.resolve(o.questions), 'utf8'));
    validate(questions);
    report.questions = questions.length;
    const names = o.method === 'all' ? Object.keys(METHODS) : [o.method];
    for (const n of names) {
      if (!METHODS[n]) throw new Error(`unknown method ${n} (known: ${Object.keys(METHODS).join(', ')})`);
      const r = await evaluate(n, brain, o, hub, questions);
      report.methods[n] = r;
      if (r.available && o.minRecall !== undefined && r.recall < Number(o.minRecall)) failed = true;
    }
  }
  if (o.clockin) report.clockin = await clockin(brain, o.clockin);

  if (o.json) { console.log(JSON.stringify(report, null, 2)); return failed ? 1 : 0; }

  console.log(`memory-eval: hub ${report.hub}, k=${o.k}`);
  console.log(`  include: ${brain.include.length ? brain.include.join(', ') : 'everything'}; exclude: ${brain.exclude.length ? brain.exclude.join(', ') : 'nothing'}`);
  for (const [n, r] of Object.entries(report.methods)) {
    console.log('');
    if (!r.available) { console.log(`method ${n}: not available (${r.reason})`); continue; }
    console.log(`method ${n}: ${r.note}`);
    for (const p of r.per_question) {
      const mark = p.recall === 1 ? 'ok  ' : p.hit ? 'part' : 'MISS';
      console.log(`  ${mark} ${p.id.padEnd(8)} ${fmt(p.recall)}  ${p.question.length > 64 ? p.question.slice(0, 61) + '...' : p.question}`);
      if (p.recall < 1) console.log(`       expected ${p.expected.join(', ')}`);
      if (o.verbose || p.recall < 1) console.log(`       top ${p.top.length ? p.top.join(', ') : '(nothing scored)'}`);
    }
    console.log(`  recall@${o.k} ${fmt(r.recall)}  hit-rate ${fmt(r.hit_rate)}  (${r.per_question.length} questions)` + (r.section_recall !== null ? `  section-recall ${fmt(r.section_recall)}` : ''));
    console.log('  by tag: ' + Object.entries(r.by_tag).map(([t, v]) => `${t} ${fmt(v.recall)} (${v.n})`).join(', '));
  }
  if (report.clockin) {
    console.log('');
    console.log(`clock-in: ${report.clockin.files.length} files, ${report.clockin.bytes} bytes, ~${report.clockin.tokens} tokens (bytes / 4)`);
    for (const f of report.clockin.files) console.log(`  ${String(f.tokens).padStart(7)}  ${f.file}${f.missing ? '  (missing)' : ''}`);
  }
  if (failed) console.log(`\nFAIL: a method scored below --min-recall ${o.minRecall}`);
  return failed ? 1 : 0;
}

main().then(code => process.exit(code), e => { console.error('memory-eval: ' + e.message); process.exit(2); });

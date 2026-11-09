#!/usr/bin/env node
// Step 1: check the questions against the brain, boot a scratch hub on a copy of
// it, and build what each condition will see. Writes items.json, the clock-in
// dumps, the per-project trees for the tools condition, and prepare-report.json.
'use strict';
const fs = require('fs');
const path = require('path');
const { parseArgs, need, readJson, writeJson, tokensOf, startHub } = require('./lib');

const HEADING = /^(#{1,3}) +(.+?)\s*#*\s*$/;
function headingsOf(lines) {
  const out = [];
  let fence = false;
  lines.forEach((l, i) => {
    if (/^\s*(```|~~~)/.test(l)) fence = !fence;
    const m = !fence && l.match(HEADING);
    if (m) out.push({ i, level: m[1].length, title: m[2] });
  });
  return out;
}
// The passage that answers the question: the named section, or the section that
// holds must_contain, up to the next heading at the same level or higher.
function passageOf(text, section, must) {
  const lines = text.split('\n');
  const heads = headingsOf(lines);
  let start = null;
  if (section) {
    start = heads.find((h) => h.title.toLowerCase().includes(section.toLowerCase())) || null;
    if (!start) return { error: `no heading "${section}"` };
  } else {
    const at = lines.findIndex((l) => l.includes(must));
    if (at < 0) return { error: `must_contain not found: ${must}` };
    const before = heads.filter((h) => h.i <= at);
    start = before.length ? before[before.length - 1] : null;
    if (!start) return { text };
  }
  const after = heads.find((h) => h.i > start.i && h.level <= start.level);
  const body = lines.slice(start.i, after ? after.i : lines.length).join('\n');
  if (!body.includes(must)) return { error: `must_contain outside the section: ${must}` };
  return { text: body };
}

function listFiles(dir, rel = '') {
  const out = [];
  if (!fs.existsSync(path.join(dir, rel))) return out;
  for (const e of fs.readdirSync(path.join(dir, rel), { withFileTypes: true })) {
    const p = path.posix.join(rel, e.name);
    if (e.isDirectory()) out.push(...listFiles(dir, p));
    else out.push(p);
  }
  return out.sort();
}

function load(files, set) {
  return (files || []).flatMap((f) => readJson(f).map((q) => ({ ...q, set, answerable: true,
    category: (q.tags || []).includes('fr') || set === 'heldout' ? 'french' : 'english' })));
}

async function main() {
  const o = parseArgs(process.argv.slice(2), ['questions', 'heldout', 'guards']);
  const brain = need(o, 'brain'), out = need(o, 'out'), port = Number(o.port || 8191);
  fs.mkdirSync(out, { recursive: true });
  const raw = [...load(o.questions, 'tuned'), ...load(o.heldout, 'heldout'),
    ...(o.guards || []).flatMap((f) => readJson(f).map((g) => ({ ...g, set: 'tuned', answerable: false, category: 'unanswerable', tags: [g.kind] })))];

  // Checks: every expected passage must exist in this copy of the brain.
  const items = [], dropped = [];
  for (const q of raw) {
    if (!q.answerable) { items.push({ ...q, oracle: null, expected: [] }); continue; }
    const e = q.expected[0];
    const file = path.join(brain, e.file);
    if (!fs.existsSync(file)) { dropped.push({ id: q.id, why: `no file ${e.file}` }); continue; }
    const p = passageOf(fs.readFileSync(file, 'utf8'), e.section, q.must_contain);
    if (p.error) { dropped.push({ id: q.id, why: p.error, file: e.file }); continue; }
    items.push({ ...q, oracle: p.text });
  }

  // What a clock-in loads: the project's STATE, then every file in knowledge/ and recipes/.
  const projects = [...new Set(items.map((q) => q.project))];
  fs.mkdirSync(path.join(out, 'dumps'), { recursive: true });
  const dumpTokens = {};
  const global = [...listFiles(brain, 'knowledge'), ...listFiles(brain, 'recipes')].filter((f) => f.endsWith('.md'));
  for (const p of projects) {
    const state = p === 'general' ? [] : [`projects/${p}/STATE.md`].filter((f) => fs.existsSync(path.join(brain, f)));
    const text = [...state, ...global].map((f) => `===== ${f} =====\n${fs.readFileSync(path.join(brain, f), 'utf8')}`).join('\n\n');
    fs.writeFileSync(path.join(out, 'dumps', `${p}.txt`), text);
    dumpTokens[p] = tokensOf(text);
  }

  // Per-project trees for the tools condition: the same walls the hub enforces.
  fs.mkdirSync(path.join(out, 'trees'), { recursive: true });
  for (const p of projects) {
    const tree = path.join(out, 'trees', p);
    fs.rmSync(tree, { recursive: true, force: true });
    fs.mkdirSync(tree, { recursive: true });
    for (const d of ['knowledge', 'recipes']) fs.cpSync(path.join(brain, d), path.join(tree, d), { recursive: true });
    if (p !== 'general' && fs.existsSync(path.join(brain, 'projects', p))) fs.cpSync(path.join(brain, 'projects', p), path.join(tree, 'projects', p), { recursive: true });
  }

  // The scratch hub answers the context call once per question. The call is
  // deterministic and sent without a session, so nothing is deduplicated.
  const hubBrain = path.join(out, 'hub-brain');
  fs.rmSync(hubBrain, { recursive: true, force: true });
  fs.cpSync(brain, hubBrain, { recursive: true });
  const hub = await startHub({ brain: hubBrain, dataDir: path.join(out, 'hub-data'), port, log: path.join(out, 'hub.log') });
  const registered = [];
  for (const d of fs.readdirSync(path.join(hubBrain, 'projects'), { withFileTypes: true })) {
    if (!d.isDirectory()) continue;
    const r = await hub.call('POST', '/api/projects', { id: d.name, label: d.name });
    registered.push({ id: d.name, status: r.status });
  }
  for (const q of items) {
    const r = await hub.call('POST', '/api/context', { request: q.question, project: q.project, agent: 'answer-eval', surface: 'answer-eval' });
    if (r.status !== 200) throw new Error(`context call ${q.id}: ${r.status} ${r.text}`);
    const c = r.json;
    q.context = { rendered: c.rendered || '', miss: !!c.miss, skipped: c.skipped || null, tokens: c.tokens, served: (c.context || []).map((x) => `${x.ref.file}#${x.ref.section || ''}`), map: (c.map || []).map((x) => x.file) };
    q.context.hit = q.answerable ? c.rendered.toLowerCase().includes(q.must_contain.toLowerCase()) : null;
  }
  await hub.stop();

  writeJson(path.join(out, 'items.json'), items);
  const answerable = items.filter((q) => q.answerable);
  const report = { brain, questions: items.length, answerable: answerable.length, unanswerable: items.length - answerable.length, dropped,
    context_hits: answerable.filter((q) => q.context.hit).length, context_empty: items.filter((q) => !q.context.rendered).length,
    mean_context_tokens: Math.round(items.reduce((a, q) => a + q.context.tokens.context + q.context.tokens.map, 0) / items.length), dump_tokens: dumpTokens, registered_failures: registered.filter((r) => r.status >= 400) };
  writeJson(path.join(out, 'prepare-report.json'), report);
  console.log(JSON.stringify(report, null, 1));
}
main().catch((e) => { console.error(e); process.exitCode = 1; });

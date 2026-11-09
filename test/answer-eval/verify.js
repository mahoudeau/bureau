#!/usr/bin/env node
// Step 3b: the judge only sees one reference passage, so an answer that quotes a
// true fact from elsewhere in the brain gets flagged as fabricated. This step
// takes only the flagged answers and checks the doubted claims against everything
// that project may see. It can clear a flag, not add one, and it stays blind to
// the condition. Writes verified.jsonl.
'use strict';
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { parseArgs, need, readJson, readJsonl, appendJsonl, rng, shuffle, childEnv, isolationFlags, runClaude, quotaTrouble, pool } = require('./lib');

const SYSTEM = 'You check claims against a knowledge base. You reply with one JSON object and nothing else.';
const CAP_BYTES = 600000;

function walk(dir) {
  const out = [];
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) out.push(...walk(p));
    else if (/\.md$/.test(e.name)) out.push(p);
  }
  return out.sort();
}
// Most trusted first, so that the size cap can only ever drop the least useful
// files: STATE and specs, then global knowledge, then everything else.
function rank(f) {
  if (/\/projects\/[^/]+\/STATE\.md$/.test(f) || /\/projects\/[^/]+\/specs\//.test(f)) return 0;
  if (/\/(knowledge|recipes)\//.test(f) && !/\/projects\//.test(f)) return 1;
  return 2;
}
function kbOf(out, project, cache) {
  if (cache.has(project)) return cache.get(project);
  const tree = path.join(out, 'trees', project);
  const files = walk(tree).sort((a, b) => (rank(a) - rank(b)) || a.localeCompare(b));
  let text = '';
  for (const f of files) {
    const add = `===== ${path.relative(tree, f)} =====\n${fs.readFileSync(f, 'utf8')}\n\n`;
    if (Buffer.byteLength(text) + Buffer.byteLength(add) > CAP_BYTES) break;
    text += add;
  }
  cache.set(project, text);
  return text;
}
function parse(text) {
  const m = String(text).match(/\{[\s\S]*\}/);
  if (!m) return null;
  try {
    const j = JSON.parse(m[0]);
    return typeof j.still_fabricated === 'boolean' ? j : null;
  } catch { return null; }
}

async function main() {
  const o = parseArgs(process.argv.slice(2));
  const out = need(o, 'out');
  const model = o.model || 'claude-sonnet-5-5', concurrency = Number(o.concurrency || 3), seed = Number(o.seed || 1234), maxUtil = Number(o['max-utilization'] || 0.85);
  const items = new Map(readJson(path.join(out, 'items.json')).map((q) => [q.id, q]));
  const answers = readJsonl(o.results || path.join(out, 'answers.jsonl')).filter((a) => !a.error && a.answer);
  const map = readJson(o.map || path.join(out, 'judge-map.json'));
  const firstKey = new Map(Object.entries(map).map(([oid, keys]) => [oid, keys[0]]));
  const byKey = new Map(answers.map((a) => [a.key, a]));
  const file = o.verified || path.join(out, 'verified.jsonl');
  // --recheck-from FILE: only redo what an earlier pass left standing or failed on.
  const earlier = o['recheck-from'] ? readJsonl(o['recheck-from']) : null;
  const cleared = new Set((earlier || []).filter((v) => !v.still_fabricated).map((v) => v.oid));
  const done = new Set([...readJsonl(file).map((v) => v.oid), ...cleared]);
  const flagged = readJsonl(o.judgements || path.join(out, 'judgements.jsonl')).filter((j) => j.fabricated && !done.has(j.oid));
  const jobs = shuffle(flagged.map((j) => ({ j, a: byKey.get(firstKey.get(j.oid)) })).filter((x) => x.a), rng(seed));
  console.log(`${jobs.length} flagged answers to verify`);
  const blank = path.join(out, 'cwd-blank');
  fs.mkdirSync(blank, { recursive: true });
  const env = childEnv(out);
  const flags = isolationFlags();
  const cache = new Map();
  let finished = 0, failures = 0;
  const reason = await pool(jobs, concurrency, async ({ j, a }, stop) => {
    const item = items.get(a.id);
    const prompt = `Knowledge base for project ${item.project} (everything this project may see):\n\n${kbOf(out, item.project, cache)}\n\n---\n\nQuestion asked: ${item.question}\n\nAnswer that was given:\n${a.answer}\n\nA reviewer doubted these statements in the answer, because the single passage they had did not support them:\n${(j.claims || [j.reason]).map((c) => `- ${c}`).join('\n')}\n\nCheck each statement against the knowledge base. Set "still_fabricated" to true when at least one statement is specific and is contradicted by the knowledge base or supported by nothing in it, and it is not true general technical knowledge. Statements that restate the question or the project's name do not count. Otherwise set it to false.\n\nReply with exactly one JSON object: {"still_fabricated":true|false,"reason":"one short sentence"}`;
    let parsed = null, r = null;
    for (let attempt = 1; attempt <= 2 && !parsed; attempt++) {
      r = await runClaude({ prompt, system: SYSTEM, model, effort: 'low', cwd: blank, env, flags, timeoutMs: 180000 });
      const q = quotaTrouble(r, maxUtil);
      if (q) { stop(q); return; }
      if (r.result && !r.result.is_error) parsed = parse(r.result.result);
    }
    finished++;
    if (!parsed) { failures++; return; }
    appendJsonl(file, { oid: j.oid, ...parsed });
    if (finished % 25 === 0) console.log(`${finished}/${jobs.length}, ${failures} failed`);
  });
  console.log(`verified ${finished}, ${failures} failed`);
  if (reason) { fs.appendFileSync(path.join(out, 'STOPPED.txt'), `${new Date().toISOString()} verify stopped: ${reason}\n`); console.log(`STOPPED: ${reason}`); process.exitCode = 3; }
}
main().catch((e) => { console.error(e); process.exitCode = 1; });

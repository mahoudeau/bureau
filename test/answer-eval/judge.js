#!/usr/bin/env node
// Step 3: the blind judge, as a separate run. It sees the question, the reference
// passage and an answer, in a shuffled order under an opaque id, and never the
// condition. Identical answers to one question are judged once.
'use strict';
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { parseArgs, need, readJson, readJsonl, appendJsonl, writeJson, rng, shuffle, childEnv, isolationFlags, runClaude, quotaTrouble, pool } = require('./lib');

const SYSTEM = 'You grade answers given to a developer. You reply with one JSON object and nothing else.';
const NO_REFERENCE = '(none: the material available for this project does not contain the answer to this question)';

function promptFor(item, answer) {
  const ref = item.answerable ? item.oracle : NO_REFERENCE;
  const rules = item.answerable
    ? `This question has an answer, given in the reference passage. verdict is one of:
- "correct": the answer gives the key fact or fix from the reference passage and does not contradict it. Extra harmless detail is fine.
- "partly": it gives part of what the reference says but misses the key fact, or mixes correct content with a real error.
- "wrong": it answers, but the answer contradicts the reference passage or misses it entirely.
- "abstained": it says it does not know or does not have the information, and gives no substantive answer.`
    : `This question cannot be answered from the material available for this project. verdict is one of:
- "abstained": the answer says it does not know or does not have this information. General pointers (such as where to look) are fine as long as no specific answer is asserted.
- "wrong": it gives a specific answer anyway.`;
  return `Project: ${item.project}

Question:
${item.question}

Reference passage:
${ref}

Answer to grade:
${answer}

${rules}

Also set "fabricated" to true when the answer states as fact something specific that is contradicted by the reference passage, or something specific about this developer's projects, accounts, setup or decisions that the reference passage does not support. General technical knowledge that is true does not count, and neither does a correct answer that goes beyond the reference with general knowledge. When "fabricated" is true, list in "claims" the specific statements you doubt, each one quoted or closely paraphrased. A later step checks those statements against the whole knowledge base, so the reference passage being silent is enough to list them here.

Reply with exactly one JSON object: {"verdict":"...","fabricated":true|false,"claims":["..."],"reason":"one short sentence"}`;
}

function parseJudge(text) {
  const m = String(text).match(/\{[\s\S]*\}/);
  if (!m) return null;
  try {
    const j = JSON.parse(m[0]);
    if (!['correct', 'partly', 'wrong', 'abstained'].includes(j.verdict) || typeof j.fabricated !== 'boolean') return null;
    return j;
  } catch { return null; }
}

async function main() {
  const o = parseArgs(process.argv.slice(2));
  const out = need(o, 'out');
  const model = o.model || 'claude-sonnet-5-5';
  const concurrency = Number(o.concurrency || 4), seed = Number(o.seed || 777), maxUtil = Number(o['max-utilization'] || 0.85);
  const answersFile = o.results || path.join(out, 'answers.jsonl');
  const items = new Map(readJson(path.join(out, 'items.json')).map((q) => [q.id, q]));
  const answers = readJsonl(answersFile).filter((r) => !r.error && r.answer);
  const file = o.judgements || path.join(out, 'judgements.jsonl');
  const done = new Set(readJsonl(file).map((j) => j.oid));

  // Opaque ids carry no condition. The map from answer to oid is kept apart.
  const groups = new Map();
  const norm = (s) => String(s).trim().replace(/\s+/g, ' ').toLowerCase();
  for (const a of answers) {
    const oid = crypto.createHash('sha256').update(`${seed}\u0000${a.id}\u0000${norm(a.answer)}`).digest('hex').slice(0, 16);
    if (!groups.has(oid)) groups.set(oid, { oid, id: a.id, answer: a.answer, keys: [] });
    groups.get(oid).keys.push(a.key);
  }
  writeJson(o.map || path.join(out, 'judge-map.json'), Object.fromEntries([...groups.values()].map((g) => [g.oid, g.keys])));
  const jobs = shuffle([...groups.values()].filter((g) => !done.has(g.oid)), rng(seed));
  console.log(`${groups.size} distinct answers from ${answers.length} runs, ${jobs.length} to judge`);

  const blank = path.join(out, 'cwd-blank');
  fs.mkdirSync(blank, { recursive: true });
  const env = childEnv(out);
  const flags = isolationFlags();
  let finished = 0, failures = 0;
  const reason = await pool(jobs, concurrency, async (job, stop) => {
    let parsed = null, r = null;
    for (let attempt = 1; attempt <= 3 && !parsed; attempt++) {
      r = await runClaude({ prompt: promptFor(items.get(job.id), job.answer), system: SYSTEM, model, effort: 'low', cwd: blank, env, flags, timeoutMs: 120000 });
      const q = quotaTrouble(r, maxUtil);
      if (q) { stop(q); return; }
      if (r.result && !r.result.is_error) parsed = parseJudge(r.result.result);
    }
    finished++;
    if (!parsed) { failures++; appendJsonl(file + '.failed', { oid: job.oid, id: job.id, raw: r && r.result ? r.result.result : null }); return; }
    appendJsonl(file, { oid: job.oid, ...parsed });
    if (finished % 50 === 0) console.log(`${finished}/${jobs.length}, ${failures} failed`);
    if (failures >= 10 && failures / finished > 0.2) stop(`too many judge failures: ${failures} of ${finished}`);
  });
  console.log(`judged ${finished}, ${failures} failed`);
  if (reason) { fs.appendFileSync(path.join(out, 'STOPPED.txt'), `${new Date().toISOString()} judge stopped: ${reason}\n`); console.log(`STOPPED: ${reason}`); process.exitCode = 3; }
}
main().catch((e) => { console.error(e); process.exitCode = 1; });

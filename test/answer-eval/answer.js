#!/usr/bin/env node
// Step 2: every question, every condition, every repetition. Appends one line per
// run to answers.jsonl and skips what is already there, so a stopped run resumes.
'use strict';
const fs = require('fs');
const path = require('path');
const { parseArgs, need, readJson, readJsonl, appendJsonl, rng, shuffle, childEnv, isolationFlags, runClaude, quotaTrouble, pool } = require('./lib');

const SYSTEM = 'You answer questions from a developer about their own work and projects. Answer in the language of the question, in at most 120 words. If you do not have the information needed to answer, say plainly that you do not know. Do not guess facts about the developer\'s projects, accounts or setup.';
const SYSTEM_TOOLS = `${SYSTEM} The knowledge base for this project is in the current directory, as markdown files. Use the read and search tools to look for the answer before you reply.`;
const TOOLS = ['Read', 'Grep', 'Glob'];

function promptFor(item, condition, out) {
  const ask = `Project: ${item.project}\n\nQuestion: ${item.question}`;
  let ref = '';
  if (condition === 'B') ref = fs.readFileSync(path.join(out, 'dumps', `${item.project}.txt`), 'utf8');
  if (condition === 'C' || condition === 'F') ref = item.context.rendered;
  if (condition === 'E' && item.oracle) ref = item.oracle;
  return ref ? `Reference material:\n\n${ref}\n\n---\n\n${ask}` : ask;
}

async function main() {
  const o = parseArgs(process.argv.slice(2));
  const out = need(o, 'out');
  const model = o.model || 'claude-sonnet-5-5';
  const effort = o.effort || 'medium';
  const reps = Number(o.reps || 3), concurrency = Number(o.concurrency || 4), seed = Number(o.seed || 1), maxUtil = Number(o['max-utilization'] || 0.85);
  const conditions = (o.conditions || 'A,B,C,D,E').split(',');
  const only = o.only ? new Set(o.only.split(',')) : null;
  const items = readJson(path.join(out, 'items.json')).filter((q) => !only || only.has(q.id));
  const file = o.results || path.join(out, 'answers.jsonl');
  const done = new Set(readJsonl(file).filter((r) => !r.error).map((r) => r.key));
  const blank = path.join(out, 'cwd-blank');
  fs.mkdirSync(blank, { recursive: true });

  const jobs = [];
  for (const item of items) for (const condition of conditions) for (let rep = 1; rep <= reps; rep++) {
    const key = `${item.id}|${condition}|${rep}`;
    if (!done.has(key)) jobs.push({ item, condition, rep, key });
  }
  const order = shuffle(jobs, rng(seed));
  console.log(`${order.length} runs to do (${done.size} already done), ${concurrency} at a time`);

  const flags = isolationFlags();
  const env = childEnv(out);
  let finished = 0, failures = 0;
  const t0 = Date.now();
  const reason = await pool(order, concurrency, async (job, stop) => {
    const { item, condition, rep, key } = job;
    const usesTools = condition === 'D' || condition === 'F';
    const cwd = usesTools ? path.join(out, 'trees', item.project) : blank;
    const req = { prompt: promptFor(item, condition, out), system: usesTools ? SYSTEM_TOOLS : SYSTEM, tools: usesTools ? TOOLS : [], restricted: usesTools, model, effort, cwd, env, flags };
    let r = null;
    for (let attempt = 1; attempt <= 3; attempt++) {
      r = await runClaude(req);
      const bad = !r.result || r.result.is_error;
      if (!bad) break;
      if (quotaTrouble(r, maxUtil)) break;
      await new Promise((res) => setTimeout(res, 2000 * attempt));
    }
    // Isolation is checked on every run, not assumed.
    const expected = usesTools ? TOOLS.slice().sort() : [];
    const seen = r.init ? r.init.tools.slice().sort() : null;
    const toolsOk = seen && JSON.stringify(seen) === JSON.stringify(expected);
    const mcpOk = r.init && r.init.mcp_servers.length === 0;
    const isolated = toolsOk && mcpOk && r.hookEvents === 0;
    const u = (r.result && r.result.usage) || {};
    const rec = { key, id: item.id, condition, rep, model: r.init ? r.init.model : null,
      answer: r.result ? r.result.result : null, error: !r.result ? (r.timedOut ? 'timeout' : `no result, exit ${r.code}: ${r.stderr}`) : (r.result.is_error ? String(r.result.result).slice(0, 300) : null),
      input_tokens: (u.input_tokens || 0) + (u.cache_creation_input_tokens || 0) + (u.cache_read_input_tokens || 0), output_tokens: u.output_tokens || 0,
      turns: r.result ? r.result.num_turns : null, tool_uses: r.toolUses, reads: r.reads, latency_ms: r.latencyMs, api_ms: r.result ? r.result.duration_api_ms : null, cost_usd: r.result ? r.result.total_cost_usd : null,
      hook_events: r.hookEvents, isolated, seven_day: r.rateLimit && r.rateLimit.unifiedWindows && r.rateLimit.unifiedWindows.seven_day ? r.rateLimit.unifiedWindows.seven_day.utilization : null };
    appendJsonl(file, rec);
    finished++;
    if (rec.error) failures++;
    if (finished % 25 === 0) console.log(`${finished}/${order.length}, ${failures} failed, ${Math.round((Date.now() - t0) / 1000)}s, seven day ${rec.seven_day}`);
    if (!isolated && r.init) stop(`isolation broken on ${key}: tools ${seen}, mcp ${r.init.mcp_servers.length}, hook events ${r.hookEvents}`);
    const q = quotaTrouble(r, maxUtil);
    if (q) stop(q);
    if (failures >= 10 && failures / finished > 0.2) stop(`too many failures: ${failures} of ${finished}`);
  });

  const canary = path.join(out, 'hook-canary.log');
  const canaryHit = fs.existsSync(canary);
  console.log(`done: ${finished} runs, ${failures} failed, canary ${canaryHit ? 'TOUCHED' : 'untouched'}`);
  if (reason) {
    fs.writeFileSync(path.join(out, 'STOPPED.txt'), `${new Date().toISOString()} stopped: ${reason}\n`);
    console.log(`STOPPED: ${reason}`);
    process.exitCode = 3;
  }
  if (canaryHit) process.exitCode = 4;
}
main().catch((e) => { console.error(e); process.exitCode = 1; });

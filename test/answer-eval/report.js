#!/usr/bin/env node
// Step 4: join answers and judgements and write report.md and summary.json.
// Confidence intervals resample questions, not runs, because the repetitions of
// one question are not independent.
'use strict';
const fs = require('fs');
const path = require('path');
const { parseArgs, need, readJson, readJsonl, writeJson, rng } = require('./lib');

const CONDITIONS = { A: 'no context', B: 'clock-in dump', C: 'context call', D: 'read-only tools', E: 'oracle section', F: 'context call plus tools' };
const BOOT = 2000;

function score(row, item) {
  const v = row.verdict;
  const accurate = item.answerable ? v === 'correct' : v === 'abstained';
  const hallucinated = row.fabricated || (item.answerable && v === 'wrong');
  const mech = item.answerable && item.must_contain ? String(row.answer).toLowerCase().includes(item.must_contain.toLowerCase()) : null;
  // The stricter reading: a flag on an answer that abstained is a side remark
  // about the notes, not a made-up answer to the question.
  const halluAnswered = v !== 'abstained' && hallucinated;
  // Did the agent open a file the context call's map offered? Only known for
  // runs that recorded their reads and were offered a map.
  const offered = (item.context && item.context.map) || [];
  const read = (row.reads || []).map((p) => String(p).split(`/trees/${item.project}/`).pop().replace(/^\.\//, ''));
  const mapRead = row.reads && offered.length ? +read.some((p) => offered.includes(p)) : null;
  return { tools: row.tool_uses, map_read: mapRead, accurate: +accurate, partly: +(v === 'partly'), lenient: +(accurate || v === 'partly'), hallucinated: +hallucinated, hallu_answered: +halluAnswered, abstained: +(v === 'abstained'), mechanical: mech === null ? null : +mech, input: row.input_tokens, latency: row.latency_ms };
}

const METRICS = ['accurate', 'partly', 'lenient', 'hallucinated', 'hallu_answered', 'abstained', 'mechanical', 'input', 'latency', 'tools', 'map_read'];
function mean(a) { return a.length ? a.reduce((x, y) => x + y, 0) / a.length : NaN; }
function perQuestion(rows, metric) {
  const by = new Map();
  for (const r of rows) {
    if (r.s[metric] === null || r.s[metric] === undefined) continue;
    if (!by.has(r.id)) by.set(r.id, []);
    by.get(r.id).push(r.s[metric]);
  }
  return new Map([...by].map(([id, v]) => [id, mean(v)]));
}
function ci(vals, rand) {
  if (!vals.length) return [NaN, NaN];
  const stats = [];
  for (let b = 0; b < BOOT; b++) {
    let sum = 0;
    for (let i = 0; i < vals.length; i++) sum += vals[Math.floor(rand() * vals.length)];
    stats.push(sum / vals.length);
  }
  stats.sort((x, y) => x - y);
  return [stats[Math.floor(BOOT * 0.025)], stats[Math.floor(BOOT * 0.975)]];
}
const pct = (x) => (Number.isNaN(x) ? 'n/a' : (x * 100).toFixed(0));
const tok = (x) => (Number.isNaN(x) ? 'n/a' : Math.round(x).toLocaleString('en-US'));
const sec = (x) => (Number.isNaN(x) ? 'n/a' : (x / 1000).toFixed(1));
const one = (x) => (Number.isNaN(x) ? 'n/a' : x.toFixed(1));
const cell = (v, f) => `${f(v.mean)} [${f(v.ci[0])}, ${f(v.ci[1])}]`;

function summarize(rows, condition, rand) {
  const sub = rows.filter((r) => r.condition === condition);
  const out = { runs: sub.length, questions: new Set(sub.map((r) => r.id)).size };
  for (const m of METRICS) {
    const q = [...perQuestion(sub, m).values()];
    out[m] = { mean: mean(q), ci: ci(q, rand) };
  }
  return out;
}
function paired(rows, condition, base, metric, rand) {
  const a = perQuestion(rows.filter((r) => r.condition === condition), metric);
  const b = perQuestion(rows.filter((r) => r.condition === base), metric);
  const diffs = [];
  let better = 0, worse = 0;
  for (const [id, v] of a) if (b.has(id)) { const d = v - b.get(id); diffs.push(d); if (d > 1e-9) better++; else if (d < -1e-9) worse++; }
  return { mean: mean(diffs), ci: ci(diffs, rand), better, worse, ties: diffs.length - better - worse };
}

function table(title, rows, rand) {
  const lines = [`### ${title}`, '', '| Condition | n q | Accuracy % | Partly % | Hallucination % | Halluc. when answering % | Abstained % | must_contain % | Input tokens | Latency s | Tool calls | Map file read % |', '|---|---|---|---|---|---|---|---|---|---|---|---|'];
  const data = {};
  for (const c of Object.keys(CONDITIONS)) {
    if (!rows.some((r) => r.condition === c)) continue;
    const s = summarize(rows, c, rand);
    data[c] = s;
    lines.push(`| ${c} ${CONDITIONS[c]} | ${s.questions} | ${cell(s.accurate, pct)} | ${cell(s.partly, pct)} | ${cell(s.hallucinated, pct)} | ${cell(s.hallu_answered, pct)} | ${cell(s.abstained, pct)} | ${cell(s.mechanical, pct)} | ${cell(s.input, tok)} | ${cell(s.latency, sec)} | ${cell(s.tools, one)} | ${cell(s.map_read, pct)} |`);
  }
  const base = 'C';
  if (data[base]) {
    lines.push('', 'Paired against C (per question, condition minus C; a positive accuracy gap means that condition beat C).', '', '| Condition | Accuracy gap pts | Hallucination gap pts | Halluc. when answering gap pts | Abstention gap pts | Q where it did better / worse / tied on accuracy |', '|---|---|---|---|---|---|');
    for (const c of Object.keys(data)) {
      if (c === base) continue;
      const acc = paired(rows, c, base, 'accurate', rand), hal = paired(rows, c, base, 'hallucinated', rand), ans = paired(rows, c, base, 'hallu_answered', rand), abs = paired(rows, c, base, 'abstained', rand);
      data[c].vs_c = { accuracy: acc, hallucination: hal, hallucination_answering: ans, abstention: abs };
      const f = (p) => `${p.mean > 0 ? '+' : ''}${(p.mean * 100).toFixed(1)} [${(p.ci[0] * 100).toFixed(1)}, ${(p.ci[1] * 100).toFixed(1)}]`;
      lines.push(`| ${c} | ${f(acc)} | ${f(hal)} | ${f(ans)} | ${f(abs)} | ${acc.better} / ${acc.worse} / ${acc.ties} |`);
    }
  }
  if (data.F) {
    lines.push('', 'F against C and D (per question, F minus the other condition).', '', '| F minus | Accuracy gap pts | Hallucination gap pts | Halluc. when answering gap pts | Abstention gap pts | Input tokens gap | Latency gap s | Tool calls gap | Q where F did better / worse / tied on accuracy |', '|---|---|---|---|---|---|---|---|---|');
    for (const other of ['C', 'D']) {
      if (!data[other]) continue;
      const g = (m) => paired(rows, 'F', other, m, rand);
      const pts = (p) => `${p.mean > 0 ? '+' : ''}${(p.mean * 100).toFixed(1)} [${(p.ci[0] * 100).toFixed(1)}, ${(p.ci[1] * 100).toFixed(1)}]`;
      const raw = (p, d, k = 1) => `${p.mean > 0 ? '+' : ''}${(p.mean / k).toFixed(d)} [${(p.ci[0] / k).toFixed(d)}, ${(p.ci[1] / k).toFixed(d)}]`;
      const [acc, hal, ans, abs, inp, lat, too] = ['accurate', 'hallucinated', 'hallu_answered', 'abstained', 'input', 'latency', 'tools'].map(g);
      data.F[`vs_${other}`] = { accuracy: acc, hallucination: hal, hallucination_answering: ans, abstention: abs, input: inp, latency: lat, tools: too };
      lines.push(`| ${other} | ${pts(acc)} | ${pts(hal)} | ${pts(ans)} | ${pts(abs)} | ${raw(inp, 0)} | ${raw(lat, 1, 1000)} | ${raw(too, 1)} | ${acc.better} / ${acc.worse} / ${acc.ties} |`);
    }
  }
  return { text: lines.join('\n'), data };
}

function main() {
  const o = parseArgs(process.argv.slice(2), ['also']);
  const out = need(o, 'out');
  const items = new Map(readJson(path.join(out, 'items.json')).map((q) => [q.id, q]));
  // One result set per prefix, joined separately: the same answer text in two
  // sets has the same opaque id but its own judgement.
  const loadSet = (prefix) => {
    const f = (n) => path.join(out, prefix + n);
    const answers = readJsonl((!prefix && o.results) || f('answers.jsonl'));
    const judgements = new Map(readJsonl((!prefix && o.judgements) || f('judgements.jsonl')).map((j) => [j.oid, j]));
    // A flag the knowledge base check cleared is not a fabrication.
    // A later pass (verified-recheck.jsonl) replaces the earlier ruling on the same answer.
    const base = (!prefix && o.verified) || f('verified.jsonl');
    const finalRuling = new Map([...readJsonl(base), ...readJsonl(base.replace(/\.jsonl$/, '-recheck.jsonl'))].map((v) => [v.oid, v]));
    const verified = [...finalRuling.values()];
    for (const v of verified) if (!v.still_fabricated && judgements.has(v.oid)) judgements.get(v.oid).fabricated = false;
    const keyOf = new Map();
    for (const [oid, keys] of Object.entries(readJson((!prefix && o.map) || f('judge-map.json')))) for (const k of keys) keyOf.set(k, oid);
    const good = answers.filter((a) => !a.error && a.answer && keyOf.has(a.key) && judgements.has(keyOf.get(a.key)));
    const rows = good.map((a) => {
      const j = judgements.get(keyOf.get(a.key));
      const item = items.get(a.id);
      return { ...a, set: item.set, category: item.category, answerable: item.answerable, kind: item.kind, verdict: j.verdict, fabricated: j.fabricated, reason: j.reason, hit: item.context && item.context.hit, s: score({ ...a, verdict: j.verdict, fabricated: j.fabricated }, item) };
    });
    return { answers, verified, rows, standing: [...judgements.values()].filter((j) => j.fabricated).length };
  };
  const sets = ['', ...(o.also || [])].map(loadSet);
  const answers = sets.flatMap((s) => s.answers), verified = sets.flatMap((s) => s.verified), rows = sets.flatMap((s) => s.rows);
  const flaggedRaw = sets.reduce((a, s) => a + s.standing, 0);
  const seed = Number(o.seed || 4242);
  const rand = rng(seed);
  const errors = answers.filter((a) => a.error);
  const notIsolated = answers.filter((a) => a.isolated === false);
  const judged = rows.length;
  const parts = [];
  const summary = {};
  const slices = [
    ['All questions', rows],
    ['English (tuned)', rows.filter((r) => r.category === 'english')],
    ['French, all', rows.filter((r) => r.category === 'french')],
    ['French, tuned (the 9 in the main set)', rows.filter((r) => r.category === 'french' && r.set === 'tuned')],
    ['French, held-out (fr2 set, 14)', rows.filter((r) => r.category === 'french' && r.set === 'heldout')],
    ['Unanswerable (negative and wall)', rows.filter((r) => r.category === 'unanswerable')],
    ['Negative only', rows.filter((r) => r.kind === 'negative')],
    ['Wall only', rows.filter((r) => r.kind === 'wall')],
    ['Tuned questions, answerable', rows.filter((r) => r.answerable && r.set === 'tuned')],
    ['Held-out questions', rows.filter((r) => r.set === 'heldout')],
  ];
  for (const [title, sub] of slices) {
    if (!sub.length) continue;
    const t = table(title, sub, rand);
    parts.push(t.text);
    summary[title] = t.data;
  }
  const retr = [true, false].map((hit) => {
    const sub = rows.filter((r) => r.condition === 'C' && r.answerable && r.hit === hit);
    return `C when the context held the expected string: ${hit ? 'yes' : 'no'}: ${sub.length} runs, accuracy ${(mean(sub.map((r) => r.s.accurate)) * 100).toFixed(0)}%, hallucination ${(mean(sub.map((r) => r.s.hallucinated)) * 100).toFixed(0)}%`;
  });
  const fRows = rows.filter((r) => r.condition === 'F');
  if (fRows.length) {
    const offered = fRows.filter((r) => r.s.map_read !== null);
    retr.push(`F runs offered a map: ${offered.length} of ${fRows.length}. Of those, runs that opened a file the map listed: ${offered.filter((r) => r.s.map_read).length}. Only Read calls count, not Grep or Glob.`);
  }
  const header = [`# Answer eval report`, '', `Runs joined with a judgement: ${judged} of ${answers.length}. Errored runs: ${errors.length}. Runs failing the isolation check: ${notIsolated.length}. Fabrication flags checked against the whole knowledge base: ${verified.length}, cleared: ${verified.filter((v) => !v.still_fabricated).length}, left standing: ${flaggedRaw} distinct answers.`, '', 'Accuracy is the share of correct answers; on unanswerable questions, correct means the answer abstained. Hallucination: the judge flagged a fabricated specific that the knowledge base check did not clear, or a wrong answer on an answerable question. Halluc. when answering is the same, leaving out flags on answers that abstained (side remarks about the notes); this column was added after seeing the data. 95% intervals resample questions (2000 draws). Cells are mean [low, high].', '', ...retr, ''].join('\n');
  fs.writeFileSync(path.join(out, o.report || 'report.md'), header + '\n' + parts.join('\n\n') + '\n');
  writeJson(path.join(out, o.summary || 'summary.json'), summary);
  writeJson(path.join(out, o.graded || 'graded.json'), rows.map(({ s, ...r }) => r));
  console.log(`report written, ${judged} rows, ${errors.length} errors`);
}
main();

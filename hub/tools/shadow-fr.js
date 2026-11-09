#!/usr/bin/env node
// tools/shadow-fr.js: French search terms for every passage of a brain, so a
// question asked in French finds a note written in English. Writes
// <brain>/.index/shadow-fr.json, keyed by a hash of each passage: commit it with
// the brain. The hub adds these terms to what it searches and never serves them.
// An edited passage gets a new hash, and its old terms stop applying.
//
// Usage: node hub/tools/shadow-fr.js <brain> [--batch 40] [--model haiku]
// Needs the claude CLI. Run it again after edits: only new passages are sent.
// It runs in an empty directory with project settings only, so no hook from the
// user's settings fires, and nothing is sent to a hub.
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const args = process.argv.slice(2);
const opt = (name, fallback) => { const i = args.indexOf(name); if (i === -1) return fallback; const v = args[i + 1]; args.splice(i, 2); return v; };
const BATCH = +opt('--batch', 40);
const MODEL = opt('--model', 'haiku');
const brain = args[0] && path.resolve(args[0]);
if (!brain || !fs.existsSync(brain)) { console.error('usage: node hub/tools/shadow-fr.js <brain> [--batch 40] [--model haiku]'); process.exit(2); }

const work = fs.mkdtempSync(path.join(os.tmpdir(), 'bureau-shadow-'));
process.env.BUREAU_BRAIN_DIR = brain;
process.env.BUREAU_DATA_DIR = path.join(work, 'data');
process.env.BUREAU_ENV_FILE = path.join(work, 'no.env');
const brainIndex = require('../lib/index');

const file = path.join(brain, brainIndex.SHADOW_FILE);
const old = fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : {};
const chunks = brainIndex.chunkTexts();
const out = Object.fromEntries(chunks.filter((c) => old[c.hash]).map((c) => [c.hash, old[c.hash]]));
const todo = chunks.filter((c) => !old[c.hash]);
const save = () => { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, `${JSON.stringify(out, Object.keys(out).sort(), 0)}\n`); };

const prompt = (items) => `You write French search terms for a bilingual note search index.
For each numbered passage below, output the French words and short phrases a French speaker would type to find it: translate the key terms, add common French synonyms, and keep identifiers, product names and numbers as they are. 10 to 30 terms per passage, plain text, no explanation.
Return ONLY a JSON array of strings, one per passage, in the same order, with exactly ${items.length} elements.

${items.map((c, i) => `#${i}\n${c.text.slice(0, 1200)}`).join('\n\n')}`;

const cwd = path.join(work, 'empty');
fs.mkdirSync(cwd);
let failed = 0;
for (let i = 0; i < todo.length; i += BATCH) {
  const items = todo.slice(i, i + BATCH);
  const res = spawnSync('claude', ['-p', '--model', MODEL, '--setting-sources', 'project', '--strict-mcp-config', '--tools', '', '--no-session-persistence', '--output-format', 'text', prompt(items)],
    { cwd, encoding: 'utf8', maxBuffer: 1 << 26, timeout: 300000 });
  let terms = null;
  if (res.status === 0) { try { terms = JSON.parse(res.stdout.match(/\[[\s\S]*\]/)[0]); } catch { /* counted below */ } }
  if (!Array.isArray(terms) || terms.length !== items.length) { failed += items.length; console.error(`batch at ${i}: no usable answer, skipped`); continue; }
  items.forEach((c, j) => { out[c.hash] = String(terms[j]); });
  save();
  console.error(`${Math.min(i + BATCH, todo.length)} of ${todo.length}`);
}
save();
fs.rmSync(work, { recursive: true, force: true });
console.log(`${Object.keys(out).length} passages in ${brainIndex.SHADOW_FILE}, ${failed} skipped. Run it again to retry those.`);

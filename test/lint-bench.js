// How long does write-time lint take as the brain grows? Builds synthetic
// brains shaped like a real one (curated notes, journal days, project files)
// and times lintFile, the check the hub runs on every curated write.
// Not in CI: timings depend on the machine. Usage: node test/lint-bench.js
// Measured 2026-10-02 on the boss's Mac: 3 ms at 160 files, 15 ms at 1,000,
// 79 ms at 5,000, 180 ms at 10,000. Linear, because every check rereads every
// note to resolve links; a kept-in-memory link index removes that.
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const lint = require('../hub/tools/brain-lint.js');

function note(i, kind) {
  const lines = [];
  for (let k = 0; k < 12; k++) lines.push(`- [fact] observation ${k} of note ${i}, with some words to make it a realistic length for a recipe line (source: t-${i})`);
  return `---\ntitle: ${kind} ${i}\nsummary: "Synthetic ${kind} ${i}."\ncompartment: ${kind}\nscope: global\npermalink: ${kind}-${i}\nversion: 2\n---\n\n${lines.join('\n')}\n\n## Relations\n- see also [[${kind}-${Math.max(0, i - 1)}]]\n`;
}

function build(dir, n) {
  // about 15% curated notes, the rest journal days and project files
  const curated = Math.round(n * 0.15), journal = Math.round(n * 0.25), project = n - curated - journal;
  for (const sub of ['recipes', 'knowledge', 'journal', 'projects/p']) fs.mkdirSync(path.join(dir, sub), { recursive: true });
  for (let i = 0; i < curated; i++) {
    const kind = i % 2 ? 'recipes' : 'knowledge';
    fs.writeFileSync(path.join(dir, kind, `${kind}-${i}.md`), note(i, kind));
  }
  for (let i = 0; i < journal; i++) fs.writeFileSync(path.join(dir, 'journal', `2026-${String(i).padStart(5, '0')}.md`), '- 10:00 [chat] a journal line\n'.repeat(8));
  for (let i = 0; i < project; i++) fs.writeFileSync(path.join(dir, 'projects/p', `doc-${i}.md`), '# A project file\n\nSome prose.\n'.repeat(20));
}

const base = fs.mkdtempSync(path.join(os.tmpdir(), 'lint-bench-'));
try {
  for (const n of [160, 1000, 5000, 10000]) {
    const dir = path.join(base, String(n));
    build(dir, n);
    const candidate = note(0, 'knowledge');
    lint.lintFile(dir, 'knowledge/knowledge-0.md', candidate); // warm the disk cache
    const runs = [];
    for (let r = 0; r < 5; r++) {
      const t0 = process.hrtime.bigint();
      lint.lintFile(dir, 'knowledge/knowledge-0.md', candidate);
      runs.push(Number(process.hrtime.bigint() - t0) / 1e6);
    }
    runs.sort((a, b) => a - b);
    console.log(`${String(n).padStart(6)} files: median ${runs[2].toFixed(0)} ms, worst ${runs[4].toFixed(0)} ms per curated write`);
  }
} finally {
  fs.rmSync(base, { recursive: true, force: true });
}

// test/brain-lint.test.js: test/brain-lint.sh in node, so it runs where there
// is no bash (Windows CI runs this one). Same fixtures, same checks, plus one
// more: the valid brain saved with CRLF endings and a BOM (Notepad) lints
// exactly as it does with LF. Zero deps. Usage: node test/brain-lint.test.js
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const LINT = path.join(ROOT, 'hub', 'tools', 'brain-lint.js');
const FIX = path.join(__dirname, 'fixtures');
let PASS = 0, FAIL = 0;
function check(label, haystack, needle) {
  const ok = needle instanceof RegExp ? needle.test(haystack) : haystack.includes(needle);
  if (ok) { PASS++; console.log(`  ok: ${label}`); }
  else { FAIL++; console.log(`  FAIL: ${label}\n    wanted: ${needle}`); }
}
function refuse(label, haystack, needle) {
  if (!haystack.includes(needle)) { PASS++; console.log(`  ok: ${label}`); }
  else { FAIL++; console.log(`  FAIL: ${label}`); }
}
function lint(dir) {
  const r = spawnSync(process.execPath, [LINT, dir], { encoding: 'utf8' });
  return { out: r.stdout + r.stderr, code: r.status };
}
const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'bureau-lint-'));
const temps = [];

console.log('1. a well-formed brain passes');
const valid = lint(path.join(FIX, 'brain-valid'));
check('lint passes', valid.out, 'LINT PASSED');
check('exit code 0', `exit:${valid.code}`, 'exit:0');
refuse('every summary-bearing file has one, knowledge/INDEX.md exempt', valid.out, 'missing "summary"');
check('no warnings at all (summaries, Now)', valid.out, ' 0 warnings');

console.log('2. a malformed brain fails on each planted defect');
const invalid = lint(path.join(FIX, 'brain-invalid'));
const I = invalid.out;
check('exit code 1', `exit:${invalid.code}`, 'exit:1');
check('unsourced observation caught', I, 'unsourced observation');
check('dangling wikilink caught', I, 'dangling wikilink');
check('missing frontmatter caught', I, 'missing frontmatter');
check('attic lineage gap caught', I, 'missing "retired_reason"');
check('unresolved superseded_by caught', I, 'superseded_by does not resolve');
check('scope-location mismatch caught', I, 'does not match location');
check('missing scope on v2 note caught', I, 'missing "scope"');
check('unknown compartment folder warned', I, 'unknown compartment folder');
check('missing summary warned', I, 'warn: knowledge/no-summary.md: missing "summary"');
check('over-long summary caught', I, /ERROR: knowledge\/long-summary\.md: summary is .* over the 200 limit/);
check('duplicate rule id caught', I, 'duplicate rule id RULE-BROKEN-01');
check('unsourced rule caught', I, 'rule RULE-BROKEN-02 has no source');
check('missing Now warned', I, 'warn: projects/no-now/STATE.md: no "## Now" section');
check('over-long Now warned', I, 'warn: projects/long-now/STATE.md: "## Now" is 31 lines, over the 30 limit');
check('prose in a file-level source caught', I, 'ERROR: recipes/bad-file-source.md: frontmatter "source" holds a malformed ref "the boss said so"');
check('a malformed file source covers nothing', I, 'ERROR: recipes/bad-file-source.md: unsourced observation');
check('prose in a source group warned', I, 'warn: recipes/prose-source.md: source group holds prose');
check('a prose group is no source', I, 'ERROR: recipes/prose-source.md: unsourced observation');

console.log('2b. v0.3 provenance: mission ids and a file-level source count');
refuse('a t- id and a file-level source are both accepted', valid.out, 'recipes/descale-coffee.md');
const { lintFile } = require(LINT);
const one = JSON.stringify(lintFile(path.join(FIX, 'brain-valid'), 'recipes/refill-coffee.md', '---\ntitle: x\nsummary: "x"\ncompartment: recipe\npermalink: refill-coffee\nversion: 1\n---\n\n- [step] no source here\n'));
check("lintFile reports one file's errors only", one, 'recipes/refill-coffee.md: unsourced observation');
refuse('lintFile keeps to the file it was asked about', one, 'descale-coffee');

console.log("3. the repo's own specs (docs/specs) pass as a project's specs/");
const specsBrain = tmp(); temps.push(specsBrain);
fs.mkdirSync(path.join(specsBrain, 'projects', 'bureau', 'specs'), { recursive: true });
for (const f of fs.readdirSync(path.join(ROOT, 'docs', 'specs')).filter(f => f.endsWith('.md')))
  fs.copyFileSync(path.join(ROOT, 'docs', 'specs', f), path.join(specsBrain, 'projects', 'bureau', 'specs', f));
const specs = lint(specsBrain);
check('specs lint passes', specs.out, 'LINT PASSED');
check('specs exit code 0', `exit:${specs.code}`, 'exit:0');
check('specs are linted', specs.out, /^3 files/m);
check('specs carry no warnings', specs.out, ' 0 warnings');

console.log('4. journal records (v0.3): lenient, but a broken record in a format 0.3 day is warned');
const jBrain = tmp(); temps.push(jBrain);
fs.mkdirSync(path.join(jBrain, 'journal'));
fs.copyFileSync(path.join(FIX, 'claims', 'valid', 'journal', '2026-10-02.md'), path.join(jBrain, 'journal', '2026-10-02.md'));
fs.copyFileSync(path.join(FIX, 'claims', 'invalid', 'journal', '2026-10-03.md'), path.join(jBrain, 'journal', '2026-10-03.md'));
fs.writeFileSync(path.join(jBrain, 'journal', '2026-10-01.md'), '- [lesson] a v0.2 day, free text\n');
const journal = lint(jBrain);
check('a broken journal record still passes lint', `exit:${journal.code}`, 'exit:0');
check('and is warned with its line and code', journal.out, 'warn: journal/2026-10-03.md: line 7: E_EVIDENCE');
check('a well-formed day and a v0.2 day are not warned', journal.out, ' 1 warnings');

console.log('5. CRLF and a BOM change nothing');
for (const name of ['brain-valid', 'brain-invalid']) {
  const copy = tmp(); temps.push(copy);
  fs.cpSync(path.join(FIX, name), copy, { recursive: true });
  (function walk(d) {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const p = path.join(d, e.name);
      if (e.isDirectory()) walk(p);
      else if (e.name.endsWith('.md')) fs.writeFileSync(p, '﻿' + fs.readFileSync(p, 'utf8').replace(/\r?\n/g, '\r\n'));
    }
  })(copy);
  const lfRun = name === 'brain-valid' ? valid : invalid;
  const crlfRun = lint(copy);
  check(`${name} saved with CRLF and a BOM: same exit code`, `exit:${crlfRun.code}`, `exit:${lfRun.code}`);
  check(`${name} saved with CRLF and a BOM: same report`, crlfRun.out, lfRun.out);
}

for (const d of temps) fs.rmSync(d, { recursive: true, force: true });
console.log(`\npassed ${PASS}, failed ${FAIL}`);
console.log(FAIL ? 'BRAIN-LINT BROKEN.' : 'BRAIN-LINT OK.');
process.exit(FAIL ? 1 : 0);

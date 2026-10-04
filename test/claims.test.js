// Brain Format v0.3 claims: the fixtures are the contract (docs/brain-format.md,
// "The parsed form"). Zero dependencies: node test/claims.test.js
//
// The reader is hub/lib/claims.js. Every fixture must have a well-formed
// expectation, then every case runs against the reader:
//   valid/    parseFile(md, {path}) deep-equals the .json next to it, and
//             every claim in a format 0.3 file writes back byte for byte
//   invalid/  parseFile reports each { code, line } listed in .expect.json
//   generated cases that are awkward to keep as files (text over 2000 chars)
'use strict';
const fs = require('fs');
const path = require('path');
const assert = require('assert');

const ROOT = path.join(__dirname, 'fixtures', 'claims');
let pass = 0, fail = 0;
const ok = (label) => { pass++; console.log('  ok: ' + label); };
const bad = (label, why) => { fail++; console.log('  FAIL: ' + label + '\n    ' + String(why).split('\n').join('\n    ')); };

function walk(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
    e.isDirectory() ? walk(path.join(dir, e.name)) : [path.join(dir, e.name)]);
}
const mdUnder = (sub) => walk(path.join(ROOT, sub)).filter((f) => f.endsWith('.md')).sort();
const rel = (sub, f) => path.relative(path.join(ROOT, sub), f); // the brain path the fixture stands for

const valid = mdUnder('valid');
const invalid = mdUnder('invalid');

let claims = null;
try { claims = require(path.join(__dirname, '..', 'hub', 'lib', 'claims.js')); } catch (e) {
  if (e.code !== 'MODULE_NOT_FOUND') throw e;
}

// Byte-for-byte write-back needs LF fixtures: .gitattributes keeps them LF in
// every checkout, Windows included. A \r here means that guard is gone.
console.log('0. the fixtures are checked out with LF line endings');
const crlf = walk(ROOT).filter((f) => fs.readFileSync(f).includes(0x0d));
if (crlf.length) bad('no \\r in any fixture', 'check .gitattributes (eol=lf): ' + crlf.map((f) => path.relative(ROOT, f)).join(', '));
else ok('no \\r in any fixture');

console.log('1. every fixture has a well-formed expectation');
for (const f of valid) {
  const exp = f.replace(/\.md$/, '.json');
  try { const j = JSON.parse(fs.readFileSync(exp, 'utf8')); assert.ok(Array.isArray(j.claims) && Array.isArray(j.errors)); ok('valid/' + rel('valid', f)); }
  catch (e) { bad('valid/' + rel('valid', f), e.message); }
}
for (const f of invalid) {
  const exp = f.replace(/\.md$/, '.expect.json');
  try { const j = JSON.parse(fs.readFileSync(exp, 'utf8')); assert.ok(Array.isArray(j) && j.length && j.every((x) => /^E_[A-Z_]+$/.test(x.code) && x.line > 0)); ok('invalid/' + rel('invalid', f)); }
  catch (e) { bad('invalid/' + rel('invalid', f), e.message); }
}

if (!claims) {
  bad('2. reader cases', 'hub/lib/claims.js is missing (' + valid.length + ' valid, ' + invalid.length + ' invalid, 1 generated case cannot run)');
} else {
  console.log('2. valid fixtures parse to their expectation and write back unchanged');
  for (const f of valid) {
    const label = 'valid/' + rel('valid', f);
    const md = fs.readFileSync(f, 'utf8');
    const expected = JSON.parse(fs.readFileSync(f.replace(/\.md$/, '.json'), 'utf8'));
    let got;
    try { got = claims.parseFile(md, { path: rel('valid', f) }); } catch (e) { bad(label + ' parses', e.stack); continue; }
    try { assert.deepStrictEqual(got, expected); ok(label + ' parses as expected'); } catch (e) { bad(label + ' parses as expected', e.message); }
    if (expected.format === '0.3') {
      const lines = md.split('\n');
      for (const c of expected.claims) {
        const span = c.form === 'long' ? 1 + Object.keys(c.fields).length + (c.sources.length ? 1 : 0) + (c.tags.length ? 1 : 0) : 1;
        const original = lines.slice(c.line - 1, c.line - 1 + span).join('\n');
        try { assert.strictEqual(claims.serializeClaim(c), original); ok(label + ' ' + (c.id || 'line ' + c.line) + ' writes back byte for byte'); }
        catch (e) { bad(label + ' ' + (c.id || 'line ' + c.line) + ' writes back byte for byte', e.message); }
      }
    }
  }

  console.log('3. invalid fixtures report each expected error');
  for (const f of invalid) {
    const label = 'invalid/' + rel('invalid', f);
    const want = JSON.parse(fs.readFileSync(f.replace(/\.md$/, '.expect.json'), 'utf8'));
    let got;
    try { got = claims.parseFile(fs.readFileSync(f, 'utf8'), { path: rel('invalid', f) }); } catch (e) { bad(label, e.stack); continue; }
    for (const w of want) {
      if (got.errors.some((e) => e.code === w.code && e.line === w.line)) ok(label + ': ' + w.code + ' on line ' + w.line);
      else bad(label + ': ' + w.code + ' on line ' + w.line, 'got ' + JSON.stringify(got.errors));
    }
  }

  console.log('4. generated cases');
  const long = '---\ntitle: Long\nsummary: Generated.\ncompartment: recipe\nscope: global\npermalink: generated-long\nversion: 3\nformat: 0.3\nsource: t-1\n---\n\n- [fact] ' + 'x'.repeat(2001) + ' ^c-zzzzz0\n';
  const got = claims.parseFile(long, { path: 'recipes/generated-long.md' });
  if (got.errors.some((e) => e.code === 'E_TOO_LONG' && e.line === 12)) ok('text over 2000 characters: E_TOO_LONG on line 12');
  else bad('text over 2000 characters: E_TOO_LONG on line 12', 'got ' + JSON.stringify(got.errors));
}

console.log('passed ' + pass + ', failed ' + fail);
process.exit(fail ? 1 : 0);

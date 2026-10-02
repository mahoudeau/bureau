// Journal records round trip (Brain Format v0.3, "Journal records"): for many
// generated records full of awkward characters, writing a record with
// serializeClaim and reading it back with parseFile gives the same record.
// Zero dependencies, no hub needed: node test/journal.test.js
'use strict';
const assert = require('assert');
const path = require('path');
const claims = require(path.join(__dirname, '..', 'hub', 'lib', 'claims.js'));

let pass = 0, fail = 0;
const ok = (label) => { pass++; };
const bad = (label, why) => { fail++; console.log('  FAIL: ' + label + '\n    ' + String(why).split('\n').join('\n    ')); };

// A seeded generator, so a failure names a case that reproduces
let seed = 20261002;
const rnd = (n) => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed % n; };
const pick = (list) => list[rnd(list.length)];

const PIECES = [
  'deploy', 'the remote tree', 'Quote "smart"', "and 'plain'", 'a # alone', '#deploy', '#v2-hub', 'C# and F#',
  '(parens)', '(source: t-12)', '(source: the docs)', '((nested))', 'https://example.com/page?x=1&y=2#section-2',
  'http://a.b/c_(d)', 'emoji 🚀', '👩‍💻 at work', 'café', 'naïve', 'Zürich', 'Ærøskøbing', 'ﬁ ligature',
  '`code`', '`code (with parens)`', '```fence```', 'key: value', 'a: b: c', '- [fact] inside', '[[journal/2026-08-11]]',
  '[[deploy-hub#^block]]', '^ caret', 'back\\slash', 'pipe | bar', '*stars*', '_under_', '<b>html</b>', '&amp;',
  '50%', '$HOME', '~/path', 'tab\there', 'semi; colon', 'dash - dash', 'end.', 'comma,', '100', 't-356', 'j-ish',
];
const AGENTS = ['consul', 'sol', 'moneta', 'kassad-2', 'brawne'];
const TAGS = ['deploy', 'lftp', 'hub', 'v2', 'a-b-c', '0day'];

function line(min, max) {
  const n = min + rnd(max - min + 1);
  const words = [];
  for (let i = 0; i < n; i++) words.push(pick(PIECES));
  return words.join(' ');
}

// A record as the hub writes it: trimmed one-line text and evidence, the
// fields in any subset the hub can stamp, tags from the tags field only (a
// #word in a record's text stays text).
function record(i) {
  const text = line(1, 12);
  const tags = TAGS.filter(() => rnd(3) === 0);
  const fields = { evidence: line(1, 8), by: pick(AGENTS) };
  if (rnd(2)) fields.mission = 't-' + (1 + rnd(999));
  fields.at = `2026-${String(1 + rnd(12)).padStart(2, '0')}-${String(1 + rnd(28)).padStart(2, '0')}T${String(rnd(24)).padStart(2, '0')}:${String(rnd(60)).padStart(2, '0')}Z`;
  fields.confidence = pick(['observed', 'stated', 'inferred']);
  const id = 'j-' + i.toString(36).padStart(8, '0');
  return { id, kind: pick(claims.KINDS), form: 'long', line: 0, text, tags, sources: [], source_note: null, fields };
}

const FRONT = '---\ntitle: Journal 2026-10-02\ncompartment: journal\nformat: 0.3\n---\n\n';
const N = 500;
const all = [];
for (let i = 0; i < N; i++) {
  const r = record(i);
  const block = claims.serializeClaim(r);
  const got = claims.parseFile(FRONT + block + '\n', { path: 'journal/2026-10-02.md' });
  try {
    assert.deepStrictEqual(got.errors, []);
    assert.strictEqual(got.claims.length, 1);
    assert.deepStrictEqual({ ...got.claims[0], line: 0 }, r);
    assert.strictEqual(claims.serializeClaim(got.claims[0]), block);
    ok('record ' + i);
  } catch (e) { bad('record ' + i + ':\n' + block, e.message); }
  all.push({ r, block });
}
console.log('1. ' + N + ' generated records read back as written');

// A whole day, the way appends build it: blocks joined by one newline, free
// text lines in between (the window), read back in order with their lines.
let day = FRONT, lineNo = FRONT.split('\n').length;
const expected = [];
all.slice(0, 100).forEach(({ r, block }, i) => {
  if (i % 7 === 3) { day += `- 12:0${i % 10} [chat] a free-text line, not a claim\n`; lineNo++; }
  expected.push({ ...r, line: lineNo });
  day += block + '\n';
  lineNo += block.split('\n').length;
});
const parsed = claims.parseFile(day, { path: 'journal/2026-10-02.md' });
try {
  assert.deepStrictEqual(parsed.errors, []);
  assert.deepStrictEqual(parsed.claims, expected);
  ok('a whole day');
} catch (e) { bad('a whole day reads back record by record, with its lines', e.message.slice(0, 2000)); }
console.log('2. a day of 100 records and free-text lines reads back in order');

console.log('passed ' + pass + ', failed ' + fail);
process.exit(fail ? 1 : 0);

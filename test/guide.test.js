// The setup guide's progress: which screen a guide opens on, and when a screen
// counts as finished. Zero dependencies: node test/guide.test.js
//
// hub/public/app/setup/progress.js is an ES module and this is plain node, so
// it is copied to a temporary folder marked as ESM, as markdown.test.js does.
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');

const SRC = path.join(__dirname, '..', 'hub', 'public', 'app', 'setup', 'progress.js');
let pass = 0, fail = 0;
const check = (label, cond, why) => {
  if (cond) { pass++; console.log('  ok: ' + label); }
  else { fail++; console.log('  FAIL: ' + label + (why === undefined ? '' : '\n    ' + JSON.stringify(why))); }
};

async function load() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'guide-test-'));
  fs.writeFileSync(path.join(dir, 'package.json'), '{"type":"module"}');
  fs.copyFileSync(SRC, path.join(dir, 'progress.js'));
  // A file URL: a bare D:\ path is not something import() takes on Windows.
  const mod = await import(require('url').pathToFileURL(path.join(dir, 'progress.js')).href);
  fs.rmSync(dir, { recursive: true, force: true });
  return mod;
}

(async () => {
  const { stepDone, openingStep } = await load();
  // The first screens of /setup, in the shape setup.js builds them.
  let on = false;
  const steps = () => [
    { id: 'start', action: { type: 'none' } },
    { id: 'look', action: { type: 'show' } },
    { id: 'path', action: { type: 'choice', key: 'mode' } },
    { id: 'consul-on', action: { type: 'turnOn', check: () => on } },
    { id: 'done', action: { type: 'done' } },
  ];
  const fresh = () => ({ flags: {}, choices: {} });

  console.log('1. a brand-new guide');
  {
    const local = fresh();
    check('opens on the welcome screen', openingStep(steps(), local).id === 'start', openingStep(steps(), local).id);
    check('the welcome screen is not finished before it is seen', !stepDone(steps()[0], local));
    check('the look picker is not finished before it is seen', !stepDone(steps()[1], local));
  }

  console.log('2. screens seen');
  {
    const local = fresh();
    local.flags.start = true;
    check('welcome seen: it is finished', stepDone(steps()[0], local));
    check('welcome seen: the guide opens on the look picker', openingStep(steps(), local).id === 'look');
    local.flags.look = true;
    check('both seen: the guide opens on the first choice', openingStep(steps(), local).id === 'path');
    local.choices.mode = 'claude';
    check('choice made: the guide opens on the first check', openingStep(steps(), local).id === 'consul-on');
    on = true;
    check('all checks pass: the guide opens on the last screen', openingStep(steps(), local).id === 'done');
    on = false;
  }

  console.log('3. a guide left halfway');
  {
    const local = fresh();
    check('reopens where it was left, even before the welcome is seen', openingStep(steps(), local, 'consul-on').id === 'consul-on');
    check('a saved step that no longer exists falls back to the first unfinished', openingStep(steps(), local, 'gone').id === 'start');
    check('the last screen always counts as finished', stepDone(steps()[4], local));
  }

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });

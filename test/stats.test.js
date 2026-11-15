// lib/stats.js on hand-made missions whose numbers are known: periods and
// their edges, time zones, estimated closes, send-backs, rulings, the waiting
// count, the query checks and one day in order.
// Zero dependencies, no hub needed: node test/stats.test.js
'use strict';
const assert = require('assert');
const path = require('path');
const stats = require(path.join(__dirname, '..', 'hub', 'lib', 'stats.js'));

let pass = 0, fail = 0;
function check(label, fn) {
  try { fn(); pass++; } catch (e) { fail++; console.log(`  FAIL: ${label}\n    ${String(e.message).split('\n').join('\n    ')}`); }
}

const NOW = new Date('2026-11-14T20:00:00Z');
const entry = (ts, by, more = {}) => ({ ts, by, note: more.note || 'x', ...more });
const TASKS = [
  // Filed Monday, claimed, parked for review, sent back, done Wednesday.
  { id: 't-1', title: 'one', project: 'alpha', status: 'done', gate: 'boss', assignee: 'ann', created_at: '2026-11-09T08:00:00Z', log: [
    entry('2026-11-09T09:00:00Z', 'ann', { from: 'queued', to: 'claimed' }),
    entry('2026-11-09T12:00:00Z', 'ann', { from: 'claimed', to: 'review' }),
    entry('2026-11-10T12:00:00Z', 'human', { from: 'review', to: 'queued', kind: 'send_back' }),
    entry('2026-11-10T13:00:00Z', 'ann', { from: 'queued', to: 'claimed' }),
    entry('2026-11-11T09:00:00Z', 'ann', { from: 'claimed', to: 'done' }),
    entry('2026-11-11T09:00:00Z', 'ann', { note: 'approved by boss in session: "yes" (recorded by ann)' }),
  ] },
  // An old mission with notes only: its close is its last entry.
  { id: 't-2', title: 'two', project: 'beta', status: 'done', assignee: 'bob', created_at: '2026-11-02T10:00:00Z', log: [
    entry('2026-11-02T11:00:00Z', 'bob', { note: 'claimed (lease 120m)' }),
    entry('2026-11-03T10:00:00Z', 'human', { note: 'approved via link' }),
  ] },
  // Closed at 23:30 UTC on Sunday 8 Nov: Monday 9 Nov in Paris.
  { id: 't-3', title: 'three', project: 'alpha', status: 'discarded', assignee: null, created_at: '2026-11-08T20:00:00Z', log: [
    entry('2026-11-08T23:30:00Z', 'human', { from: 'queued', to: 'discarded' }),
  ] },
  // Waiting on the boss since Thursday, still waiting.
  { id: 't-4', title: 'four', project: 'beta', status: 'review', gate: 'boss', assignee: 'ann', created_at: '2026-11-12T08:00:00Z', log: [
    entry('2026-11-12T08:30:00Z', 'ann', { from: 'queued', to: 'claimed' }),
    entry('2026-11-12T10:00:00Z', 'ann', { from: 'claimed', to: 'review' }),
  ] },
];
const run = (q) => stats.compute(TASKS, stats.parseQuery(q), null, NOW);

check('weeks start on Monday and cover the range', () => {
  const r = run({ group: 'week', from: '2026-11-02', to: '2026-11-15', tz: 'UTC' });
  assert.deepStrictEqual(r.periods.map((p) => [p.start, p.end]), [['2026-11-02', '2026-11-08'], ['2026-11-09', '2026-11-15']]);
});
check('created and closed land in their weeks (UTC)', () => {
  const r = run({ group: 'week', from: '2026-11-02', to: '2026-11-15', tz: 'UTC' });
  assert.deepStrictEqual(r.periods.map((p) => [p.created, p.done, p.discarded]), [[2, 1, 1], [2, 1, 0]]);
});
check('a time zone moves a close across midnight', () => {
  const r = run({ group: 'week', from: '2026-11-02', to: '2026-11-15', tz: 'Europe/Paris' });
  assert.deepStrictEqual(r.periods.map((p) => p.discarded), [0, 1]);
  assert.strictEqual(r.days.find((d) => d.day === '2026-11-09').created, 1);
});
check('an old mission without status changes is counted and marked estimated', () => {
  const r = run({ group: 'week', from: '2026-11-02', to: '2026-11-15', tz: 'UTC' });
  assert.strictEqual(r.totals.estimated, 1);
  assert.strictEqual(r.totals.done, 2);
});
check('claim to done runs from the first claim', () => {
  const r = run({ group: 'week', from: '2026-11-09', to: '2026-11-15', tz: 'UTC', project: 'alpha' });
  assert.strictEqual(r.totals.claim_to_close.n, 1);
  assert.strictEqual(r.totals.claim_to_close.median_h, 48);
  assert.strictEqual(r.totals.cycle.median_h, 49);
});
check('send-backs and the send-back rate', () => {
  const r = run({ group: 'week', from: '2026-11-02', to: '2026-11-15', tz: 'UTC' });
  assert.strictEqual(r.totals.send_backs, 1);
  assert.strictEqual(r.totals.send_back_rate, 0.5);
});
check('time in review sums every round', () => {
  const r = run({ group: 'week', from: '2026-11-09', to: '2026-11-15', tz: 'UTC', project: 'alpha' });
  assert.strictEqual(r.totals.review_wait.median_h, 24);
});
check('rulings: a send-back, a link approval read from its words, one chat approval', () => {
  const r = run({ group: 'week', from: '2026-11-02', to: '2026-11-15', tz: 'UTC' });
  // other: the boss discarding t-3 by hand.
  assert.deepStrictEqual(r.totals.rulings, { approve: 1, in_chat: 1, send_back: 1, answer: 0, verdict: 0, other: 1 });
});
check('waiting on the boss: now, and at the end of each week', () => {
  const r = run({ group: 'week', from: '2026-11-02', to: '2026-11-15', tz: 'UTC' });
  assert.strictEqual(r.totals.waiting_now, 1);
  assert.deepStrictEqual(r.periods.map((p) => p.waiting_end), [0, 1]);
});
check('the status log starts with the first status change', () => {
  const r = run({ group: 'week', from: '2026-11-02', to: '2026-11-15', tz: 'UTC' });
  assert.strictEqual(r.status_log_since, '2026-11-08');
});
check('per project and per agent', () => {
  const r = run({ group: 'week', from: '2026-11-02', to: '2026-11-15', tz: 'UTC' });
  assert.deepStrictEqual(r.projects.map((p) => [p.project, p.created, p.done]), [['alpha', 2, 1], ['beta', 2, 1]]);
  const ann = r.agents.find((a) => a.agent === 'ann');
  assert.deepStrictEqual([ann.claims, ann.done], [3, 1]);
  assert.strictEqual(r.agents.find((a) => a.agent === 'bob').claims, 1);
});
check('the agent filter keeps that agent\'s missions', () => {
  const r = run({ group: 'week', from: '2026-11-02', to: '2026-11-15', tz: 'UTC', agent: 'bob' });
  assert.strictEqual(r.totals.created, 1);
});
check('months and days', () => {
  const m = run({ group: 'month', from: '2026-10-01', to: '2026-11-14', tz: 'UTC' });
  assert.deepStrictEqual(m.periods.map((p) => [p.start, p.end]), [['2026-10-01', '2026-10-31'], ['2026-11-01', '2026-11-30']]);
  const d = run({ group: 'day', from: '2026-11-09', to: '2026-11-11', tz: 'UTC' });
  assert.deepStrictEqual(d.periods.map((p) => p.done), [0, 0, 1]);
});
check('brain commits by author and compartment, root files left out', () => {
  const commits = [
    { author: 'ann', date: '2026-11-10T10:00:00Z', files: ['journal/2026-11-10.md', 'projects/alpha/STATE.md'] },
    { author: 'ann', date: '2026-11-10T11:00:00Z', files: ['.gitattributes'] },
    { author: 'sol', date: '2026-10-01T10:00:00Z', files: ['recipes/x.md'] },
  ];
  const r = stats.compute(TASKS, stats.parseQuery({ group: 'week', from: '2026-11-09', to: '2026-11-15', tz: 'UTC' }), commits, NOW);
  assert.strictEqual(r.brain.commits, 2);
  assert.deepStrictEqual(r.brain.authors, [{ author: 'ann', commits: 2 }]);
  assert.deepStrictEqual(r.brain.compartments.map((c) => c.compartment).sort(), ['journal', 'projects']);
  assert.strictEqual(run({ group: 'week', tz: 'UTC', to: '2026-11-15' }).brain, null);
});
check('the query: defaults and refusals', () => {
  const q = stats.parseQuery({ to: '2026-11-15' });
  assert.deepStrictEqual([q.group, q.from, q.tz], ['week', '2026-08-24', 'UTC']);
  assert.match(stats.parseQuery({ tz: 'Mars/Olympus' }).error, /time zone/);
  assert.match(stats.parseQuery({ group: 'year' }).error, /group/);
  assert.match(stats.parseQuery({ from: '2026-02-30' }).error, /from/);
  assert.match(stats.parseQuery({ from: '2026-11-10', to: '2026-11-01' }).error, /after/);
  assert.match(stats.parseQuery({ from: '2020-01-01', to: '2026-11-01' }).error, /at most/);
});
check('one day in order, in its time zone', () => {
  const t = stats.timeline(TASKS, { day: '2026-11-09', tz: 'Europe/Paris' }, [{ author: 'ann', date: '2026-11-09T10:30:00Z', message: 'notes' }]);
  assert.deepStrictEqual(t.entries.map((e) => [e.mission, e.to || e.ruling || 'note']), [['t-3', 'discarded'], ['t-1', 'claimed'], ['t-1', 'review']]);
  assert.strictEqual(t.commits.length, 1);
});

console.log(`stats: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);

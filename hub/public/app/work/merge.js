// Awaiting merge: the evidence next to the PR, so the merge decision isn't made
// blind on GitHub.
//
// Boss rulings kept from v2:
// - A row leaves only on a confirmed fact: a real answer saying the PR closed
//   or merged. A failed or rate-limited check changes nothing.
// - Renders never fetch. One ticker talks to GitHub, at most once a minute,
//   one list call per repo.
// - Discarded and failed missions have nothing to merge.
// - READY is his turn: the mission is done, or in review at his gate. Anything
//   else with an open PR is still in the loop and sits apart.
// - The count is confirmed-open READY rows only. Under rate limits it reads low
//   and honest, never high and wrong. Unconfirmed rows still show.

import { h, fill } from '../dom.js';
import { statusWord, swatch } from '../status.js';
import { emptyState } from '../ui.js';
import { evidenceOf, prOf } from './model.js';
import { keyed } from './keyed.js';
import { missionHref, section, thumb } from './parts.js';

const OPEN_TTL = 120000;
const TICK_MS = 60000;
const FIRST_TICK_MS = 1500;
const COOLDOWN_MS = 600000;
const CLOSED_KEY = 'v2-awaitmerge-closed'; // v2's key: closed is permanent, and already paid for

// Module state on purpose: it outlives a trip to another page.
const known = new Map(); // "owner/repo#N" -> { state, ts }
const inflight = new Set();
let rateLimitedUntil = 0;
let lastTick = 0;

try {
  for (const key of JSON.parse(localStorage.getItem(CLOSED_KEY) || '[]')) known.set(key, { state: 'closed', ts: 0 });
} catch { /* start with nothing known */ }

function rememberClosed(key) {
  try {
    const seen = JSON.parse(localStorage.getItem(CLOSED_KEY) || '[]');
    if (!seen.includes(key)) {
      seen.push(key);
      localStorage.setItem(CLOSED_KEY, JSON.stringify(seen));
    }
  } catch { /* it costs one more call next load */ }
}

const prKey = (pr) => `${pr.owner}/${pr.repo}#${pr.number}`;
const abandoned = (t) => t.status === 'failed' || t.status === 'discarded';
const isReady = (t) => t.status === 'done' || (t.status === 'review' && t.gate !== 'critic');

function candidates(state) {
  return ((state && state.tasks) || []).map((t) => {
    if (abandoned(t)) return null;
    const pr = prOf(t);
    return pr ? { task: t, pr } : null;
  }).filter(Boolean);
}

// One list call settles every candidate in the repo. Absent from the list
// means closed only if the list is complete.
async function checkRepo(owner, repo, keys) {
  const repoKey = `${owner}/${repo}`;
  if (inflight.has(repoKey) || Date.now() < rateLimitedUntil) return false;
  inflight.add(repoKey);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 8000);
  try {
    const res = await fetch(`https://api.github.com/repos/${owner}/${repo}/pulls?state=open&per_page=100`, {
      headers: { Accept: 'application/vnd.github+json' },
      signal: controller.signal,
    });
    if (!res.ok) {
      if (res.status === 403 || res.status === 429) rateLimitedUntil = Date.now() + COOLDOWN_MS;
      return false;
    }
    const complete = !/rel="next"/.test(res.headers.get('Link') || '');
    const list = await res.json();
    if (!Array.isArray(list)) return false;
    const open = new Set(list.map((pr) => `${repoKey}#${pr && pr.number}`));
    for (const key of keys) {
      if (open.has(key)) known.set(key, { state: 'open', ts: Date.now() });
      else if (complete) {
        known.set(key, { state: 'closed', ts: Date.now() });
        rememberClosed(key);
      }
    }
    return true;
  } catch {
    return false; // network, CORS or timeout: keep what we knew
  } finally {
    clearTimeout(timeout);
    inflight.delete(repoKey);
  }
}

async function tick(getState, repaint) {
  if (Date.now() < rateLimitedUntil || Date.now() - lastTick < TICK_MS - 5000) return;
  const repos = new Map();
  for (const { pr } of candidates(getState())) {
    const key = prKey(pr);
    const seen = known.get(key);
    if (seen && seen.state === 'closed') continue;
    const repoKey = `${pr.owner}/${pr.repo}`;
    if (!repos.has(repoKey)) repos.set(repoKey, { owner: pr.owner, repo: pr.repo, keys: [], due: false });
    const group = repos.get(repoKey);
    group.keys.push(key);
    if (!seen || Date.now() - seen.ts >= OPEN_TTL) group.due = true;
  }
  const pick = [...repos.values()].filter((g) => g.due).sort((a, b) => b.keys.length - a.keys.length)[0];
  if (!pick) return;
  lastTick = Date.now();
  if (await checkRepo(pick.owner, pick.repo, pick.keys)) repaint();
}

function evidenceFold(task) {
  const { current } = evidenceOf(task.artifacts);
  if (!current.length) return null;
  const grid = h('div', { class: 'work-thumbs work-thumbs-small' });
  // Built on opening: a merge history shouldn't fetch every screenshot it ever had.
  return h('details', {
    class: 'work-fold',
    onToggle(e) { if (e.target.open && !grid.children.length) fill(grid, current.map((it) => thumb(it, { caption: false }))); },
  }, h('summary', null, `Evidence ${current.length}`), grid);
}

function row(o) {
  return h('div', { class: 'work-pr' },
    h('div', { class: 'work-pr-line' },
      h('a', { class: 'work-pr-no om-strong om-link', href: o.pr.url, target: '_blank', rel: 'noopener', title: `Pull request #${o.pr.number} on GitHub` }, `#${o.pr.number}`),
      swatch(o.task.status),
      h('a', { class: 'work-pr-title om-clip om-grow', href: missionHref(o.task.id) }, h('span', { class: 'om-strong' }, o.task.id), ' ', o.task.title),
      o.state === 'unconfirmed' ? h('span', { class: 'om-tag', title: "GitHub hasn't answered yet, so this PR might already be closed." }, 'Unconfirmed') : null,
      o.loop ? h('span', { class: 'om-meta' }, o.task.status === 'review' ? `Review, gate ${o.task.gate}` : statusWord(o.task.status)) : null),
    evidenceFold(o.task));
}

const SIG = (o) => [o.task.id, o.task.title, o.task.status, o.task.gate, o.state, o.pr.url, (o.task.artifacts || []).length];
const KEY = (o) => o.task.id;

export function mergeSection(ctx, getState) {
  const count = h('span', { class: 'om-meta' });
  const ready = h('div', { class: 'work-list' });
  const loopRows = h('div', { class: 'work-list' });
  const loopSummary = h('summary');
  const loop = h('details', { class: 'work-fold', hidden: true }, loopSummary, loopRows);
  const quiet = h('div', null);
  const node = section('Awaiting merge', count, quiet, ready, loop);

  function paint() {
    const open = candidates(getState()).map((c) => {
      const seen = known.get(prKey(c.pr));
      return { ...c, state: (seen && seen.state) || 'unconfirmed', loop: !isReady(c.task) };
    }).filter((o) => o.state !== 'closed');
    const readyRows = open.filter((o) => !o.loop);
    const loopList = open.filter((o) => o.loop);

    const confirmed = readyRows.filter((o) => o.state === 'open').length;
    const unsure = readyRows.length - confirmed;
    count.textContent = `${confirmed} ready${unsure ? `, ${unsure} unconfirmed` : ''}`;

    keyed(ready, readyRows, { key: KEY, sig: SIG, create: row });
    keyed(loopRows, loopList.map((o) => ({ ...o, loop: true })), { key: KEY, sig: SIG, create: row });
    loop.hidden = !loopList.length;
    loopSummary.textContent = `In the loop ${loopList.length}`;
    if (readyRows.length) quiet.replaceChildren();
    else if (!quiet.children.length) fill(quiet, emptyState('Nothing ready to merge'));
  }

  const timer = setInterval(() => tick(getState, paint), TICK_MS);
  const first = setTimeout(() => tick(getState, paint), FIRST_TICK_MS);
  ctx.onCleanup(() => { clearInterval(timer); clearTimeout(first); });

  return { node, paint };
}

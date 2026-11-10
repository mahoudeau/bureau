// One goal: where it's going, the bar, and how far its missions have got.

import { h } from '../dom.js';
import * as store from '../store.js';
import { statusLabel } from '../status.js';
import { emptyState, relativeTime, timeTag } from '../ui.js';
import { byStatus, childrenOf, crumbs, goalName, isGoal, livePainter, meter, missionRow, progress, projectLabel, richText, section } from '../setup/kit.js';

// Sections split on their headings. The form writes this shape, and goals filed
// by agents mostly follow it. Whatever isn't the bar stays with the destination.
function parse(body) {
  const destination = [];
  const bar = [];
  let loops = 0;
  let inBar = false;
  for (const line of String(body || '').split('\n')) {
    const loop = /^##\s*loops:\s*(\d+)\s*$/i.exec(line);
    if (loop) { loops = Number(loop[1]); inBar = false; continue; }
    if (/^##\s*bar\s*$/i.test(line)) { inBar = true; continue; }
    if (/^##\s/.test(line)) inBar = false;
    (inBar ? bar : destination).push(line);
  }
  return { destination: destination.join('\n').trim(), bar: bar.join('\n').trim(), loops };
}

// Files the form uploaded are listed in the bar as "<path> (in the brain)".
function references(bar) {
  return bar.split('\n')
    .map((line) => /^-?\s*(\S.*?) \(in the brain\)\s*$/.exec(line))
    .filter(Boolean)
    .map((m) => m[1]);
}

const brainHref = (path) => `/brain/${path.split('/').map(encodeURIComponent).join('/')}`;

const CYCLE = /^cycle\s+\d+\s*:/i;
const PERPETUAL = /##\s*mode:\s*perpetual/i;

function text(goal) {
  const { destination, bar, loops } = parse(goal.body);
  const refs = references(bar);
  const cycles = PERPETUAL.test(goal.body || '') ? (goal.log || []).filter((l) => CYCLE.test((l.note || '').trim())) : [];
  return h('div', { class: 'set-sections' },
    section('Destination', loops ? `${loops} loops per mission` : null,
      destination ? richText(destination) : h('p', { class: 'om-meta' }, 'No destination written.')),
    bar ? section('The bar', null, richText(bar)) : null,
    refs.length ? section('Reference files', String(refs.length),
      h('ul', { class: 'set-refs' }, refs.map((path) => h('li', null, h('a', { class: 'om-link', href: brainHref(path) }, path))))) : null,
    cycles.length ? section('Cycles', String(cycles.length),
      h('ul', { class: 'set-refs' }, cycles.map((l) => h('li', null, h('span', { class: 'om-meta' }, relativeTime(l.ts)), ' ', l.note)))) : null);
}

function progressPart(goal, state) {
  const children = childrenOf(goal, state.tasks).sort(byStatus);
  return h('div', { class: 'set-sections' },
    h('div', { class: 'set-bigmeter' }, meter(progress(children))),
    section('Missions', String(children.length),
      children.length
        ? h('div', { class: 'om-list set-flush' }, children.map((c) => missionRow(c)))
        : emptyState('No missions yet', 'The lead files them here once it has read the goal.')));
}

function head(goal, state) {
  return h('div', { class: 'set-goalhead' },
    h('h1', { class: 'om-display om-h2 set-title' }, goalName(goal)),
    h('p', { class: 'om-row om-meta set-facts' },
      statusLabel(goal.status),
      h('span', null, projectLabel(state, goal.project)),
      goal.assignee ? h('span', null, goal.assignee) : null,
      h('span', null, 'filed ', timeTag(goal.created_at)),
      h('a', { class: 'om-link', href: `/missions/${encodeURIComponent(goal.id)}`, dataset: { k: 'mission' } }, 'Open as a mission')));
}

export async function render(ctx) {
  let state = await store.ready();
  const id = ctx.params.id;
  const find = () => state.tasks.find((t) => t.id === id);
  const page = h('div', { class: 'app-page set-page' });
  const crumbsNav = crumbs(['Goals', '/goals'], [id]);

  let goal = find();
  if (!goal || !isGoal(goal)) {
    await store.refresh().then((next) => { state = next; }).catch(() => {});
    goal = find();
  }
  if (!goal || !isGoal(goal)) {
    page.append(crumbsNav, emptyState('No such goal', `${id} isn't a goal on this hub, or it's outside what this token can see.`,
      h('a', { class: 'om-link', href: '/goals' }, 'All goals')));
    return page;
  }
  ctx.title(goalName(goal));

  const top = h('div');
  const left = h('div');
  const right = h('div');
  const topPainter = livePainter(top, () => head(find() || goal, state));
  const progressPainter = livePainter(right, () => progressPart(find() || goal, state));
  topPainter.paint();
  progressPainter.paint();

  // Text only redraws when the text changed, so a heartbeat doesn't re-render it.
  let shownText = null;
  const paintText = () => {
    const now = find() || goal;
    const key = `${now.body}\u0000${(now.log || []).length}`;
    if (key === shownText) return;
    shownText = key;
    left.replaceChildren(text(now));
  };
  paintText();

  ctx.onCleanup(store.subscribe((next) => {
    state = next;
    topPainter.paint();
    progressPainter.paint();
    paintText();
  }));
  ctx.onCleanup(topPainter.stop);
  ctx.onCleanup(progressPainter.stop);

  page.append(crumbsNav, top, h('div', { class: 'set-split' }, left, right));
  return page;
}

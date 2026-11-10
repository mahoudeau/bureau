// Every goal, with how far along it is.

import { h } from '../dom.js';
import * as store from '../store.js';
import { statusLabel } from '../status.js';
import { emptyState, timeTag } from '../ui.js';
import { childrenOf, goalName, isClosed, isGoal, livePainter, meter, newestFirst, pageHead, progress, projectLabel, section, setupPage } from '../setup/kit.js';

const newGoal = () => h('a', { class: 'om-btn om-btn-primary', href: '/goals/new' }, 'New goal');

function row(goal, state) {
  return h('a', { class: 'om-row set-goal', href: `/goals/${encodeURIComponent(goal.id)}`, dataset: { k: goal.id } },
    h('span', { class: 'set-status' }, statusLabel(goal.status)),
    h('span', { class: 'set-name' }, h('span', { class: 'om-row-id set-inline-id' }, goal.id), ' ', goalName(goal)),
    h('span', { class: 'om-data-s set-project' }, projectLabel(state, goal.project)),
    meter(progress(childrenOf(goal, state.tasks))),
    h('span', { class: 'om-data-s set-age' }, timeTag(goal.created_at)));
}

function group(title, goals, state) {
  if (!goals.length) return null;
  return section(title, String(goals.length), h('div', { class: 'om-list set-flush' }, goals.map((g) => row(g, state))));
}

function build(state) {
  const goals = state.tasks.filter(isGoal).sort(newestFirst);
  if (!goals.length) {
    return h('div', { class: 'om-sheet' }, emptyState('No goals yet',
      'A goal is a destination and a bar. The lead breaks it into missions, and the meter fills as they get done.',
      newGoal()));
  }
  return h('div', { class: 'set-sections' },
    group('Open', goals.filter((g) => !isClosed(g)), state),
    group('Closed', goals.filter(isClosed), state));
}

export async function render(ctx) {
  let state = await store.ready();
  const list = h('div');
  const painter = livePainter(list, () => build(state));
  painter.paint();
  ctx.onCleanup(store.subscribe((next) => { state = next; painter.paint(); }));
  ctx.onCleanup(painter.stop);
  return setupPage(pageHead('Goals', newGoal()), list);
}

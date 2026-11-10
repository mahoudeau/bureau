// The Desk: what needs the boss, then what's moving. Nothing here is decoration:
// each section answers something the board can't.

import { h, fill } from '../dom.js';
import * as store from '../store.js';
import { swatch, statusWord } from '../status.js';
import { emptyState, relativeTime, timeTag } from '../ui.js';
import { blockedOnMission, byId, byPriority, projectLabel } from '../work/model.js';
import { keyed } from '../work/keyed.js';
import { missionHref, section } from '../work/parts.js';
import { needsSection } from '../work/needs.js';
import { mergeSection } from '../work/merge.js';
import { inboxSection } from '../work/inbox.js';
import { teamSection } from '../work/team.js';
import { officeWindow } from '../work/office.js';

// What the feed says. Heartbeats aren't here: eight agents pinging is noise.
const VERBS = {
  'task.created': 'filed',
  'task.claimed': 'claimed',
  'task.review': 'parked for review',
  'task.done': 'closed',
  'task.failed': 'failed',
  'task.requeued': 'sent back',
  'task.blocked': 'blocked',
  'task.updated': 'updated',
  'task.approved': 'approved, to apply',
  'task.applied': 'applied an item of',
  'agent.registered': 'clocked in',
  'message.posted': 'messaged',
  'knowledge.written': 'wrote',
  'journal.captured': 'captured',
  'project.created': 'created project',
};

function inFlightOf(state) {
  const tasks = state.tasks || [];
  const index = byId(tasks);
  return tasks.filter((t) => ['claimed', 'in_progress', 'approved'].includes(t.status)
    || (t.status === 'review' && t.gate === 'critic')
    || (t.status === 'blocked' && blockedOnMission(t, index)));
}

function flightRow(t) {
  return h('a', { class: 'om-list-row work-row', href: missionHref(t.id) },
    swatch(t.status),
    h('span', { class: 'work-row-word om-meta' }, t.status === 'review' ? 'With critic' : statusWord(t.status)),
    h('span', { class: 'work-row-id om-strong' }, t.id),
    h('span', { class: 'om-grow om-clip' }, t.title),
    t.assignee ? h('span', { class: 'work-row-who om-meta om-clip' }, t.assignee) : null,
    h('span', { class: 'work-row-age om-meta' }, relativeTime(t.created_at)));
}

function flightGroup(group) {
  const list = h('div', { class: 'om-list' });
  const el = h('div', { class: 'work-group' },
    h('div', { class: 'work-group-head om-label' }, h('span', null, group.label), h('span', null, group.tasks.length)),
    list);
  el.fillRows = (tasks) => keyed(list, tasks, {
    key: (t) => t.id,
    sig: (t) => [t.title, t.status, t.assignee, t.gate, relativeTime(t.created_at)],
    create: flightRow,
  });
  el.fillRows(group.tasks);
  return el;
}

function inFlightSection() {
  const count = h('span', { class: 'om-meta' });
  const groups = h('div', { class: 'work-groups' });
  const quiet = h('div', null);
  const node = section('In flight', count, quiet, groups);

  function paint(state) {
    const tasks = inFlightOf(state);
    count.textContent = tasks.length ? String(tasks.length) : '';
    const byProject = new Map();
    for (const t of tasks) {
      if (!byProject.has(t.project)) byProject.set(t.project, []);
      byProject.get(t.project).push(t);
    }
    const list = [...byProject.entries()].map(([id, ts]) => ({ id, label: projectLabel(state, id), tasks: ts.sort(byPriority) }))
      .sort((a, b) => a.label.localeCompare(b.label));
    keyed(groups, list, {
      key: (g) => g.id,
      sig: (g) => [g.label, g.tasks.length],
      create: flightGroup,
    }).forEach((el, i) => el.fillRows(list[i].tasks));
    if (tasks.length) quiet.replaceChildren();
    else if (!quiet.children.length) fill(quiet, emptyState('Nobody is working on anything'));
  }

  return { node, paint };
}

function eventRow(ev) {
  const actor = ev.assignee || ev.by || ev.author || ev.from || ev.name || '';
  // A message's own id means nothing to anyone; who it went to does.
  const target = (/^t-\d+$/.test(ev.id || '') && ev.id) || ev.file || ev.to || '';
  const label = ev.title || ev.note || ev.body || '';
  const inner = [
    timeTag(ev.ts),
    h('span', { class: 'work-event-what om-clip' },
      actor ? h('span', { class: 'om-strong' }, actor) : null, ` ${VERBS[ev.type]}${target ? ` ${target}` : ''}`,
      label ? h('span', { class: 'work-event-label' }, ` ${label}`) : null),
  ];
  return ev.id && /^t-\d+$/.test(ev.id)
    ? h('a', { class: 'om-list-row work-event', href: missionHref(ev.id) }, inner)
    : h('div', { class: 'work-event work-event-plain' }, inner);
}

function recentSection() {
  const list = h('div', { class: 'om-list' });
  const quiet = h('div', null);
  const node = section('Recent', h('a', { class: 'om-meta om-link', href: '/activity' }, 'All activity'), quiet, list);

  function paint(state) {
    const events = (state.log || []).filter((ev) => VERBS[ev.type]).slice(-25).reverse();
    keyed(list, events, {
      key: (ev) => `${ev.ts}|${ev.type}|${ev.id || ev.file || ev.name || ''}`,
      sig: (ev) => [relativeTime(ev.ts)],
      create: eventRow,
    });
    if (events.length) quiet.replaceChildren();
    else if (!quiet.children.length) fill(quiet, emptyState('Nothing has happened yet'));
  }

  return { node, paint };
}

export async function render(ctx) {
  ctx.title('Desk');
  await store.ready();

  const needs = needsSection(ctx);
  const flight = inFlightSection();
  const merge = mergeSection(ctx, () => store.getState());
  const recent = recentSection();
  const inbox = inboxSection(ctx);
  const team = teamSection();

  const page = h('div', { class: 'app-page work-page work-desk' },
    needs.node,
    h('div', { class: 'work-cols' },
      h('div', { class: 'work-main' }, flight.node, merge.node, recent.node),
      h('aside', { class: 'work-rail', 'aria-label': 'The office, inbox and team' }, officeWindow(), inbox.node, team.node)));

  ctx.onCleanup(store.subscribe((state) => {
    needs.paint();
    flight.paint(state);
    merge.paint();
    recent.paint(state);
    team.paint(state);
  }));

  return page;
}

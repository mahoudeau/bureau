// The Desk: what needs the boss, then what's moving. Nothing here is decoration:
// each section answers something the board can't.

import { h, fill } from '../dom.js';
import * as store from '../store.js';
import { swatch, statusWord } from '../status.js';
import { emptyState, relativeTime, timeTag } from '../ui.js';
import { blockedOnMission, byId, byPriority, projectLabel } from '../desk/model.js';
import { keyed } from '../desk/keyed.js';
import { missionHref, section, sideNote } from '../desk/parts.js';
import { needsSection } from '../desk/needs.js';
import { mergeSection } from '../desk/merge.js';
import { inboxSection } from '../desk/inbox.js';
import { teamSection } from '../desk/team.js';
import { officeWindow } from '../desk/office.js';

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
  return h('a', { class: 'om-row work-row', href: missionHref(t.id) },
    swatch(t.status),
    h('span', { class: 'om-row-id' }, t.id),
    h('span', { class: 'om-row-title' }, t.title),
    h('span', { class: 'om-row-meta work-row-word' }, t.status === 'review' ? 'With critic' : statusWord(t.status)),
    h('span', { class: 'om-row-meta work-row-who' }, [t.assignee, relativeTime(t.created_at)].filter(Boolean).join(', ')));
}

function flightGroup(group) {
  const list = h('div', { class: 'om-list' });
  const el = h('div', { class: 'work-group' },
    h('div', { class: 'om-group-head' }, h('span', { class: 'om-label' }, group.label), h('span', { class: 'om-data-s' }, String(group.tasks.length))),
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
  const count = sideNote();
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
    h('span', { class: 'om-row-meta work-event-time' }, timeTag(ev.ts)),
    h('span', { class: 'om-row-title work-event-what' },
      actor ? h('span', { class: 'om-strong' }, actor) : null, ` ${VERBS[ev.type]}${target ? ` ${target}` : ''}`,
      label ? h('span', { class: 'work-event-label' }, ` ${label}`) : null),
  ];
  return ev.id && /^t-\d+$/.test(ev.id)
    ? h('a', { class: 'om-row work-event', href: missionHref(ev.id) }, inner)
    : h('div', { class: 'om-row om-row-static work-event' }, inner);
}

function recentSection() {
  const list = h('div', { class: 'om-list' });
  const quiet = h('div', null);
  const node = section('Recent', h('a', { class: 'om-link om-caption', href: '/activity' }, 'All activity'), quiet, list);

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

  // The layers: one raised sheet for the decisions, plain sheets for what's
  // moving, and the rail for what you glance at.
  const page = h('div', { class: 'work-page work-desk' },
    h('div', { class: 'om-ground om-field-ground' },
      h('div', { class: 'om-workspace' },
        h('div', { class: 'om-work work-main' }, needs.node, flight.node, merge.node, recent.node),
        h('aside', { class: 'om-rail work-rail', 'aria-label': 'The office, inbox and team' }, officeWindow(), inbox.node, team.node))));

  ctx.onCleanup(store.subscribe((state) => {
    needs.paint();
    flight.paint(state);
    merge.paint();
    recent.paint(state);
    team.paint(state);
  }));

  return page;
}

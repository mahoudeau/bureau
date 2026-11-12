// The event feed. The hub hands over its last 200 events with the state, so
// paging happens here, and anything that arrives while the page is open is kept.

import { h } from '../dom.js';
import * as store from '../store.js';
import { emptyState, timeTag } from '../ui.js';
import { livePainter, pageHead, setupPage } from '../setup/kit.js';

const PAGE = 50;

const WORDS = {
  'task.created': 'Filed', 'task.claimed': 'Claimed', 'task.updated': 'Updated', 'task.done': 'Done',
  'task.failed': 'Failed', 'task.review': 'In review', 'task.approved': 'Approved', 'task.applied': 'Applied',
  'task.blocked': 'Blocked', 'task.requeued': 'Back in queue', 'task.approved_in_session': 'Approved in chat',
  'agent.registered': 'Agent online', 'agent.heartbeat': 'Heartbeat', 'agent.removed': 'Agent removed',
  'agent.capabilities_changed': 'Tags changed', 'agent.roles_changed': 'Roles changed',
  'message.posted': 'Message', 'knowledge.written': 'Brain write', 'knowledge.forced': 'Brain write, forced',
  'journal.captured': 'Journal', 'project.created': 'Project created', 'project.renamed': 'Project changed',
  'project.deleted': 'Project deleted', 'settings.changed': 'Settings changed',
  'token.minted': 'Token minted', 'token.revoked': 'Token revoked',
};

const GROUPS = [
  ['missions', 'Missions', (t) => t.startsWith('task.')],
  ['agents', 'Agents', (t) => t.startsWith('agent.') && t !== 'agent.heartbeat'],
  ['brain', 'Brain', (t) => t.startsWith('knowledge.') || t.startsWith('journal.')],
  ['messages', 'Messages', (t) => t.startsWith('message.')],
  ['setup', 'Setup', (t) => t.startsWith('project.') || t.startsWith('settings.') || t.startsWith('token.')],
];

const keyOf = (e) => `${e.ts}|${e.type}|${e.id || ''}|${e.name || ''}|${e.note || ''}`;

// Settings land in the log as a before and an after. Say what moved.
function settingsChange({ before, after }) {
  const flat = (o, prefix = '') => Object.entries(o || {}).flatMap(([k, v]) => (
    v && typeof v === 'object' && !Array.isArray(v) ? flat(v, `${prefix}${k} `) : [[`${prefix}${k}`, String(v)]]));
  const was = new Map(flat(before));
  const now = new Map(flat(after));
  const lines = [...now].filter(([k, v]) => was.get(k) !== v).map(([k, v]) => `${k}: ${v}`);
  for (const k of was.keys()) if (!now.has(k)) lines.push(`${k} cleared`);
  return lines.join(', ');
}

function what(e) {
  if (e.type === 'agent.roles_changed') return (e.after || []).join(', ') || 'No roles';
  if (e.type === 'settings.changed') return settingsChange(e);
  return e.title || e.file || e.body || e.note || '';
}

function row(e) {
  const who = e.assignee || e.name || e.from || e.author || '';
  const text = String(what(e)).slice(0, 200);
  const mission = /^t-\d+$/.test(e.id || '') ? e.id : null;
  return h('li', { class: 'set-event' },
    h('span', { class: 'om-data-s set-event-time' }, timeTag(e.ts)),
    h('span', { class: 'om-label set-event-type' }, WORDS[e.type] || e.type),
    h('span', { class: 'om-strong set-event-who' }, who),
    h('span', { class: 'set-event-what' },
      mission ? [h('a', { class: 'om-link', href: `/missions/${mission}`, dataset: { k: keyOf(e) } }, mission), ' '] : null,
      text));
}

export async function render(ctx) {
  const state = await store.ready();

  // Everything seen since the page opened, oldest first.
  const seen = new Map();
  const merge = (log) => {
    for (const e of log || []) if (!seen.has(keyOf(e))) seen.set(keyOf(e), e);
  };
  merge(state.log);

  let shown = PAGE;
  const picked = new Set((ctx.query.get('type') || '').split(',').filter((k) => GROUPS.some(([key]) => key === k)));
  let heartbeats = ctx.query.get('heartbeats') === '1';

  function wanted(e) {
    if (e.type === 'agent.heartbeat') return heartbeats;
    if (!picked.size) return true;
    return GROUPS.some(([key, , test]) => picked.has(key) && test(e.type));
  }

  const syncUrl = () => ctx.setQuery({ type: [...picked].join(',') || null, heartbeats: heartbeats ? '1' : null });

  const chip = (text, pressed, onClick, key) => h('button', {
    type: 'button',
    class: 'om-chip',
    'aria-pressed': pressed ? 'true' : 'false',
    dataset: { k: key },
    onClick,
  }, text);

  function changed() {
    syncUrl();
    shown = PAGE;
    paintAll();
  }

  const chips = h('div', { class: 'om-chips' });
  function paintChips() {
    const focus = document.activeElement && chips.contains(document.activeElement) ? document.activeElement.dataset.k : null;
    chips.replaceChildren(
      chip('All', !picked.size, () => { picked.clear(); changed(); }, 'all'),
      ...GROUPS.map(([key, word]) => chip(word, picked.has(key), () => {
        if (picked.has(key)) picked.delete(key);
        else picked.add(key);
        changed();
      }, key)));
    if (focus) chips.querySelector(`[data-k="${focus}"]`).focus({ preventScroll: true });
  }

  const toggle = h('input', {
    type: 'checkbox',
    checked: heartbeats,
    onChange() {
      heartbeats = toggle.checked;
      changed();
    },
  });

  const clearFilters = () => {
    picked.clear();
    changed();
  };

  function build() {
    const all = [...seen.values()].filter(wanted).reverse();
    const page = all.slice(0, shown);
    if (!seen.size) {
      return h('div', { class: 'om-sheet' }, emptyState('Nothing yet', 'Events land here as agents claim missions, write to the brain and report back.'));
    }
    if (!all.length) {
      return h('div', { class: 'om-sheet' }, emptyState('Nothing of that type',
        `None of the ${seen.size} events the hub has handed over match.`,
        h('button', { type: 'button', class: 'om-btn', onClick: clearFilters }, 'Show everything')));
    }
    return h('div', { class: 'om-sheet' },
      h('ol', { class: 'set-events' }, page.map(row)),
      h('div', { class: 'om-spread set-events-foot' },
        h('span', { class: 'om-data-s' }, `Showing ${page.length} of ${all.length}. The hub hands over its last 200 events.`),
        all.length > page.length
          ? h('button', {
            type: 'button',
            class: 'om-btn',
            dataset: { k: 'more' },
            onClick() { shown += PAGE; painter.paint(); },
          }, `Show ${Math.min(PAGE, all.length - page.length)} more`)
          : null));
  }

  const feed = h('div');
  const painter = livePainter(feed, build);

  // The last 24 hours as a heat strip, one cell an hour (OMAKO DS, om-heat).
  // Heartbeats stay out unless they're shown below, so the strip and the list agree.
  const heat = h('span', { class: 'om-heat set-heat', role: 'img' });
  const heatLine = h('p', { class: 'om-data-s' });
  function paintHeat() {
    const hour = 3600000;
    const end = Math.ceil(Date.now() / hour) * hour;
    const counts = new Array(24).fill(0);
    for (const e of seen.values()) {
      if (!wanted(e)) continue;
      const at = new Date(e.ts).getTime();
      const i = 23 - Math.floor((end - at - 1) / hour);
      if (i >= 0 && i < 24) counts[i] += 1;
    }
    const total = counts.reduce((a, b) => a + b, 0);
    const max = Math.max(1, ...counts);
    const busiest = counts.indexOf(Math.max(...counts));
    const busyHour = new Date(end - (24 - busiest) * hour).getHours();
    const line = total
      ? `${total} event${total === 1 ? '' : 's'} in the last 24 hours, busiest from ${String(busyHour).padStart(2, '0')}:00`
      : 'Nothing in the last 24 hours';
    heat.dataset.values = counts.map((c) => (c / max).toFixed(2)).join(',');
    heat.setAttribute('aria-label', `${line}. One cell per hour, oldest on the left.`);
    heatLine.textContent = line;
  }

  function paintAll() {
    paintChips();
    paintHeat();
    painter.paint();
  }
  paintAll();

  ctx.onCleanup(store.subscribe((next) => {
    merge(next.log);
    paintHeat();
    painter.paint();
  }));
  ctx.onCleanup(painter.stop);

  return setupPage(
    pageHead('Activity'),
    h('div', { class: 'set-band set-toolbar' },
      chips,
      h('label', { class: 'om-check' }, toggle, 'Include heartbeats')),
    h('section', { class: 'om-sheet om-sheet-body set-pulse' }, heatLine, heat),
    feed);
}

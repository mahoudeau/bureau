// Who works here. The team first, visitors after, and anyone idle for days
// muted at the bottom, never mixed in with the people working now.

import { h } from '../dom.js';
import * as api from '../api.js';
import * as store from '../store.js';
import { confirmButton, emptyState, relativeTime } from '../ui.js';
import { livePainter, pageHead, refusal, section, setupPage } from '../setup/kit.js';

const MINUTE = 60 * 1000;
const DAY = 24 * 60 * MINUTE;

const LIVENESS = {
  active: { word: 'Active', dither: 'om-d100' },
  idle: { word: 'Idle', dither: 'om-d25' },
  offline: { word: 'Offline', dither: 'om-d0' },
};
const TIER = { active: 0, idle: 1, offline: 2 };

const age = (a) => Date.now() - new Date(a.last_seen || 0).getTime();
function liveness(a) {
  const ms = age(a);
  return ms < 5 * MINUTE ? 'active' : ms < 60 * MINUTE ? 'idle' : 'offline';
}

// Kinds that aren't people on the team, or a probe that declared only test tags.
const FIXTURE_TAGS = new Set(['curl', 'test', 'throwaway-verification']);
function isVisitor(a) {
  if (['dummy', 'demo', 'other'].includes(a.kind)) return true;
  const tags = a.capabilities || [];
  return tags.length > 0 && tags.every((c) => FIXTURE_TAGS.has(c));
}

function roles(a, settings, legacy) {
  const set = settings && settings.agents && settings.agents[a.name] && settings.agents[a.name].roles;
  if (set) return set;
  // On a legacy hub the tags an agent declares still count until roles are set.
  if (legacy) return (a.capabilities || []).filter((c) => ['lead', 'critic', 'librarian', 'curator'].includes(c));
  return [];
}

function livenessMark(state) {
  const { word, dither } = LIVENESS[state];
  return h('span', { class: 'app-status set-live' },
    h('span', { class: `om-swatch ${dither}`, 'aria-hidden': 'true' }),
    h('span', { class: 'om-label' }, word));
}

function row(a, view) {
  const state = liveness(a);
  const held = view.tasks.filter((t) => t.assignee === a.name && (t.status === 'claimed' || t.status === 'in_progress'));
  // A fleet only counts while its parent is reporting. A stale one is a lie.
  const fleet = state === 'active' && Array.isArray(a.sub_agents) ? a.sub_agents : [];
  const tags = roles(a, view.settings, view.legacy);
  const refused = view.errors.get(a.name);

  return h('div', { class: 'set-agent' },
    h('div', { class: 'set-agent-row' },
      livenessMark(state),
      h('span', { class: 'set-agent-name' },
        h('span', { class: 'om-strong' }, a.name),
        h('span', { class: 'om-data-s' }, a.kind || '')),
      h('span', { class: 'om-cluster om-cluster-3 set-tags' }, tags.map((t) => h('span', { class: 'om-tag' }, t))),
      h('span', { class: 'set-agent-work' },
        held.length
          ? [h('a', { class: 'om-link', href: `/missions/${encodeURIComponent(held[0].id)}`, dataset: { k: `${a.name}-m` } }, held[0].id),
            ' ', h('span', { class: 'set-held' }, held[0].title),
            held.length > 1 ? h('span', { class: 'om-data-s' }, ` +${held.length - 1}`) : null]
          : h('span', { class: 'om-data-s' }, a.activity || (state === 'offline' ? 'Away' : 'No mission'))),
      h('span', { class: 'om-data-s set-seen' }, a.last_seen ? `Seen ${relativeTime(a.last_seen)}` : 'Never seen'),
      confirmButton('Remove', () => view.remove(a), { title: `Remove ${a.name}?`, body: 'It leaves the roster. Its missions and history stay, and it can register again.', class: 'om-btn om-btn-danger set-remove' })),
    fleet.length ? h('ul', { class: 'set-fleet' }, fleet.map((f) => h('li', null,
      h('span', null, f.label), f.activity ? h('span', { class: 'om-data-s' }, f.activity) : null))) : null,
    refused ? h('p', { class: 'om-field-error set-message', role: 'alert' }, refused) : null);
}

function groupRows(rows, view) {
  return h('div', { class: 'set-agents' }, rows.map((a) => row(a, view)));
}

function byLife(a, b) {
  return TIER[liveness(a)] - TIER[liveness(b)] || age(a) - age(b);
}

function build(view) {
  const agents = view.agents;
  if (!agents.length) {
    return h('div', null, emptyState('No agents yet', 'An agent appears here the first time it registers with the hub.',
      h('a', { class: 'om-link', href: '/settings?tab=tokens' }, 'Mint a token for one')));
  }
  const away = agents.filter((a) => age(a) >= DAY).sort(byLife);
  const present = agents.filter((a) => age(a) < DAY).sort(byLife);
  const team = present.filter((a) => !isVisitor(a));
  const visitors = present.filter(isVisitor);
  const live = team.filter((a) => liveness(a) === 'active').length;
  return h('div', { class: 'set-sections' },
    team.length ? section('Team', `${live} of ${team.length} active`, groupRows(team, view)) : null,
    visitors.length ? section('Visitors', String(visitors.length), groupRows(visitors, view)) : null,
    away.length ? h('div', { class: 'set-muted' }, section('Idle for days', String(away.length), groupRows(away, view))) : null);
}

export async function render(ctx) {
  let state = await store.ready();
  const [health, settings] = await Promise.all([
    api.get('/api/health', { signal: ctx.signal }),
    api.get('/api/settings', { signal: ctx.signal }).then((r) => r.settings),
  ]);
  const errors = new Map();
  const list = h('div');
  let painter = null;

  async function remove(a) {
    errors.delete(a.name);
    try {
      await api.del(`/api/agents/${encodeURIComponent(a.name)}`, { signal: ctx.signal });
      await store.refresh().catch(() => {});
    } catch (err) {
      if (api.isAbort(err)) return;
      errors.set(a.name, refusal(err));
    }
    painter.paint();
  }

  const view = () => ({
    agents: state.agents || [],
    tasks: state.tasks || [],
    settings,
    legacy: health.auth !== 'strict',
    errors,
    remove,
  });

  painter = livePainter(list, () => build(view()));
  painter.paint();
  ctx.onCleanup(store.subscribe((next) => { state = next; painter.paint(); }));
  ctx.onCleanup(painter.stop);

  return setupPage(
    pageHead('Agents', h('a', { class: 'om-btn', href: '/settings?tab=roles' }, 'Roles')),
    list);
}

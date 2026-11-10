// Who works here, short version. Live agents first, idle ones at the bottom.
// Visitors are counted, not listed: /agents has them.

import { h, fill } from '../dom.js';
import { emptyState, relativeTime } from '../ui.js';
import { isVisitor, liveness, roleOf, teamOf } from './model.js';
import { keyed } from './keyed.js';
import { section } from './parts.js';

const LOOK = {
  active: { dither: 'om-d100', word: 'Active' },
  idle: { dither: 'om-d25', word: 'Idle' },
  offline: { dither: 'om-d0', word: 'Offline' },
};
const SHOW = 10;

function agentRow(a) {
  const live = liveness(a);
  const look = LOOK[live];
  // A stale fleet reads as a lie: only a live parent shows one.
  const fleet = live === 'active' && Array.isArray(a.sub_agents) ? a.sub_agents : [];
  return h('div', { class: ['work-agent', live !== 'active' && 'is-quiet'], title: `${look.word}, seen ${relativeTime(a.last_seen)}` },
    h('div', { class: 'work-agent-line' },
      h('span', { class: `om-swatch ${look.dither}`, role: 'img', 'aria-label': look.word, title: look.word }),
      h('span', { class: 'om-strong om-clip' }, a.name),
      h('span', { class: 'om-tag' }, roleOf(a)),
      h('span', { class: 'work-agent-doing om-data-s om-clip' }, a.activity || look.word.toLowerCase())),
    fleet.length ? h('div', { class: 'work-fleet om-data-s' }, fleet.map((s) => h('div', { class: 'om-clip' }, s.label, s.activity ? `: ${s.activity}` : ''))) : null);
}

export function teamSection() {
  const list = h('div', { class: 'work-list' });
  const quiet = h('div', null);
  const foot = h('div', { class: 'work-foot' });
  const node = section('Team', h('a', { class: 'om-link om-caption', href: '/agents' }, 'All agents'), quiet, list, foot);

  function paint(state) {
    const all = (state && state.agents) || [];
    const team = teamOf(all);
    const shown = team.slice(0, SHOW);
    keyed(list, shown, {
      key: (a) => a.name,
      sig: (a) => [a.activity, liveness(a), roleOf(a), a.sub_agents, relativeTime(a.last_seen)],
      create: agentRow,
    });
    if (team.length) quiet.replaceChildren();
    else if (!quiet.children.length) fill(quiet, emptyState('No agents yet'));
    const hidden = team.length - shown.length;
    const visitors = all.filter(isVisitor).length;
    const parts = [];
    if (hidden) parts.push(`${hidden} more`);
    if (visitors) parts.push(`${visitors} visitor${visitors === 1 ? '' : 's'}`);
    foot.textContent = parts.join(', ');
    foot.hidden = !parts.length;
  }

  return { node, paint };
}

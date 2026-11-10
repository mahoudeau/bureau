// The approval policy, in the words the pages use for it.

import { h } from '../dom.js';

export const POLICIES = [
  ['dashboard', 'Dashboard', 'Only you close boss-gate missions, here.'],
  ['in-session', 'In session', 'An agent can close one with your words from the chat.'],
  ['critic', 'Critic', 'The critic or the lead can close one.'],
];

// The word for a project's policy, and where it comes from.
export function approvalWord(settings, id) {
  const own = settings.projects && settings.projects[id] && settings.projects[id].approval;
  if (own) return own;
  const global = settings.global && settings.global.approval;
  return global ? `${global} (global)` : 'dashboard (default)';
}

const globalWord = (settings) => (settings.global && settings.global.approval) || 'dashboard by default';

export function projectSelect(settings, id, props) {
  const own = (settings.projects && settings.projects[id] && settings.projects[id].approval) || '';
  return h('select', { class: 'om-select', ...props },
    h('option', { value: '', selected: !own }, `Inherit (${globalWord(settings)})`),
    POLICIES.map(([value, word]) => h('option', { value, selected: value === own }, word)));
}

export function globalSelect(settings, props) {
  const own = (settings.global && settings.global.approval) || '';
  return h('select', { class: 'om-select', ...props },
    h('option', { value: '', selected: !own }, 'Not set (works as Dashboard)'),
    POLICIES.map(([value, word]) => h('option', { value, selected: value === own }, word)));
}

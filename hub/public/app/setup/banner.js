// The first-run banner: on every page, for an owner, until consul and sol each
// have an app allowed (/setup). It has no close button: the guide itself can
// be left at any step, and this is what brings you back to it. Anyone who is
// not an owner gets a 403 from /api/setup and never sees it.

import { h } from '../dom.js';
import * as api from '../api.js';

let status = null;
let fetchedAt = 0;
let notOwner = false;
const listeners = new Set();

// The guide's status, from the hub. Cached for 30 seconds unless fresh.
export async function setupStatus({ fresh = false, signal } = {}) {
  if (notOwner) return null;
  if (!fresh && status && Date.now() - fetchedAt < 30_000) return status;
  try {
    status = await api.get('/api/setup', { signal, keepSession: true });
    fetchedAt = Date.now();
    listeners.forEach((fn) => fn(status));
    return status;
  } catch (err) {
    if (api.isAbort(err)) throw err;
    if (err && err.status === 403) notOwner = true;
    return null;
  }
}

export function onSetupStatus(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export function setupBanner() {
  const text = h('span');
  const marks = [h('i'), h('i')];
  const button = h('a', { class: 'om-btn om-btn-primary', href: '/setup' }, 'Start setup');
  const el = h('div', { class: 'app-setup-banner', hidden: true },
    h('div', { class: 'om-banner', role: 'status' },
      h('div', { class: 'om-banner-edge om-d50', 'aria-hidden': 'true' }),
      h('div', { class: 'om-banner-body' },
        h('p', null, h('strong', null, 'Finish setting up Bureau.'), ' ', text, ' ', h('span', { class: 'om-steps', 'aria-hidden': 'true' }, marks)),
        button)));
  let path = '/';
  let bare = false;

  function paint(s) {
    const show = !!s && !s.done && !bare && path !== '/setup';
    el.hidden = !show;
    if (!show) return;
    const consul = s.agents.consul.allowed;
    const sol = s.agents.sol.allowed;
    text.textContent = consul ? 'Consul is connected. Sol isn\'t yet.'
      : sol ? 'Sol is connected. Consul isn\'t yet.'
        : 'Consul and sol aren\'t connected yet.';
    marks[0].className = consul ? 'is-done' : '';
    marks[1].className = sol ? 'is-done' : '';
    button.textContent = s.agents.consul.on || s.agents.sol.on ? 'Resume setup' : 'Start setup';
  }
  onSetupStatus(paint);

  return {
    el,
    update(nextPath, isBare) {
      path = nextPath;
      bare = !!isBare;
      if (bare) { el.hidden = true; return; }
      setupStatus().then(paint).catch(() => {});
    },
  };
}

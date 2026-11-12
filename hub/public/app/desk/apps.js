// The Desk's top line when an app is waiting (doc 30, D13): an app that signed
// in as an agent does nothing until an owner allows it, here or in Settings.
// Only owners see it; for anyone else /api/apps answers 403 and nothing shows.

import { h } from '../dom.js';
import * as api from '../api.js';
import { toast } from '../ui.js';
import { section, sideNote } from './parts.js';

export function appsSection(ctx) {
  const count = sideNote();
  const list = h('div', { class: 'om-list' });
  const node = section('Apps waiting for you', count,
    h('p', { class: 'om-data-s' }, 'Each one signed in as an agent and does nothing until you allow it. Deny anything you did not connect yourself.'),
    list);
  node.hidden = true;
  let last = 0, owner = true;

  async function rule(app, status) {
    try {
      await api.post(`/api/apps/${encodeURIComponent(app.id)}`, { status }, { signal: ctx.signal });
      toast(`${app.name || app.client_id} ${status === 'allowed' ? 'allowed' : 'denied'} as ${app.agent}`);
      last = 0;
      paint();
    } catch (err) {
      if (!api.isAbort(err)) toast(err.message);
    }
  }

  async function paint() {
    if (!owner || Date.now() - last < 10_000) return;
    last = Date.now();
    let apps;
    try {
      apps = (await api.get('/api/apps', { signal: ctx.signal, keepSession: true })).apps;
    } catch (err) {
      if (err && err.status === 403) owner = false;
      return;
    }
    const waiting = apps.filter((a) => a.status === 'pending');
    node.hidden = !waiting.length;
    count.textContent = waiting.length ? String(waiting.length) : '';
    list.replaceChildren(...waiting.map((a) => h('div', { class: 'om-row om-row-static' },
      h('span', { class: 'om-row-title' }, h('span', { class: 'om-strong' }, a.name || a.client_id), ` wants to act as ${a.agent}`, a.verified ? '' : ' (unverified app)'),
      h('span', { class: 'om-cluster om-cluster-2' },
        h('button', { type: 'button', class: 'om-btn om-btn-primary', onClick: () => rule(a, 'allowed') }, 'Allow'),
        h('button', { type: 'button', class: 'om-btn', onClick: () => rule(a, 'denied') }, 'Deny')))));
  }

  return { node, paint };
}

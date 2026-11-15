// The Desk's line for a newer Bureau release. The hub checks once a day
// (GET /api/updates, lib/updates.js); this only says so and points at
// Settings, Updates, where the steps are. Only the operator sees it: for anyone
// else the route answers 404 and the Desk stops asking.

import { h } from '../dom.js';
import * as api from '../api.js';

const EVERY_MS = 10 * 60_000;

export function updateNotice(ctx) {
  const line = h('p', null);
  const node = h('div', { class: 'om-banner', role: 'status', hidden: true },
    h('div', { class: 'om-banner-edge om-d25', 'aria-hidden': 'true' }),
    h('div', { class: 'om-banner-body' }, line));
  let last = 0, operator = true;

  async function paint() {
    if (!operator || Date.now() - last < EVERY_MS) return;
    last = Date.now();
    let status;
    try {
      status = await api.get('/api/updates', { signal: ctx.signal, keepSession: true });
    } catch (err) {
      if (err && (err.status === 404 || err.status === 403)) operator = false;
      return;
    }
    node.hidden = !(status && status.behind);
    if (node.hidden) return;
    line.replaceChildren(
      h('strong', null, `Bureau ${status.latest} is out. `),
      `This hub runs ${status.current}. `,
      h('a', { href: '/settings?tab=updates' }, 'What to do before upgrading'));
  }

  return { node, paint };
}

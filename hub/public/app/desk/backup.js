// The Desk's red line for the off-server backup (doc 31, D4): no good copy in
// 36 hours, or no good check on the Mac in 35 days. The hub decides what to
// say (GET /api/backups, status.alerts); this only shows it. Only the operator
// sees it: for anyone else the route answers 404 and the Desk stops asking.

import { h } from '../dom.js';
import * as api from '../api.js';

const EVERY_MS = 60_000;

export function backupNotice(ctx) {
  const lines = h('div', { class: 'om-stack' });
  const node = h('div', { class: 'om-banner', role: 'alert', hidden: true },
    h('div', { class: 'om-banner-edge om-cross', 'aria-hidden': 'true' }),
    h('div', { class: 'om-banner-body' }, lines));
  let last = 0, operator = true;

  async function paint() {
    if (!operator || Date.now() - last < EVERY_MS) return;
    last = Date.now();
    let status;
    try {
      status = (await api.get('/api/backups', { signal: ctx.signal, keepSession: true })).status;
    } catch (err) {
      if (err && (err.status === 404 || err.status === 403)) operator = false;
      return;
    }
    const alerts = (status && Array.isArray(status.alerts)) ? status.alerts : [];
    node.hidden = !alerts.length;
    lines.replaceChildren(...alerts.map((text, i) => h('p', null, i === 0 ? h('strong', null, 'Backup: ') : null, text)));
  }

  return { node, paint };
}

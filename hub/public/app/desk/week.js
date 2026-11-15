// The Desk's "This week" card: done, filed and waiting since Monday, the
// seven days as cells (shaded against each other), and the way into Insights.
// Asks the hub at most once a minute while the Desk is open.

import { h, fill } from '../dom.js';
import * as api from '../api.js';
import { section } from './parts.js';
import { TZ, today, addDays, monday, longDay, shortDay, duration, stat, levels, LEVEL_CLASS } from '../insights/draw.js';

const EVERY_MS = 60000;
const LETTERS = ['M', 'T', 'W', 'T', 'F', 'S', 'S'];

export function weekSection(ctx) {
  const stats = h('div', { class: 'om-stats ins-stats-sm' });
  const days = h('div', { class: 'ins-week' });
  const line = h('p', { class: 'om-caption ins-week-line' });
  const node = section('This week', h('a', { class: 'om-link om-caption', href: '/insights' }, 'Insights'),
    stats, h('div', { class: 'ins-week-body' }, days, line));
  node.hidden = true;
  let at = 0;
  let busy = false;

  async function load() {
    if (busy || Date.now() - at < EVERY_MS) return;
    busy = true;
    at = Date.now();
    const from = monday(today());
    try {
      const r = await api.get(`/api/stats?${new URLSearchParams({ group: 'week', from, to: addDays(from, 6), tz: TZ })}`, { signal: ctx.signal });
      const level = levels(r.days.map((d) => d.entries));
      const t = r.totals;
      fill(stats, stat('Done', String(t.done)), stat('Filed', String(t.created)), stat('Waiting', String(t.waiting_now)));
      fill(days,
        LETTERS.map((l) => h('span', { class: 'ins-lab', 'aria-hidden': 'true' }, l)),
        r.days.map((d) => (d.day > today()
          ? h('span', { class: 'ins-cell ins-l0 ins-later', 'aria-hidden': 'true' })
          : h('a', {
            class: ['ins-cell', LEVEL_CLASS[level(d.entries)]],
            href: `/insights/${d.day}`,
            'aria-label': `${longDay(d.day)}: ${d.entries} log entries, ${d.done} done`,
            title: `${shortDay(d.day)}: ${d.entries} log entries, ${d.done} done`,
          }))));
      const approvals = t.rulings.approve + t.rulings.in_chat;
      line.textContent = [
        t.claim_to_close.n ? `Claim to done: ${duration(t.claim_to_close.median_h)} median.` : null,
        `${approvals} approval${approvals === 1 ? '' : 's'} so far.`,
      ].filter(Boolean).join(' ');
      node.hidden = false;
    } catch (e) {
      // The card is a glance, not a page: on a refusal or an old hub it stays out of the way.
      if (!api.isAbort(e)) node.hidden = true;
    } finally {
      busy = false;
    }
  }

  return { node, paint: load };
}

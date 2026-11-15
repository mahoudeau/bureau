// One day in order, from GET /api/stats/day: every log entry and brain commit,
// grouped by hour in this browser's time zone.

import { h, fill } from '../dom.js';
import * as api from '../api.js';
import { emptyState, errorState, loadingState } from '../ui.js';
import { crumbs, pageHead, setupPage, section } from '../setup/kit.js';
import { TZ, today, addDays, isDay, longDay, weekdayName, hm, stat } from '../insights/draw.js';
import { missionHref } from '../desk/parts.js';

const FILTERS = [
  ['all', 'Everything', () => true],
  ['status', 'Status changes', (r) => !!r.to],
  ['rulings', 'Your rulings', (r) => !!r.ruling],
  ['brain', 'Brain', (r) => r.kind === 'Brain'],
];

// What an entry was, in a word, and the rest of its note.
function words(e) {
  const note = e.note || '';
  if (e.ruling === 'in_chat') return ['Approved in a chat', note.replace(/^approved by boss in session:\s*/, '')];
  if (e.ruling === 'approve') return ['Approved', note.replace(/^approved\b\s*/i, '')];
  if (e.ruling === 'send_back' || (e.from === 'review' && e.to === 'queued')) return ['Sent back', note];
  if (e.ruling === 'answer') return ['Answered', note];
  if (e.ruling === 'verdict') return ['Verdicts', note];
  if (e.to === 'claimed') return ['Claimed', ''];
  if (e.to === 'in_progress') return ['Started', note];
  if (e.to === 'review') return ['In review', note];
  if (e.to === 'blocked') return ['Blocked', note];
  if (e.to === 'done') return ['Done', note];
  if (e.to === 'failed') return ['Failed', note];
  if (e.to === 'discarded') return ['Discarded', note];
  if (e.to === 'queued') return ['Back in queue', note];
  if (e.to === 'approved') return ['Approved, to apply', note];
  if (e.ruling) return ['Your note', note];
  return ['Note', note];
}
const SWATCH = {
  Claimed: 'om-d25', Started: 'om-d50', 'In review': 'om-d75', Done: 'om-d100', Blocked: 'om-hatch',
  'Approved in a chat': 'om-bars', Approved: 'om-bars', 'Sent back': 'om-cross', Brain: 'om-d50',
};

export async function render(ctx) {
  const day = ctx.params.date;
  if (!isDay(day)) return setupPage(emptyState('Not a day', 'Days look like 2026-11-14.', h('a', { class: 'om-link', href: '/insights' }, 'Back to Insights')));
  ctx.title(longDay(day));
  let filter = FILTERS.some(([k]) => k === ctx.query.get('show')) ? ctx.query.get('show') : 'all';

  const before = addDays(day, -1);
  const after = addDays(day, 1);
  const nav = h('span', { class: 'ins-range' },
    h('a', { class: 'om-btn om-btn-sm', href: `/insights/${before}` }, `← ${weekdayName(before)}`),
    after <= today() ? h('a', { class: 'om-btn om-btn-sm', href: `/insights/${after}` }, `${weekdayName(after)} →`) : null);
  const kpis = h('div', { class: 'om-stats ins-stats' });
  const chips = h('div', { class: 'om-chips' });
  const list = h('div', { class: 'ins-tl' }, loadingState());

  const page = setupPage(
    crumbs(['Insights', '/insights'], [longDay(day)]),
    pageHead(longDay(day), nav),
    h('div', { class: 'ins-body' },
      kpis,
      section('In order', `${TZ.replace(/_/g, ' ')} time`, chips, list)));
  page.classList.add('ins-page');

  let rows = [];
  function paintList() {
    chips.replaceChildren(...FILTERS.map(([k, word]) => h('button', {
      type: 'button', class: 'om-chip', 'aria-pressed': k === filter ? 'true' : 'false',
      onClick() { filter = k; ctx.setQuery({ show: k === 'all' ? null : k }); paintList(); },
    }, word)));
    const test = FILTERS.find(([k]) => k === filter)[2];
    const shown = rows.filter(test);
    if (!shown.length) { fill(list, emptyState(rows.length ? 'Nothing of that kind that day' : 'Nothing happened that day')); return; }
    const out = [];
    let hour = '';
    for (const r of shown) {
      const hh = hm(r.ts).slice(0, 2);
      if (hh !== hour) {
        out.push(h('div', { class: 'om-group-head ins-hour' }, h('span', { class: 'om-label' }, `${hh}:00`),
          h('span', { class: 'om-data-s' }, String(shown.filter((x) => hm(x.ts).slice(0, 2) === hh).length))));
        hour = hh;
      }
      out.push(h('div', { class: 'ins-tl-row' },
        h('span', { class: 'om-data-s' }, hm(r.ts)),
        h('span', { class: 'om-label ins-tl-kind' }, SWATCH[r.kind] ? h('span', { class: `om-swatch ${SWATCH[r.kind]}`, 'aria-hidden': 'true' }) : null, r.kind),
        h('div', { class: 'ins-tl-what' },
          r.mission ? h('span', { class: 'om-body-s' }, h('a', { class: 'om-link', href: missionHref(r.mission) }, r.mission), ` ${r.title || ''}`) : null,
          h('span', { class: 'om-caption' }, [r.by, r.text].filter(Boolean).join(': ')))));
    }
    fill(list, out);
  }

  try {
    const r = await api.get(`/api/stats/day?${new URLSearchParams({ date: day, tz: TZ })}`, { signal: ctx.signal });
    rows = r.entries.map((e) => {
      const [kind, text] = words(e);
      return { ts: e.ts, kind, text, mission: e.mission, title: e.title, by: e.by, to: e.to, ruling: e.ruling };
    }).concat((r.commits || []).map((c) => ({ ts: c.ts, kind: 'Brain', text: c.message, by: c.author })))
      .sort((a, b) => (a.ts < b.ts ? -1 : a.ts > b.ts ? 1 : 0));
    const missions = new Set(r.entries.map((e) => e.mission)).size;
    const chat = new Set(r.entries.filter((e) => e.ruling === 'in_chat').map((e) => e.mission)).size;
    fill(kpis,
      stat('Log entries', String(r.entries.length), `on ${missions} mission${missions === 1 ? '' : 's'}`),
      stat('Done', String(r.entries.filter((e) => e.to === 'done').length)),
      stat('Your rulings', String(r.entries.filter((e) => e.ruling && e.ruling !== 'in_chat').length + chat), chat ? `${chat} in a chat` : ''),
      r.commits ? stat('Brain commits', String(r.commits.length)) : null);
    paintList();
  } catch (e) {
    if (api.isAbort(e)) return page;
    fill(list, errorState(e.message, () => ctx.reload()));
  }
  return page;
}

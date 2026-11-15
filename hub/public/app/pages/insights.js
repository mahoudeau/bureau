// Insights: what the bureau did per day, week or month, from GET /api/stats.
// The numbers come from the missions this credential sees, in this browser's
// time zone. A day in the calendar opens that day in order (insights-day.js).

import { h, fill } from '../dom.js';
import * as api from '../api.js';
import * as store from '../store.js';
import { emptyState, errorState, loadingState } from '../ui.js';
import { pageHead, setupPage, section } from '../setup/kit.js';
import {
  TZ, today, addDays, addMonths, isDay, monday, firstOfMonth, shortDay, longDay, monthName,
  duration, stat, calendar, levelKey, flowChart, lineChart, barRows, tooltips,
} from '../insights/draw.js';

const GROUPS = [['day', 'Day'], ['week', 'Week'], ['month', 'Month']];
const REFRESH_MS = 60000;

// The range that ends on `to`: 30 days, 12 weeks or 12 months, whole periods.
export function rangeOf(group, to) {
  if (group === 'day') return { from: addDays(to, -29), to };
  if (group === 'month') return { from: addMonths(firstOfMonth(to), -11), to };
  return { from: addDays(monday(to), -77), to };
}

function periodTip(group, p) {
  const when = group === 'day' ? longDay(p.start) : group === 'week' ? `Week of ${shortDay(p.start)}` : monthName(p.start);
  return `${when}|${p.created} filed|${p.done} done, ${p.discarded + p.failed} discarded or failed`;
}
const periodLabel = (group, p) => (group === 'month' ? monthName(p.start).slice(0, 3) : shortDay(p.start));

function headline(r) {
  const t = r.totals;
  const closed = t.done + t.discarded + t.failed;
  return h('div', { class: 'om-stats ins-stats' },
    stat('Done', String(t.done), `${t.discarded} discarded, ${t.failed} failed`),
    stat('Filed', String(t.created), `${shortDay(r.from)} to ${shortDay(r.to)}`),
    stat('Claim to done', duration(t.claim_to_close.median_h), t.claim_to_close.n ? `median; 1 in 10 over ${duration(t.claim_to_close.p90_h)}` : 'nothing done yet'),
    stat('In your review', duration(t.review_wait.median_h), t.review_wait.n ? `median wait, ${t.review_wait.n} missions` : 'nothing reviewed'),
    stat('Waiting on you', String(t.waiting_now), 'right now'),
    stat('Sent back', t.send_back_rate === null ? 'n/a' : `${Math.round(t.send_back_rate * 100)} %`, closed ? `${t.send_backs} send-backs` : ''));
}

function rulingsBlock(r) {
  const k = r.totals.rulings;
  const rows = [
    { label: 'Approved on the Desk', value: k.approve },
    { label: 'Approved in a chat', value: k.in_chat },
    { label: 'Item verdicts', value: k.verdict },
    { label: 'Sent back', value: k.send_back },
    { label: 'Answered a question', value: k.answer },
  ];
  const all = rows.reduce((a, b) => a + b.value, 0);
  return section('Your rulings', `${all} in all`,
    barRows(rows),
    h('p', { class: 'om-caption ins-note' }, 'Approvals from before the log recorded kinds are read from their words, so they still count.'));
}

function projectsBlock(r, state) {
  const label = (id) => ((state.projects || []).find((p) => p.id === id) || {}).label || id;
  const list = r.projects;
  if (!list.length) return section('Projects', null, emptyState('Nothing in this range'));
  const top = list.slice(0, 10);
  const max = Math.max(...top.map((p) => p.done));
  return section('Projects', list.length > top.length ? `${list.length - top.length} more` : null,
    h('div', { class: 'om-table-wrap' }, h('table', { class: 'om-table set-table ins-table' },
      h('thead', null, h('tr', null,
        h('th', { scope: 'col' }, 'Project'), h('th', { scope: 'col', class: 'ins-n' }, 'Filed'), h('th', { scope: 'col', class: 'ins-n' }, 'Done'),
        h('th', { scope: 'col', class: 'ins-n' }, 'Median to done'), h('th', { scope: 'col' }, 'Share of done'))),
      h('tbody', null, top.map((p) => h('tr', null,
        h('td', { 'data-label': 'Project' }, p.project === 'none' ? 'No project' : h('a', { class: 'om-link', href: `/projects/${encodeURIComponent(p.project)}` }, label(p.project))),
        h('td', { class: 'ins-n', 'data-label': 'Filed' }, String(p.created)),
        h('td', { class: 'ins-n', 'data-label': 'Done' }, String(p.done)),
        h('td', { class: 'ins-n', 'data-label': 'Median to done' }, duration(p.cycle_median_h)),
        h('td', { class: 'ins-bar', 'data-label': 'Share of done' }, h('span', { class: 'ins-share' }, h('i', { style: { width: `${max ? (p.done / max) * 100 : 0}%` } })))))))));
}

function agentsBlock(r) {
  if (!r.agents.length) return section('Agents', null, emptyState('Nobody worked in this range'));
  const top = r.agents.slice(0, 10);
  return section('Agents', r.agents.length > top.length ? `${r.agents.length - top.length} more` : null,
    h('div', { class: 'om-table-wrap' }, h('table', { class: 'om-table set-table ins-table' },
      h('thead', null, h('tr', null, ['Agent', 'Claims', 'Notes', 'Done', 'Discarded'].map((c, i) => h('th', { scope: 'col', class: i ? 'ins-n' : null }, c)))),
      h('tbody', null, top.map((a) => h('tr', null,
        h('td', { 'data-label': 'Agent' }, a.agent === 'unassigned' ? 'Unassigned' : a.agent),
        h('td', { class: 'ins-n', 'data-label': 'Claims' }, String(a.claims)),
        h('td', { class: 'ins-n', 'data-label': 'Notes' }, String(a.notes)),
        h('td', { class: 'ins-n', 'data-label': 'Done' }, String(a.done)),
        h('td', { class: 'ins-n', 'data-label': 'Discarded' }, String(a.discarded))))))),
    h('p', { class: 'om-caption ins-note' }, 'Done counts for whoever held the mission. Unassigned: closed with nobody on it.'));
}

function brainBlock(r) {
  const b = r.brain;
  if (!b) return null;
  return section('Brain', `${b.commits} commits`,
    h('div', { class: 'ins-two' },
      h('div', null, h('h3', { class: 'om-label ins-sub' }, 'By author'), barRows(b.authors.slice(0, 6).map((a) => ({ label: a.author, value: a.commits })))),
      h('div', null, h('h3', { class: 'om-label ins-sub' }, 'By compartment'), barRows(b.compartments.slice(0, 6).map((c) => ({ label: c.compartment, value: c.commits }))))));
}

export async function render(ctx) {
  const state = await store.ready();
  const q = ctx.query;
  let group = GROUPS.some(([k]) => k === q.get('group')) ? q.get('group') : 'week';
  let to = isDay(q.get('to')) && q.get('to') <= today() ? q.get('to') : today();
  let project = q.get('project') || '';
  let agent = q.get('agent') || '';
  let report = null;
  let fetchedAt = 0;
  let ticket = 0;

  const seg = h('div', { class: 'om-seg', role: 'group', 'aria-label': 'Count per' });
  const rangeText = h('span', { class: 'om-data ins-range-text' });
  const earlier = h('button', { type: 'button', class: 'om-btn om-btn-sm', 'aria-label': 'Earlier', onClick() { to = addDays(rangeOf(group, to).from, -1); changed(); } }, '←');
  const later = h('button', { type: 'button', class: 'om-btn om-btn-sm', 'aria-label': 'Later', onClick() {
    // Forward by the range on screen; a month range ends on a month's last day.
    const next = group === 'day' ? addDays(to, 30) : group === 'week' ? addDays(to, 84) : addDays(addMonths(firstOfMonth(to), 13), -1);
    to = next < today() ? next : today();
    changed();
  } }, '→');
  const projectSel = h('select', { class: 'om-select', 'aria-label': 'Project', onChange() { project = projectSel.value; changed(); } },
    h('option', { value: '' }, 'All projects'),
    (state.projects || []).map((p) => h('option', { value: p.id, selected: p.id === project }, p.label || p.id)));
  const agentSel = h('select', { class: 'om-select', 'aria-label': 'Agent', onChange() { agent = agentSel.value; changed(); } },
    h('option', { value: '' }, 'All agents'),
    (state.agents || []).map((a) => h('option', { value: a.name, selected: a.name === agent }, a.name)));

  const body = h('div', { class: 'ins-body' });
  const page = setupPage(
    pageHead('Insights'),
    h('div', { class: 'set-band ins-toolbar' },
      seg,
      h('span', { class: 'ins-range' }, earlier, rangeText, later),
      h('span', { class: 'om-select-wrap' }, projectSel),
      h('span', { class: 'om-select-wrap' }, agentSel)),
    body);
  page.classList.add('ins-page');
  tooltips(page);

  function paintSeg() {
    seg.replaceChildren(...GROUPS.map(([k, word]) => h('button', {
      type: 'button', 'aria-pressed': k === group ? 'true' : 'false',
      onClick() { if (group !== k) { group = k; changed(); } },
    }, word)));
  }

  function changed() {
    ctx.setQuery({ group: group === 'week' ? null : group, to: to === today() ? null : to, project: project || null, agent: agent || null });
    load();
  }

  async function load() {
    const id = ++ticket;
    const range = rangeOf(group, to);
    paintSeg();
    rangeText.textContent = `${shortDay(range.from)} to ${shortDay(range.to)} ${range.to.slice(0, 4)}`;
    later.disabled = to >= today();
    if (!report) fill(body, loadingState());
    const params = new URLSearchParams({ group, from: range.from, to: range.to, tz: TZ });
    if (project) params.set('project', project);
    if (agent) params.set('agent', agent);
    try {
      const r = await api.get(`/api/stats?${params}`, { signal: ctx.signal });
      if (id !== ticket) return;
      report = r;
      fetchedAt = Date.now();
      paint();
    } catch (e) {
      if (api.isAbort(e) || id !== ticket) return;
      fill(body, errorState(e.message, load));
    }
  }

  const charts = [];
  function drawCharts() {
    for (const c of charts) c();
  }

  function paint() {
    const r = report;
    charts.length = 0;
    const busiest = r.days.reduce((a, d) => (d.entries > (a ? a.entries : -1) ? d : a), null);
    const cal = h('div', { class: 'ins-heat' }, calendar(r.days, (d) => `/insights/${d}`, today()));

    const flowBox = h('div', { class: 'ins-chart' });
    const periods = r.periods.map((p) => ({ ...p, label: periodLabel(group, p), tip: periodTip(group, p) }));
    charts.push(() => flowBox.replaceChildren(flowChart(periods, flowBox.clientWidth)));

    // The waiting count is only known once the log records status changes.
    const since = r.status_log_since;
    const waitPoints = r.periods.filter((p) => !since || p.end >= since).map((p) => ({
      label: periodLabel(group, p), value: p.waiting_end,
      tip: `${group === 'day' ? longDay(p.start) : group === 'week' ? `Week of ${shortDay(p.start)}` : monthName(p.start)}|${p.waiting_end} waiting at its end|${p.rulings} rulings`,
    }));
    const waitBox = h('div', { class: 'ins-chart' });
    charts.push(() => waitBox.replaceChildren(lineChart(waitPoints, waitBox.clientWidth, 'Missions waiting on you at the end of each period')));

    const t = r.totals;
    const closed = t.done + t.discarded + t.failed;
    fill(body,
      headline(r),
      section('Every day', busiest && busiest.entries ? `Busiest: ${shortDay(busiest.day)}, ${busiest.entries} entries` : null,
        cal,
        h('div', { class: 'ins-legend om-caption' }, h('span', null, 'Log entries per day. Pick a day to see it in order.'), levelKey())),
      section(`Filed and closed, per ${group}`, null,
        h('div', { class: 'ins-legend om-caption' },
          h('span', { class: 'ins-key' }, h('i', { class: 'ins-cell ins-l0 ins-solidline', 'aria-hidden': 'true' }), 'Filed'),
          h('span', { class: 'ins-key' }, h('i', { class: 'ins-cell ins-l4', 'aria-hidden': 'true' }), 'Done'),
          h('span', { class: 'ins-key' }, h('i', { class: 'ins-cell om-d50', 'aria-hidden': 'true' }), 'Discarded or failed')),
        flowBox,
        // Text sits on a sheet, never on the ground.
        t.estimated
          ? h('p', { class: 'om-caption ins-note' }, `${t.estimated} of the ${closed} closes in this range are estimated: those missions predate status changes in the log, so their close is their last log entry.`)
          : null),
      h('div', { class: 'ins-two' },
        section('Waiting on you', `at the end of each ${group}`,
          waitBox,
          h('p', { class: 'om-caption ins-note' }, since && since > r.from
            ? `Missions in your review or blocked on a question. Counted from ${shortDay(since)}: older logs don't record status changes.`
            : 'Missions in your review or blocked on a question.')),
        rulingsBlock(r)),
      h('div', { class: 'ins-two' }, projectsBlock(r, store.getState() || state), agentsBlock(r)),
      brainBlock(r));
    requestAnimationFrame(drawCharts);
  }

  let resizeTimer = null;
  const onResize = () => { clearTimeout(resizeTimer); resizeTimer = setTimeout(drawCharts, 120); };
  window.addEventListener('resize', onResize);
  ctx.onCleanup(() => { window.removeEventListener('resize', onResize); clearTimeout(resizeTimer); });
  // New work shows up within a minute while the page is open.
  ctx.onCleanup(store.subscribe(() => {
    if (Date.now() - fetchedAt > REFRESH_MS && to === today()) load();
  }));

  load();
  return page;
}

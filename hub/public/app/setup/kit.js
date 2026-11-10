// What goals, projects, agents, activity and settings share: the page head, a
// section, a labelled field, a line that says what went wrong, and a table that
// stacks on a phone.

import { fill, h } from '../dom.js';
import { statusLabel } from '../status.js';
import { timeTag, toast } from '../ui.js';

export const BOSS_ONLY = 'Sign in with the boss token to change this';

// What to show for a refused write. The hub's words, except a 403 on something
// only the boss can do, where the words would only name the rule.
export function refusal(err) {
  if (err && err.status === 403) return BOSS_ONLY;
  return (err && err.message) || 'That failed.';
}

export function pageHead(title, ...right) {
  return h('div', { class: 'om-band-main set-head' },
    h('h1', { class: 'om-display-m set-title' }, title),
    right.length ? h('div', { class: 'om-cluster om-cluster-3' }, right) : null);
}

export function crumbs(...items) {
  return h('nav', { 'aria-label': 'Breadcrumb' },
    h('ol', { class: 'om-crumbs' }, items.map(([text, href]) => h('li', null,
      href ? h('a', { href }, text) : text))));
}

// The page's layers. The breadcrumb and the head at the start go in the band,
// everything after them sits on the ground.
const inBand = (el) => el instanceof Element && (el.tagName === 'NAV' || el.classList.contains('set-head') || el.classList.contains('set-band'));
export function setupPage(...children) {
  const all = children.flat().filter(Boolean);
  let i = 0;
  while (i < all.length && inBand(all[i])) i += 1;
  const band = all.slice(0, i);
  return h('div', { class: 'app-layers set-page' },
    band.length ? h('div', { class: 'om-band' }, h('div', { class: 'om-band-inner om-stack om-stack-3' }, band)) : null,
    h('div', { class: 'om-ground om-field-ground' }, h('div', { class: 'om-container set-body' }, all.slice(i))));
}

export function section(title, meta, ...children) {
  return h('section', { class: 'om-sheet set-section' },
    h('header', { class: 'om-titlebar' },
      h('h2', null, title),
      meta ? h('span', { class: 'om-data-s' }, meta) : null),
    children);
}

let fieldCount = 0;
// A label tied to its control, and a hint the control points at.
export function field(label, control, hint) {
  const id = control.id || `set-f${++fieldCount}`;
  control.id = id;
  let help = null;
  if (hint) {
    help = h('p', { class: 'om-field-help set-hint', id: `${id}-hint` }, hint);
    control.setAttribute('aria-describedby', `${id}-hint`);
  }
  // A select gets the system's arrow.
  const shown = control.tagName === 'SELECT' ? h('span', { class: 'om-select-wrap' }, control) : control;
  return h('div', { class: 'om-field' },
    h('label', { class: 'om-field-label', for: id }, label), shown, help);
}

// One line that says what went wrong, in place. Hidden until it has something.
export function message() {
  const el = h('p', { class: 'om-field-error set-message', role: 'alert', hidden: true });
  return {
    el,
    say(text) {
      el.textContent = text;
      el.hidden = false;
      el.scrollIntoView({ block: 'nearest' });
    },
    clear() { el.textContent = ''; el.hidden = true; },
  };
}

export function notice(text, edge = 'om-d25') {
  return h('div', { class: 'om-banner' },
    h('div', { class: `om-banner-edge ${edge}`, 'aria-hidden': 'true' }),
    h('div', { class: 'om-banner-body' }, text));
}

// columns: [{ label, cell(row), head: bool }]. Below phone width each row
// becomes a block and each cell carries its column's name.
export function table(columns, rows, rowClass) {
  return h('div', { class: 'om-table-wrap' },
    h('table', { class: 'om-table set-table' },
      h('thead', null, h('tr', null, columns.map((c) => h('th', { scope: 'col' }, c.label)))),
      h('tbody', null, rows.map((row) => h('tr', { class: rowClass ? rowClass(row) : null },
        columns.map((c) => h('td', { 'data-label': c.label }, c.cell(row))))))));
}

export function copyButton(value, label = 'Copy') {
  return h('button', {
    type: 'button',
    class: 'om-btn',
    async onClick() {
      try {
        await navigator.clipboard.writeText(typeof value === 'function' ? value() : value);
        toast('Copied');
      } catch {
        toast("Couldn't copy. Select it and copy by hand.");
      }
    },
  }, label);
}

// ---- Missions ----

const CLOSED = new Set(['done', 'failed', 'discarded']);
export const isClosed = (t) => CLOSED.has(t.status);
export const isGoal = (t) => /^goal:/i.test(t.title || '');
export const goalName = (t) => String(t.title || '').replace(/^goal:\s*/i, '');

export const newestFirst = (a, b) => String(b.created_at || '').localeCompare(String(a.created_at || ''));

export function projectLabel(state, id) {
  const p = (state.projects || []).find((x) => x.id === id);
  return (p && p.label) || id || '';
}

// Children cite their goal in the body. That convention is the whole link.
export function childrenOf(goal, tasks) {
  return tasks.filter((t) => {
    if (t.id === goal.id) return false;
    const m = /goal:\s*(t-\d+)/i.exec(t.body || '');
    return !!m && m[1] === goal.id;
  });
}

// A discarded child was never going to happen, so it isn't part of the count.
export function progress(children) {
  const counted = children.filter((t) => t.status !== 'discarded');
  const done = counted.filter((t) => t.status === 'done').length;
  return { done, total: counted.length, value: counted.length ? Math.round((done / counted.length) * 100) : 0 };
}

export function meter({ done, total, value }) {
  const label = total ? `${done} of ${total} done` : 'No missions yet';
  return h('span', { class: 'set-meter' },
    h('span', { class: 'om-meter', style: { '--value': value }, role: 'img', 'aria-label': label }, h('i')),
    h('span', { class: 'om-data-s set-count' }, label));
}

const ORDER = ['blocked', 'review', 'approved', 'in_progress', 'claimed', 'queued', 'done', 'failed', 'discarded'];
const rank = (t) => {
  const i = ORDER.indexOf(t.status);
  return i === -1 ? ORDER.length : i;
};
export const byStatus = (a, b) => rank(a) - rank(b) || newestFirst(a, b);

export function missionRow(t, extra) {
  return h('a', { class: 'om-row set-mission', href: `/missions/${encodeURIComponent(t.id)}`, dataset: { k: t.id } },
    h('span', { class: 'set-status' }, statusLabel(t.status)),
    h('span', { class: 'set-id om-row-id' }, t.id),
    h('span', { class: 'set-name' }, t.title),
    h('span', { class: 'om-data-s set-by' }, t.assignee || extra || ''),
    h('span', { class: 'om-data-s set-age' }, timeTag(t.created_at)));
}

// ---- Live lists ----

// Repaints target from build() when the result differs, and puts focus back
// where it was, so a heartbeat can't take the row out from under a click.
export function livePainter(target, build) {
  let shown = null;
  let timer = null;
  const paint = () => {
    clearTimeout(timer);
    const next = build();
    if (shown && shown.isEqualNode(next)) return;
    const active = document.activeElement;
    const key = active && target.contains(active) ? active.dataset.k : null;
    shown = next;
    fill(target, next);
    if (key) {
      const again = target.querySelector(`[data-k="${CSS.escape(key)}"]`);
      if (again) again.focus({ preventScroll: true });
    }
  };
  return { paint, stop: () => clearTimeout(timer) };
}

// ---- Text ----

let markdown = null;
const loadMarkdown = () => {
  if (!markdown) markdown = import('../markdown.js').catch(() => null);
  return markdown;
};

// Preserved plain text at once, rendered markdown as soon as there is a
// renderer. Stays plain text if there isn't one.
export function richText(text) {
  const box = h('div', { class: 'set-plain' }, text);
  loadMarkdown().then(async (mod) => {
    if (!mod || !mod.renderMarkdown) return;
    const node = await mod.renderMarkdown(text);
    box.classList.remove('set-plain');
    fill(box, node);
  }).catch(() => { /* the plain text is already there */ });
  return box;
}

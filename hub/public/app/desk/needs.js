// Needs me now: the page's one raised sheet, rows ruled where they stand.
// Approve needs one click. Send back and Answer open a note on the row, because
// the agent needs to know what to change. Only the next decision's button is
// solid: the ink goes to one place.

import { h, fill } from '../dom.js';
import { statusWord, swatch } from '../status.js';
import * as store from '../store.js';
import { relativeTime, toast } from '../ui.js';
import { lastEntry, needsMe, oldestFirst, projectLabel, undecided } from './model.js';
import { keyed } from './keyed.js';
import { missionHref, movedOn, refusalLine, remember, keep, rule } from './parts.js';
import { batchBar, batchRefusal } from './batch.js';

function clipNote(text, n = 140) {
  const s = String(text || '').replace(/\s+/g, ' ').trim();
  return s.length > n ? `${s.slice(0, n)}...` : s;
}

export function needsSection(ctx) {
  let newest = remember('deskNewestFirst', false);
  const ruled = new Set(); // gone from here the moment the hub said yes
  const selection = new Set();
  const trays = new Map(); // id -> open tray kind, survives a repaint

  const hint = h('span', { class: 'om-caption work-needs-hint', hidden: true }, 'Tick two or more to rule on them together');
  const count = h('span', { class: 'om-count work-needs-count' });
  const sort = h('button', {
    type: 'button',
    class: 'om-btn om-btn-ghost om-btn-sm',
    onClick() {
      newest = !newest;
      keep('deskNewestFirst', newest);
      paint();
    },
  });
  const list = h('div', { class: 'work-needs-list' });
  const clear = h('p', { class: 'work-clear', hidden: true }, 'Nothing needs you.');
  const batch = batchBar({
    getState: () => store.getState(),
    selection,
    onChange: () => paint(),
    onDone: () => store.refresh().catch(() => {}),
  });

  const node = h('section', { class: 'om-raised work-needs', 'aria-labelledby': 'work-needs-title' },
    h('header', { class: 'om-titlebar om-titlebar-active work-needs-head' },
      h('h1', { id: 'work-needs-title' }, 'Needs me now'),
      h('div', { class: 'om-cluster om-cluster-3' }, hint, sort, count)),
    clear, list, batch.node);

  const visible = () => {
    const rows = needsMe(store.getState()).filter((t) => !ruled.has(t.id)).sort(oldestFirst);
    return newest ? rows.reverse() : rows;
  };

  // After a ruling the next item comes up, ready for the keyboard: on its title,
  // never on its ruling button. Enter opens the mission. A held or repeated Enter
  // must not walk down the queue approving everything it lands on.
  function focusNext(position) {
    const rows = [...list.querySelectorAll('.work-need')];
    const next = rows[Math.min(position, rows.length - 1)];
    if (next) next.querySelector('.work-need-title').focus();
  }

  function row(t) {
    const refusal = refusalLine();
    const head = h('div', { class: 'om-need work-need-head' });
    const tray = h('form', { class: 'work-need-tray', hidden: true });
    const el = h('div', { class: 'work-need', dataset: { id: t.id } }, head, tray, refusal.el);
    let current = t;

    async function decide(status, note, button) {
      const position = visible().findIndex((x) => x.id === current.id);
      refusal.clear();
      el.querySelectorAll('button, input').forEach((b) => { b.disabled = true; });
      try {
        const moved = status === 'done' ? await movedOn(current.id, current.log ? current.log.length : null) : null;
        if (moved) {
          toast(moved.status === 'review'
            ? `${current.id} is back for a new round. Nothing was approved.`
            : `${current.id} already moved on: it is ${statusWord(moved.status)} now. Nothing was approved.`);
          el.querySelectorAll('button, input').forEach((b) => { b.disabled = false; });
          await store.refresh().catch(() => {});
          focusNext(position);
          return;
        }
        await rule(current.id, { status, note });
      } catch (e) {
        el.querySelectorAll('button, input').forEach((b) => { b.disabled = false; });
        refusal.show(e.message);
        if (button) button.focus();
        return;
      }
      ruled.add(current.id);
      selection.delete(current.id);
      trays.delete(current.id);
      toast(`${current.id}: ${status === 'done' ? 'approved' : current.status === 'blocked' ? 'answered' : 'sent back'}.`);
      paint();
      focusNext(position);
      store.refresh().catch(() => {});
    }

    function openTray(kind) {
      trays.set(current.id, kind);
      const input = h('input', {
        class: 'om-input',
        placeholder: kind === 'answer' ? 'Your answer' : 'What should change',
        'aria-label': kind === 'answer' ? `Your answer on ${current.id}` : `What should change on ${current.id}`,
        onKeydown(e) { if (e.key === 'Escape') { e.preventDefault(); closeTray(); } },
      });
      const send = h('button', { type: 'submit', class: 'om-btn om-btn-primary' }, kind === 'answer' ? 'Send answer' : 'Send back');
      fill(tray, input, send, h('button', { type: 'button', class: 'om-btn', onClick: closeTray }, 'Cancel'));
      tray.onsubmit = (e) => {
        e.preventDefault();
        const note = input.value.trim();
        if (!note) {
          refusal.show(kind === 'answer' ? 'Write the answer first.' : 'Write what should change, so the agent knows.');
          input.focus();
          return;
        }
        decide('queued', note, send);
      };
      tray.hidden = false;
      el.classList.remove('is-next');
      el.querySelectorAll('.work-need-go').forEach((b) => b.classList.remove('om-btn-primary'));
      input.focus();
    }

    function closeTray() {
      trays.delete(current.id);
      tray.hidden = true;
      tray.replaceChildren();
      refusal.clear();
      paint();
      el.querySelector('.work-need-title').focus();
    }

    function paintHead(task) {
      current = task;
      const open = undecided(task).length;
      const review = task.status === 'review';
      const last = lastEntry(task);
      // The main action goes solid only on the first row, set in paint().
      const go = ['om-btn', 'om-btn-sm', 'work-need-go', el.classList.contains('is-next') && 'om-btn-primary'];
      const actions = [];
      if (review && open) actions.push(h('a', { class: go, href: missionHref(task.id) }, 'Review'));
      if (review && !open) actions.push(h('button', { type: 'button', class: go, onClick: (e) => decide('done', 'approved', e.currentTarget) }, 'Approve'));
      if (review) actions.push(h('button', { type: 'button', class: 'om-btn om-btn-sm', onClick: () => openTray('back') }, 'Send back'));
      if (!review) actions.push(h('button', { type: 'button', class: go, onClick: () => openTray('answer') }, 'Answer'));

      fill(head,
        // A box only where a batch would take it. A question needs its own
        // answer, and undecided items or a critic gate need their own page.
        !batchRefusal(task)
          ? h('label', { class: 'om-check work-need-pick' },
            h('input', {
              type: 'checkbox',
              checked: selection.has(task.id),
              'aria-label': `Select ${task.id} for a batch verdict`,
              onChange(e) {
                if (e.target.checked) selection.add(task.id); else selection.delete(task.id);
                batch.paint();
              },
            }))
          : h('span', { class: 'work-need-pick', 'aria-hidden': 'true' }),
        swatch(task.status),
        h('div', { class: 'om-need-main work-need-main' },
          h('a', { class: 'om-need-title work-need-title', href: missionHref(task.id), title: task.title },
            h('span', { class: 'om-need-id' }, task.id), h('span', { class: 'om-clip work-need-text' }, task.title)),
          h('div', { class: 'om-need-meta work-need-meta' },
            h('span', null, projectLabel(store.getState(), task.project)),
            task.assignee ? h('span', null, task.assignee) : null,
            h('span', null, relativeTime(task.created_at)),
            open ? h('span', { class: 'om-tag' }, `${open} to rule`) : null,
            !review && last ? h('span', { class: 'work-need-asked om-clip', title: last.note }, clipNote(last.note)) : null)),
        h('div', { class: 'om-actions work-need-actions' }, actions));
    }

    el.paintHead = paintHead;
    paintHead(t);
    if (trays.has(t.id)) openTray(trays.get(t.id));
    return el;
  }

  function paint() {
    const state = store.getState();
    for (const id of [...ruled]) if (!needsMe(state).some((t) => t.id === id)) ruled.delete(id);
    const rows = visible();
    const n = rows.length;
    // A row that stopped being batchable has lost its box, so it can't stay ticked.
    for (const t of rows) if (batchRefusal(t)) selection.delete(t.id);
    hint.hidden = rows.filter((t) => !batchRefusal(t)).length < 2;
    count.textContent = n ? String(n) : '';
    count.hidden = !n;
    count.setAttribute('aria-label', `${n} waiting`);
    sort.textContent = newest ? 'Newest first' : 'Oldest first';
    sort.hidden = n < 2;
    clear.hidden = n > 0;
    keyed(list, rows, {
      key: (t) => t.id,
      sig: (t) => [t.title, t.status, t.gate, t.project, t.assignee, undecided(t).length, relativeTime(t.created_at), lastEntry(t) && lastEntry(t).note],
      create: row,
      patch: (el, t) => el.paintHead(t),
    }).forEach((el, i) => {
      // Ticks follow the selection without rebuilding the row under the cursor.
      const box = el.querySelector('.work-need-pick input');
      if (box) box.checked = selection.has(rows[i].id);
      // One solid button on the sheet: the next decision's.
      // With a note open, the note's own button is the decision instead.
      const solid = i === 0 && !trays.has(rows[i].id);
      el.classList.toggle('is-next', solid);
      el.querySelectorAll('.work-need-go').forEach((b) => b.classList.toggle('om-btn-primary', solid));
    });
    batch.paint();
    ctx.title(n ? `Desk (${n})` : 'Desk');
  }

  return { node, paint };
}

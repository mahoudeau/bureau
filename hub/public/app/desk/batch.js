// One verdict across several reviews. The risk here is rubber-stamping, so a
// mission is refused from a batch when it still has undecided items or sits at
// the critic's gate, and every approval lists the titles and asks you to say
// you read them. Eligibility is read off the live state, not off the moment
// the box was ticked: a mission that changes drops out on its own.

import { h, fill } from '../dom.js';
import { statusWord } from '../status.js';
import { toast } from '../ui.js';
import { movedOn, rule, refusalLine } from './parts.js';

function refusal(t) {
  if (!t) return 'no longer on the board';
  if (t.status !== 'review') return 'left review';
  if (t.gate === 'critic') return 'critic gate';
  if (Array.isArray(t.items) && t.items.some((it) => it.verdict === 'proposed')) return 'has unread items';
  return null;
}

// selection is the Desk's Set of ids. onDone runs after a batch is applied.
export function batchBar({ getState, selection, onChange, onDone }) {
  const node = h('div', { class: 'work-batch', hidden: true });
  let confirming = false;
  let confirmSig = '';
  let busy = false;

  function clear() {
    selection.clear();
    confirming = false;
    onChange();
    paint();
  }

  function read() {
    const tasks = new Map(((getState() && getState().tasks) || []).map((t) => [t.id, t]));
    const rows = [...selection].map((id) => ({ id, t: tasks.get(id), reason: refusal(tasks.get(id)) }));
    return { eligible: rows.filter((r) => !r.reason), refused: rows.filter((r) => r.reason) };
  }

  async function apply(ids, status, noteEl, err) {
    if (busy) return;
    const note = noteEl.value.trim();
    if (status === 'queued' && !note) {
      err.show('Write a note, so every agent knows what to change.');
      noteEl.focus();
      return;
    }
    busy = true;
    node.querySelectorAll('button, input').forEach((el) => { el.disabled = true; });
    const results = await Promise.all(ids.map(async (id) => {
      try {
        const moved = status === 'done' ? await movedOn(id) : null;
        if (moved) return `${id}: already moved on, it is ${statusWord(moved.status)} now.`;
        await rule(id, { status, note: note || (status === 'done' ? 'approved (batch)' : '') });
        return null;
      } catch (e) {
        return `${id}: ${e.message}`;
      }
    }));
    busy = false;
    const failures = results.filter(Boolean);
    const applied = ids.length - failures.length;
    selection.clear();
    confirming = false;
    onChange();
    onDone();
    paint();
    if (failures.length) {
      toast(`${applied} applied, ${failures.length} refused.`);
      fill(node, h('p', { class: 'work-refusal', role: 'alert' }, failures.join(' ')),
        h('button', { type: 'button', class: 'om-btn', onClick: () => { node.hidden = true; } }, 'OK'));
      node.hidden = false;
    } else {
      toast(`${status === 'done' ? 'Approved' : 'Sent back'}: ${applied}.`);
    }
  }

  function paintConfirm(eligible) {
    const err = refusalLine();
    const noteEl = h('input', { class: 'om-input', placeholder: 'Note. Optional to approve, required to send back', 'aria-label': 'Note for all of them' });
    const approve = h('button', { type: 'button', class: 'om-btn om-btn-primary', disabled: true, onClick: () => apply(eligible.map((r) => r.id), 'done', noteEl, err) }, 'Approve all');
    const back = h('button', { type: 'button', class: 'om-btn', disabled: true, onClick: () => apply(eligible.map((r) => r.id), 'queued', noteEl, err) }, 'Send back all');
    const ack = h('input', {
      type: 'checkbox',
      onChange() { approve.disabled = !ack.checked; back.disabled = !ack.checked; },
    });
    fill(node,
      h('p', { class: 'om-label' }, `One verdict for ${eligible.length} missions`),
      h('ul', { class: 'work-batch-list' }, eligible.map((r) => h('li', { class: 'om-clip' }, h('span', { class: 'om-strong' }, r.id), ' ', r.t.title))),
      h('label', { class: 'om-check' }, ack, `I read these ${eligible.length} titles`),
      noteEl,
      err.el,
      h('div', { class: 'om-row' }, approve, back,
        h('button', { type: 'button', class: 'om-btn om-btn-ghost', onClick() { confirming = false; paint(); } }, 'Cancel')));
  }

  function paint() {
    if (busy) return;
    if (!selection.size) {
      node.hidden = true;
      node.replaceChildren();
      confirming = false;
      return;
    }
    node.hidden = false;
    const { eligible, refused } = read();
    const sig = JSON.stringify([eligible.map((r) => [r.id, r.t.title]), refused.map((r) => r.id)]);

    if (confirming && !refused.length && eligible.length >= 2) {
      // A repaint mid-confirm would drop the note and the tick. Only a change
      // in what's being ruled on is worth that.
      if (sig !== confirmSig) { confirmSig = sig; paintConfirm(eligible); }
      return;
    }
    confirming = false;
    confirmSig = '';

    const canBatch = eligible.length >= 2 && !refused.length;
    fill(node,
      h('div', { class: 'om-spread' },
        h('span', { class: 'om-strong' }, `${selection.size} selected`),
        h('div', { class: 'om-row' },
          canBatch ? h('button', { type: 'button', class: 'om-btn om-btn-primary', onClick() { confirming = true; paint(); } }, 'Review and apply') : null,
          h('button', { type: 'button', class: 'om-btn om-btn-ghost', onClick: clear }, 'Clear'))),
      refused.length ? h('p', { class: 'work-batch-why' }, `One at a time: ${refused.map((r) => `${r.id} ${r.reason}`).join(', ')}.`) : null,
      eligible.length === 1 && !refused.length ? h('p', { class: 'work-batch-why' }, 'Select one more to batch.') : null);
  }

  return { node, paint };
}

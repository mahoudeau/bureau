// A mission, as a page. Its status decides its shape. Where the boss has to rule,
// the decision is pinned to the window and the thing to judge is the one raised
// sheet. Where he's only watching, it's a single quiet column. A ruling moves on
// to the next thing that needs him.

import { h, fill, on } from '../dom.js';
import * as api from '../api.js';
import * as store from '../store.js';
import { statusLabel, statusWord, swatch } from '../status.js';
import { emptyState, relativeTime, timeTag, toast } from '../ui.js';
import { appear } from '../motion.js';
import {
  evidenceOf, findReplacement, goalChildren, goalRef, isGoal, isTerminal, lastEntry, nextNeeding, plainArtifacts,
  prOf, projectLabel, roundOf, waitingOnId,
} from '../desk/model.js';
import { isTypingIn, keyed } from '../desk/keyed.js';
import { kbd, missionHref, movedOn, refusalLine, rule, thumb } from '../desk/parts.js';

const BODY_FOLD_CHARS = 1400;
const MAX_STEPS = 12; // Past this, a row of little boxes stops saying anything.
const VERDICT_WORD = { approved: 'Accepted', rejected: 'Rejected', later: 'Later', proposed: 'To rule' };
const VERDICTS = [['approved', 'Accept', 'A'], ['rejected', 'Reject', 'R'], ['later', 'Later', 'L']];
const KEY_VERDICT = { a: 'approved', r: 'rejected', l: 'later' };
const DECIDING = new Set(['review', 'blocked', 'failed', 'approved', 'discarded']);

let markdown = null;
function loadMarkdown() {
  if (!markdown) markdown = import('../markdown.js').catch(() => null);
  return markdown;
}

function bodyNode(text, module, compact) {
  if (module && typeof module.renderMarkdown === 'function') {
    try {
      const node = module.renderMarkdown(text, {});
      if (node instanceof Node) {
        if (compact && node.classList) node.classList.add('om-prose-compact');
        return node;
      }
    } catch (e) {
      console.warn(e);
    }
  }
  return h('pre', { class: 'work-plain' }, text);
}

function notFound(id) {
  return h('div', { class: 'app-page work-page' },
    emptyState('No such mission', `There is no ${id} on this hub.`, h('a', { class: 'om-link', href: '/missions' }, 'Back to the board')));
}

// The time on a line of the log: a clock today, a date before that.
function fmtClock(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  return d.toDateString() === new Date().toDateString()
    ? d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
    : d.toLocaleDateString([], { month: 'short', day: 'numeric' });
}

const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;

function fact(label, ...value) {
  return [h('dt', null, label), h('dd', null, ...value)];
}

function stat(label, ...value) {
  return h('div', { class: 'om-stat' }, h('span', { class: 'om-label' }, label), h('span', { class: 'om-title' }, ...value));
}

function titlebar(title, side, active) {
  return h('header', { class: ['om-titlebar', active && 'om-titlebar-active'] }, h('h3', null, title), side || null);
}

function logRow(l) {
  const moved = l.from && l.to ? `${statusWord(l.from)} to ${statusWord(l.to)}` : null;
  return h('li', null,
    h('time', { class: 'om-timeline-time', datetime: l.ts, title: new Date(l.ts).toLocaleString() }, fmtClock(l.ts)),
    h('span', { class: ['om-timeline-dot', moved && 'is-key'], 'aria-hidden': 'true' }),
    h('div', { class: 'om-timeline-body work-log-text' },
      h('b', null, l.by), ' ',
      moved ? h('span', { class: 'om-tag' }, moved) : null, ' ',
      l.note));
}

function payloadBlock(it) {
  if (!it.payload || !Array.isArray(it.payload.ops)) return null;
  let applied = null;
  if (it.applied_at) applied = `applied ${relativeTime(it.applied_at)} by ${it.applied_by || 'its holder'}`;
  else if (it.verdict === 'approved') applied = 'not applied yet';
  return h('div', { class: 'work-payload' },
    it.payload.ops.map((o) => h('div', { class: 'om-diff' },
      h('div', { class: 'om-diff-head' }, h('span', { class: 'work-payload-file' }, o.file), h('span', null, o.op === 'append' ? 'Appends' : 'Writes')),
      // The exact text being approved, whole. It scrolls instead of clipping.
      h('pre', { class: 'work-pre', tabindex: '0' }, o.content))),
    h('p', { class: 'om-data-s work-payload-seal' },
      h('span', { title: it.payload_sha256 || '' }, `sha256 ${String(it.payload_sha256 || '').slice(0, 12)}`),
      applied ? h('span', { class: it.applied_at ? 'om-strong' : '' }, applied) : null));
}

export async function render(ctx) {
  const id = ctx.params.id;
  ctx.title(id);

  const firstState = await store.ready();
  let task = (firstState.tasks || []).find((x) => x.id === id);
  if (!task) {
    try {
      const r = await api.get(`/api/tasks/${encodeURIComponent(id)}`, { signal: ctx.signal });
      task = r && r.task;
    } catch (e) {
      if (e.status === 404 || e.status === 400) return notFound(id);
      throw e;
    }
    if (!task) return notFound(id);
  }
  const md = await loadMarkdown();

  const drafts = new Map(); // item id -> { verdict?, comment? }
  let cursor = -1;
  let busy = false;
  let bodyOpen = false;
  let pendingControls = false;
  let noteText = '';
  let shape = 'watch'; // queue: items to rule. single: one thing to judge. watch: nothing needs him.
  const memo = new Map();

  const changed = (name, value) => {
    const mark = JSON.stringify(value);
    if (memo.get(name) === mark) return false;
    memo.set(name, mark);
    return true;
  };

  // ---- The frame. Each part repaints alone, and moves when the shape does. ----

  const crumbs = h('div', { class: 'om-cluster' });
  const nextSlot = h('div', { class: 'om-cluster' });
  const askEl = h('p', { class: 'om-band-ask work-ask' });
  const adviceEl = h('p', { class: 'om-caption', hidden: true });
  const headEl = h('div', { class: 'om-stack om-stack-2 work-head' });
  const toolsEl = h('div', { class: 'om-cluster' });
  const noteField = h('input', { class: 'om-input', placeholder: 'Add a note to the log', 'aria-label': 'Note for the log' });
  const noteRefusal = refusalLine();
  const noteForm = h('form', {
    class: 'work-note-form',
    hidden: true,
    onSubmit(e) { e.preventDefault(); saveNote(); },
  }, noteField,
  h('button', { type: 'submit', class: 'om-btn om-btn-primary' }, 'Add note'),
  h('button', { type: 'button', class: 'om-btn om-btn-ghost', onClick: hideNote }, 'Cancel'),
  noteRefusal.el);

  const statsEl = h('section', { class: 'om-sheet', hidden: true });
  const bodyEl = h('section', { class: 'om-sheet', hidden: true });
  const evidenceEl = h('section', { class: 'om-sheet', hidden: true });
  const artifactsEl = h('section', { class: 'om-sheet', hidden: true });
  const factsEl = h('section', { class: 'om-sheet', 'aria-label': 'Details' });

  const itemsTitle = h('h2', null, 'Items');
  const itemsSteps = h('span', { class: 'om-steps', 'aria-hidden': 'true' });
  const itemsCount = h('span', { class: 'om-label' });
  const itemsKeys = h('span', { class: 'om-cluster work-keys' }, kbd('1-9'), kbd('A'), kbd('R'), kbd('L'), kbd('Enter'));
  const itemsHead = h('header', { class: 'om-titlebar' }, h('div', { class: 'om-queue-head' }, itemsTitle, itemsSteps, itemsCount), itemsKeys);
  const itemsList = h('ol', { class: 'work-items' });
  const itemBatchEl = h('div', { class: 'work-batch work-item-batch', hidden: true });
  const itemsEl = h('section', { class: 'om-sheet', hidden: true }, itemsHead, itemsList, itemBatchEl);

  const logMeta = h('span', { class: 'om-disclosure-meta' });
  const logList = h('ol', { class: 'om-timeline' });
  const logDetails = h('details', { class: 'om-disclosure' },
    h('summary', null, 'Activity', logMeta),
    h('div', { class: 'om-disclosure-body' }, logList));
  const logEl = h('section', { class: 'om-sheet' }, logDetails);

  const workEl = h('div', { class: 'om-work' });
  const railEl = h('aside', { class: 'om-rail', 'aria-label': 'Reference' });
  const layoutEl = h('div', { class: 'om-work-single' }, workEl, railEl);

  const dockLabel = h('span', { class: 'om-label' });
  const dockSteps = h('span', { class: 'om-steps', 'aria-hidden': 'true' });
  const dockState = h('div', { class: 'om-dock-state' }, dockLabel, dockSteps);
  // data-more: a Bayer band into the dock while there's more to scroll (OMAKO DS).
  const barEl = h('div', { class: 'om-dock work-dock', role: 'region', 'aria-label': 'Decision', hidden: true, dataset: { more: '' } });

  const page = h('div', { class: 'work-page work-mission', dataset: { density: 'comfortable' } },
    h('div', { class: 'om-band' },
      h('div', { class: 'om-band-inner om-stack om-stack-3' },
        h('div', { class: 'om-band-top' }, crumbs, nextSlot),
        h('div', { class: 'om-band-main' }, headEl, toolsEl),
        noteForm)),
    h('div', { class: 'om-ground om-field-ground work-ground' }, layoutEl),
    barEl);

  fill(crumbs,
    h('ol', { class: 'om-crumbs' },
      h('li', null, h('a', { href: '/missions' }, 'Missions')),
      h('li', null, id)),
    kbd('Esc'));

  function currentNext() {
    return nextNeeding(store.getState(), task);
  }

  function paintNext() {
    const next = currentNext();
    if (changed('next', next && next.id)) {
      fill(nextSlot, next
        ? [h('a', { class: 'om-link', href: missionHref(next.id), title: next.title }, `Next: ${next.id}`), kbd('N')]
        : []);
    }
  }

  // ---- The shape ----

  const editableStatus = () => !isTerminal(task) && task.status !== 'approved';
  const hasItems = () => (task.items || []).length > 0;
  const deciding = () => DECIDING.has(task.status) || (editableStatus() && hasItems());

  function paintLayout() {
    let next = 'watch';
    if (deciding()) next = hasItems() ? 'queue' : 'single';
    shape = next;
    if (!changed('layout', [shape, task.status])) return;

    layoutEl.className = shape === 'watch' ? 'om-work-single' : 'om-workspace';
    railEl.hidden = shape === 'watch';
    itemsEl.className = shape === 'queue' ? 'om-raised' : 'om-sheet';
    itemsHead.classList.toggle('om-titlebar-active', shape === 'queue');
    bodyEl.className = shape === 'single' ? 'om-raised' : 'om-sheet';
    logDetails.open = shape === 'watch' || task.status === 'blocked';

    if (shape === 'queue') {
      workEl.replaceChildren(itemsEl);
      railEl.replaceChildren(bodyEl, evidenceEl, artifactsEl, factsEl, logEl);
    } else if (shape === 'single') {
      workEl.replaceChildren(bodyEl, evidenceEl, artifactsEl);
      railEl.replaceChildren(factsEl, logEl);
    } else {
      workEl.replaceChildren(statsEl, bodyEl, evidenceEl, artifactsEl, itemsEl, factsEl, logEl);
      railEl.replaceChildren();
    }
  }

  function paintHead() {
    if (!changed('head', [task.title, task.status, task.gate, task.assignee, task.project, roundOf(task), relativeTime(task.created_at)])) return;
    ctx.title(`${task.id} ${task.title}`);
    const round = roundOf(task);
    fill(headEl,
      h('div', { class: 'om-cluster' },
        statusLabel(task.status),
        h('span', { class: 'om-tag' }, `Gate: ${task.gate || 'boss'}`),
        round ? h('span', { class: 'om-tag' }, `Round ${round}`) : null),
      h('h1', { class: 'om-display-m work-m-title' }, task.title),
      askEl,
      adviceEl,
      h('div', { class: 'om-band-meta' },
        h('span', { class: 'om-strong' }, task.id),
        h('span', null, task.assignee || 'Nobody on it'),
        h('a', { class: 'om-link', href: `/projects/${encodeURIComponent(task.project)}` }, projectLabel(store.getState(), task.project)),
        timeTag(task.created_at)));
  }

  // One sentence: what this page wants from the boss right now.
  function askText() {
    const items = task.items || [];
    const open = items.filter((it) => verdictOf(it) === 'proposed').length;
    const left = items.filter((it) => it.verdict === 'approved' && it.payload && !it.applied_at).length;
    const holder = task.assignee || 'its agent';
    switch (task.status) {
      case 'review':
        if (!items.length) return 'Approve it or send it back.';
        return open ? `Rule on ${plural(open, 'item')}, then approve or send back.` : 'Every item is ruled. Approve or send back.';
      case 'blocked': {
        const waiting = waitingOnId(task);
        if (waiting) return `Waiting on ${waiting}.`;
        const asked = [...(task.log || [])].reverse().find((l) => l.to === 'blocked') || lastEntry(task);
        return asked && asked.note ? `${asked.by}: ${asked.note}` : 'Waiting on your answer.';
      }
      case 'failed': return 'It failed. Re-queue it or discard it.';
      case 'discarded': return 'Discarded. Re-queue it to bring it back.';
      case 'approved': return left ? `Approved. With ${holder} to apply the accepted items, then close.` : 'Everything accepted is applied. Ready to close.';
      case 'done': return 'Closed.';
      case 'queued': return 'In the queue. Nothing needs you yet.';
      default: return task.assignee ? `${task.assignee} has this. Nothing needs you yet.` : 'Nobody has this yet.';
    }
  }

  function paintAsk() {
    askEl.textContent = askText();
    const returns = task.status === 'review' && task.after_approval === 'return';
    adviceEl.hidden = !returns;
    if (returns) adviceEl.textContent = `Approving returns this to ${task.assignee || 'its agent'}, who applies the accepted items exactly as shown and closes it. Every item needs a verdict first.`;
  }

  // ---- More, and the note ----

  let closeMenu = null;
  let closeDialog = null;
  ctx.onCleanup(on(document, 'click', (e) => {
    if (closeMenu && !e.target.closest('.work-more')) closeMenu();
  }));
  ctx.onCleanup(() => {
    if (closeDialog) closeDialog();
  });

  function moreMenu() {
    const close = () => {
      menu.hidden = true;
      button.setAttribute('aria-expanded', 'false');
      closeMenu = null;
    };
    const menu = h('div', { class: 'om-menu work-more-menu', role: 'menu', hidden: true },
      h('button', {
        type: 'button',
        class: 'om-menu-item',
        role: 'menuitem',
        onClick() { close(); openDiscard(button); },
      }, 'Discard'));
    const button = h('button', {
      type: 'button',
      class: 'om-btn om-btn-icon',
      'aria-label': 'More',
      'aria-haspopup': 'menu',
      'aria-expanded': 'false',
      onClick() {
        if (!menu.hidden) { close(); return; }
        menu.hidden = false;
        button.setAttribute('aria-expanded', 'true');
        closeMenu = close;
      },
    }, h('i', { class: 'om-icon om-i-more', 'aria-hidden': 'true' }));
    return h('div', {
      class: 'work-more',
      onKeydown(e) {
        if (e.key !== 'Escape' || menu.hidden) return;
        e.preventDefault();
        close();
        button.focus();
      },
    }, button, menu);
  }

  function openDiscard(returnTo) {
    if (closeDialog) return;
    const err = refusalLine();
    const why = h('input', { class: 'om-input', id: 'work-discard-why', value: noteText });
    const working = !['queued', 'blocked', 'failed', 'review', 'approved'].includes(task.status) && task.assignee;
    const keep = h('button', { type: 'button', class: 'om-btn om-btn-ghost', onClick: () => closeDialog() }, 'Keep it');
    const confirm = h('button', {
      type: 'button',
      class: 'om-btn om-btn-primary',
      async onClick() {
        if (busy) return;
        err.clear();
        busy = true;
        confirm.disabled = true;
        const verdicts = collectVerdicts();
        let response;
        try {
          response = await rule(task.id, { status: 'discarded', note: why.value.trim() || currentNote() || 'discarded by the boss', ...(verdicts.length ? { verdicts } : {}) });
        } catch (e) {
          busy = false;
          confirm.disabled = false;
          if (!api.isAbort(e)) err.show(e.message);
          return;
        }
        busy = false;
        closeDialog();
        await adopt(response.task);
        showResult('Discarded.');
      },
    }, `Discard ${task.id}`);
    const scrim = h('div', {
      class: 'om-scrim',
      onClick(e) { if (e.target === scrim) closeDialog(); },
      onKeydown(e) {
        if (e.key === 'Escape') {
          e.preventDefault();
          e.stopPropagation();
          closeDialog();
          return;
        }
        if (e.key !== 'Tab') return;
        const stops = [...scrim.querySelectorAll('button:not(:disabled), input')];
        const first = stops[0];
        const last = stops[stops.length - 1];
        if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
        else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
      },
    },
    h('div', { class: 'om-dialog', role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': 'work-discard-title' },
      h('header', { class: 'om-dialog-head' },
        h('h2', { id: 'work-discard-title' }, `Discard ${task.id}?`),
        h('button', { type: 'button', class: 'om-btn om-btn-icon om-btn-sm', 'aria-label': 'Close', onClick: () => closeDialog() }, h('i', { class: 'om-icon om-i-x', 'aria-hidden': 'true' }))),
      h('div', { class: 'om-dialog-body' },
        h('p', null, working ? `${task.assignee} will stop working on it. You can re-queue it later.` : 'You can re-queue it later.'),
        h('div', { class: 'om-field' },
          h('label', { class: 'om-field-label', for: 'work-discard-why' }, 'Why ', h('em', null, '(optional)')),
          why),
        err.el),
      h('footer', { class: 'om-dialog-foot' }, keep, confirm)));
    closeDialog = () => {
      scrim.remove();
      closeDialog = null;
      if (returnTo && returnTo.isConnected) returnTo.focus();
    };
    document.body.append(scrim);
    why.focus();
  }

  function showNote() {
    noteForm.hidden = false;
    noteField.focus();
  }

  function hideNote() {
    noteForm.hidden = true;
    noteField.value = '';
    noteRefusal.clear();
  }

  async function saveNote() {
    const note = noteField.value.trim();
    if (!note || busy) return;
    noteRefusal.clear();
    busy = true;
    let response;
    try {
      response = await rule(task.id, { note });
    } catch (e) {
      busy = false;
      if (!api.isAbort(e)) noteRefusal.show(e.message);
      return;
    }
    busy = false;
    hideNote();
    toast('Note added.');
    await adopt(response.task);
  }

  function paintTools() {
    if (!changed('tools', [task.status, shape])) return;
    const canDiscard = task.status !== 'done' && task.status !== 'discarded';
    const canNote = shape === 'watch' && task.status !== 'done';
    if (!canNote) hideNote();
    closeMenu = null;
    fill(toolsEl,
      canNote ? h('button', { type: 'button', class: 'om-btn', onClick: showNote }, h('i', { class: 'om-icon om-i-comment', 'aria-hidden': 'true' }), 'Add note') : null,
      canDiscard ? moreMenu() : null);
  }

  // ---- What he reads ----

  function paintBody() {
    if (!changed('body', [task.body, bodyOpen, shape])) return;
    if (!task.body) { bodyEl.hidden = true; bodyEl.replaceChildren(); return; }
    bodyEl.hidden = false;
    const long = task.body.length > BODY_FOLD_CHARS;
    const raised = shape === 'single';
    fill(bodyEl,
      titlebar('Brief', null, raised),
      h('div', { class: raised ? 'om-raised-body' : 'om-sheet-body' },
        h('div', { class: ['work-body', long && !bodyOpen && 'is-folded'] }, bodyNode(task.body, md, shape === 'queue')),
        long ? h('button', {
          type: 'button',
          class: 'om-btn om-btn-ghost work-body-more',
          onClick() { bodyOpen = !bodyOpen; paintBody(); },
        }, bodyOpen ? 'Fold' : 'Read all') : null));
  }

  // What the boss sees is always the round being judged: the newest burst of
  // images first, older rounds folded away. Each image appears once.
  function paintEvidence() {
    const inReview = task.status === 'review';
    if (!changed('evidence', [task.artifacts, inReview])) return;
    const { current, history } = evidenceOf(task.artifacts);
    if (!current.length && !history.length && !inReview) { evidenceEl.hidden = true; evidenceEl.replaceChildren(); return; }
    evidenceEl.hidden = false;
    fill(evidenceEl,
      titlebar('Evidence', current.length ? h('span', { class: 'om-label' }, `Current round ${current.length}`) : null),
      h('div', { class: 'om-sheet-body' },
        current.length ? h('div', { class: 'work-thumbs' }, current.map((it) => thumb(it))) : h('p', { class: 'work-none om-data-s' }, 'No images attached.'),
        history.length ? h('details', { class: 'work-fold' },
          h('summary', null, `History ${history.length}`),
          h('div', { class: 'work-thumbs work-thumbs-small' }, history.map((it) => thumb(it)))) : null));
  }

  function paintArtifacts() {
    const plain = plainArtifacts(task.artifacts);
    if (!changed('artifacts', plain)) return;
    if (!plain.length) { artifactsEl.hidden = true; artifactsEl.replaceChildren(); return; }
    artifactsEl.hidden = false;
    fill(artifactsEl,
      titlebar('Artifacts', h('span', { class: 'om-label' }, String(plain.length))),
      h('div', { class: 'om-sheet-body' },
        h('ul', { class: 'work-artifacts' }, plain.map((a) => {
          const linkable = a.url && /^https?:\/\//i.test(a.url);
          return h('li', { class: 'work-artifact' },
            linkable
              ? h('a', { class: 'om-link', href: a.url, target: '_blank', rel: 'noopener' }, a.label || a.url)
              : h('span', null, a.label || a.url || ''),
            !linkable && a.url && a.label ? h('span', { class: 'om-data-s work-artifact-path' }, a.url) : null,
            h('span', { class: 'om-data-s' }, `${a.by || ''}${a.ts ? ` ${relativeTime(a.ts)}` : ''}`));
        }))));
  }

  // ---- Items ----

  const rowOf = (itemId) => itemsList.querySelector(`[data-item="${CSS.escape(itemId)}"]`);

  function draftOf(itemId) {
    if (!drafts.has(itemId)) drafts.set(itemId, {});
    return drafts.get(itemId);
  }

  // Only what actually differs from what the hub holds.
  function collectVerdicts() {
    const out = [];
    for (const it of task.items || []) {
      const d = drafts.get(it.id);
      if (!d) continue;
      const entry = { id: it.id };
      if (d.verdict && d.verdict !== it.verdict) entry.verdict = d.verdict;
      const comment = (d.comment || '').trim();
      if (comment && comment !== (it.comment || '')) entry.comment = comment;
      if (entry.verdict || entry.comment) {
        if (!entry.verdict && it.verdict !== 'proposed') entry.verdict = it.verdict;
        out.push(entry);
      }
    }
    return out;
  }

  function paintDirty() {
    const save = barEl.querySelector('.work-save');
    if (save && (task.status === 'review' || !DECIDING.has(task.status))) save.hidden = !collectVerdicts().length;
    paintProgress();
  }

  function verdictOf(it) {
    const d = drafts.get(it.id);
    return (d && d.verdict) || it.verdict;
  }

  // What the locked Approve says on hover: which items still need a ruling.
  function whyLocked(items) {
    const nums = items.map((it, i) => (verdictOf(it) === 'proposed' ? i + 1 : 0)).filter(Boolean);
    if (nums.length === items.length && nums.length > 1) return `All ${nums.length} items still need a ruling`;
    if (nums.length === 1) return `Item ${nums[0]} still needs a ruling`;
    if (nums.length > 4) return `${nums.length} items still need a ruling`;
    return `Items ${nums.slice(0, -1).join(', ')} and ${nums[nums.length - 1]} still need a ruling`;
  }

  // Everything that counts the rulings: the titlebar, the dock, the sentence in
  // the band and the lock on Approve.
  function paintProgress() {
    const items = task.items || [];
    const open = items.filter((it) => verdictOf(it) === 'proposed').length;
    const ruling = shape === 'queue' && editableStatus();
    const steps = () => (items.length && items.length <= MAX_STEPS
      ? items.map((it, i) => h('i', { class: [verdictOf(it) !== 'proposed' && 'is-done', verdictOf(it) === 'proposed' && i === cursor && 'is-now'] }))
      : []);

    if (!ruling) itemsTitle.textContent = 'Items';
    else if (!open) itemsTitle.textContent = `All ${plural(items.length, 'item')} ruled`;
    else itemsTitle.textContent = `Item ${cursor + 1} of ${items.length}`;
    fill(itemsSteps, ruling ? steps() : []);

    if (!barEl.hidden) {
      const left = items.filter((it) => it.verdict === 'approved' && it.payload && !it.applied_at).length;
      let word = statusWord(task.status);
      if (task.status === 'review') word = items.length ? `${items.length - open} of ${items.length} ruled` : 'Ready for you';
      else if (task.status === 'blocked') word = 'Waiting on you';
      else if (task.status === 'approved') word = left ? `${left} to apply` : 'All applied';
      dockLabel.textContent = word;
      fill(dockSteps, ruling ? steps() : []);

      const approveBtn = barEl.querySelector('.work-approve');
      if (approveBtn) {
        // Locked, not disabled: the pointer and the keyboard can still reach
        // it, so it can say what's missing and light up the count.
        approveBtn.disabled = busy;
        const locked = open > 0;
        approveBtn.setAttribute('aria-disabled', String(locked));
        dockState.classList.toggle('om-wants', locked);
        if (!locked) {
          approveBtn.textContent = 'Approve';
          approveBtn.removeAttribute('data-why');
        } else {
          approveBtn.textContent = open === items.length ? `Rule all ${items.length} first` : `Rule ${open} more first`;
          approveBtn.dataset.why = whyLocked(items);
        }
      }
    }
    paintAsk();
  }

  function paintRowState(itemId) {
    const it = (task.items || []).find((x) => x.id === itemId);
    const row = rowOf(itemId);
    if (!it || !row) return;
    const verdict = verdictOf(it);
    row.querySelectorAll('[data-verdict]').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.verdict === verdict)));
    const flag = row.querySelector('.work-item-state');
    if (flag) {
      const dirty = !!drafts.get(it.id) && collectVerdicts().some((v) => v.id === it.id);
      flag.textContent = `${VERDICT_WORD[verdict] || verdict}${dirty ? ', unsaved' : ''}`;
      flag.classList.toggle('om-tag-solid', verdict !== 'proposed');
    }
  }

  function setCursor(index, { scroll = true } = {}) {
    const rows = [...itemsList.children];
    // No cursor on items that can't be ruled: it would promise keys that do nothing.
    cursor = rows.length && editableStatus() ? Math.max(0, Math.min(index, rows.length - 1)) : -1;
    rows.forEach((r, i) => {
      r.classList.toggle('is-cursor', i === cursor);
      if (i === cursor) r.setAttribute('aria-current', 'true');
      else r.removeAttribute('aria-current');
    });
    if (scroll && rows[cursor]) rows[cursor].scrollIntoView({ block: 'nearest' });
    paintProgress();
  }

  function setVerdict(it, verdict) {
    const d = draftOf(it.id);
    if (d.verdict === verdict) delete d.verdict;
    else d.verdict = verdict;
    paintRowState(it.id);
    paintDirty();
  }

  // ---- Several items, one verdict ----
  //
  // The risk is the same as the Desk's batch: rubber-stamping. So it takes at
  // least two items, lists their titles, and asks you to say you read them.
  // Selection is checked against the live mission: an item that gets applied or
  // disappears drops out on its own.

  const picked = new Set();
  let itemBatchSig = '';
  const canRule = (it) => editableStatus() && !it.applied_at;

  function paintItemBatch() {
    const items = task.items || [];
    for (const itemId of [...picked]) {
      const it = items.find((x) => x.id === itemId);
      if (!it || !canRule(it)) picked.delete(itemId);
    }
    const sig = JSON.stringify([...picked].map((itemId) => [itemId, (items.find((x) => x.id === itemId) || {}).title]));
    if (sig === itemBatchSig) return;
    itemBatchSig = sig;
    if (!picked.size) { itemBatchEl.hidden = true; itemBatchEl.replaceChildren(); return; }
    itemBatchEl.hidden = false;
    if (picked.size < 2) { fill(itemBatchEl, h('p', { class: 'work-batch-why' }, 'Select one more to rule them together.')); return; }

    const err = refusalLine();
    const accept = h('button', { type: 'button', class: 'om-btn om-btn-primary', disabled: true, onClick: () => applyItemVerdict('approved', err) }, 'Accept all');
    const reject = h('button', { type: 'button', class: 'om-btn', disabled: true, onClick: () => applyItemVerdict('rejected', err) }, 'Reject all');
    const ack = h('input', { type: 'checkbox', onChange() { accept.disabled = !ack.checked; reject.disabled = !ack.checked; } });
    fill(itemBatchEl,
      h('p', { class: 'om-label' }, `One verdict for ${picked.size} items`),
      h('ul', { class: 'work-batch-list' }, [...picked].map((itemId) => h('li', { class: 'om-clip' }, h('span', { class: 'om-strong' }, itemId), ' ', items.find((x) => x.id === itemId).title))),
      h('label', { class: 'om-check' }, ack, `I read these ${picked.size} items`),
      err.el,
      h('div', { class: 'om-cluster' }, accept, reject,
        h('button', { type: 'button', class: 'om-btn om-btn-ghost', onClick() { picked.clear(); paintItems(); } }, 'Clear')));
  }

  async function applyItemVerdict(verdict, err) {
    if (busy) return;
    const ids = [...picked];
    err.clear();
    busy = true;
    itemBatchEl.querySelectorAll('button, input').forEach((el) => { el.disabled = true; });
    let response;
    try {
      // A comment typed on one of these rides along. Drafts on the other items
      // stay drafts: this verdict isn't about them.
      response = await rule(task.id, {
        verdicts: ids.map((itemId) => {
          const comment = ((drafts.get(itemId) || {}).comment || '').trim();
          return { id: itemId, verdict, ...(comment ? { comment } : {}) };
        }),
      });
    } catch (e) {
      busy = false;
      itemBatchEl.querySelectorAll('button, input').forEach((el) => { el.disabled = false; });
      if (!api.isAbort(e)) err.show(e.message);
      return;
    }
    busy = false;
    toast(`${verdict === 'approved' ? 'Accepted' : 'Rejected'}: ${ids.length} items.`);
    picked.clear();
    ids.forEach((itemId) => drafts.delete(itemId));
    task = response.task;
    memo.delete('bar');
    paintPassive();
    paintControls(true);
    store.refresh().catch(() => {});
  }

  // One row per item. The row under the cursor opens up, and the others stay
  // built so a comment typed on one survives moving away from it.
  function itemRow(it, index) {
    const editable = editableStatus() && !it.applied_at;
    const pick = editable
      ? h('label', { class: 'om-check work-item-pick' },
        h('input', {
          type: 'checkbox',
          checked: picked.has(it.id),
          'aria-label': `Select ${it.id} for a batch verdict`,
          onChange(e) {
            if (e.target.checked) picked.add(it.id); else picked.delete(it.id);
            paintItemBatch();
          },
        }))
      : null;
    const clickable = editableStatus();
    const rowParts = [
      h('span', { class: 'om-queue-num', 'aria-hidden': 'true' }, index < 9 ? String(index + 1) : ''),
      h('span', { class: 'work-item-title' }, h('span', { class: 'om-data-s work-item-id' }, it.id), ' ', it.title),
      h('span', { class: ['work-item-state', 'om-tag', verdictOf(it) !== 'proposed' && 'om-tag-solid'] }, VERDICT_WORD[verdictOf(it)] || verdictOf(it)),
    ];
    const open = clickable
      ? h('button', { type: 'button', class: 'om-queue-row', onClick() { setCursor(index, { scroll: false }); } }, rowParts)
      : h('div', { class: 'om-queue-row work-item-static' }, rowParts);
    const controls = editable
      ? h('div', { class: 'om-item-rule' },
        h('div', { class: 'om-seg work-verdicts', role: 'group', 'aria-label': `Verdict on ${it.id}` },
          VERDICTS.map(([value, word]) => h('button', {
            type: 'button',
            dataset: { verdict: value },
            'aria-pressed': String(verdictOf(it) === value),
            onClick() {
              setCursor(index, { scroll: false });
              setVerdict(it, value);
            },
          }, word))),
        h('input', {
          class: 'om-input',
          placeholder: 'Comment',
          'aria-label': `Comment on ${it.id}`,
          value: (drafts.get(it.id) && drafts.get(it.id).comment) || it.comment || '',
          onInput(e) {
            draftOf(it.id).comment = e.target.value;
            paintRowState(it.id);
            paintDirty();
          },
          onFocus: () => setCursor(index, { scroll: false }),
        }))
      : (it.comment ? h('p', { class: 'work-item-said' }, h('span', { class: 'om-label' }, 'Comment '), it.comment) : null);
    const body = it.body ? h('p', { class: 'om-item-why work-item-body' }, it.body) : null;
    const payload = payloadBlock(it);
    return h('li', { class: 'work-item', dataset: { item: it.id } },
      h('div', { class: 'work-item-row' }, pick, open),
      body || payload || controls ? h('div', { class: 'om-item work-item-detail' }, body, payload, controls) : null);
  }

  function paintItems() {
    const items = task.items || [];
    itemsEl.hidden = !items.length;
    paintItemBatch();
    if (!items.length) return;
    const pinned = items.filter((it) => it.verdict === 'approved' && it.payload);
    itemsCount.textContent = pinned.length ? `Applied ${pinned.filter((it) => it.applied_at).length}/${pinned.length}` : '';
    const editable = editableStatus();
    itemsKeys.hidden = !editable;
    itemsList.classList.toggle('is-all-open', !editable);
    keyed(itemsList, items.map((it, i) => ({ it, i })), {
      key: ({ it }) => it.id,
      sig: ({ it }) => [it.title, it.body, it.verdict, it.comment, it.applied_at, editable],
      create: ({ it, i }) => itemRow(it, i),
    });
    items.forEach((it) => paintRowState(it.id));
    // Ticks follow the selection without rebuilding a row that didn't change.
    [...itemsList.children].forEach((row) => {
      const box = row.querySelector('.work-item-pick input');
      if (box) box.checked = picked.has(row.dataset.item);
    });
    if (cursor < 0 || cursor >= items.length) {
      const first = editable ? items.findIndex((it) => it.verdict === 'proposed' && !it.applied_at) : 0;
      setCursor(first < 0 ? 0 : first, { scroll: false });
    } else {
      setCursor(cursor, { scroll: false });
    }
  }

  // ---- Details ----

  function paintStats() {
    const sig = [shape, task.assignee, task.lease_until, task.priority, task.project];
    if (!changed('stats', sig)) return;
    statsEl.hidden = shape !== 'watch';
    if (statsEl.hidden) return;
    fill(statsEl, h('div', { class: 'om-stats' },
      stat('Assignee', task.assignee
        ? h('span', { class: 'om-cluster' }, h('span', { class: 'om-avatar' }, task.assignee.slice(0, 2)), task.assignee)
        : 'Nobody'),
      task.lease_until ? stat('Lease', h('time', { datetime: task.lease_until, title: new Date(task.lease_until).toLocaleString() }, relativeTime(task.lease_until))) : null,
      stat('Priority', `P${task.priority ?? 3}`),
      stat('Project', h('a', { class: 'om-link', href: `/projects/${encodeURIComponent(task.project)}` }, projectLabel(store.getState(), task.project)))));
  }

  function paintFacts() {
    const state = store.getState();
    const parent = goalRef(task);
    const parentTask = parent ? (state.tasks || []).find((x) => x.id === parent) : null;
    const kids = isGoal(task) ? goalChildren(state.tasks, task.id) : [];
    const replacement = task.status === 'discarded' ? findReplacement(task) : null;
    const waiting = task.status === 'blocked' ? waitingOnId(task) : null;
    const pr = prOf(task);
    const sig = [shape, task.status, task.gate, task.priority, task.project, task.assignee, task.reserved_for, task.lease_until,
      task.created_by, task.created_at, parent, parentTask && parentTask.title, kids.map((k) => [k.id, k.status, k.title]), replacement, waiting, pr];
    if (!changed('facts', sig)) return;
    const done = kids.filter((k) => k.status === 'done').length;
    // Watching, the four that matter sit in the stat row above.
    const full = shape !== 'watch';
    fill(factsEl,
      titlebar('Details'),
      h('div', { class: 'om-sheet-body' },
        h('dl', { class: 'om-props' },
          fact('Gate', task.gate || 'boss'),
          full ? fact('Priority', `P${task.priority ?? 3}`) : null,
          full ? fact('Project', h('a', { class: 'om-link', href: `/projects/${encodeURIComponent(task.project)}` }, projectLabel(state, task.project))) : null,
          full ? fact('Assignee', task.assignee || 'Nobody') : null,
          task.reserved_for ? fact('Reserved for', task.reserved_for) : null,
          full && task.lease_until ? fact('Lease', h('time', { datetime: task.lease_until, title: new Date(task.lease_until).toLocaleString() }, relativeTime(task.lease_until))) : null,
          fact('Filed', `${task.created_by || 'unknown'} `, timeTag(task.created_at)),
          parent ? fact('Goal', h('a', { class: 'om-link', href: `/goals/${encodeURIComponent(parent)}` }, parent), parentTask ? h('span', { class: 'work-fact-sub' }, parentTask.title) : null) : null,
          kids.length ? fact(`Children ${done}/${kids.length}`,
            h('span', { class: 'om-meter', style: { '--value': Math.round((done / kids.length) * 100) } }, h('i')),
            h('ul', { class: 'work-kids' }, kids.map((k) => h('li', null,
              h('a', { class: 'work-kid', href: missionHref(k.id), title: k.title }, swatch(k.status), h('span', { class: 'om-strong' }, k.id), h('span', { class: 'om-clip' }, k.title)))))) : null,
          replacement ? fact('Replaced by', h('a', { class: 'om-link', href: missionHref(replacement) }, replacement)) : null,
          waiting ? fact('Waiting on', h('a', { class: 'om-link', href: missionHref(waiting) }, waiting)) : null,
          pr ? fact('Pull request', h('a', { class: 'om-link', href: pr.url, target: '_blank', rel: 'noopener' }, `${pr.repo} #${pr.number}`)) : null)));
  }

  function paintLog() {
    const log = task.log || [];
    if (!changed('log', log.length)) return;
    logMeta.textContent = plural(log.length, 'event');
    fill(logList, log.length ? log.map(logRow) : h('li', { class: 'work-none om-data-s' }, 'Nothing logged yet.'));
  }

  // ---- The dock ----

  const refusal = refusalLine();
  const result = h('p', { class: 'work-bar-result om-data-s', hidden: true });
  let noteInput = null;

  function adopt(next) {
    if (next) {
      task = next;
      drafts.clear();
      noteText = '';
      memo.delete('bar');
      paintPassive();
      paintControls(true);
    }
    return store.refresh().catch(() => {});
  }

  function setBusy(value) {
    busy = value;
    barEl.querySelectorAll('button, input').forEach((el) => { el.disabled = value; });
    if (!value) paintProgress(); // Approve stays locked until every item is ruled.
  }

  function showResult(word) {
    const next = currentNext();
    fill(result, word, ' ', next ? h('a', { class: 'om-link', href: missionHref(next.id) }, `Next: ${next.id}`) : 'Nothing else needs you.');
    result.hidden = false;
  }

  // When your verdict changes the dock, the new dock spreads in from the
  // button you pressed: the screen changed because you acted (OMAKO DS motion).
  let spreadFrom = null;
  const sideOf = (el) => {
    if (!el || !barEl.contains(el)) return 'center';
    const b = el.getBoundingClientRect(); const d = barEl.getBoundingClientRect();
    return b.left + b.width / 2 > d.left + d.width / 2 ? 'right' : 'left';
  };

  // body is the PATCH; onDone decides what happens after the hub says yes.
  async function decide(body, onDone) {
    if (busy) return;
    refusal.clear();
    result.hidden = true;
    const verdicts = collectVerdicts();
    const from = sideOf(document.activeElement);
    setBusy(true);
    let response;
    try {
      response = await rule(task.id, { ...body, ...(verdicts.length ? { verdicts } : {}) });
    } catch (e) {
      setBusy(false);
      if (!api.isAbort(e)) refusal.show(e.message);
      return;
    }
    setBusy(false);
    spreadFrom = from;
    await adopt(response.task);
    spreadFrom = null;
    onDone(response.task);
  }

  function requiredNote(message) {
    const value = noteInput ? noteInput.value.trim() : '';
    if (!value) {
      refusal.show(message);
      // On a phone the note folds away until something needs it.
      barEl.classList.add('is-noting');
      if (noteInput) noteInput.focus();
      return null;
    }
    return value;
  }

  const currentNote = () => (noteInput ? noteInput.value.trim() : '');

  async function approve() {
    if (busy) return;
    const approveBtn = barEl.querySelector('.work-approve');
    if (approveBtn && approveBtn.getAttribute('aria-disabled') === 'true') return;
    setBusy(true);
    let moved;
    try {
      moved = await movedOn(task.id, task.log ? task.log.length : null);
    } catch (e) {
      setBusy(false);
      if (!api.isAbort(e)) refusal.show(e.message);
      return;
    }
    setBusy(false);
    if (moved) {
      toast(moved.status === 'review'
        ? `${moved.id} is back for a new round. Nothing was approved.`
        : `${moved.id} already moved on: it is ${statusWord(moved.status)} now. Nothing was approved.`);
      await adopt(moved);
      return;
    }
    decide({ status: 'done', note: currentNote() || 'approved' }, (t) => {
      toast(`${t.id}: ${t.status === 'approved' ? 'approved, back with its holder to apply.' : 'approved.'}`);
      const next = currentNext();
      if (next) ctx.navigate(missionHref(next.id));
      else {
        toast('Nothing else needs you.');
        ctx.navigate('/');
      }
    });
  }
  function sendBack() {
    const note = requiredNote('Write what should change, so the agent knows.');
    if (note) decide({ status: 'queued', note }, () => showResult('Sent back.'));
  }
  function answer() {
    const note = requiredNote('Write the answer first.');
    if (note) decide({ status: 'queued', note }, () => showResult('Answered.'));
  }
  function requeue() {
    decide({ status: 'queued', note: currentNote() || 're-queued by the boss' }, () => showResult('Back in the queue.'));
  }
  function closeDone() {
    decide({ status: 'done', note: currentNote() || 'closed by the boss' }, () => showResult('Closed.'));
  }

  function saveVerdicts() {
    const verdicts = collectVerdicts();
    if (!verdicts.length) {
      refusal.show('Rule on at least one item first.');
      return;
    }
    if (busy) return;
    refusal.clear();
    result.hidden = true;
    const from = sideOf(document.activeElement);
    setBusy(true);
    rule(task.id, { verdicts }).then(async (r) => {
      setBusy(false);
      toast('Verdicts saved.');
      spreadFrom = from;
      await adopt(r.task);
      spreadFrom = null;
    }, (e) => {
      setBusy(false);
      if (!api.isAbort(e)) refusal.show(e.message);
    });
  }

  function barActions() {
    const editable = editableStatus() && hasItems();
    const save = () => h('button', { type: 'button', class: 'om-btn work-save', onClick: saveVerdicts }, 'Save verdicts', kbd('Enter'));
    switch (task.status) {
      case 'review': {
        const s = save();
        s.hidden = !collectVerdicts().length;
        return {
          placeholder: 'Note. Optional to approve, required to send back',
          actions: [s,
            h('button', { type: 'button', class: 'om-btn', onClick: sendBack }, 'Send back'),
            h('button', { type: 'button', class: 'om-btn om-btn-primary work-approve', onClick: approve }, 'Approve')],
        };
      }
      case 'blocked':
        return {
          placeholder: 'Your answer',
          actions: [editable ? save() : null,
            h('button', { type: 'button', class: 'om-btn om-btn-primary', onClick: answer }, 'Answer')],
        };
      case 'failed':
        return {
          placeholder: 'Note. Optional',
          actions: [h('button', { type: 'button', class: 'om-btn om-btn-primary', onClick: requeue }, 'Re-queue')],
        };
      case 'discarded':
        return {
          placeholder: 'Note. Optional',
          actions: [h('button', { type: 'button', class: 'om-btn', onClick: requeue }, 'Re-queue')],
        };
      case 'approved': {
        const left = (task.items || []).filter((it) => it.verdict === 'approved' && it.payload && !it.applied_at).length;
        return {
          placeholder: 'Note. Optional',
          actions: [left ? null : h('button', { type: 'button', class: 'om-btn om-btn-primary', onClick: closeDone }, 'Close done')],
        };
      }
      case 'done':
        return null;
      default: {
        const s = editable ? save() : null;
        if (s) s.hidden = !collectVerdicts().length;
        return { placeholder: 'Note. Optional', actions: [s] };
      }
    }
  }

  function paintBar(force) {
    const left = (task.items || []).filter((it) => it.verdict === 'approved' && it.payload && !it.applied_at).length;
    const sig = [task.status, (task.items || []).length, task.after_approval, task.assignee, left, deciding()];
    if (!force && !changed('bar', sig)) return;
    memo.set('bar', JSON.stringify(sig));
    const spec = deciding() ? barActions() : null;
    barEl.hidden = !spec;
    if (!spec) { noteInput = null; return; }
    noteInput = h('input', {
      class: 'om-input om-dock-note',
      placeholder: spec.placeholder,
      'aria-label': spec.placeholder,
      value: noteText,
      onInput(e) { noteText = e.target.value; },
    });
    barEl.classList.toggle('is-noting', task.status === 'blocked' || !!noteText);
    fill(barEl, refusal.el, result, dockState, noteInput, h('div', { class: 'om-dock-actions' }, spec.actions));
    paintProgress();
    if (spreadFrom) appear(barEl, 'spread', spreadFrom);
  }

  // ---- Painting from live state ----

  function paintPassive() {
    paintLayout();
    paintHead();
    paintStats();
    paintBody();
    paintEvidence();
    paintArtifacts();
    paintFacts();
    paintLog();
    paintNext();
    paintTools();
    paintAsk();
  }

  // Items and the dock hold what you're typing. They wait until you leave the
  // field; the evidence around them keeps moving.
  function paintControls(force) {
    if (!force && (itemsEl.contains(document.activeElement) || barEl.contains(document.activeElement)) && isTypingIn(document.activeElement)) {
      pendingControls = true;
      return;
    }
    pendingControls = false;
    paintItems();
    paintBar(force);
  }

  ctx.onCleanup(on(page, 'focusout', () => {
    if (!pendingControls) return;
    setTimeout(() => { if (pendingControls && !isTypingIn(document.activeElement)) paintControls(); }, 0);
  }));

  function fromState(state) {
    const live = ((state && state.tasks) || []).find((x) => x.id === id);
    // A snapshot fetched before our own PATCH can land after it. Never go back.
    if (live && (live.log || []).length >= (task.log || []).length) {
      task = live;
      paintPassive();
      paintControls();
    } else {
      paintNext();
    }
  }

  paintPassive();
  paintControls(true);
  ctx.onCleanup(store.subscribe(fromState));

  // ---- Keys ----

  ctx.onCleanup(on(document, 'keydown', (e) => {
    if (e.defaultPrevented || e.metaKey || e.ctrlKey || e.altKey) return;
    if (document.querySelector('.om-scrim, [role="dialog"]')) return;
    const active = document.activeElement;
    if (isTypingIn(active)) {
      if (e.key === 'Escape') active.blur();
      return;
    }

    if (e.key === 'Escape') {
      e.preventDefault();
      ctx.navigate('/missions');
      return;
    }
    if (e.key === 'n' || e.key === 'N') {
      const next = currentNext();
      if (next) {
        e.preventDefault();
        ctx.navigate(missionHref(next.id));
      }
      return;
    }

    const items = task.items || [];
    if (!items.length || !editableStatus()) return;
    if (/^[1-9]$/.test(e.key)) {
      const index = Number(e.key) - 1;
      if (index < items.length) {
        e.preventDefault();
        setCursor(index);
      }
      return;
    }
    const verdict = KEY_VERDICT[e.key.toLowerCase()];
    if (verdict) {
      const it = items[cursor];
      if (!it || it.applied_at) return;
      e.preventDefault();
      const d = draftOf(it.id);
      d.verdict = verdict;
      paintRowState(it.id);
      paintDirty();
      if (cursor < items.length - 1) setCursor(cursor + 1);
      return;
    }
    if (e.key === 'Enter') {
      // On a button or a link, Enter is that control's.
      if (active && active.closest && active.closest('button, a, summary')) return;
      if (collectVerdicts().length) {
        e.preventDefault();
        saveVerdicts();
      }
    }
  }));

  return page;
}

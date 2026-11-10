// A mission, as a page. Reviewing is the main job here, so evidence comes before
// items, the decision bar stays in view, and a ruling moves on to the next thing
// that needs the boss.

import { h, fill, on } from '../dom.js';
import * as api from '../api.js';
import * as store from '../store.js';
import { statusLabel, statusWord, swatch } from '../status.js';
import { confirmButton, emptyState, relativeTime, timeTag, toast } from '../ui.js';
import {
  evidenceOf, findReplacement, goalChildren, goalRef, isGoal, isTerminal, nextNeeding, plainArtifacts,
  prOf, projectLabel, roundOf, waitingOnId,
} from '../desk/model.js';
import { isTypingIn, keyed } from '../desk/keyed.js';
import { kbd, missionHref, movedOn, refusalLine, rule, section, thumb } from '../desk/parts.js';

const BODY_FOLD_CHARS = 1400;
const VERDICT_WORD = { approved: 'Accepted', rejected: 'Rejected', later: 'Later', proposed: 'To rule' };
const VERDICTS = [['approved', 'Accept', 'A'], ['rejected', 'Reject', 'R'], ['later', 'Later', 'L']];
const KEY_VERDICT = { a: 'approved', r: 'rejected', l: 'later' };

let markdown = null;
function loadMarkdown() {
  if (!markdown) markdown = import('../markdown.js').catch(() => null);
  return markdown;
}

function bodyNode(text, module) {
  if (module && typeof module.renderMarkdown === 'function') {
    try {
      const node = module.renderMarkdown(text, {});
      if (node instanceof Node) return node;
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

const fmtStamp = (iso) => (iso ? new Date(iso).toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : '');

function fact(label, ...value) {
  return h('div', { class: 'work-fact' }, h('dt', { class: 'om-label' }, label), h('dd', null, ...value));
}

function logRow(l) {
  const moved = l.from && l.to ? `${statusWord(l.from)} to ${statusWord(l.to)}` : null;
  return h('li', { class: 'work-log-row' },
    h('time', { class: 'work-log-time om-meta', datetime: l.ts, title: new Date(l.ts).toLocaleString() }, fmtStamp(l.ts)),
    h('div', { class: 'work-log-text' },
      h('span', { class: 'om-strong' }, l.by), ' ',
      moved ? h('span', { class: 'om-tag' }, moved) : null, ' ',
      h('span', { class: 'work-log-note' }, l.note)));
}

function payloadBlock(it) {
  if (!it.payload || !Array.isArray(it.payload.ops)) return null;
  let applied = null;
  if (it.applied_at) applied = `applied ${relativeTime(it.applied_at)} by ${it.applied_by || 'its holder'}`;
  else if (it.verdict === 'approved') applied = 'not applied yet';
  return h('div', { class: 'work-payload' },
    it.payload.ops.map((o) => h('div', { class: 'work-payload-op' },
      h('p', { class: 'work-payload-file om-meta' }, h('span', { class: 'om-strong' }, o.op === 'append' ? 'Appends to ' : 'Writes '), o.file),
      // The exact text being approved, whole. It scrolls instead of clipping.
      h('pre', { class: 'work-pre', tabindex: '0' }, o.content))),
    h('p', { class: 'om-meta work-payload-seal' },
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
  const memo = new Map();

  const changed = (name, value) => {
    const mark = JSON.stringify(value);
    if (memo.get(name) === mark) return false;
    memo.set(name, mark);
    return true;
  };

  // ---- The frame. Each part repaints alone. ----

  const crumbs = h('div', { class: 'work-m-crumbs' });
  const nextSlot = h('div', { class: 'work-m-next' });
  const headEl = h('div', { class: 'work-m-head' });
  const bodyEl = h('div', { class: 'work-m-block' });
  const evidenceEl = h('div', { class: 'work-m-block' });
  const artifactsEl = h('div', { class: 'work-m-block' });
  const itemsCount = h('span', { class: 'om-meta' });
  const itemsList = h('ol', { class: 'work-items' });
  const itemBatchEl = h('div', { class: 'work-batch work-item-batch', hidden: true });
  const itemsEl = h('div', { class: 'work-m-block', hidden: true },
    section('Items', itemsCount, h('p', { class: 'work-keys om-meta' }, kbd('1-9'), ' pick ', kbd('A'), ' ', kbd('R'), ' ', kbd('L'), ' rule ', kbd('Enter'), ' save'), itemsList, itemBatchEl));
  const logCount = h('span', { class: 'om-meta' });
  const logList = h('ol', { class: 'work-log' });
  const logEl = section('Log', logCount, logList);
  const factsEl = h('aside', { class: 'work-m-facts', 'aria-label': 'Facts' });
  const barEl = h('div', { class: 'work-bar', role: 'region', 'aria-label': 'Decision' });

  const page = h('div', { class: 'app-page work-page work-mission' },
    h('div', { class: 'work-m-top' }, crumbs, nextSlot),
    headEl,
    h('div', { class: 'work-m-cols' },
      h('div', { class: 'work-m-main' }, bodyEl, evidenceEl, artifactsEl, itemsEl, logEl),
      factsEl),
    barEl);

  fill(crumbs,
    h('ol', { class: 'om-crumbs' },
      h('li', null, h('a', { class: 'om-link', href: '/missions' }, 'Missions')),
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

  function paintHead() {
    if (!changed('head', [task.title, task.status, task.gate, task.assignee, task.project, task.priority, roundOf(task), relativeTime(task.created_at)])) return;
    ctx.title(`${task.id} ${task.title}`);
    const round = roundOf(task);
    fill(headEl,
      h('div', { class: 'work-m-status' },
        statusLabel(task.status),
        h('span', { class: task.gate === 'critic' ? 'om-tag' : 'om-tag om-tag-solid' }, `Gate: ${task.gate || 'boss'}`)),
      h('h1', { class: 'om-display om-h2 work-m-title' }, task.title),
      h('div', { class: 'work-m-meta om-meta' },
        h('span', { class: 'om-strong' }, task.id),
        task.assignee ? h('span', null, task.assignee) : h('span', null, 'Nobody on it'),
        h('a', { class: 'om-link', href: `/projects/${encodeURIComponent(task.project)}` }, projectLabel(store.getState(), task.project)),
        timeTag(task.created_at),
        round ? h('span', null, `Round ${round}`) : null));
  }

  function paintBody() {
    if (!changed('body', [task.body, bodyOpen])) return;
    if (!task.body) { bodyEl.hidden = true; bodyEl.replaceChildren(); return; }
    bodyEl.hidden = false;
    const long = task.body.length > BODY_FOLD_CHARS;
    fill(bodyEl,
      h('div', { class: ['work-body', 'om-prose-compact', long && !bodyOpen && 'is-folded'] }, bodyNode(task.body, md)),
      long ? h('button', {
        type: 'button',
        class: 'om-btn om-btn-ghost work-body-more',
        onClick() { bodyOpen = !bodyOpen; paintBody(); },
      }, bodyOpen ? 'Fold' : 'Read all') : null);
  }

  // What the boss sees is always the round being judged: the newest burst of
  // images first, older rounds folded away. Each image appears once.
  function paintEvidence() {
    const inReview = task.status === 'review';
    if (!changed('evidence', [task.artifacts, inReview])) return;
    const { current, history } = evidenceOf(task.artifacts);
    if (!current.length && !history.length && !inReview) { evidenceEl.hidden = true; evidenceEl.replaceChildren(); return; }
    evidenceEl.hidden = false;
    fill(evidenceEl, section('Evidence', current.length ? h('span', { class: 'om-meta' }, `Current round ${current.length}`) : null,
      current.length ? h('div', { class: 'work-thumbs' }, current.map((it) => thumb(it))) : h('p', { class: 'work-none om-meta' }, 'No images attached.'),
      history.length ? h('details', { class: 'work-fold' },
        h('summary', null, `History ${history.length}`),
        h('div', { class: 'work-thumbs work-thumbs-small' }, history.map((it) => thumb(it)))) : null));
  }

  function paintArtifacts() {
    const plain = plainArtifacts(task.artifacts);
    if (!changed('artifacts', plain)) return;
    if (!plain.length) { artifactsEl.hidden = true; artifactsEl.replaceChildren(); return; }
    artifactsEl.hidden = false;
    fill(artifactsEl, section('Artifacts', h('span', { class: 'om-meta' }, String(plain.length)),
      h('ul', { class: 'work-artifacts' }, plain.map((a) => {
        const linkable = a.url && /^https?:\/\//i.test(a.url);
        return h('li', { class: 'work-artifact' },
          linkable
            ? h('a', { class: 'om-link', href: a.url, target: '_blank', rel: 'noopener' }, a.label || a.url)
            : h('span', null, a.label || a.url || ''),
          !linkable && a.url && a.label ? h('span', { class: 'om-meta work-artifact-path' }, a.url) : null,
          h('span', { class: 'om-meta' }, `${a.by || ''}${a.ts ? ` ${relativeTime(a.ts)}` : ''}`));
      }))));
  }

  // ---- Items ----

  const editableStatus = () => !isTerminal(task) && task.status !== 'approved';
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
    if (save && task.status === 'review') save.hidden = !collectVerdicts().length;
  }

  function verdictOf(it) {
    const d = drafts.get(it.id);
    return (d && d.verdict) || it.verdict;
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
      h('div', { class: 'om-row' }, accept, reject,
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

  function itemRow(it, index) {
    const editable = editableStatus() && !it.applied_at;
    const number = h('span', { class: 'work-item-no', 'aria-hidden': 'true' }, index < 9 ? String(index + 1) : '');
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
    const controls = editable
      ? h('div', { class: 'work-item-controls' },
        h('div', { class: 'om-seg', role: 'group', 'aria-label': `Verdict on ${it.id}` },
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
          class: 'om-input work-item-comment',
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
    return h('li', { class: 'work-item', dataset: { item: it.id } },
      h('div', { class: 'work-item-head' },
        pick,
        number,
        h('span', { class: 'work-item-id om-strong' }, it.id),
        h('span', { class: 'work-item-title om-strong' }, it.title),
        h('span', { class: ['work-item-state', 'om-tag', verdictOf(it) === 'proposed' ? '' : 'om-tag-solid'] }, VERDICT_WORD[verdictOf(it)] || verdictOf(it))),
      it.body ? h('pre', { class: 'work-item-body' }, it.body) : null,
      payloadBlock(it),
      controls);
  }

  function paintItems() {
    const items = task.items || [];
    itemsEl.hidden = !items.length;
    paintItemBatch();
    if (!items.length) return;
    const pinned = items.filter((it) => it.verdict === 'approved' && it.payload);
    itemsCount.textContent = pinned.length
      ? `Applied ${pinned.filter((it) => it.applied_at).length}/${pinned.length}`
      : `${items.filter((it) => it.verdict === 'proposed').length} to rule of ${items.length}`;
    const editable = editableStatus();
    itemsEl.querySelector('.work-keys').hidden = !editable;
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

  // ---- Facts ----

  function paintFacts() {
    const state = store.getState();
    const parent = goalRef(task);
    const parentTask = parent ? (state.tasks || []).find((x) => x.id === parent) : null;
    const kids = isGoal(task) ? goalChildren(state.tasks, task.id) : [];
    const replacement = task.status === 'discarded' ? findReplacement(task) : null;
    const waiting = task.status === 'blocked' ? waitingOnId(task) : null;
    const pr = prOf(task);
    const sig = [task.status, task.gate, task.priority, task.project, task.assignee, task.reserved_for, task.lease_until,
      task.created_by, task.created_at, parent, parentTask && parentTask.title, kids.map((k) => [k.id, k.status, k.title]), replacement, waiting, pr];
    if (!changed('facts', sig)) return;
    const done = kids.filter((k) => k.status === 'done').length;
    fill(factsEl, h('dl', { class: 'work-facts' },
      fact('Status', statusLabel(task.status)),
      fact('Gate', task.gate || 'boss'),
      fact('Priority', `P${task.priority ?? 3}`),
      fact('Project', h('a', { class: 'om-link', href: `/projects/${encodeURIComponent(task.project)}` }, projectLabel(state, task.project))),
      fact('Assignee', task.assignee || 'Nobody'),
      task.reserved_for ? fact('Reserved for', task.reserved_for) : null,
      task.lease_until ? fact('Lease', h('time', { datetime: task.lease_until, title: new Date(task.lease_until).toLocaleString() }, relativeTime(task.lease_until))) : null,
      fact('Filed', `${task.created_by || 'unknown'} `, timeTag(task.created_at)),
      parent ? fact('Goal', h('a', { class: 'om-link', href: `/goals/${encodeURIComponent(parent)}` }, parent), parentTask ? h('span', { class: 'work-fact-sub' }, parentTask.title) : null) : null,
      kids.length ? fact(`Children ${done}/${kids.length}`,
        h('span', { class: 'om-meter', style: { '--value': Math.round((done / kids.length) * 100) } }, h('i')),
        h('ul', { class: 'work-kids' }, kids.map((k) => h('li', null,
          h('a', { class: 'work-kid', href: missionHref(k.id), title: k.title }, swatch(k.status), h('span', { class: 'om-strong' }, k.id), h('span', { class: 'om-clip' }, k.title)))))) : null,
      replacement ? fact('Replaced by', h('a', { class: 'om-link', href: missionHref(replacement) }, replacement)) : null,
      waiting ? fact('Waiting on', h('a', { class: 'om-link', href: missionHref(waiting) }, waiting)) : null,
      pr ? fact('Pull request', h('a', { class: 'om-link', href: pr.url, target: '_blank', rel: 'noopener' }, `${pr.repo} #${pr.number}`)) : null));
  }

  function paintLog() {
    const log = task.log || [];
    if (!changed('log', log.length)) return;
    logCount.textContent = String(log.length);
    fill(logList, log.length ? log.map(logRow) : h('li', { class: 'work-none om-meta' }, 'Nothing logged yet.'));
  }

  // ---- The decision bar ----

  const refusal = refusalLine();
  const result = h('p', { class: 'work-bar-result om-meta', hidden: true });
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
  }

  function showResult(word) {
    const next = currentNext();
    fill(result, word, ' ', next ? h('a', { class: 'om-link', href: missionHref(next.id) }, `Next: ${next.id}`) : 'Nothing else needs you.');
    result.hidden = false;
  }

  // body is the PATCH; onDone decides what happens after the hub says yes.
  async function decide(body, onDone) {
    if (busy) return;
    refusal.clear();
    result.hidden = true;
    const verdicts = collectVerdicts();
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
    await adopt(response.task);
    onDone(response.task);
  }

  function requiredNote(message) {
    const value = noteInput ? noteInput.value.trim() : '';
    if (!value) {
      refusal.show(message);
      if (noteInput) noteInput.focus();
      return null;
    }
    return value;
  }

  const currentNote = () => (noteInput ? noteInput.value.trim() : '');

  async function approve() {
    if (busy) return;
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

  async function discard() {
    await new Promise((resolve) => {
      decide({ status: 'discarded', note: currentNote() || 'discarded by the boss' }, () => { showResult('Discarded.'); resolve(); }).finally(resolve);
    });
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
    setBusy(true);
    rule(task.id, { verdicts }).then(async (r) => {
      setBusy(false);
      toast('Verdicts saved.');
      await adopt(r.task);
    }, (e) => {
      setBusy(false);
      if (!api.isAbort(e)) refusal.show(e.message);
    });
  }

  function barActions() {
    const hasItems = (task.items || []).length > 0;
    const editable = editableStatus() && hasItems;
    const discardBtn = () => confirmButton('Discard', discard, { confirmLabel: 'Really discard', class: 'om-btn om-btn-danger' });
    const save = () => h('button', { type: 'button', class: 'om-btn work-save', onClick: saveVerdicts }, 'Save verdicts', kbd('Enter'));
    switch (task.status) {
      case 'review': {
        const s = save();
        s.hidden = !collectVerdicts().length;
        return {
          placeholder: 'Note. Optional to approve, required to send back',
          actions: [discardBtn(), s,
            h('button', { type: 'button', class: 'om-btn', onClick: sendBack }, 'Send back'),
            h('button', { type: 'button', class: 'om-btn om-btn-primary work-approve', onClick: approve }, 'Approve')],
        };
      }
      case 'blocked':
        return {
          placeholder: 'Your answer',
          actions: [discardBtn(), editable ? save() : null,
            h('button', { type: 'button', class: 'om-btn om-btn-primary', onClick: answer }, 'Answer')],
        };
      case 'failed':
        return {
          placeholder: 'Note. Optional',
          actions: [discardBtn(), h('button', { type: 'button', class: 'om-btn om-btn-primary', onClick: requeue }, 'Re-queue')],
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
          actions: [discardBtn(), left ? null : h('button', { type: 'button', class: 'om-btn om-btn-primary', onClick: closeDone }, 'Close done')],
        };
      }
      case 'done':
        return null;
      default:
        return {
          placeholder: 'Note. Optional',
          actions: [discardBtn(), editable ? save() : null],
        };
    }
  }

  function paintBar(force) {
    const left = (task.items || []).filter((it) => it.verdict === 'approved' && it.payload && !it.applied_at).length;
    const sig = [task.status, (task.items || []).length, task.after_approval, task.assignee, left];
    if (!force && !changed('bar', sig)) return;
    memo.set('bar', JSON.stringify(sig));
    const spec = barActions();
    barEl.hidden = !spec;
    if (!spec) { noteInput = null; return; }
    let advice = null;
    if (task.status === 'review' && task.after_approval === 'return') {
      advice = `Approving returns this to ${task.assignee || 'its agent'}, who applies the accepted items exactly as shown and closes it. Every item needs a verdict first.`;
    } else if (task.status === 'approved') {
      advice = left
        ? `Approved. With ${task.assignee || 'its agent'} to apply the accepted items, then close.`
        : 'Everything accepted is applied. Ready to close.';
    }
    noteInput = h('input', {
      class: 'om-input work-bar-note',
      placeholder: spec.placeholder,
      'aria-label': spec.placeholder,
      value: noteText,
      onInput(e) { noteText = e.target.value; },
    });
    fill(barEl,
      advice ? h('p', { class: 'work-bar-advice om-meta' }, advice) : null,
      refusal.el,
      result,
      h('div', { class: 'work-bar-row' }, noteInput, h('div', { class: 'work-bar-actions' }, spec.actions)));
  }

  // ---- Painting from live state ----

  function paintPassive() {
    paintHead();
    paintBody();
    paintEvidence();
    paintArtifacts();
    paintFacts();
    paintLog();
    paintNext();
  }

  // Items and the bar hold what you're typing. They wait until you leave the
  // field; the evidence above them keeps moving.
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

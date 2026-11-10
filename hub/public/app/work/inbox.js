// Messages to the boss, with inbox treatment. They rang his Discord when sent,
// so they never count as waiting on him.
//
// Read state lives in this browser: the hub has no read flag and this isn't
// worth one. A second device starts fresh.

import { h, fill } from '../dom.js';
import * as api from '../api.js';
import * as store from '../store.js';
import { emptyState, errorState } from '../ui.js';
import { keyed } from './keyed.js';
import { ago, agoTag, missionHref, section } from './parts.js';

const READ_KEY = 'bureauV2.nmn.readMessageIds'; // v2's key, so what's read stays read
const RECENT = 5;
const PREVIEW = 100;

function loadRead() {
  try { return new Set(JSON.parse(localStorage.getItem(READ_KEY) || '[]')); } catch { return new Set(); }
}
function saveRead(read) {
  try { localStorage.setItem(READ_KEY, JSON.stringify([...read])); } catch { /* read state is a nicety */ }
}

function preview(text) {
  const s = String(text == null ? '' : text);
  if (s.length <= PREVIEW) return s;
  return `${s.slice(0, PREVIEW).replace(/\s+\S*$/, '')}...`;
}

export function inboxSection(ctx) {
  let messages = [];
  let failed = null;
  let showAll = false;
  const read = loadRead();
  const expanded = new Set();

  const count = h('span', { class: 'om-meta' });
  const list = h('div', { class: 'work-list' });
  const foot = h('div', { class: 'work-foot' });
  const note = h('div', null);
  const node = section('Inbox', count, note, list, foot);

  function markRead(id) {
    if (!id || read.has(id)) return;
    read.add(id);
    saveRead(read);
    paint();
  }

  function row(m) {
    const unread = !read.has(m.id);
    const open = expanded.has(m.id);
    return h('article', { class: ['work-msg', unread && 'is-unread'] },
      h('button', {
        type: 'button',
        class: 'work-msg-open',
        'aria-expanded': String(open),
        onClick() {
          if (expanded.has(m.id)) expanded.delete(m.id); else expanded.add(m.id);
          read.add(m.id);
          saveRead(read);
          paint();
        },
      },
      h('span', { class: `om-swatch ${unread ? 'om-d100' : 'om-d0'}`, role: 'img', 'aria-label': unread ? 'Unread' : 'Read', title: unread ? 'Unread' : 'Read' }),
      h('span', { class: 'work-msg-text' }, open ? m.body : preview(m.body))),
      h('div', { class: 'work-msg-meta om-meta' },
        h('span', { class: 'om-strong' }, m.from), agoTag(m.ts),
        m.task_id ? h('a', { class: 'om-link', href: missionHref(m.task_id), onClick: () => markRead(m.id) }, m.task_id) : null));
  }

  function paint() {
    const unread = messages.filter((m) => !read.has(m.id)).length;
    count.textContent = messages.length ? `${unread} unread of ${messages.length}` : '';
    if (failed) {
      fill(note, errorState(failed, load));
      keyed(list, [], { key: (m) => m.id, create: row });
      foot.replaceChildren();
      return;
    }
    if (!messages.length) {
      fill(note, emptyState('No messages'));
      keyed(list, [], { key: (m) => m.id, create: row });
      foot.replaceChildren();
      return;
    }
    note.replaceChildren();
    const ordered = [...messages].sort((a, b) => String(b.ts).localeCompare(String(a.ts)));
    const shown = showAll ? ordered : ordered.slice(0, RECENT);
    keyed(list, shown, {
      key: (m) => m.id,
      sig: (m) => [m.body, m.from, m.ts, m.task_id, read.has(m.id), expanded.has(m.id), ago(m.ts)],
      create: row,
    });
    const kids = [];
    if (unread) {
      kids.push(h('button', {
        type: 'button',
        class: 'om-btn om-btn-ghost',
        onClick() {
          messages.forEach((m) => read.add(m.id));
          saveRead(read);
          paint();
        },
      }, 'Mark all read'));
    }
    if (messages.length > RECENT) {
      kids.push(h('button', {
        type: 'button',
        class: 'om-btn om-btn-ghost',
        onClick() { showAll = !showAll; paint(); },
      }, showAll ? 'Recent only' : `Show all ${messages.length}`));
    }
    fill(foot, kids);
  }

  async function load() {
    try {
      const r = await api.get('/api/messages?for=boss', { signal: ctx.signal });
      // The endpoint also returns broadcasts and things the boss sent. An inbox
      // holds what's addressed to him.
      messages = ((r && r.messages) || []).filter((m) => m.to === 'boss');
      failed = null;
    } catch (e) {
      if (api.isAbort(e)) return;
      failed = e.message || "Couldn't load messages.";
    }
    paint();
  }

  ctx.onCleanup(store.subscribeEvents((type) => { if (type === 'message.posted') load(); }));
  load();
  return { node };
}

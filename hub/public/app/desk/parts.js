// Small pieces the work pages share: a section head, a refusal line, a key
// hint, what a ruling sends, and the evidence thumbnails.

import { h } from '../dom.js';
import * as api from '../api.js';
import { relativeTime } from '../ui.js';

export const rule = (id, body) => api.patch(`/api/tasks/${encodeURIComponent(id)}`, { agent: 'human', ...body });

export const missionHref = (id) => `/missions/${encodeURIComponent(id)}`;

// The mission as the hub holds it now, if it isn't the review on screen: it left
// review, or it left and came back as a new round since the log entry `seen`. A
// tab can show a live Approve on something ruled on hours ago, so approving asks
// first. A note added during the review doesn't count.
export async function movedOn(id, seen) {
  const r = await api.get(`/api/tasks/${encodeURIComponent(id)}`);
  const task = r && r.task;
  if (!task) return null;
  if (task.status !== 'review') return task;
  const newRound = seen != null && (task.log || []).slice(seen).some((entry) => entry.to === 'review');
  return newRound ? task : null;
}

// A sheet with its title bar. In the rail the bar turns into a small mono label.
export function section(title, side, ...kids) {
  return h('section', { class: 'om-sheet work-section' },
    h('header', { class: 'om-titlebar' }, h('h2', null, title), side || null),
    ...kids);
}

// The quiet count or note at the end of a title bar.
export const sideNote = (text = '') => h('span', { class: 'om-data-s' }, text);

export const kbd = (key) => h('kbd', { class: 'om-kbd work-kbd' }, key);

// Refusals from the hub are shown as written, where the ruling was made.
export function refusalLine() {
  const el = h('p', { class: 'work-refusal', role: 'alert', hidden: true });
  return {
    el,
    show(message) { el.textContent = message; el.hidden = false; },
    clear() { el.textContent = ''; el.hidden = true; },
  };
}

// A thumbnail that opens the full image. The hub's images need the header, so
// hub-auth.js fills in both URLs when this reaches the page.
export function thumb(it, { caption = true } = {}) {
  const src = window.BureauHub.imageUrl(it.img);
  const label = it.a.label || it.img;
  const when = it.a.ts ? relativeTime(it.a.ts) : '';
  // om-pic: shown in Atkinson dither; the link opens the original (OMAKO DS).
  return h('a', { class: 'work-thumb', dataset: { secureHref: src }, target: '_blank', rel: 'noopener', title: label },
    h('span', { class: 'om-pic' }, h('img', { dataset: { secureSrc: src }, alt: label, loading: 'lazy' })),
    caption ? h('span', { class: 'work-thumb-cap om-clip' }, when ? `${label} · ${when}` : label) : null);
}

const KEY = (name) => `bureau.work.${name}`;

export function remember(name, fallback) {
  try {
    const raw = localStorage.getItem(KEY(name));
    return raw === null ? fallback : JSON.parse(raw);
  } catch {
    return fallback;
  }
}
export function keep(name, value) {
  try { localStorage.setItem(KEY(name), JSON.stringify(value)); } catch { /* it just won't stick */ }
}

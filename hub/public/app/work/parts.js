// Small pieces the work pages share: a section head, a refusal line, a key
// hint, what a ruling sends, and the evidence thumbnails.

import { h } from '../dom.js';
import * as api from '../api.js';
import { relativeTime } from '../ui.js';

export const rule = (id, body) => api.patch(`/api/tasks/${encodeURIComponent(id)}`, { agent: 'human', ...body });

export const missionHref = (id) => `/missions/${encodeURIComponent(id)}`;

export function section(title, side, ...kids) {
  return h('section', { class: 'work-section' },
    h('div', { class: 'om-bar' }, h('h2', { class: 'om-label' }, title), side || null),
    ...kids);
}

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
  return h('a', { class: 'work-thumb', dataset: { secureHref: src }, target: '_blank', rel: 'noopener', title: label },
    h('img', { dataset: { secureSrc: src }, alt: label, loading: 'lazy' }),
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

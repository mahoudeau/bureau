// Small shared pieces: toast, confirm in a dialog, the states a page can be in, and
// how the app writes time.

import { h } from './dom.js';
import { appear, vanish } from './motion.js';

let toasts = null;
export function toast(message, { ms = 4000 } = {}) {
  if (!toasts || !toasts.isConnected) {
    toasts = h('div', { class: 'om-toasts', role: 'status', 'aria-live': 'polite' });
    document.body.append(toasts);
  }
  const el = h('div', { class: 'om-toast' }, message);
  toasts.append(el);
  appear(el);
  setTimeout(() => vanish(el).then(() => el.remove()), ms);
  return el;
}

// A dialog that asks before something that can't be undone. The focus stays
// inside it, Esc and the scrim close it, and focus goes back where it was.
// onConfirm may be async; if it throws, the message shows in the dialog and it
// stays open.
let dialogSeq = 0;
export function confirmDialog({ title, body = '', confirmLabel, keepLabel = 'Keep it', onConfirm }) {
  const returnTo = document.activeElement;
  const id = `app-confirm-${++dialogSeq}`;
  const error = h('p', { class: 'om-field-error', role: 'alert', hidden: true });
  let busy = false;
  let closing = false;
  const close = () => {
    if (closing) return;
    closing = true;
    if (returnTo && returnTo.isConnected) returnTo.focus();
    vanish(scrim).then(() => scrim.remove());
  };
  const keep = h('button', { type: 'button', class: 'om-btn', onClick: close }, keepLabel);
  const confirm = h('button', {
    type: 'button',
    class: 'om-btn om-btn-primary',
    async onClick() {
      if (busy) return;
      busy = true;
      confirm.disabled = true;
      error.hidden = true;
      try {
        await onConfirm();
      } catch (e) {
        busy = false;
        confirm.disabled = false;
        error.textContent = e.message || 'That failed.';
        error.hidden = false;
        return;
      }
      close();
    },
  }, confirmLabel);
  const scrim = h('div', {
    class: 'om-scrim',
    onClick(e) { if (e.target === scrim) close(); },
    onKeydown(e) {
      if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        close();
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
  h('div', { class: 'om-dialog', role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': id },
    h('header', { class: 'om-dialog-head' },
      h('h2', { id }, title),
      h('button', { type: 'button', class: 'om-btn om-btn-icon om-btn-sm', 'aria-label': 'Close', onClick: close }, h('i', { class: 'om-icon om-i-x', 'aria-hidden': 'true' }))),
    h('div', { class: 'om-dialog-body' }, body ? h('p', null, body) : null, error),
    h('footer', { class: 'om-dialog-foot' }, keep, confirm)));
  document.body.append(scrim);
  appear(scrim);
  keep.focus();
  return close;
}

// A quiet button for something that can't be undone. It asks in a dialog, as
// the system wants for every destructive action. The dialog title is the
// question, and its main button repeats the action.
export function confirmButton(label, onConfirm, { title = `${label}?`, body = '', confirmLabel = label, class: cls = 'om-btn om-btn-danger' } = {}) {
  return h('button', {
    type: 'button',
    class: cls,
    onClick: () => confirmDialog({ title, body, confirmLabel, onConfirm }),
  }, label);
}

// The headline is the quiet title style, a dithered fill (OMAKO DS, om-fill).
export function emptyState(title, body, action) {
  return h('div', { class: 'om-empty om-stack' },
    h('p', { class: 'om-display-s om-fill' }, title),
    body ? h('p', { style: 'margin:0' }, body) : null,
    action ? h('div', null, action) : null);
}

export function loadingState(label = 'Loading') {
  return h('div', { class: 'om-stack', role: 'status', 'aria-label': label },
    h('div', { class: 'om-wait' }),
    h('p', { class: 'om-data-s' }, label));
}

// retry, when given, is a function called by a Retry button.
export function errorState(message, retry) {
  return h('div', { class: 'om-banner', role: 'alert' },
    h('div', { class: 'om-banner-edge om-cross', 'aria-hidden': 'true' }),
    h('div', { class: 'om-banner-body om-spread' },
      h('span', null, message),
      retry ? h('button', { type: 'button', class: 'om-btn', onClick: retry }, 'Retry') : null));
}

const UNITS = [[60, 'm'], [24, 'h'], [30, 'd']];

// '5m ago', 'in 2h', 'just now', and a plain date past a month. Empty for a
// value that isn't a date. To the minute: live rows compare this to decide
// whether to rebuild, and a counter in seconds would rebuild them on every
// heartbeat.
export function relativeTime(value, now = Date.now()) {
  const then = new Date(value).getTime();
  if (Number.isNaN(then)) return '';
  const past = then <= now;
  let n = Math.floor(Math.abs(now - then) / 60000);
  if (n < 1) return past ? 'just now' : 'in under 1m';
  for (const [size, unit] of UNITS) {
    if (n < size) return past ? `${n}${unit} ago` : `in ${n}${unit}`;
    n = Math.floor(n / size);
  }
  return new Date(then).toISOString().slice(0, 10);
}

// A <time> showing the relative form, with the exact one on hover.
export function timeTag(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return h('time', null, '');
  return h('time', { datetime: date.toISOString(), title: date.toLocaleString() }, relativeTime(date));
}

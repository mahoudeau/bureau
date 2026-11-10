// Small shared pieces: toast, confirm in place, the states a page can be in, and
// how the app writes time.

import { h } from './dom.js';

let toasts = null;
export function toast(message, { ms = 4000 } = {}) {
  if (!toasts || !toasts.isConnected) {
    toasts = h('div', { class: 'om-toasts', role: 'status', 'aria-live': 'polite' });
    document.body.append(toasts);
  }
  const el = h('div', { class: 'om-toast' }, message);
  toasts.append(el);
  setTimeout(() => el.remove(), ms);
  return el;
}

// A button that asks once, on itself: the first click arms it, the second acts.
// It disarms after a few seconds or when focus leaves. onConfirm may be async;
// if it throws, the message goes to a toast.
export function confirmButton(label, onConfirm, { confirmLabel = 'Click again to confirm', class: cls = 'om-btn om-btn-danger', ms = 4000 } = {}) {
  let armed = false;
  let timer = null;
  const disarm = () => {
    armed = false;
    clearTimeout(timer);
    button.textContent = label;
    button.removeAttribute('aria-live');
    button.classList.remove('om-btn-primary');
  };
  const button = h('button', {
    type: 'button',
    class: cls,
    onBlur: disarm,
    async onClick() {
      if (!armed) {
        armed = true;
        button.textContent = confirmLabel;
        button.setAttribute('aria-live', 'polite');
        button.classList.add('om-btn-primary');
        timer = setTimeout(disarm, ms);
        return;
      }
      clearTimeout(timer);
      button.disabled = true;
      try {
        await onConfirm();
      } catch (e) {
        toast(e.message || 'That failed.');
      } finally {
        button.disabled = false;
        disarm();
      }
    },
  }, label);
  return button;
}

export function emptyState(title, body, action) {
  return h('div', { class: 'om-empty om-stack' },
    h('p', { class: 'om-label' }, title),
    body ? h('p', { style: 'margin:0' }, body) : null,
    action ? h('div', null, action) : null);
}

export function loadingState(label = 'Loading') {
  return h('div', { class: 'om-stack', role: 'status', 'aria-label': label },
    h('div', { class: 'om-wait' }),
    h('p', { class: 'om-meta', style: 'margin:0' }, label));
}

// retry, when given, is a function called by a Retry button.
export function errorState(message, retry) {
  return h('div', { class: 'om-banner', role: 'alert' },
    h('div', { class: 'om-banner-edge om-cross', 'aria-hidden': 'true' }),
    h('div', { class: 'om-banner-body om-spread' },
      h('span', null, message),
      retry ? h('button', { type: 'button', class: 'om-btn', onClick: retry }, 'Retry') : null));
}

// The title and "Not built yet". Delete it when the page is built.
export function placeholder(title) {
  return h('div', { class: 'app-page om-stack' },
    h('h1', { class: 'om-display om-h1' }, title),
    h('p', null, 'Not built yet'));
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

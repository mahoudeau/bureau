import { h } from '../dom.js';
import * as api from '../api.js';

export function render(ctx) {
  const input = h('input', {
    class: 'om-input',
    id: 'token',
    name: 'token',
    type: 'password',
    autocomplete: 'current-password',
    required: true,
  });
  const error = h('p', { class: 'om-field-error', role: 'alert', hidden: true });
  const submit = h('button', { type: 'submit', class: 'om-btn om-btn-primary om-btn-block' }, 'Sign in');

  function fail(message) {
    error.textContent = message;
    error.hidden = false;
    submit.disabled = false;
    input.focus();
  }

  async function signIn(e) {
    e.preventDefault();
    const token = input.value.trim();
    if (!token) return;
    error.hidden = true;
    submit.disabled = true;
    try {
      await api.get('/api/health', { token, keepSession: true, signal: ctx.signal });
    } catch (err) {
      if (api.isAbort(err)) return;
      fail(err.status === 401 ? "That token isn't right." : err.message);
      return;
    }
    api.setToken(token);
    ctx.navigate(api.nextPath(), { replace: true });
  }

  // The sign-in template: one raised sheet in the middle of the ground. The
  // OMAKO button goes above the form once Bureau signs in with OMAKO.
  const page = h('div', { class: 'app-layers' },
    h('div', { class: 'om-ground om-center app-signin' },
      h('div', { class: 'om-center-sheet om-stack om-stack-4' },
        h('section', { class: 'om-raised' },
          h('header', { class: 'om-titlebar om-titlebar-active' }, h('h1', null, 'Sign in to Bureau')),
          h('form', { class: 'om-raised-body om-stack om-stack-4', onSubmit: signIn },
            h('div', { class: 'om-field' },
              h('label', { class: 'om-field-label', for: 'token' }, 'Hub token'),
              input),
            error,
            submit)),
        h('p', { class: 'om-caption app-signin-note' }, 'Self-hosted. Your token stays on this server.'))));
  setTimeout(() => input.focus(), 0);
  return page;
}

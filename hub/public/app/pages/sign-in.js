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
  const submit = h('button', { type: 'submit', class: 'om-btn om-btn-primary' }, 'Sign in');

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

  // A second way in ("Sign in with OMAKO") goes under the form.
  const page = h('div', { class: 'app-signin om-stack' },
    h('h1', { class: 'om-display om-h1' }, 'Sign in'),
    h('form', { onSubmit: signIn },
      h('div', { class: 'om-field' },
        h('label', { class: 'om-label', for: 'token' }, 'Hub token'),
        input),
      error,
      submit));
  setTimeout(() => input.focus(), 0);
  return page;
}

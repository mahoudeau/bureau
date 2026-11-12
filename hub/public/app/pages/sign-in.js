import { h } from '../dom.js';
import * as api from '../api.js';
import { foldNext } from '../motion.js';

// Two ways in (doc 30, C4 and Q2): "Sign in with OMAKO" (or the hub's own
// issuer), which leaves a session cookie, and a token pasted by hand, kept
// behind "Use a token instead" for hubs without sign-in or when the issuer is
// down.
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
    foldNext();
    ctx.navigate(api.nextPath(), { replace: true });
  }

  const next = api.nextPath();
  const issuerLink = h('a', { class: 'om-btn om-btn-primary om-btn-block', href: `/auth/login?next=${encodeURIComponent(next)}`, hidden: true }, 'Sign in with OMAKO');
  const tokenForm = h('form', { class: 'om-stack om-stack-4', onSubmit: signIn },
    h('div', { class: 'om-field' },
      h('label', { class: 'om-field-label', for: 'token' }, 'Hub token'),
      input),
    error,
    submit);
  const useToken = h('button', { type: 'button', class: 'om-link app-signin-alt', hidden: true }, 'Use a token instead');
  useToken.addEventListener('click', () => {
    tokenForm.hidden = false;
    useToken.hidden = true;
    setTimeout(() => input.focus(), 0);
  });

  // The sign-in template: one box alone on the ground, with the long shadow
  // and the wordmark's side, the two dramatic moves the system keeps for rare
  // pages (OMAKO DS, om-cast and om-side).
  const page = h('div', { class: 'app-layers' },
    h('div', { class: 'om-ground om-center app-signin' },
      h('div', { class: 'om-center-sheet om-stack om-stack-4' },
        h('section', { class: 'om-cast app-signin-box' },
          h('div', { class: 'om-raised-body om-stack om-stack-4' },
            h('h1', { class: 'om-display-m om-side', dataset: { text: 'Bureau' }, 'aria-label': 'Sign in to Bureau' }, 'Bureau'),
            issuerLink,
            tokenForm,
            useToken)),
        h('p', { class: 'om-caption app-signin-note' }, 'Self-hosted. What you sign in with stays between you and this hub.'))));

  // Already signed in with the cookie: go straight on. Otherwise show the
  // issuer's button when this hub has one, with the token behind a link.
  (async () => {
    try {
      const me = await api.get('/api/me', { keepSession: true, signal: ctx.signal });
      if (me) { ctx.navigate(next, { replace: true }); return; }
    } catch (err) {
      if (api.isAbort(err)) return;
    }
    let hasIssuer = false;
    try {
      const wk = await fetch('/.well-known/bureau', { signal: ctx.signal }).then((r) => r.json());
      hasIssuer = !!(wk && wk.sign_in);
      if (wk && wk.issuer && !/omako\.dev/.test(wk.issuer)) issuerLink.textContent = 'Sign in';
    } catch { /* no sign-in: the token it is */ }
    if (hasIssuer) {
      issuerLink.hidden = false;
      tokenForm.hidden = true;
      useToken.hidden = false;
    } else {
      setTimeout(() => input.focus(), 0);
    }
  })();
  return page;
}

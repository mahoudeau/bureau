// The guide's engine, shared by /setup (consul and sol) and /setup/agent/<name>
// (any agent). One task per screen, each with a check: the hub verifies what it
// can see (an app reaching it, an app allowed, a first answer), a click is the
// check for a copy or a link, and the rest the owner confirms. Next opens only
// once the check passes. The guide can be left at any step and resumes there.
//
// A step is { id, ch, title, text[], more?, figure?, action, then?, when?, next? }.
// text items are paragraphs; more is [summary, paragraphs[]] pairs, folded.
// when(local) hides the step until a choice shows it. Actions:
//   none | done {render(s, local)} | link {href} | copy {value, hide?}
//   confirm | wait {check, show?} | turnOn {body(), check} | allow {apps(), agent, check}
//   choice {key, options: [{value, label}]}

import { fill, h } from '../dom.js';
import * as api from '../api.js';
import { toast } from '../ui.js';
import { refusal } from './kit.js';

// What this browser remembers between visits: the step, the clicks the hub
// can't see, and the choices. Never anything secret.
function loadSaved(key) {
  try { return JSON.parse(localStorage.getItem(key)) || {}; } catch { return {}; }
}
function save(key, state) {
  try { localStorage.setItem(key, JSON.stringify(state)); } catch { /* private window: fine */ }
}

export const newest = (apps) => apps.slice().sort((a, b) => String(b.last_used).localeCompare(String(a.last_used)))[0] || null;

// Mounts a guide. load({fresh, signal}) gives the hub's status (polled every
// three seconds); steps(s) builds the steps from it. Returns the guide's node.
export function runWizard(ctx, { key, load, initial, steps, doneHref = '/', migrate }) {
  let s = initial;
  const saved = loadSaved(key);
  const local = { flags: saved.flags || {}, choices: saved.choices || {} };
  if (migrate) migrate(saved, local);
  let all = steps(s);
  const shown = () => all.filter((st) => !st.when || st.when(local));
  const firstOpen = () => shown().find((st) => !isDone(st)) || shown()[shown().length - 1];
  let at = (shown().find((st) => st.id === saved.at) || firstOpen()).id;

  function isDone(st) {
    const a = st.action;
    if (a.type === 'none' || a.type === 'done') return true;
    if (a.type === 'choice') return local.choices[a.key] !== undefined && local.choices[a.key] !== null;
    const first = a.check ? a.check() : !!local.flags[st.id];
    if (!st.then) return first;
    return (first || st.then.check()) && st.then.check();
  }
  function remember() { save(key, { at, flags: local.flags, choices: local.choices }); }

  const chapters = h('div', { class: 'wiz-chapters' });
  const bar = h('div', { class: 'wiz-bar', 'aria-hidden': 'true' });
  const card = h('section', { class: 'wiz-card', 'aria-live': 'polite' });
  const navEl = h('nav', { class: 'wiz-nav', 'aria-label': 'Setup' });
  const error = h('p', { class: 'om-field-error', role: 'alert', hidden: true });

  async function refresh() {
    const fresh = await load({ fresh: true, signal: ctx.signal });
    if (!fresh) return;
    const before = JSON.stringify(s);
    s = fresh;
    all = steps(s);
    if (JSON.stringify(s) !== before) paint();
  }
  const timer = setInterval(() => { if (!document.hidden) refresh().catch(() => {}); }, 3000);
  ctx.onCleanup(() => clearInterval(timer));

  function say(text) { error.textContent = text; error.hidden = !text; }

  function check(text, done) {
    return h('div', { class: `wiz-check${done ? ' is-ok' : ''}`, role: 'status' },
      done ? h('span', { class: 'wiz-check-mark', 'aria-hidden': 'true' }, '✓') : h('span', { class: 'om-wait', 'aria-hidden': 'true' }),
      h('span', null, text));
  }

  async function copy(value) {
    try { await navigator.clipboard.writeText(value); return true; } catch { toast('Couldn\'t copy. Select it and copy by hand.'); return false; }
  }

  function actionNodes(st, a, part) {
    const flagged = !!local.flags[part === 'then' ? `${st.id}:then` : st.id];
    switch (a.type) {
      case 'turnOn': {
        if (a.check()) return [check(a.ok, true)];
        return [h('button', { type: 'button', class: 'om-btn om-btn-primary', async onClick(e) {
          e.currentTarget.disabled = true;
          say('');
          try {
            await api.patch('/api/settings', a.body(), { signal: ctx.signal });
            await refresh();
            paint();
          } catch (err) { if (!api.isAbort(err)) { say(refusal(err)); paint(); } }
        } }, a.label)];
      }
      case 'link':
        return [h('a', { class: 'om-btn om-btn-primary', href: a.href, target: '_blank', rel: 'noopener', onClick() { local.flags[st.id] = true; remember(); setTimeout(paint, 0); } }, `${a.label} ↗`),
          flagged ? check(a.ok, true) : null];
      case 'copy':
        return [
          a.hide
            ? h('details', { class: 'om-disclosure wiz-peek' }, h('summary', null, 'Read them first'), h('pre', { class: 'wiz-prompt' }, a.value))
            : h('div', { class: 'wiz-value' }, h('code', null, a.value)),
          h('button', { type: 'button', class: 'om-btn om-btn-primary', async onClick() {
            if (!a.value) { say(a.missing || 'This text isn\'t on this hub.'); return; }
            if (await copy(a.value)) { local.flags[st.id] = true; remember(); paint(); }
          } }, a.label || 'Copy'),
          flagged ? check(a.ok, true) : null];
      case 'confirm':
        if (flagged) return [check(a.ok, true)];
        return [h('button', { type: 'button', class: 'om-btn om-btn-primary', onClick() { local.flags[st.id] = true; remember(); paint(); } }, a.label)];
      case 'wait': {
        const ok = a.check();
        return [
          a.show ? h('div', { class: 'wiz-value' }, h('code', null, a.show), h('button', { type: 'button', class: 'om-btn', async onClick() { if (await copy(a.show)) toast('Copied'); } }, 'Copy')) : null,
          check(ok ? a.ok : a.waiting, ok)];
      }
      case 'allow': {
        if (a.check()) return [check(a.ok, true)];
        const app = newest(a.apps().filter((x) => x.status !== 'allowed'));
        if (!app) return [check('Waiting for the app to reach your hub', false)];
        const rule = (status) => async () => {
          say('');
          try {
            await api.post(`/api/apps/${encodeURIComponent(app.id)}`, { status }, { signal: ctx.signal });
            await refresh();
            paint();
          } catch (err) { if (!api.isAbort(err)) say(refusal(err)); }
        };
        return [h('div', { class: 'wiz-ask' },
          h('span', null, h('strong', null, app.name), ` wants to act as ${a.agent}`, app.verified ? '' : ' (unverified app)',
            app.status === 'denied' ? h('span', { class: 'om-data-s' }, '. You denied it.') : null),
          h('span', { class: 'om-cluster om-cluster-2' },
            h('button', { type: 'button', class: 'om-btn om-btn-primary', onClick: rule('allowed') }, 'Allow'),
            app.status === 'denied' ? null : h('button', { type: 'button', class: 'om-btn', onClick: rule('denied') }, 'Deny')))];
      }
      case 'choice':
        return [h('div', { class: 'wiz-choice' }, a.options.map((o, k) => h('button', {
          type: 'button',
          class: `om-btn${k === 0 ? ' om-btn-primary' : ''}`,
          'aria-pressed': String(local.choices[a.key] === o.value),
          onClick() { local.choices[a.key] = o.value; remember(); all = steps(s); move(1); },
        }, o.label)))];
      case 'done':
        return a.render(s, local, check);
      default: return [];
    }
  }

  function move(by) {
    const list = shown();
    const i = list.findIndex((st) => st.id === at);
    if (by > 0 && list[i].action.type === 'done') {
      try { localStorage.removeItem(key); } catch { /* fine */ }
      ctx.navigate(doneHref);
      return;
    }
    const next = list[Math.max(0, Math.min(list.length - 1, i + by))];
    at = next.id;
    say('');
    remember();
    paint();
    card.focus({ preventScroll: true });
    window.scrollTo(0, 0);
  }

  function paint() {
    const list = shown();
    let i = list.findIndex((st) => st.id === at);
    if (i < 0) { at = firstOpen().id; i = list.findIndex((st) => st.id === at); }
    const st = list[i];
    // The chapters are the ones the shown steps belong to, in order.
    const names = [...new Set(list.map((x) => x.ch))];
    const chNow = names.indexOf(st.ch);
    fill(chapters, names.map((c, k) => h('span', { class: k < chNow ? 'is-done' : k === chNow ? 'is-now' : '' }, c)));
    fill(bar, list.map((x, k) => h('i', { class: k < i ? 'is-done' : k === i ? 'is-now' : '' })));
    const inCh = list.filter((x) => x.ch === st.ch);
    const count = k0(st, names) ? null : h('span', { class: 'wiz-count' }, `${st.ch} · ${inCh.indexOf(st) + 1} of ${inCh.length}`);
    const firstDone = (st.action.check ? st.action.check() : !!local.flags[st.id]) || (st.then && st.then.check());
    fill(card, count, h('h2', null, st.title), st.text.filter(Boolean).map((t) => h('p', null, t)),
      (st.more || []).map(([summary, body]) => h('details', { class: 'om-disclosure wiz-more' }, h('summary', null, summary), body.map((t) => h('p', null, t)))),
      st.figure ? st.figure() : null,
      h('div', { class: 'wiz-action' }, actionNodes(st, st.action, 'first'), st.then && firstDone ? actionNodes(st, st.then, 'then') : null),
      error);
    const canNext = isDone(st) && st.action.type !== 'choice';
    fill(navEl,
      i > 0 ? h('button', { type: 'button', class: 'om-btn', onClick: () => move(-1) }, 'Back') : h('a', { class: 'om-btn', href: doneHref }, 'Not now'),
      st.action.type === 'choice' ? h('span') : h('button', {
        type: 'button', class: 'om-btn om-btn-primary', disabled: !canNext, title: canNext ? null : 'Finish this step first',
        onClick: () => move(1),
      }, st.next || 'Next'));
  }
  // No count on the first and last chapters: the start and the end.
  const k0 = (st, names) => st.ch === names[0] || st.ch === names[names.length - 1];
  card.tabIndex = -1;
  paint();

  return h('div', { class: 'wiz' },
    h('div', { class: 'wiz-progress', 'aria-label': 'Progress' }, chapters, bar),
    card, navEl);
}

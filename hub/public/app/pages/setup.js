// /setup: the first-run guide. Every hub starts with two agents, consul (the
// owner's envoy in claude.ai and the terminal) and sol (the librarian, a
// nightly routine). One task per screen, each with a check: the hub verifies
// what it can see (a connector reaching it, an app allowed, a first answer),
// a click is the check for a copy or a link, and the rest the owner confirms.
// Next opens only once the check passes. The guide can be left at any step;
// the banner (setup/banner.js) brings the owner back where they stopped.

import { fill, h, s as svg } from '../dom.js';
import * as api from '../api.js';
import { toast } from '../ui.js';
import { BOSS_ONLY, notice, refusal, setupPage, pageHead } from '../setup/kit.js';
import { setupStatus } from '../setup/banner.js';
import { CHAT_PREFERENCE, CLAUDE_MD } from '../setup/texts.js';

const CONNECTORS_URL = 'https://claude.ai/settings/connectors';
const PROFILE_URL = 'https://claude.ai/settings/profile';
const ROUTINES_URL = 'https://claude.ai/code/routines';
const HELLO = 'Who am I at Bureau?';
const SAVED = 'bureau.setup';
const CHAPTERS = ['Start', 'Consul', 'Terminal', 'Sol', 'Done'];

// What this browser remembers between visits: the step, the clicks the hub
// can't see, and whether the owner wants the terminal. Never anything secret.
function loadSaved() {
  try { return JSON.parse(localStorage.getItem(SAVED)) || {}; } catch { return {}; }
}
function save(state) {
  try { localStorage.setItem(SAVED, JSON.stringify(state)); } catch { /* private window: fine */ }
}

// claude.ai's three tool permissions, drawn the way its connector page shows
// them, with the one to pick marked: a tick (Always allow), a hand (Needs
// approval) and a barred circle (Blocked).
const ICONS = {
  allow: [['circle', { cx: 12, cy: 12, r: 9 }], ['path', { d: 'M8 12.5l2.7 2.7L16.2 9.6' }]],
  ask: [['path', { d: 'M8.5 13V6.8a1.2 1.2 0 0 1 2.4 0V11M10.9 11V5.4a1.2 1.2 0 0 1 2.4 0V11M13.3 11V6a1.2 1.2 0 0 1 2.4 0v5.5M15.7 11.5V8.4a1.2 1.2 0 0 1 2.4 0v5.4a6.2 6.2 0 0 1-6.2 6.2h-.4a6.2 6.2 0 0 1-5.3-3l-2-3.3a1.3 1.3 0 0 1 2.1-1.5l1.2 1.6' }]],
  block: [['circle', { cx: 12, cy: 12, r: 9 }], ['path', { d: 'M5.6 5.6l12.8 12.8' }]],
};
const icon = (name) => svg('svg', { viewBox: '0 0 24 24', class: 'wiz-perm-icon', 'aria-hidden': 'true' },
  ICONS[name].map(([tag, attrs]) => svg(tag, attrs)));
function permissionsFigure() {
  const seg = (name, label, on) => h('span', { class: `wiz-perm-opt${on ? ' is-on' : ''}`, title: label }, icon(name));
  return h('figure', { class: 'wiz-perm' },
    h('div', { class: 'wiz-perm-row' },
      h('span', { class: 'wiz-perm-name' }, 'Other tools'),
      h('span', { class: 'wiz-perm-menu' }, icon('allow'), 'Always allow', h('span', { 'aria-hidden': 'true' }, '▾'))),
    h('div', { class: 'wiz-perm-row' },
      h('span', { class: 'wiz-perm-name om-data-s' }, 'each tool'),
      h('span', { class: 'wiz-perm-seg' }, seg('allow', 'Always allow', true), seg('ask', 'Needs approval'), seg('block', 'Blocked'))),
    h('figcaption', { class: 'wiz-perm-key' },
      h('span', null, icon('allow'), ' Always allow: pick this'),
      h('span', null, icon('ask'), ' Needs approval'),
      h('span', null, icon('block'), ' Blocked')));
}

const appsOf = (s, name, cli) => s.agents[name].apps.filter((a) => !!a.cli === !!cli);
const newest = (apps) => apps.slice().sort((a, b) => String(b.last_used).localeCompare(String(a.last_used)))[0] || null;

// The steps. check(s, local) says whether the step is done; a step with
// first/then is two checks, the second shown once the first passes.
function steps(s) {
  const consul = s.agents.consul;
  const sol = s.agents.sol;
  const hub = s.hub_url || location.origin;
  const list = [
    { id: 'start', ch: 'Start', title: 'Bureau starts with two agents',
      text: [
        [h('strong', null, 'Consul'), ' is you, through Claude. Your chats in claude.ai act as consul: it opens a mission for the work you do together and keeps what it learned.'],
        [h('strong', null, 'Sol'), ' is the librarian. Once a night it tidies what the day wrote down, and leaves you a short digest to approve.'],
        'You connect each one once, with your OMAKO account. One thing at a time, about ten minutes.'],
      action: { type: 'none' }, next: 'Start' },
  ];
  if (!s.sign_in) {
    list.push({ id: 'signin', ch: 'Start', title: 'Turn on sign-in',
      text: ['Agents connect by signing in with your account, so the hub needs sign-in first. On the server, next to the hub, run this, open the link it prints, and confirm.'],
      action: { type: 'copy', value: 'node hub/tools/omako.js pair', ok: 'Copied. Run it on the server.' },
      then: { type: 'wait', check: () => s.sign_in, waiting: 'Waiting for the hub to be paired', ok: 'Sign-in is on.' } });
  }
  list.push(
    { id: 'consul-on', ch: 'Consul', title: 'Turn consul on', text: ['This lets consul sign in to your hub, with every project open to it.'],
      action: { type: 'turnOn', agent: 'consul', label: 'Turn on consul', check: () => consul.on, ok: 'Consul is on.' } },
    { id: 'consul-open', ch: 'Consul', title: 'Open your connectors in claude.ai',
      text: ['It opens in a new tab. Keep this one open: you\'ll come back here.', ['Then click ', h('strong', null, 'Add custom connector'), '.']],
      action: { type: 'link', href: CONNECTORS_URL, label: 'Open claude.ai connectors', ok: 'Opened in a new tab.' } },
    { id: 'consul-name', ch: 'Consul', title: 'Give it a name', text: [['Copy this, then paste it in the ', h('strong', null, 'Name'), ' field.']],
      action: { type: 'copy', value: 'Bureau (consul)', ok: 'Copied. Paste it in Name.' } },
    { id: 'consul-url', ch: 'Consul', title: 'Give it this address', text: [['Copy this, then paste it in the ', h('strong', null, 'URL'), ' field.']],
      action: { type: 'copy', value: consul.address || `${hub}/mcp/agent/consul`, ok: 'Copied. Paste it in URL.' } },
    { id: 'consul-connect', ch: 'Consul', title: 'Connect, and sign in',
      text: [['In claude.ai, click ', h('strong', null, 'Connect'), '. Sign in with your OMAKO account and approve.'], 'This screen moves on by itself once claude.ai reaches your hub.'],
      action: { type: 'wait', check: () => appsOf(s, 'consul').length > 0, waiting: 'Waiting for claude.ai to reach your hub', ok: 'claude.ai reached your hub.' } },
    { id: 'consul-allow', ch: 'Consul', title: 'Let Claude act as consul', text: ['Only allow an app you just connected yourself.'],
      action: { type: 'allow', apps: () => appsOf(s, 'consul'), agent: 'consul', check: () => appsOf(s, 'consul').some((a) => a.status === 'allowed'), ok: 'Claude can act as consul.' } },
    { id: 'consul-trust', ch: 'Consul', title: 'Let consul work without asking',
      text: [
        ['In claude.ai, open ', h('a', { class: 'om-link', href: CONNECTORS_URL, target: '_blank', rel: 'noopener' }, 'your connectors'), ', then ', h('strong', null, 'Bureau (consul)'), '. Under Tool permissions, every tool starts on ', h('strong', null, 'Needs approval'), ', the hand: Claude would stop and ask you before each step.'],
        ['Next to ', h('strong', null, 'Other tools'), ', open the menu and pick ', h('strong', null, 'Always allow'), '. Every tool switches to the tick.']],
      figure: permissionsFigure,
      action: { type: 'confirm', label: 'I\'ve set Always allow', ok: 'Consul works without asking.' } },
    { id: 'consul-prefs', ch: 'Consul', title: 'Tell Claude to use it on its own',
      text: [
        'Without this, Claude only uses Bureau when you ask. With it, every real piece of work becomes a mission, and what Claude learns is kept.',
        ['Copy these instructions, then paste them in ', h('a', { class: 'om-link', href: PROFILE_URL, target: '_blank', rel: 'noopener' }, 'claude.ai, Settings, Profile'), ', in the box for your personal preferences. Add them to what\'s there, if anything.']],
      action: { type: 'copy', value: CHAT_PREFERENCE, hide: true, label: 'Copy the instructions', ok: 'Copied. Paste them in your preferences.' } },
    { id: 'consul-hello', ch: 'Consul', title: 'Say hello',
      text: [['Open a new chat in claude.ai, turn on ', h('strong', null, 'Bureau (consul)'), ', and ask:']],
      action: { type: 'wait', show: HELLO, check: () => appsOf(s, 'consul').some((a) => a.working), waiting: 'Waiting for consul\'s first answer', ok: 'Consul answered. It works.' } },
    { id: 'terminal', ch: 'Terminal', title: 'Do you use Claude Code on this computer?', text: ['Consul can work in your terminal too. You can add it later.'],
      action: { type: 'choice', yes: 'Yes, set it up', no: 'No, skip this' } },
    { id: 'terminal-login', ch: 'Terminal', terminal: true, title: 'Sign in from your terminal',
      text: ['In a clone of the Bureau repo, run this. It shows a code and opens OMAKO: approve there.'],
      action: { type: 'copy', value: `node connectors/cli/bureau.js login --hub ${hub}`, ok: 'Copied. Run it in your terminal.' },
      then: { type: 'wait', check: () => appsOf(s, 'consul', true).length > 0, waiting: 'Waiting for your terminal to sign in', ok: 'Your terminal reached the hub.' } },
    { id: 'terminal-allow', ch: 'Terminal', terminal: true, title: 'Let your terminal act as consul', text: ['Only allow it if you just ran the command.'],
      action: { type: 'allow', apps: () => appsOf(s, 'consul', true), agent: 'consul', check: () => appsOf(s, 'consul', true).some((a) => a.status === 'allowed'), ok: 'Your terminal can act as consul.' } },
    { id: 'terminal-claudemd', ch: 'Terminal', terminal: true, title: 'Tell Claude Code to use it on its own',
      text: [
        'Same idea as in claude.ai: these instructions make Claude Code open a mission for real work, and keep what it learns.',
        ['Copy them, then add them to ', h('code', null, '~/.claude/CLAUDE.md'), ', the file Claude Code reads in every project. Create it if it isn\'t there.']],
      action: { type: 'copy', value: CLAUDE_MD, hide: true, label: 'Copy the instructions', ok: 'Copied. Add them to your CLAUDE.md.' } },
    { id: 'sol-on', ch: 'Sol', title: 'Turn sol on', text: ['Sol is the librarian. This lets it sign in to your hub.'],
      action: { type: 'turnOn', agent: 'sol', label: 'Turn on sol', check: () => sol.on, ok: 'Sol is on.' } },
    { id: 'sol-name', ch: 'Sol', title: 'Add sol as a connector',
      text: [['Same as consul: in claude.ai connectors, ', h('strong', null, 'Add custom connector'), '. Name it:']],
      action: { type: 'copy', value: 'Bureau (sol)', ok: 'Copied. Paste it in Name.' } },
    { id: 'sol-url', ch: 'Sol', title: 'Give it this address',
      text: [['Paste it in ', h('strong', null, 'URL'), ', then click ', h('strong', null, 'Connect'), ' and sign in.']],
      action: { type: 'copy', value: sol.address || `${hub}/mcp/agent/sol`, ok: 'Copied. Paste it in URL.' },
      then: { type: 'wait', check: () => appsOf(s, 'sol').length > 0, waiting: 'Waiting for the connector to reach your hub', ok: 'The connector reached your hub.' } },
    { id: 'sol-allow', ch: 'Sol', title: 'Let it act as sol', text: ['Only allow an app you just connected yourself.'],
      action: { type: 'allow', apps: () => appsOf(s, 'sol'), agent: 'sol', check: () => appsOf(s, 'sol').some((a) => a.status === 'allowed'), ok: 'Claude can act as sol.' } },
    { id: 'sol-routine', ch: 'Sol', title: 'Create sol\'s routine',
      text: [['A routine is a task claude.ai runs on a schedule. In claude.ai, open ', h('strong', null, 'Code'), ', then ', h('strong', null, 'Routines'), ', then ', h('strong', null, 'New routine'), '. Name it ', h('strong', null, 'sol'), '.']],
      action: { type: 'link', href: ROUTINES_URL, label: 'Open claude.ai routines', ok: 'Opened in a new tab.' } },
    { id: 'sol-prompt', ch: 'Sol', title: 'Paste its instructions',
      text: ['Copy them, and paste them as the routine\'s prompt. They tell sol what to do each night.'],
      action: { type: 'copy', value: s.sol_charter || '', hide: true, label: 'Copy the instructions', ok: 'Copied. Paste them as the prompt.' } },
    { id: 'sol-schedule', ch: 'Sol', title: 'Pick its connector and its time',
      text: [['Under connectors, keep ', h('strong', null, 'Bureau (sol)'), ' and switch the others off.'], ['Set it to run ', h('strong', null, 'every day'), ', at night: 01:00 is a good time. Then save.']],
      action: { type: 'confirm', label: 'I\'ve saved the routine', ok: 'Saved.' } },
    { id: 'sol-run', ch: 'Sol', title: 'Run it once now',
      text: [['On the routine\'s page, click ', h('strong', null, 'Run now'), '. Its first night is a short one.']],
      action: { type: 'wait', check: () => appsOf(s, 'sol').some((a) => a.working), waiting: 'Waiting for sol to clock in', ok: 'Sol clocked in. It works.' } },
    { id: 'done', ch: 'Done', title: 'You\'re all set', text: [], action: { type: 'done' }, next: 'Go to the Desk' },
  );
  return list;
}

export async function render(ctx) {
  ctx.title('Set up Bureau');
  let s = await setupStatus({ fresh: true, signal: ctx.signal });
  if (!s) return setupPage(pageHead('Set up Bureau'), notice(BOSS_ONLY));

  const saved = loadSaved();
  const local = { flags: saved.flags || {}, terminal: saved.terminal === undefined ? null : saved.terminal };
  let all = steps(s);
  const shown = () => all.filter((st) => !st.terminal || local.terminal === true);
  const firstOpen = () => shown().find((st) => !isDone(st)) || shown()[shown().length - 1];
  let at = (shown().find((st) => st.id === saved.at) || firstOpen()).id;

  function isDone(st) {
    const a = st.action;
    if (a.type === 'none' || a.type === 'done') return true;
    if (a.type === 'choice') return local.terminal !== null;
    const first = a.check ? a.check() : !!local.flags[st.id];
    if (!st.then) return first;
    return (first || st.then.check()) && st.then.check();
  }
  function remember() { save({ at, flags: local.flags, terminal: local.terminal }); }

  const chapters = h('div', { class: 'wiz-chapters' });
  const bar = h('div', { class: 'wiz-bar', 'aria-hidden': 'true' });
  const card = h('section', { class: 'wiz-card', 'aria-live': 'polite' });
  const navEl = h('nav', { class: 'wiz-nav', 'aria-label': 'Setup' });
  const error = h('p', { class: 'om-field-error', role: 'alert', hidden: true });

  async function refresh() {
    const fresh = await setupStatus({ fresh: true, signal: ctx.signal });
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
          const roles = s.agents[a.agent].roles.length ? undefined : s.agents[a.agent].wanted_roles;
          try {
            await api.patch('/api/settings', { agents: { [a.agent]: { oauth: { projects: ['*'] }, ...(roles ? { roles } : {}) } } }, { signal: ctx.signal });
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
            if (!a.value) { say('The instructions aren\'t on this hub. Take them from connectors/cowork/SOL-SHIFT.md in the Bureau repo.'); return; }
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
        return [h('div', { class: 'wiz-choice' },
          h('button', { type: 'button', class: 'om-btn om-btn-primary', onClick() { local.terminal = true; remember(); move(1); } }, a.yes),
          h('button', { type: 'button', class: 'om-btn', onClick() { local.terminal = false; remember(); move(1); } }, a.no))];
      case 'done': {
        const line = (text, ok) => h('li', null, check(text, ok));
        return [h('ul', { class: 'wiz-done-list' },
          line('Consul works in claude.ai', s.agents.consul.apps.some((x) => !x.cli && x.status === 'allowed')),
          local.terminal ? line('Consul works in your terminal', s.agents.consul.apps.some((x) => x.cli && x.status === 'allowed')) : null,
          line('Sol runs every night', s.agents.sol.allowed)),
          h('p', null, 'Ask consul for anything in claude.ai. Sol\'s first digest lands on your Desk tomorrow morning. You can change any of this in Settings, Sign-in.')];
      }
      default: return [];
    }
  }

  function move(by) {
    const list = shown();
    const i = list.findIndex((st) => st.id === at);
    const next = list[Math.max(0, Math.min(list.length - 1, i + by))];
    if (by > 0 && list[i].action.type === 'done') {
      try { localStorage.removeItem(SAVED); } catch { /* fine */ }
      ctx.navigate('/');
      return;
    }
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
    const chNow = CHAPTERS.indexOf(st.ch);
    fill(chapters, CHAPTERS.filter((c) => c !== 'Terminal' || local.terminal !== false).map((c) => {
      const k = CHAPTERS.indexOf(c);
      return h('span', { class: k < chNow ? 'is-done' : k === chNow ? 'is-now' : '' }, c);
    }));
    fill(bar, list.map((x, k) => h('i', { class: k < i ? 'is-done' : k === i ? 'is-now' : '' })));
    const inCh = list.filter((x) => x.ch === st.ch);
    const count = st.ch === 'Start' || st.ch === 'Done' ? null : h('span', { class: 'wiz-count' }, `${st.ch} · ${inCh.indexOf(st) + 1} of ${inCh.length}`);
    const firstDone = (st.action.check ? st.action.check() : !!local.flags[st.id]) || (st.then && st.then.check());
    fill(card, count, h('h2', null, st.title), st.text.map((t) => h('p', null, t)), st.figure ? st.figure() : null,
      h('div', { class: 'wiz-action' }, actionNodes(st, st.action, 'first'), st.then && firstDone ? actionNodes(st, st.then, 'then') : null),
      error);
    const canNext = isDone(st) && st.action.type !== 'choice';
    fill(navEl,
      i > 0 ? h('button', { type: 'button', class: 'om-btn', onClick: () => move(-1) }, 'Back') : h('a', { class: 'om-btn', href: '/' }, 'Not now'),
      st.action.type === 'choice' ? h('span') : h('button', {
        type: 'button', class: 'om-btn om-btn-primary', disabled: !canNext, title: canNext ? null : 'Finish this step first',
        onClick: () => move(1),
      }, st.next || 'Next'));
  }
  card.tabIndex = -1;
  paint();

  return setupPage(
    pageHead('Set up Bureau', h('a', { class: 'om-btn', href: '/' }, 'Exit setup')),
    h('div', { class: 'wiz' },
      h('div', { class: 'wiz-progress', 'aria-label': 'Progress' }, chapters, bar),
      card, navEl));
}

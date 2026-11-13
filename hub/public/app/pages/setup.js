// /setup: the first-run guide. Every hub starts with two agents, consul (the
// owner's envoy in chat and the terminal) and sol (the librarian, a nightly
// routine). The owner picks a path first: Claude, walked click by click
// (claude.ai for consul and sol, Claude Code in the terminal), or any other AI
// app, with the generic steps (setup/generic.js). The engine is
// setup/wizard.js; the banner (setup/banner.js) brings the owner back here.

import { h, s as svg } from '../dom.js';
import { BOSS_ONLY, notice, setupPage, pageHead } from '../setup/kit.js';
import { setupStatus } from '../setup/banner.js';
import { CHAT_PREFERENCE, CLAUDE_MD } from '../setup/texts.js';
import { runWizard } from '../setup/wizard.js';
import { HELLO, genericSteps, signinStep } from '../setup/generic.js';

const CONNECTORS_URL = 'https://claude.ai/new#customize/connectors';
const PROFILE_URL = 'https://claude.ai/settings/profile';
const ROUTINES_URL = 'https://claude.ai/code/routines';

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
const claude = (l) => l.choices.mode === 'claude';
const generic = (l) => l.choices.mode === 'generic';
const terminal = (l) => claude(l) && l.choices.terminal === true;

// The steps, rebuilt from each fresh status. check() says whether a step is
// done; a step with first/then is two checks, the second shown once the first
// passes.
function steps(s) {
  const consul = s.agents.consul;
  const sol = s.agents.sol;
  const hub = s.hub_url || location.origin;
  const turnOn = (agent) => () => ({ agents: { [agent.name]: { oauth: { projects: ['*'] }, ...(agent.roles.length ? {} : { roles: agent.wanted_roles }) } } });
  const list = [
    { id: 'start', ch: 'Start', title: 'Bureau starts with two agents',
      text: [
        [h('strong', null, 'Consul'), ' is you, through your AI app. Your chats act as consul: it opens a mission for the work you do together and keeps what it learned.'],
        [h('strong', null, 'Sol'), ' is the librarian. Once a night it tidies what the day wrote down, and leaves you a short digest to approve.'],
        'You connect each one once, with your account. One thing at a time, about ten minutes.'],
      action: { type: 'none' }, next: 'Start' },
  ];
  if (!s.sign_in) list.push(signinStep(s));
  list.push(
    { id: 'path', ch: 'Start', title: 'Which AI do you use?',
      text: [
        [h('strong', null, 'Claude'), ': the guide walks you through claude.ai and Claude Code, click by click.'],
        [h('strong', null, 'Another AI app'), ': any app that can add a remote MCP server works. The guide gives you the address and the instructions, and you place them in your app.'],
        'You can come back here and switch.'],
      action: { type: 'choice', key: 'mode', options: [{ value: 'claude', label: 'Claude, guided' }, { value: 'generic', label: 'Another AI app' }] } },

    // ---- Claude, guided ----
    { id: 'consul-on', ch: 'Consul', when: claude, title: 'Turn consul on', text: ['This lets consul sign in to your hub, with every project open to it.'],
      action: { type: 'turnOn', body: turnOn(consul), label: 'Turn on consul', check: () => consul.on, ok: 'Consul is on.' } },
    { id: 'consul-open', ch: 'Consul', when: claude, title: 'Open your connectors in claude.ai',
      text: ['It opens in a new tab. Keep this one open: you\'ll come back here.', ['Then click ', h('strong', null, 'Add custom connector'), '.']],
      action: { type: 'link', href: CONNECTORS_URL, label: 'Open claude.ai connectors', ok: 'Opened in a new tab.' } },
    { id: 'consul-name', ch: 'Consul', when: claude, title: 'Give it a name', text: [['Copy this, then paste it in the ', h('strong', null, 'Name'), ' field.']],
      action: { type: 'copy', value: 'Bureau (consul)', ok: 'Copied. Paste it in Name.' } },
    { id: 'consul-url', ch: 'Consul', when: claude, title: 'Give it this address', text: [['Copy this, then paste it in the ', h('strong', null, 'URL'), ' field.']],
      action: { type: 'copy', value: consul.address || `${hub}/mcp/agent/consul`, ok: 'Copied. Paste it in URL.' } },
    { id: 'consul-connect', ch: 'Consul', when: claude, title: 'Connect, and sign in',
      text: [['In claude.ai, click ', h('strong', null, 'Connect'), '. Sign in with your OMAKO account and approve.'], 'This screen moves on by itself once claude.ai reaches your hub.'],
      action: { type: 'wait', check: () => appsOf(s, 'consul').length > 0, waiting: 'Waiting for claude.ai to reach your hub', ok: 'claude.ai reached your hub.' } },
    { id: 'consul-allow', ch: 'Consul', when: claude, title: 'Let Claude act as consul', text: ['Only allow an app you just connected yourself.'],
      action: { type: 'allow', apps: () => appsOf(s, 'consul'), agent: 'consul', check: () => appsOf(s, 'consul').some((a) => a.status === 'allowed'), ok: 'Claude can act as consul.' } },
    { id: 'consul-trust', ch: 'Consul', when: claude, title: 'Let consul work without asking',
      text: [
        ['In claude.ai, open ', h('a', { class: 'om-link', href: CONNECTORS_URL, target: '_blank', rel: 'noopener' }, 'your connectors'), ', then ', h('strong', null, 'Bureau (consul)'), '. Under Tool permissions, every tool starts on ', h('strong', null, 'Needs approval'), ', the hand: Claude would stop and ask you before each step.'],
        ['Next to ', h('strong', null, 'Other tools'), ', open the menu and pick ', h('strong', null, 'Always allow'), '. Every tool switches to the tick.']],
      figure: permissionsFigure,
      action: { type: 'confirm', label: 'I\'ve set Always allow', ok: 'Consul works without asking.' } },
    { id: 'consul-prefs', ch: 'Consul', when: claude, title: 'Tell Claude to use it on its own',
      text: [
        'Without this, Claude only uses Bureau when you ask. With it, every real piece of work becomes a mission, and what Claude learns is kept.',
        ['Copy these instructions, then paste them in ', h('a', { class: 'om-link', href: PROFILE_URL, target: '_blank', rel: 'noopener' }, 'claude.ai, Settings, Profile'), ', in the box for your personal preferences. Add them to what\'s there, if anything.']],
      action: { type: 'copy', value: CHAT_PREFERENCE, hide: true, label: 'Copy the instructions', ok: 'Copied. Paste them in your preferences.' } },
    { id: 'consul-hello', ch: 'Consul', when: claude, title: 'Say hello',
      text: [['Open a new chat in claude.ai, turn on ', h('strong', null, 'Bureau (consul)'), ', and ask:']],
      action: { type: 'wait', show: HELLO, check: () => appsOf(s, 'consul').some((a) => a.working), waiting: 'Waiting for consul\'s first answer', ok: 'Consul answered. It works.' } },
    { id: 'terminal', ch: 'Terminal', when: claude, title: 'Do you use Claude Code on this computer?', text: ['Consul can work in your terminal too. You can add it later.'],
      action: { type: 'choice', key: 'terminal', options: [{ value: true, label: 'Yes, set it up' }, { value: false, label: 'No, skip this' }] } },
    { id: 'terminal-login', ch: 'Terminal', when: terminal, title: 'Sign in from your terminal',
      text: ['In a clone of the Bureau repo, run this. It shows a code and opens OMAKO: approve there.'],
      action: { type: 'copy', value: `node connectors/cli/bureau.js login --hub ${hub}`, ok: 'Copied. Run it in your terminal.' },
      then: { type: 'wait', check: () => appsOf(s, 'consul', true).length > 0, waiting: 'Waiting for your terminal to sign in', ok: 'Your terminal reached the hub.' } },
    { id: 'terminal-allow', ch: 'Terminal', when: terminal, title: 'Let your terminal act as consul', text: ['Only allow it if you just ran the command.'],
      action: { type: 'allow', apps: () => appsOf(s, 'consul', true), agent: 'consul', check: () => appsOf(s, 'consul', true).some((a) => a.status === 'allowed'), ok: 'Your terminal can act as consul.' } },
    { id: 'terminal-claudemd', ch: 'Terminal', when: terminal, title: 'Tell Claude Code to use it on its own',
      text: [
        'Same idea as in claude.ai: these instructions make Claude Code open a mission for real work, and keep what it learns.',
        ['Copy them, then add them to ', h('code', null, '~/.claude/CLAUDE.md'), ', the file Claude Code reads in every project. Create it if it isn\'t there.']],
      action: { type: 'copy', value: CLAUDE_MD, hide: true, label: 'Copy the instructions', ok: 'Copied. Add them to your CLAUDE.md.' } },
    { id: 'sol-on', ch: 'Sol', when: claude, title: 'Turn sol on', text: ['Sol is the librarian. This lets it sign in to your hub.'],
      action: { type: 'turnOn', body: turnOn(sol), label: 'Turn on sol', check: () => sol.on, ok: 'Sol is on.' } },
    { id: 'sol-name', ch: 'Sol', when: claude, title: 'Add sol as a connector',
      text: [['Same as consul: in claude.ai connectors, ', h('strong', null, 'Add custom connector'), '. Name it:']],
      action: { type: 'copy', value: 'Bureau (sol)', ok: 'Copied. Paste it in Name.' } },
    { id: 'sol-url', ch: 'Sol', when: claude, title: 'Give it this address',
      text: [['Paste it in ', h('strong', null, 'URL'), ', then click ', h('strong', null, 'Connect'), ' and sign in.']],
      action: { type: 'copy', value: sol.address || `${hub}/mcp/agent/sol`, ok: 'Copied. Paste it in URL.' },
      then: { type: 'wait', check: () => appsOf(s, 'sol').length > 0, waiting: 'Waiting for the connector to reach your hub', ok: 'The connector reached your hub.' } },
    { id: 'sol-allow', ch: 'Sol', when: claude, title: 'Let it act as sol', text: ['Only allow an app you just connected yourself.'],
      action: { type: 'allow', apps: () => appsOf(s, 'sol'), agent: 'sol', check: () => appsOf(s, 'sol').some((a) => a.status === 'allowed'), ok: 'Claude can act as sol.' } },
    { id: 'sol-routine', ch: 'Sol', when: claude, title: 'Create sol\'s routine',
      text: [['A routine is a task claude.ai runs on a schedule. In claude.ai, open ', h('strong', null, 'Code'), ', then ', h('strong', null, 'Routines'), ', then ', h('strong', null, 'New routine'), '. Name it ', h('strong', null, 'sol'), '.']],
      action: { type: 'link', href: ROUTINES_URL, label: 'Open claude.ai routines', ok: 'Opened in a new tab.' } },
    { id: 'sol-prompt', ch: 'Sol', when: claude, title: 'Paste its instructions',
      text: ['Copy them, and paste them as the routine\'s prompt. They tell sol what to do each night.'],
      action: { type: 'copy', value: s.sol_charter || '', hide: true, label: 'Copy the instructions', ok: 'Copied. Paste them as the prompt.', missing: 'The instructions aren\'t on this hub. Take them from connectors/cowork/SOL-SHIFT.md in the Bureau repo.' } },
    { id: 'sol-schedule', ch: 'Sol', when: claude, title: 'Pick its connector and its time',
      text: [['Under connectors, keep ', h('strong', null, 'Bureau (sol)'), ' and switch the others off.'], ['Set it to run ', h('strong', null, 'every day'), ', at night: 01:00 is a good time. Then save.']],
      action: { type: 'confirm', label: 'I\'ve saved the routine', ok: 'Saved.' } },
    { id: 'sol-run', ch: 'Sol', when: claude, title: 'Run it once now',
      text: [['On the routine\'s page, click ', h('strong', null, 'Run now'), '. Its first night is a short one.']],
      action: { type: 'wait', check: () => appsOf(s, 'sol').some((a) => a.working), waiting: 'Waiting for sol to clock in', ok: 'Sol clocked in. It works.' } },

    // ---- Another AI app: the generic steps ----
    ...genericSteps(s, consul, { ch: 'Consul', prefix: 'consul-g', when: generic }),
    ...genericSteps(s, sol, { ch: 'Sol', prefix: 'sol-g', when: generic, charter: s.sol_charter }),

    { id: 'done', ch: 'Done', title: 'You\'re all set', text: [], next: 'Go to the Desk',
      action: { type: 'done', render: (st, l, check) => {
        const line = (text, ok) => h('li', null, check(text, ok));
        const g = generic(l);
        return [h('ul', { class: 'wiz-done-list' },
          line(g ? 'Consul works in your app' : 'Consul works in claude.ai', st.agents.consul.apps.some((x) => !x.cli && x.status === 'allowed') || (g && st.agents.consul.allowed)),
          l.choices.terminal && !g ? line('Consul works in your terminal', st.agents.consul.apps.some((x) => x.cli && x.status === 'allowed')) : null,
          line(g ? 'Sol runs on its schedule' : 'Sol runs every night', st.agents.sol.allowed)),
          h('p', null, g
            ? 'Ask consul for anything in your app. Sol\'s digests land on your Desk. Every other agent connects the same way: Settings, Sign-in, then Connect next to its name.'
            : 'Ask consul for anything in claude.ai. Sol\'s first digest lands on your Desk tomorrow morning. You can change any of this in Settings, Sign-in.')];
      } } },
  );
  return list;
}

export async function render(ctx) {
  ctx.title('Set up Bureau');
  const s = await setupStatus({ fresh: true, signal: ctx.signal });
  if (!s) return setupPage(pageHead('Set up Bureau'), notice(BOSS_ONLY));
  const wizard = runWizard(ctx, {
    key: 'bureau.setup', initial: s, steps, doneHref: '/',
    load: setupStatus,
    // Before the choice existed, the guide was Claude's, and the terminal
    // answer sat at the top level.
    migrate(saved, local) {
      if (saved.terminal !== undefined && saved.terminal !== null && local.choices.terminal === undefined) {
        local.choices.terminal = saved.terminal;
        if (local.choices.mode === undefined) local.choices.mode = 'claude';
      }
    },
  });
  return setupPage(pageHead('Set up Bureau', h('a', { class: 'om-btn', href: '/' }, 'Exit setup')), wizard);
}

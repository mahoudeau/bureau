// The generic guide: connecting one agent from any AI app that can add a
// remote MCP server. The first-run guide uses it for consul and sol when the
// owner doesn't use Claude; /setup/agent/<name> uses it for every agent.

import { h } from '../dom.js';
import { agentInstructions } from './texts.js';

export const HELLO = 'Who am I at Bureau?';
const CLAUDE_CONNECTORS = 'https://claude.ai/new#customize/connectors';
const cap = (name) => name.charAt(0).toUpperCase() + name.slice(1);

// The hub needs sign-in before any agent can sign in.
export function signinStep(s) {
  return { id: 'signin', ch: 'Start', title: 'Turn on sign-in',
    text: ['Agents connect by signing in with your account, so the hub needs sign-in first. On the server, next to the hub, run this, open the link it prints, and confirm.'],
    action: { type: 'copy', value: 'node hub/tools/omako.js pair', ok: 'Copied. Run it on the server.' },
    then: { type: 'wait', check: () => s.sign_in, waiting: 'Waiting for the hub to be paired', ok: 'Sign-in is on.' } };
}

// The steps for one agent. agent is its status from the hub; charter, when
// the hub has one, makes it a scheduled agent (sol) instead of a chat one.
export function genericSteps(s, agent, { charter = null, ch = cap(agent.name), prefix = agent.name, when } = {}) {
  const name = agent.name;
  const hub = s.hub_url || location.origin;
  const address = agent.address || `${hub}/mcp/agent/${name}`;
  const account = s.omako ? 'your OMAKO account' : 'your account on this hub';
  const step = (o) => ({ ch, when, ...o, id: `${prefix}-${o.id}` });
  const list = [
    step({ id: 'on', title: `Turn ${name} on`,
      text: [`This lets ${name} sign in to your hub, with every project open to it. You can narrow its projects later in Settings, Sign-in.`],
      action: { type: 'turnOn', label: `Turn on ${name}`, check: () => agent.on, ok: `${cap(name)} is on.`,
        body: () => ({ agents: { [name]: { oauth: { projects: ['*'] }, ...(!agent.roles.length && agent.wanted_roles.length ? { roles: agent.wanted_roles } : {}) } } }) } }),
    step({ id: 'add', title: 'Add Bureau to your AI app',
      text: [
        'Bureau speaks MCP, the open standard AI apps use to reach tools. In your app\'s settings, add a remote MCP server. Apps call it a connector, an integration or a tool server. If it asks for a type, pick HTTP, not a command to run.',
        ['Name it ', h('strong', null, `Bureau (${name})`), ' and give it this address. Your app then opens a page to sign in: use ', account, ' and approve.']],
      more: [
        ['Using claude.ai?', [['Open ', h('a', { class: 'om-link', href: CLAUDE_CONNECTORS, target: '_blank', rel: 'noopener' }, 'Customize, then Connectors'), ', then ', h('strong', null, 'Add custom connector'), '.']]],
        ['No MCP in your app?', [
          'An agent that runs commands can sign in from a terminal instead. In a clone of the Bureau repo, run:',
          h('code', null, `node connectors/cli/bureau.js login --agent ${name} --hub ${hub}`),
          ['It shows a code to approve. Afterwards, ', h('code', null, `bureau token --agent ${name}`), ' prints a fresh token for the hub\'s HTTP API, described in docs/protocol.md.']]]],
      action: { type: 'copy', value: address, ok: 'Copied. Paste it as the address.' },
      then: { type: 'wait', check: () => agent.apps.length > 0, waiting: 'Waiting for your app to reach your hub', ok: 'Your app reached your hub.' } }),
    step({ id: 'allow', title: `Let your app act as ${name}`, text: ['Only allow an app you just connected yourself.'],
      action: { type: 'allow', apps: () => agent.apps, agent: name, check: () => agent.allowed, ok: `Your app can act as ${name}.` } }),
    step({ id: 'trust', title: 'Let it work without asking',
      text: [
        'Most apps ask you before each tool call. If yours can always allow a server\'s tools, turn that on for Bureau. The hub still holds every rule: the walls between projects, and the reviews you sign.',
        charter ? 'A scheduled run needs it: nobody is there to click.' : null],
      action: { type: 'confirm', label: 'Done, or my app doesn\'t ask', ok: 'Set.' } }),
  ];
  if (charter) {
    list.push(
      step({ id: 'prompt', title: 'Give it its instructions',
        text: [`These tell ${name} what to do on each run. Make a task in your app that runs on its own (apps call it a scheduled task or an automation), and paste them as its prompt.`],
        action: { type: 'copy', value: charter, hide: true, label: 'Copy the instructions', ok: 'Copied. Paste them as the prompt.' } }),
      step({ id: 'schedule', title: 'Run it on a schedule',
        text: [
          ['Give the task only the ', h('strong', null, `Bureau (${name})`), ' connector, and set it to run once a day', name === 'sol' ? ', at night: 01:00 is a good time.' : '.'],
          'No scheduler in your app? Any cron job that starts your agent with this prompt does the same.'],
        action: { type: 'confirm', label: 'I\'ve scheduled it', ok: 'Scheduled.' } }),
      step({ id: 'run', title: 'Run it once now', text: ['Start the task by hand once. Its first run is a short one.'],
        action: { type: 'wait', check: () => agent.working, waiting: `Waiting for ${name} to clock in`, ok: `${cap(name)} clocked in. It works.` } }));
  } else {
    list.push(
      step({ id: 'prompt', title: 'Tell it to use Bureau on its own',
        text: [
          'Without this, your app only uses Bureau when you ask. With it, every real piece of work becomes a mission, and what it learns is kept.',
          'Copy these instructions, then paste them where your app keeps standing instructions: custom instructions, a system prompt, rules or preferences.'],
        action: { type: 'copy', value: agentInstructions(name), hide: true, label: 'Copy the instructions', ok: 'Copied. Paste them in your app.' } }),
      step({ id: 'hello', title: 'Say hello', text: [['Open a new conversation with ', h('strong', null, `Bureau (${name})`), ' turned on, and ask:']],
        action: { type: 'wait', show: HELLO, check: () => agent.working, waiting: `Waiting for ${name}'s first answer`, ok: `${cap(name)} answered. It works.` } }));
  }
  return list;
}

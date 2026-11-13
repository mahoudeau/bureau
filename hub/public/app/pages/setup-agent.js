// /setup/agent/<name>: the generic guide for one agent, from any AI app that
// can add a remote MCP server. Settings, Sign-in sends the owner here when an
// agent's sign-in is turned on, and from Connect beside each agent.

import { h } from '../dom.js';
import * as api from '../api.js';
import { BOSS_ONLY, notice, setupPage, pageHead } from '../setup/kit.js';
import { runWizard } from '../setup/wizard.js';
import { genericSteps, signinStep } from '../setup/generic.js';

const SETTINGS = '/settings?tab=signin';

export async function render(ctx) {
  const name = String(ctx.params.name || '').toLowerCase();
  ctx.title(`Connect ${name}`);
  const head = pageHead(`Connect ${name}`, h('a', { class: 'om-btn', href: SETTINGS }, 'Exit'));
  if (!/^[a-z][a-z0-9_-]{0,31}$/.test(name) || name === 'human' || name === 'system') {
    return setupPage(head, notice('That isn\'t an agent name: lowercase letters, digits, - or _.'));
  }
  async function load({ signal } = {}) {
    try { return await api.get(`/api/setup/agent/${encodeURIComponent(name)}`, { signal, keepSession: true }); } catch (err) {
      if (api.isAbort(err)) throw err;
      return null;
    }
  }
  const s = await load({ signal: ctx.signal });
  if (!s) return setupPage(head, notice(BOSS_ONLY));

  function steps(st) {
    const list = [
      { id: 'start', ch: 'Start', title: `Connect ${name}`,
        text: [
          `${name} signs in to your hub through an AI app. The hub sees ${name}, and only the projects you open to it.`,
          'Any app that can add a remote MCP server works, claude.ai among them. One thing at a time.'],
        action: { type: 'none' }, next: 'Start' },
    ];
    if (!st.sign_in) list.push(signinStep(st));
    list.push(...genericSteps(st, st.agent, { charter: st.charter, prefix: 'g' }));
    list.push({ id: 'done', ch: 'Done', title: `${name} is connected`, text: [], next: 'Back to Settings',
      action: { type: 'done', render: (x, l, check) => [
        h('ul', { class: 'wiz-done-list' },
          h('li', null, check(`${name} signs in`, x.agent.on)),
          h('li', null, check(`An app is allowed as ${name}`, x.agent.allowed)),
          h('li', null, check(x.charter ? `${name} has clocked in` : `${name} has answered`, x.agent.working))),
        h('p', null, `Change its projects, or cut an app off, in Settings, Sign-in.`)] } });
    return list;
  }

  const wizard = runWizard(ctx, { key: `bureau.setup.agent.${name}`, initial: s, steps, load, doneHref: SETTINGS });
  return setupPage(head, wizard);
}

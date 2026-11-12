// Settings. A tab is a real URL, /settings?tab=tokens.

import { h } from '../dom.js';
import * as api from '../api.js';
import { pageHead, setupPage } from '../setup/kit.js';
import { appearance, approval, mcp, roles, tokens } from '../setup/settings-tabs.js';

const TABS = [
  ['appearance', 'Appearance', appearance],
  ['approval', 'Approval', approval],
  ['roles', 'Roles', roles],
  ['tokens', 'Tokens', tokens],
  ['mcp', 'MCP', mcp],
];

function who(health) {
  const c = health.credential || {};
  if (c.kind === 'boss') return 'Signed in as the boss';
  if (c.kind === 'agent') return `Signed in as ${c.name}`;
  if (c.kind === 'shared') return 'Signed in with the shared token';
  return 'Signed in';
}

export async function render(ctx) {
  const asked = ctx.query.get('tab');
  const tab = TABS.find(([key]) => key === asked) || TABS[0];
  const [key, word, build] = tab;
  ctx.title(`${word} settings`);

  const health = await api.get('/api/health', { signal: ctx.signal });
  const body = await build(ctx, health);

  return setupPage(
    pageHead('Settings',
      h('span', { class: 'om-data-s' }, who(health)),
      h('button', { type: 'button', class: 'om-btn', onClick: () => api.signOut() }, 'Sign out')),
    h('nav', { class: 'om-tabs', 'aria-label': 'Settings' },
      TABS.map(([k, w]) => h('a', { href: `/settings?tab=${k}`, 'aria-current': k === key ? 'page' : null }, w))),
    h('div', { class: 'set-tab' }, body));
}

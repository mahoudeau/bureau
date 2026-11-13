// The Sign-in tab of /settings (doc 30): who may sign in to this hub, which
// agents sign in through an app, the apps waiting for an owner, the open
// sessions, and the pairing with OMAKO. Every write here is an owner's.

import { h } from '../dom.js';
import * as api from '../api.js';
import * as store from '../store.js';
import { confirmButton, emptyState, timeTag, toast } from '../ui.js';
import { BOSS_ONLY, copyButton, field, message, notice, refusal, section, table } from './kit.js';

const ROLES = [
  ['owner', 'Owner', 'Everything, like the boss: settings, people, agents, apps.'],
  ['approver', 'Approver', 'Rules on reviews and answers blocked missions. Nothing else.'],
  ['viewer', 'Viewer', 'Reads the hub. Changes nothing.'],
];

const appState = (a) => h('span', { class: `om-tag${a.status === 'allowed' ? ' om-tag-solid' : ''}` }, a.status === 'pending' ? 'Waiting' : a.status === 'allowed' ? 'Allowed' : 'Denied');

export async function signin(ctx, health) {
  let omako, apps, sessions, settings;
  try {
    [omako, apps, sessions, { settings }] = await Promise.all([
      api.get('/api/omako', { signal: ctx.signal }),
      api.get('/api/apps', { signal: ctx.signal }).then((r) => r.apps),
      api.get('/api/sessions', { signal: ctx.signal }).then((r) => r.sessions),
      api.get('/api/settings', { signal: ctx.signal }),
    ]);
  } catch (err) {
    if (api.isAbort(err) || err.status !== 403) throw err;
    return notice(BOSS_ONLY);
  }
  const state = await store.ready();
  const error = message();
  const reload = () => ctx.navigate('/settings?tab=signin', { replace: true });

  async function save(body, said) {
    error.clear();
    try {
      await api.patch('/api/settings', body, { signal: ctx.signal });
      toast(said);
      return true;
    } catch (err) {
      if (api.isAbort(err)) return false;
      error.say(refusal(err));
      return false;
    }
  }

  // ---- the pairing ----
  const pairing = omako.paired
    ? section('Signing in with OMAKO', omako.verified ? 'Verified' : 'Paired',
      h('p', null, `This hub is paired with ${omako.issuer}${omako.hub_url ? ` as ${omako.hub_url}` : ''}. People sign in with their OMAKO account, and apps sign in as agents.`),
      omako.error ? h('p', { class: 'om-data-s' }, omako.error) : null)
    : section('Signing in', omako.sign_in ? 'On' : 'Off',
      omako.sign_in
        ? h('p', null, `People sign in through ${omako.issuer}.`)
        : h('div', { class: 'om-stack om-stack-3' },
          h('p', null, 'Sign-in is off: people paste a token, and agents use minted tokens. To sign in with OMAKO, pair this hub. On the server, beside the hub, run:'),
          h('div', { class: 'set-secret' }, h('code', { class: 'set-code' }, 'node hub/tools/omako.js pair'), copyButton('node hub/tools/omako.js pair')),
          h('p', { class: 'om-data-s' }, 'Any other OpenID issuer works too: see BUREAU_OIDC_ISSUER in hub/.env.example.')));

  // ---- apps acting as agents (D13) ----
  async function rule(app, status) {
    error.clear();
    try {
      await api.post(`/api/apps/${encodeURIComponent(app.id)}`, { status }, { signal: ctx.signal });
      toast(`${app.name || app.client_id} ${status} as ${app.agent}`);
      reload();
    } catch (err) {
      if (!api.isAbort(err)) error.say(refusal(err));
    }
  }
  async function forget(app) {
    try {
      await api.del(`/api/apps/${encodeURIComponent(app.id)}`, { signal: ctx.signal });
      toast('Forgotten');
      reload();
    } catch (err) {
      if (!api.isAbort(err)) error.say(refusal(err));
    }
  }
  const order = { pending: 0, allowed: 1, denied: 2 };
  const sortedApps = [...apps].sort((a, b) => order[a.status] - order[b.status] || String(b.last_used).localeCompare(String(a.last_used)));
  const appsBox = section('Apps acting as agents', String(apps.filter((a) => a.status === 'pending').length || ''),
    h('p', { class: 'om-data-s set-hint' }, 'An app that signs in as an agent waits here until an owner allows it, for that agent only. Deny anything you did not connect yourself.'),
    sortedApps.length
      ? table([
        { label: 'App', cell: (a) => h('span', null, h('span', { class: 'om-strong' }, a.name || a.client_id), a.verified ? null : h('span', { class: 'om-data-s' }, ' unverified')) },
        { label: 'As', cell: (a) => a.agent },
        { label: 'State', cell: appState },
        { label: 'Last seen', cell: (a) => timeTag(a.last_used) },
        {
          label: 'Rule',
          cell: (a) => h('span', { class: 'om-cluster om-cluster-2' },
            a.status !== 'allowed' ? h('button', { type: 'button', class: 'om-btn om-btn-primary', onClick: () => rule(a, 'allowed') }, 'Allow') : null,
            a.status !== 'denied' ? h('button', { type: 'button', class: 'om-btn', onClick: () => rule(a, 'denied') }, 'Deny') : null,
            confirmButton('Forget', () => forget(a), { title: `Forget ${a.name || a.client_id}?`, body: 'Its next call waits for an owner again.' })),
        },
      ], sortedApps, (a) => (a.status === 'denied' ? 'set-muted' : null))
      : emptyState('No app has signed in yet', 'Add an agent\'s address as a connector in claude.ai, or run bureau login.'));

  // ---- agents that sign in ----
  const agents = settings.agents || {};
  const names = [...new Set([...(state.agents || []).map((a) => a.name), ...Object.keys(agents)])]
    .filter((n) => /^[a-z][a-z0-9_-]{0,31}$/.test(n) && n !== 'human' && n !== 'system').sort();
  const projects = state.projects || [];
  const origin = location.origin;
  function agentRow(name) {
    const on = agents[name] && agents[name].oauth;
    const list = on ? on.projects : null;
    const select = h('select', { class: 'om-select', 'aria-label': `Projects ${name} reaches when signed in` },
      h('option', { value: '' }, 'Off'),
      h('option', { value: '*', selected: !!list && list.includes('*') }, 'All projects'),
      projects.map((p) => h('option', { value: p.id, selected: !!list && !list.includes('*') && list.length === 1 && list[0] === p.id }, p.label || p.id)));
    if (list && !list.includes('*') && list.length > 1) select.append(h('option', { value: list.join(','), selected: true }, list.join(', ')));
    select.addEventListener('change', async () => {
      const v = select.value;
      const body = { agents: { [name]: { oauth: v ? { projects: v.split(',') } : null } } };
      if (await save(body, v ? `${name} signs in` : `${name} no longer signs in`)) reload();
    });
    const address = `${origin}/mcp/agent/${name}`;
    const connected = apps.some((a) => a.agent === name && a.status === 'allowed');
    return h('div', { class: 'set-role' },
      h('span', { class: 'om-strong set-role-name' }, name),
      select,
      on ? h('span', { class: 'set-secret' }, h('code', { class: 'set-code' }, address), copyButton(address)) : null,
      on ? h('a', { class: `om-btn${connected ? '' : ' om-btn-primary'}`, href: `/setup/agent/${encodeURIComponent(name)}` }, connected ? 'Guide' : 'Connect') : null);
  }
  // An agent that has never clocked in has no row yet: name it here.
  const newName = h('input', { class: 'om-input', id: 'agent-new', placeholder: 'consul', pattern: '[a-z][a-z0-9_-]{0,31}' });
  const newProjects = h('select', { class: 'om-select', id: 'agent-new-projects' },
    h('option', { value: '*' }, 'All projects'),
    projects.map((p) => h('option', { value: p.id }, p.label || p.id)));
  const addAgent = h('form', {
    class: 'set-form',
    async onSubmit(e) {
      e.preventDefault();
      const name = newName.value.trim().toLowerCase();
      if (!name) return;
      // A new agent goes straight to its guide: the address alone isn't a setup.
      if (await save({ agents: { [name]: { oauth: { projects: [newProjects.value] } } } }, `${name} signs in`)) ctx.navigate(`/setup/agent/${encodeURIComponent(name)}`);
    },
  }, field('Agent', newName, 'Lowercase letters, digits, - or _'), field('Projects', newProjects), h('div', null, h('button', { type: 'submit', class: 'om-btn' }, 'Turn on')));
  const agentsBox = section('Agents that sign in', String(names.filter((n) => agents[n] && agents[n].oauth).length),
    h('p', { class: 'om-data-s set-hint' }, 'Turn sign-in on for an agent, then Connect walks you through adding it to your AI app. The address holds no secret.'),
    names.length ? h('div', { class: 'set-roles' }, names.map(agentRow)) : null,
    addAgent);

  // ---- people ----
  const members = settings.members || {};
  const keyInput = h('input', { class: 'om-input', id: 'member-key', placeholder: 'name@example.com' });
  const roleSelect = h('select', { class: 'om-select', id: 'member-role' }, ROLES.map(([v, w]) => h('option', { value: v }, w)));
  const addForm = h('form', {
    class: 'set-form',
    async onSubmit(e) {
      e.preventDefault();
      const key = keyInput.value.trim();
      if (!key) return;
      if (await save({ members: { [key]: { role: roleSelect.value } } }, `${key}: ${roleSelect.value}`)) reload();
    },
  }, field('Email, or the issuer\'s id', keyInput), field('Role', roleSelect), h('div', null, h('button', { type: 'submit', class: 'om-btn om-btn-primary' }, 'Add')));
  const people = Object.entries(members).sort(([a], [b]) => a.localeCompare(b));
  const peopleBox = section('People', String(people.length),
    people.length
      ? table([
        { label: 'Who', cell: ([k]) => h('span', { class: 'om-strong' }, k) },
        { label: 'Role', cell: ([, m]) => ROLES.find(([v]) => v === m.role)[1] },
        { label: 'Remove', cell: ([k]) => confirmButton('Remove', async () => { if (await save({ members: { [k]: null } }, `${k} removed`)) reload(); }, { title: `Remove ${k}?`, body: 'Their session ends at their next click.' }) },
      ], people)
      : h('p', null, 'Only the owners set on the server (BUREAU_OIDC_OWNERS) sign in for now.'),
    addForm,
    h('dl', { class: 'set-defs' }, ROLES.map(([, w, what]) => [h('dt', { class: 'om-label' }, w), h('dd', null, what)])));

  // ---- sessions ----
  const sessionsBox = section('Signed in', String(sessions.length),
    sessions.length
      ? table([
        { label: 'Who', cell: (s) => h('span', null, s.email || s.sub, s.current ? h('span', { class: 'om-data-s' }, ' (you)') : null) },
        { label: 'Since', cell: (s) => timeTag(s.created_at) },
        { label: 'Last seen', cell: (s) => timeTag(s.last_seen) },
      ], sessions)
      : h('p', null, 'Nobody is signed in with an account right now.'),
    sessions.length ? h('div', null, confirmButton('Sign everyone out', async () => {
      try {
        await api.post('/api/sessions/revoke-all', {}, { signal: ctx.signal });
        location.assign('/sign-in');
      } catch (err) { if (!api.isAbort(err)) error.say(refusal(err)); }
    }, { title: 'Sign everyone out?', body: 'Every session ends, yours too. Tokens and apps keep working.', confirmLabel: 'Sign everyone out' })) : null);

  void health;
  return h('div', { class: 'set-sections' }, error.el, pairing, appsBox, agentsBox, peopleBox, sessionsBox);
}

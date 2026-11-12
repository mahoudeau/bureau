// The five tabs of /settings. A tab is a function of (ctx, health) returning a
// node, sync or async. Boss-only reads and writes answer 403 for other
// credentials, and that gets a plain line here, not a failure.

import { h } from '../dom.js';
import * as api from '../api.js';
import * as store from '../store.js';
import { THEMES, getTheme, setTheme } from '../theme.js';
import { confirmButton, emptyState, timeTag, toast } from '../ui.js';
import { BOSS_ONLY, copyButton, field, message, notice, refusal, section, table } from './kit.js';
import { POLICIES, globalSelect, projectSelect } from './approval.js';

const THEME_WORDS = { system: 'System', paper: 'Paper', ink: 'Ink' };
const THEME_HINT = { system: 'Follows your machine.', paper: 'Ink on paper.', ink: 'Paper on ink.' };

// ---- Appearance ----

export function appearance() {
  const hint = h('p', { class: 'om-data-s set-hint' });
  const seg = h('div', { class: 'om-seg', role: 'group', 'aria-label': 'Theme' });
  function paint() {
    const now = getTheme();
    hint.textContent = THEME_HINT[now];
    seg.replaceChildren(...THEMES.map((name) => h('button', {
      type: 'button',
      'aria-pressed': name === now ? 'true' : 'false',
      onClick() {
        setTheme(name);
        paint();
        seg.querySelector('[aria-pressed="true"]').focus();
      },
    }, THEME_WORDS[name])));
  }
  paint();
  return h('div', { class: 'set-sections' }, section('Theme', null, seg, hint), officePalette());
}

// The office keeps its own four-shade palettes; the dashboard stays ink and
// paper. Same key as office.html, which follows a change made here at once.
const OFFICE_KEY = 'bureau_office_palette';
const OFFICE_PALETTES = [['pocket', 'Grey'], ['olive', 'Olive'], ['dmg', 'Green'], ['amber', 'Amber']];
const OFFICE_HINT = { pocket: 'Pocket grey. The default.', olive: 'Olive, the first office.', dmg: 'The original pea green.', amber: 'Warm amber, like an old monitor.' };

function officePalette() {
  const read = () => {
    let v = null;
    try { v = localStorage.getItem(OFFICE_KEY); } catch { /* no storage: the default */ }
    return OFFICE_PALETTES.some(([k]) => k === v) ? v : 'pocket';
  };
  const hint = h('p', { class: 'om-data-s set-hint' });
  const seg = h('div', { class: 'om-seg', role: 'group', 'aria-label': 'Office palette' });
  function paint() {
    const now = read();
    hint.textContent = OFFICE_HINT[now];
    seg.replaceChildren(...OFFICE_PALETTES.map(([key, word]) => h('button', {
      type: 'button',
      'aria-pressed': key === now ? 'true' : 'false',
      onClick() {
        try { localStorage.setItem(OFFICE_KEY, key); } catch { /* it just won't stick */ }
        paint();
        seg.querySelector('[aria-pressed="true"]').focus();
      },
    }, word)));
  }
  paint();
  return section('Office palette', null, seg, hint);
}

// ---- Approval ----

export async function approval(ctx) {
  const [{ settings }, state] = await Promise.all([api.get('/api/settings', { signal: ctx.signal }), store.ready()]);
  const error = message();

  // Saves as soon as it changes. A refusal puts the old value back.
  function saving(select, body) {
    let current = select.value;
    select.addEventListener('change', async () => {
      error.clear();
      select.disabled = true;
      try {
        await api.patch('/api/settings', body(select.value || null), { signal: ctx.signal });
        current = select.value;
        toast('Saved');
      } catch (err) {
        if (api.isAbort(err)) return;
        select.value = current;
        error.say(refusal(err));
      } finally {
        select.disabled = false;
      }
    });
    return select;
  }

  const global = saving(globalSelect(settings, { id: 'approval-global' }), (v) => ({ global: { approval: v } }));
  const projects = state.projects || [];

  return h('div', { class: 'set-sections' },
    error.el,
    section('Global', null,
      h('div', { class: 'set-form' }, field('Who closes boss-gate missions', global)),
      h('dl', { class: 'set-defs' }, POLICIES.map(([, word, what]) => [h('dt', { class: 'om-label' }, word), h('dd', null, what)]))),
    section('Per project', String(projects.length),
      projects.length
        ? table([
          { label: 'Project', cell: (p) => h('a', { class: 'om-link', href: `/projects/${encodeURIComponent(p.id)}` }, p.label || p.id) },
          {
            label: 'Approval',
            cell: (p) => saving(projectSelect(settings, p.id, { 'aria-label': `Approval policy for ${p.label || p.id}` }), (v) => ({ projects: { [p.id]: { approval: v } } })),
          },
        ], projects)
        : emptyState('No projects yet')));
}

// ---- Roles ----

const ROLES = [
  ['lead', 'Plans goals into missions, and can park work for review.'],
  ['critic', 'Judges finished work against its bar.'],
  ['librarian', 'Keeps the brain and proposes what it learns.'],
  ['curator', 'Writes to the curated parts of the brain.'],
];

export async function roles(ctx, health) {
  const [{ settings }, state] = await Promise.all([api.get('/api/settings', { signal: ctx.signal }), store.ready()]);
  const error = message();
  const self = health.credential && health.credential.kind === 'agent' ? health.credential.name : null;

  let names = [...new Set([...(state.agents || []).map((a) => a.name), ...Object.keys(settings.agents || {})])].sort();
  // An agent token reads only its own entry, so the others would look empty.
  if (self) names = names.filter((n) => n === self);

  function line(name) {
    const held = new Set((settings.agents[name] && settings.agents[name].roles) || []);
    const boxes = {};
    const change = async (box) => {
      error.clear();
      box.disabled = true;
      const next = ROLES.map(([r]) => r).filter((r) => boxes[r].checked);
      try {
        await api.patch('/api/settings', { agents: { [name]: { roles: next.length ? next : null } } }, { signal: ctx.signal });
        toast(`${name}: ${next.join(', ') || 'no roles'}`);
      } catch (err) {
        if (api.isAbort(err)) return;
        box.checked = !box.checked;
        error.say(refusal(err));
      } finally {
        box.disabled = false;
      }
    };
    return h('div', { class: 'set-role' },
      h('span', { class: 'om-strong set-role-name' }, name),
      h('span', { class: 'om-cluster om-cluster-3 set-role-boxes' }, ROLES.map(([role]) => {
        const box = h('input', {
          type: 'checkbox',
          checked: held.has(role),
          'aria-label': `${role} for ${name}`,
          onChange() { change(box); },
        });
        boxes[role] = box;
        return h('label', { class: 'om-check' }, box, role);
      })));
  }

  return h('div', { class: 'set-sections' },
    error.el,
    section('Roles', String(names.length),
      names.length
        ? h('div', { class: 'set-roles' }, names.map(line))
        : emptyState('No agents yet', 'Roles are set per agent, once one has registered.')),
    h('dl', { class: 'set-defs' }, ROLES.map(([role, what]) => [h('dt', { class: 'om-label' }, role), h('dd', null, what)])),
    h('p', { class: 'om-data-s' }, 'On a strict hub these are the only roles that count. Tags an agent declares grant nothing.'));
}

// ---- Tokens ----

function deniedTab(err, health) {
  if (err.status !== 403) throw err;
  // A hub without a boss token has nobody to sign in as, so say what's true.
  return notice(health.auth === 'strict' ? BOSS_ONLY : err.message);
}

function secretRow(label, value) {
  return h('div', { class: 'om-field' },
    h('span', { class: 'om-label' }, label),
    h('div', { class: 'set-secret' },
      h('code', { class: 'set-code' }, value),
      copyButton(value)));
}

function mintedPanel(minted, dismiss) {
  // Shown once and gone after: the task on the page, so the raised sheet.
  return h('div', { class: 'om-raised om-raised-body set-minted' },
    h('h2', { class: 'om-label' }, `Token for ${minted.agent}`),
    h('p', { class: 'om-strong' }, "Copy these now. The hub keeps only a hash, so it can't show them again."),
    secretRow('Token', minted.token),
    secretRow('MCP URL', minted.mcp_url),
    h('div', null, h('button', { type: 'button', class: 'om-btn om-btn-primary', onClick: dismiss }, "I've saved them")));
}

function mintForm(ctx, state, onMinted) {
  const agent = h('input', { class: 'om-input', required: true, autocomplete: 'off', spellcheck: 'false', list: 'set-agent-names' });
  const names = h('datalist', { id: 'set-agent-names' }, (state.agents || []).map((a) => h('option', { value: a.name })));
  const label = h('input', { class: 'om-input', autocomplete: 'off', maxlength: 80 });
  const allBox = h('input', {
    type: 'checkbox',
    checked: true,
    onChange() {
      list.hidden = allBox.checked;
    },
  });
  const boxes = (state.projects || []).map((p) => ({ id: p.id, box: h('input', { type: 'checkbox', name: 'project', value: p.id }), label: p.label || p.id }));
  const list = h('div', { class: 'om-cluster om-cluster-3', hidden: true }, boxes.map(({ box, label: text }) => h('label', { class: 'om-check' }, box, text)));
  const error = message();
  const submit = h('button', { type: 'submit', class: 'om-btn om-btn-primary' }, 'Mint token');

  async function send(e) {
    e.preventDefault();
    error.clear();
    const name = agent.value.trim();
    if (!name) { error.say('A token belongs to one agent.'); return; }
    const projects = allBox.checked ? ['*'] : boxes.filter(({ box }) => box.checked).map(({ id }) => id);
    if (!projects.length) { error.say('Pick at least one project, or All projects.'); return; }
    submit.disabled = true;
    try {
      const body = { agent: name, projects };
      if (label.value.trim()) body.label = label.value.trim();
      const minted = await api.post('/api/tokens', body, { signal: ctx.signal });
      agent.value = '';
      label.value = '';
      onMinted(minted);
    } catch (err) {
      if (api.isAbort(err)) return;
      error.say(refusal(err));
    } finally {
      submit.disabled = false;
    }
  }

  return h('form', { class: 'set-form', novalidate: true, onSubmit: send },
    field('Agent', agent, 'The one name this token can act as.'),
    names,
    field('Label', label, 'Optional. Where this token lives.'),
    h('fieldset', { class: 'set-fieldset' },
      h('legend', { class: 'om-label' }, 'Projects'),
      h('label', { class: 'om-check' }, allBox, 'All projects'),
      list),
    error.el,
    h('div', null, submit));
}

function tokenStatus(t) {
  return t.revoked_at ? h('span', { class: 'om-tag' }, 'Revoked') : h('span', { class: 'om-tag om-tag-solid' }, 'Live');
}

export async function tokens(ctx, health) {
  let data;
  try {
    data = await api.get('/api/tokens', { signal: ctx.signal });
  } catch (err) {
    if (api.isAbort(err)) throw err;
    return deniedTab(err, health);
  }
  const state = await store.ready();
  const shownOnce = h('div');
  const error = message();
  const listBox = h('div');
  const shared = h('p', { class: 'om-data-s' });

  function paintShared() {
    shared.replaceChildren('Shared token last used: ', data.shared_token_last_used ? timeTag(data.shared_token_last_used) : 'not since the hub started');
  }

  function paintList() {
    const sorted = [...data.tokens].sort((a, b) => Number(!!a.revoked_at) - Number(!!b.revoked_at) || String(b.created_at).localeCompare(String(a.created_at)));
    listBox.replaceChildren(sorted.length
      ? table([
        { label: 'Agent', cell: (t) => h('span', { class: 'om-strong' }, t.agent) },
        { label: 'Label', cell: (t) => t.label || '' },
        { label: 'Projects', cell: (t) => (t.projects.includes('*') ? 'All' : t.projects.join(', ')) },
        { label: 'Last used', cell: (t) => (t.last_used ? timeTag(t.last_used) : 'Never') },
        { label: 'Minted', cell: (t) => timeTag(t.created_at) },
        { label: 'State', cell: tokenStatus },
        {
          label: 'Revoke',
          cell: (t) => (t.revoked_at ? '' : confirmButton('Revoke', () => revoke(t), { title: `Revoke ${t.agent}'s token?`, body: 'It stops working at once. Mint a new one to replace it.' })),
        },
      ], sorted, (t) => (t.revoked_at ? 'set-muted' : null))
      : emptyState('No tokens yet', 'Mint one for each agent, with only the projects it needs.'));
  }

  async function revoke(token) {
    error.clear();
    try {
      await api.del(`/api/tokens/${encodeURIComponent(token.id)}`, { signal: ctx.signal });
      data = await api.get('/api/tokens', { signal: ctx.signal });
      setTimeout(paintList, 0);
      toast(`Revoked ${token.agent}`);
    } catch (err) {
      if (api.isAbort(err)) return;
      error.say(refusal(err));
    }
  }

  async function onMinted(minted) {
    shownOnce.replaceChildren(mintedPanel(minted, () => shownOnce.replaceChildren()));
    shownOnce.scrollIntoView({ block: 'nearest' });
    data = await api.get('/api/tokens', { signal: ctx.signal }).catch(() => data);
    paintList();
  }

  paintShared();
  paintList();

  return h('div', { class: 'set-sections' },
    shownOnce,
    section('Agent tokens', String(data.tokens.filter((t) => !t.revoked_at).length), listBox, error.el, shared),
    section('Mint a token', null, mintForm(ctx, state, onMinted)));
}

// ---- MCP ----

export async function mcp(ctx, health) {
  let data;
  try {
    data = await api.get('/api/mcp', { signal: ctx.signal });
  } catch (err) {
    if (api.isAbort(err)) throw err;
    return deniedTab(err, health);
  }
  const strict = health.auth === 'strict';
  const error = message();
  const box = h('div', { class: 'set-sections' });

  const paint = () => {
    const parts = [];
    if (data.url) {
      const code = h('code', { class: 'set-code' }, 'Hidden. It works like a password.');
      let open = false;
      const reveal = h('button', {
        type: 'button',
        class: 'om-btn',
        onClick() {
          open = !open;
          code.textContent = open ? data.url : 'Hidden. It works like a password.';
          reveal.textContent = open ? 'Hide' : 'Show';
        },
      }, 'Show');
      parts.push(section(strict ? 'The old MCP URL' : 'MCP URL', null,
        h('div', { class: 'set-secret' }, code, reveal, copyButton(() => data.url)),
        strict ? h('p', { class: 'om-data-s set-hint' }, 'It acts as consul on every project. Each connector should have its own token now.') : null,
        strict ? h('div', null, confirmButton('Retire this URL', async () => {
          error.clear();
          try {
            await api.del('/api/mcp', { signal: ctx.signal });
          } catch (err) {
            if (api.isAbort(err)) return;
            error.say(refusal(err));
            return;
          }
          data = { ...data, url: null };
          toast('Retired');
          setTimeout(paint, 0);
        }, { title: 'Retire the old MCP URL?', body: 'Any connector still using it stops working.', confirmLabel: 'Retire it' })) : null,
        error.el));
    } else {
      parts.push(section('The old MCP URL', null, h('p', null, 'Retired, or never issued. Nothing to do here.')));
    }
    if (strict) {
      parts.push(section('Connecting a new client', null,
        h('p', null, 'An MCP connector is one agent. With sign-in on, turn it on for that agent and add the agent\'s address as a connector: no secret in it, and you allow the app on the Desk. Without sign-in, mint the agent a token and use the MCP URL that comes with it.'),
        h('div', { class: 'om-cluster om-cluster-2' },
          h('a', { class: 'om-btn om-btn-primary', href: '/settings?tab=signin' }, 'Sign-in'),
          h('a', { class: 'om-btn', href: '/settings?tab=tokens' }, 'Tokens'))));
    }
    box.replaceChildren(...parts);
  };
  paint();
  return box;
}

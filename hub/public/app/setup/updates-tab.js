// Settings, Updates: which Bureau this hub runs, the latest release, and when
// it's behind, the UPGRADING.md sections for every release in between, read
// from the new release itself (GET /api/updates, lib/updates.js). The
// operator's only: anyone else gets one plain line.

import { h } from '../dom.js';
import * as api from '../api.js';
import { renderMarkdown } from '../markdown.js';
import { timeTag, toast } from '../ui.js';
import { notice, refusal, section } from './kit.js';

export async function updates(ctx, health) {
  let status;
  try {
    status = await api.get('/api/updates', { signal: ctx.signal });
  } catch (err) {
    if (err && (err.status === 404 || err.status === 403)) return notice('Only whoever runs the server sees this.');
    throw err;
  }
  const root = h('div', { class: 'set-sections' });
  const paint = (s) => root.replaceChildren(...view(s));
  const button = h('button', { type: 'button', class: 'om-btn' }, 'Check now');
  async function checkNow(btn) {
    btn.disabled = true;
    try {
      paint(await api.post('/api/updates/check', {}, { signal: ctx.signal }));
    } catch (err) {
      if (!api.isAbort(err)) toast(refusal(err));
    } finally { btn.disabled = false; }
  }
  button.addEventListener('click', () => checkNow(button));

  function view(s) {
    const checked = s.checked_at ? h('span', null, 'Checked ', timeTag(s.checked_at)) : 'Not checked yet';
    let line;
    if (!s.enabled) line = 'The daily release check is off (BUREAU_UPDATE_CHECK). Nothing is asked of GitHub.';
    else if (!s.latest) line = s.error ? `The check failed: ${s.error}.` : 'The first check runs a minute after the hub starts.';
    else if (s.behind) line = h('span', null, h('strong', null, `Bureau ${s.latest} is out.`), ` This hub runs ${s.current}.`);
    else line = `This hub runs ${s.current}, the latest release.`;
    const head = section('Version', s.enabled ? checked : null,
      h('p', null, line),
      s.enabled && s.latest && s.error ? h('p', { class: 'om-data-s' }, `The last check failed: ${s.error}. This is what the one before it found.`) : null,
      h('p', { class: 'om-data-s' }, 'The hub reads the release tags on GitHub once a day. It sends nothing about itself.'),
      s.enabled ? h('div', null, button) : null);
    if (!s.behind) return [head];

    const parts = [head];
    if (s.sections.length) {
      parts.push(section('Before you upgrade', `From UPGRADING.md in ${s.latest}`,
        s.sections.map((sec) => h('div', { class: 'om-stack set-upgrade' },
          h('h3', null, sec.title),
          renderMarkdown(sec.markdown)))));
    } else {
      parts.push(section('Before you upgrade', null,
        h('p', null, `Nothing to do by hand between ${s.current} and ${s.latest}. The changelog says what's new.`)));
    }
    if (s.steps) parts.push(section('How to upgrade', null, renderMarkdown(s.steps)));
    parts.push(h('p', { class: 'om-data-s' },
      h('a', { href: s.upgrading_url, target: '_blank', rel: 'noopener' }, 'UPGRADING.md'), ' and ',
      h('a', { href: s.changelog_url, target: '_blank', rel: 'noopener' }, 'CHANGELOG.md'), ` at ${s.latest}, on GitHub.`));
    return parts;
  }

  paint(status);
  return root;
}

// The memory health line at the top of /brain. Click for the reasons. Boss and
// full-sight tokens only: anyone else gets a 403 and no line at all.

import * as api from '../api.js';
import * as store from '../store.js';
import { fill, h } from '../dom.js';
import { brainHref } from './data.js';

const EVENTS = /^(knowledge|journal|task|project)\./;
const QUIET_MS = 5000;

const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;

function section(title, ...body) {
  return h('section', { class: 'brain-health-part' }, h('h2', { class: 'om-label' }, title), body);
}

const lines = (items, empty) => (items.length
  ? h('ul', { class: 'brain-health-list' }, items.map((x) => h('li', null, x)))
  : h('p', null, empty));

const fileLink = (file, line) => h('a', { class: 'om-link', href: brainHref(file) }, line ? `${file}:${line}` : file);

function detail(hb) {
  const prov = hb.provenance;
  return [
    section('Reasons', lines(hb.reasons, 'Nothing calls for attention.')),
    section('Lint', h('p', null, `${plural(hb.lint.errors, 'error')}, ${plural(hb.lint.warnings, 'warning')}.`), hb.lint.messages.length ? lines(hb.lint.messages, '') : null),
    section('Journal', h('p', null, `${plural(hb.journal.records, 'record')} in ${hb.journal.days} days.`),
      lines(hb.journal.invalid.map((b) => h('span', null, fileLink(b.file, b.line), ` ${b.errors.map((e) => e.code).join(', ')}`)), 'Every record reads.')),
    section('Approved, not applied', lines(hb.approved_unapplied.map((m) => h('span', null,
      h('a', { class: 'om-link', href: `/missions/${m.id}` }, m.id),
      ` ${m.items.join(', ')}, waiting ${Math.floor(m.waiting_hours)}h${m.overdue ? ', overdue' : ''}`)), 'Nothing waiting.')),
    section('Stale', h('p', null, `${hb.stale.count} past their window, ${hb.stale.undated} undated.`),
      hb.stale.claims.length ? lines(hb.stale.claims.slice(0, 20).map((c) => h('span', null, fileLink(c.file, c.line), ` ${c.volatility}, verified ${c.verified}`)), '') : null),
    section('Contradictions', lines(hb.contradictions.map((c) => h('span', null, fileLink(c.file, c.line), ` ${c.id || 'no id'} contradicts ${c.contradicts}`)), 'None open.')),
    section('Provenance', h('p', null, `${prov.claims} curated claims. ${prov.own} with their own source, ${prov.file} from the file, ${prov.none} with none.${prov.sourced_pct === null ? '' : ` ${prov.sourced_pct}% sourced.`}`)),
  ];
}

// A node that fills itself in. onCleanup is the page's.
export function healthLine(onCleanup) {
  let data = null;
  let open = false;
  let timer = null;
  let gone = false;

  const swatch = h('span', { class: 'om-swatch om-d12', 'aria-hidden': 'true' });
  const word = h('span', { class: 'om-strong' }, 'Memory');
  const text = h('span', { class: 'brain-health-text' }, 'Checking');
  const line = h('button', {
    type: 'button',
    class: 'brain-health-line',
    'aria-expanded': 'false',
    onClick() {
      if (!data) return;
      open = !open;
      paint();
    },
  }, swatch, word, text);
  const more = h('div', { class: 'brain-health-more', hidden: true });
  const root = h('div', { class: 'brain-health' }, line, more);

  function paint() {
    if (!data) return;
    const waiting = data.approved_unapplied.reduce((n, m) => n + m.items.length, 0);
    swatch.className = `om-swatch ${data.status === 'ok' ? 'om-d100' : 'om-cross'}`;
    word.textContent = data.status === 'ok' ? 'Memory OK' : 'Memory needs attention';
    text.textContent = [plural(data.lint.errors, 'lint error'), `${data.journal.invalid.length} unreadable`, `${waiting} waiting to apply`, `${data.stale.count} stale`].join(' / ');
    line.setAttribute('aria-expanded', String(open));
    more.hidden = !open;
    if (open) fill(more, detail(data));
  }

  function load() {
    api.get('/api/memory/health').then((hb) => {
      if (gone) return;
      data = hb;
      paint();
    }).catch((e) => {
      if (gone) return;
      if (e.status === 403) root.remove();
      else if (!data) text.textContent = "Couldn't check";
    });
  }

  const off = store.subscribeEvents((type) => {
    if ((type !== store.RECONNECTED && !EVENTS.test(type)) || timer) return;
    timer = setTimeout(() => { timer = null; load(); }, QUIET_MS);
  });
  onCleanup(() => { gone = true; off(); clearTimeout(timer); });
  load();
  return root;
}

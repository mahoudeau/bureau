// The margin of a note: what kind of knowledge this is, where you are in it,
// and what connects to it.

import { fill, h, on } from '../dom.js';
import { brainHref, buildGraph, cleanSummary, linksHere } from './data.js';

const BELIEF = { hypothesis: 'om-d25', validated: 'om-d100', superseded: 'om-cross' };
const MAX_TOC = 200;
const MAX_LINKS = 30;

function block(title, ...content) {
  return h('section', { class: 'om-sheet brain-margin-block' },
    h('header', { class: 'om-titlebar' }, h('h2', null, title)),
    h('div', { class: 'om-sheet-body' }, content));
}

function factsBlock(front) {
  const belief = front.belief;
  const rows = [
    belief ? ['Belief', h('span', { class: 'app-status' }, h('span', { class: `om-swatch ${BELIEF[belief] || 'om-d12'}`, 'aria-hidden': 'true' }), belief)] : null,
    ['Volatility', front.volatility || 'stable'],
    front.version ? ['Version', front.version] : null,
    front.verified ? ['Verified', front.verified] : null,
    front.format ? ['Format', front.format] : null,
    front.scope ? ['Scope', front.scope] : null,
  ].filter(Boolean);
  return block('This note', h('dl', { class: 'brain-facts' }, rows.flatMap(([k, v]) => [h('dt', null, k), h('dd', null, v)])));
}

// The headings, with the one you're reading marked as you scroll.
function tocBlock(headings, onCleanup) {
  const shown = headings.filter((x) => x.level <= 4).slice(0, MAX_TOC);
  if (!shown.length) return null;
  const top = Math.min(...shown.map((x) => x.level));
  const links = shown.map((x) => h('a', { class: 'brain-toc-link', href: `#${x.id}`, style: { paddingLeft: `${(x.level - top) * 10 + 6}px` } }, x.text));
  const list = h('nav', { class: 'brain-toc', 'aria-label': 'On this page' }, links);

  let targets = null;
  let queued = false;
  let current = -1;
  const update = () => {
    queued = false;
    if (!targets) targets = shown.map((x) => document.getElementById(x.id));
    let at = -1;
    for (let i = 0; i < targets.length; i++) {
      const el = targets[i];
      if (el && el.getBoundingClientRect().top <= 96) at = i;
      else if (el) break;
    }
    if (at === current) return;
    if (current >= 0) links[current].removeAttribute('aria-current');
    current = at;
    if (at < 0) return;
    links[at].setAttribute('aria-current', 'location');
    // A long contents list scrolls inside the margin; keep the mark in sight.
    const box = list.closest('.brain-margin-in');
    if (!box || box.scrollHeight <= box.clientHeight) return;
    const row = links[at].getBoundingClientRect();
    const frame = box.getBoundingClientRect();
    if (row.top < frame.top) box.scrollTop -= frame.top - row.top + 24;
    else if (row.bottom > frame.bottom) box.scrollTop += row.bottom - frame.bottom + 24;
  };
  const queue = () => {
    if (!queued) { queued = true; requestAnimationFrame(update); }
  };
  onCleanup(on(window, 'scroll', queue, { passive: true }));
  onCleanup(on(window, 'resize', queue, { passive: true }));
  requestAnimationFrame(queue);
  return block('On this page', list);
}

function claimsBlock(doc) {
  const total = doc.claims.length;
  if (!total) return null;
  const own = doc.claims.filter((c) => c.sources.length).length;
  const fileSource = !!doc.frontmatter.source;
  const sourced = fileSource ? total : own;
  const pct = Math.round((sourced / total) * 100);
  return block('Claims',
    h('p', { class: 'brain-big' }, h('strong', null, total), ` claim${total === 1 ? '' : 's'}, ${sourced} with a source`),
    h('span', { class: 'om-meter', style: { '--value': pct }, role: 'img', 'aria-label': `${pct}% sourced` }, h('i')),
    fileSource && own < total ? h('p', { class: 'om-data-s' }, `${own} carry their own, the file's source covers the rest.`) : null);
}

function linkList(items, limit, render) {
  const shown = items.slice(0, limit);
  return [
    h('ul', { class: 'brain-links' }, shown.map((x) => h('li', null, render(x)))),
    items.length > limit ? h('p', { class: 'om-data-s' }, `And ${items.length - limit} more.`) : null,
  ];
}

const noteLink = (file, notes) => {
  const note = notes.get(file);
  return h('a', { class: 'om-link', href: brainHref(file), title: file }, note && note.title ? cleanSummary(note.title) : file.replace(/\.md$/, ''));
};

function linksOutBlock(doc, resolver, notes) {
  const internal = new Set();
  const external = new Set();
  let broken = 0;
  for (const link of doc.links) {
    if (link.kind === 'wikilink') {
      const w = resolver.wikilink(link.target);
      if (w && w.file) internal.add(w.file);
      else if (!w) broken++;
    } else if (link.kind === 'link') {
      if (/^https?:/i.test(link.href)) {
        try { external.add(new URL(link.href).host); } catch { /* not worth a row */ }
      } else {
        const l = resolver.resolveLink(link.href);
        if (l && l.file) internal.add(l.file);
        else if (l && l.broken) broken++;
      }
    }
  }
  if (!internal.size && !external.size && !broken) return null;
  return block('Links out',
    internal.size ? linkList([...internal], MAX_LINKS, (f) => noteLink(f, notes)) : null,
    external.size ? h('p', { class: 'om-data-s' }, `Outside: ${[...external].slice(0, 6).join(', ')}${external.size > 6 ? `, and ${external.size - 6} more` : ''}`) : null,
    broken ? h('p', { class: 'om-data-s' }, `${broken} ${broken === 1 ? "doesn't" : "don't"} resolve.`) : null);
}

// Worked out on request, because the hub keeps no backlinks and it means
// reading every note once. After that it's instant until the brain changes.
function linksHereBlock(path, notes, ctx) {
  const body = h('div', { class: 'brain-links-here' });

  function show() {
    const found = linksHere(path);
    if (!found) return false;
    fill(body,
      found.sources.length
        ? linkList(found.sources, MAX_LINKS, (f) => noteLink(f, notes))
        : h('p', { class: 'om-data-s' }, 'Nothing links here.'),
      h('p', { class: 'om-data-s brain-quiet' }, `From ${found.scanned} notes. Journal days aren't counted.`));
    return true;
  }

  function scan() {
    const progress = h('p', { class: 'om-data-s', role: 'status' }, 'Reading the notes');
    fill(body, h('div', { class: 'om-wait' }), progress);
    buildGraph({
      signal: ctx.signal,
      onProgress: (done, total) => { progress.textContent = `Read ${done} of ${total}`; },
    }).then(() => { show(); }).catch((e) => {
      if (e.name === 'AbortError') return;
      fill(body, h('p', { class: 'om-data-s' }, e.message || "Couldn't read the notes."), askButton());
    });
  }

  function askButton() {
    return h('button', { type: 'button', class: 'om-btn', onClick: scan }, 'Find links here');
  }

  if (!show()) fill(body, h('p', { class: 'om-data-s' }, 'Reads every note once. A few seconds, the first time.'), askButton());
  return block('Links here', body);
}

export function buildMargin({ doc, path, resolver, notes, ctx }) {
  return h('aside', { class: 'om-rail brain-margin', 'aria-label': 'About this note' },
    h('div', { class: 'brain-margin-in' },
      factsBlock(doc.frontmatter),
      tocBlock(doc.headings, ctx.onCleanup),
      claimsBlock(doc),
      linksOutBlock(doc, resolver, notes),
      linksHereBlock(path, notes, ctx)));
}

export const factLine = (doc) => {
  const front = doc.frontmatter;
  const parts = [front.belief, front.volatility, front.version ? `v${front.version}` : null, doc.claims.length ? `${doc.claims.length} claims` : null].filter(Boolean);
  return parts.length ? h('p', { class: 'brain-factline om-data-s' }, parts.join(' / ')) : null;
};

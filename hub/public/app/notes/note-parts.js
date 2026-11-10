// Small pieces of the note page.

import { h } from '../dom.js';
import { openPalette } from '../palette.js';
import { baseOf, brainHref } from './data.js';

export function crumbs(path) {
  const parts = path.split('/');
  return h('nav', { 'aria-label': 'Where this is' },
    h('ol', { class: 'om-crumbs' },
      h('li', null, h('a', { class: 'om-link', href: '/brain' }, 'Brain')),
      parts.map((part, i) => {
        const here = i === parts.length - 1;
        return h('li', { 'aria-current': here ? 'page' : null },
          here ? h('span', { class: 'om-strong' }, part) : h('a', { class: 'om-link', href: brainHref(parts.slice(0, i + 1).join('/')) }, part));
      })));
}

// Page or Raw, with the choice in the URL so it can be shared.
export function viewToggle(ctx, setRaw) {
  const wanted = ctx.query.get('raw') === '1';
  const pageBtn = h('button', { type: 'button', 'aria-pressed': String(!wanted) }, 'Page');
  const rawBtn = h('button', { type: 'button', 'aria-pressed': String(wanted) }, 'Raw');
  const choose = (raw) => {
    pageBtn.setAttribute('aria-pressed', String(!raw));
    rawBtn.setAttribute('aria-pressed', String(raw));
    setRaw(raw);
    ctx.setQuery({ raw: raw ? '1' : null });
  };
  pageBtn.addEventListener('click', () => choose(false));
  rawBtn.addEventListener('click', () => choose(true));
  return h('div', { class: 'om-seg', role: 'group', 'aria-label': 'View' }, pageBtn, rawBtn);
}

export function notFound(path, message) {
  const name = baseOf(path).replace(/\.[^.]+$/, '');
  // Dithered type put text on a pattern. The 404 is plain now, in a sheet.
  return h('div', { class: 'app-layers brain' },
    h('div', { class: 'om-ground om-field-ground' },
      h('div', { class: 'om-work-single' },
        h('section', { class: 'om-sheet om-sheet-body om-stack om-stack-3' },
          h('p', { class: 'om-display-xl brain-404', 'aria-hidden': 'true' }, '404'),
          h('h1', { class: 'om-display-m' }, message ? 'Out of reach' : 'No such note'),
          h('p', { class: 'om-data brain-404-path' }, path),
          h('p', null, message || "Nothing in the brain has that path. It may have moved to the attic."),
          h('div', { class: 'om-cluster om-cluster-3' },
            h('a', { class: 'om-btn om-btn-primary', href: '/brain' }, 'Back to the brain'),
            h('button', { type: 'button', class: 'om-btn', onClick: () => openPalette(name) }, `Search for ${name}`))))));
}

// The design system's specimen, public at /ds. Everything omako-ds has, drawn
// once on paper and once on ink.

import { h, s } from '../dom.js';
import { toast } from '../ui.js';

const RAMP = ['om-d0', 'om-d12', 'om-d25', 'om-d50', 'om-d75', 'om-d100'];
const EXCEPTIONS = ['om-hatch', 'om-cross', 'om-bars'];

const stay = (e) => e.preventDefault();
const fakeLink = (props, ...kids) => h('a', { href: '#', onClick: stay, ...props }, ...kids);

function section(title, ...kids) {
  return h('section', { class: 'ds-section' },
    h('div', { class: 'om-bar' }, h('h2', { class: 'om-label' }, title)), ...kids);
}

const tile = (cls) => h('div', { class: 'ds-tile' }, h('div', { class: cls }), h('span', null, `.${cls}`));

const mark = () => s('svg', { class: 'om-mark', viewBox: '-1.5 -1.5 103 103', 'aria-hidden': 'true' },
  s('path', { 'fill-rule': 'evenodd', d: 'M50 -1.5A51.5 51.5 0 1 0 50 101.5A51.5 51.5 0 1 0 50 -1.5ZM50 37A13 13 0 1 1 50 63A13 13 0 1 1 50 37Z' }));

function specimen(theme) {
  return h('div', { class: 'ds-sheet', 'data-theme': theme },
    h('div', { class: 'om-stack' },
      h('h2', { class: 'om-display om-h2' }, theme === 'light' ? 'Paper' : 'Ink'),

      section('Type',
        h('p', { class: 'om-display om-poster' }, 'Poster'),
        h('p', { class: 'om-display om-h1' }, 'Heading one'),
        h('p', { class: 'om-display om-h2' }, 'Heading two'),
        h('p', { class: 'om-display om-h3' }, 'Heading three'),
        h('p', { class: 'om-label' }, 'Label'),
        h('p', null, 'Body in JetBrains Mono. ', h('span', { class: 'om-strong' }, 'Strong for hierarchy.')),
        h('p', { class: 'om-meta' }, 'Meta, for the small print.'),
        h('p', null, fakeLink({ class: 'om-link' }, 'A link'), ' and a key ', h('kbd', { class: 'om-kbd' }, 'K')),
        h('p', { class: 'om-clip' }, 'A long line that clips instead of wrapping, however long it goes on, and it goes on for a while here.')),

      section('Dither ramp', h('div', { class: 'ds-ramp' }, RAMP.map(tile))),
      section('Dither exceptions', h('div', { class: 'ds-ramp' }, EXCEPTIONS.map(tile))),
      section('Cut out of a pattern',
        h('p', { class: 'om-display om-d50 om-dither-type', style: 'font-size:96px' }, '404')),

      section('Swatch and band',
        h('div', { class: 'om-row' }, [...RAMP, ...EXCEPTIONS].map((c) => h('span', { class: `om-swatch ${c}`, title: c }))),
        h('div', { class: 'om-band om-d50' }),
        h('div', { class: 'om-band om-hatch' })),

      section('Meter',
        [12, 50, 88].map((value) => h('span', { class: 'om-meter', style: { '--value': value } }, h('i')))),

      section('Waiting', h('div', { class: 'om-wait' })),

      section('Lift',
        h('div', { class: 'om-lift', style: 'width:200px' },
          h('div', { class: 'om-panel' }, 'A dithered shadow'))),

      section('Inversion',
        h('div', { class: 'om-invert om-panel' }, 'The other way round. ', h('span', { class: 'om-swatch om-d50' })),
        h('div', { class: 'om-scope om-panel', style: '--ink:var(--ink-inv);--paper:var(--paper-inv);background:var(--paper);color:var(--ink)' }, 'om-scope: a part that sets its own ink re-reads the dither. ', h('span', { class: 'om-swatch om-d50' }))),

      section('Layout',
        h('div', { class: 'om-row' }, h('span', null, 'om-row'), h('span', null, 'wraps')),
        h('div', { class: 'om-spread' }, h('span', null, 'om-spread'), h('span', null, 'pushes apart')),
        h('div', { class: 'om-row' }, h('span', { class: 'om-grow' }, 'om-grow takes the room'), h('span', null, 'end')),
        h('hr', { class: 'om-rule' }),
        h('hr', { class: 'om-rule-heavy' })),

      section('Section bar',
        h('div', { class: 'om-bar' }, h('span', { class: 'om-label' }, 'In flight'), h('span', { class: 'om-meta' }, '3 missions'))),

      section('Buttons',
        h('div', { class: 'om-row' },
          h('button', { class: 'om-btn' }, 'Default'),
          h('button', { class: 'om-btn om-btn-primary' }, 'Primary'),
          h('button', { class: 'om-btn om-btn-ghost' }, 'Ghost'),
          h('button', { class: 'om-btn om-btn-danger' }, 'Danger'),
          h('button', { class: 'om-btn om-btn-icon', 'aria-label': 'Close' }, 'x'),
          h('button', { class: 'om-btn', disabled: true }, 'Disabled'))),

      section('Fields',
        h('label', { class: 'om-field' }, h('span', { class: 'om-label' }, 'Input'), h('input', { class: 'om-input', placeholder: 'Placeholder' })),
        h('label', { class: 'om-field' }, h('span', { class: 'om-label' }, 'Text area'), h('textarea', { class: 'om-textarea' }, 'Some text')),
        h('label', { class: 'om-field' }, h('span', { class: 'om-label' }, 'Select'),
          h('select', { class: 'om-select' }, h('option', null, 'One'), h('option', null, 'Two'))),
        h('p', { class: 'om-field-error' }, 'A field error says what to do.'),
        h('div', { class: 'om-row' },
          h('label', { class: 'om-check' }, h('input', { type: 'checkbox', checked: true }), 'Checked'),
          h('label', { class: 'om-check' }, h('input', { type: 'checkbox' }), 'Not checked'))),

      section('Chips',
        h('div', { class: 'om-chips' },
          h('button', { class: 'om-chip', 'aria-pressed': 'true' }, 'Selected'),
          h('button', { class: 'om-chip' }, 'Filter'),
          h('button', { class: 'om-chip' }, h('span', { class: 'om-swatch om-d50' }), 'With swatch'))),

      section('Segmented',
        h('div', { class: 'om-seg' },
          h('button', { 'aria-pressed': 'true' }, 'Status'),
          h('button', null, 'Project'))),

      section('Tabs',
        h('div', { class: 'om-tabs' },
          fakeLink({ 'aria-current': 'page' }, 'Appearance'),
          fakeLink(null, 'Approval'),
          h('button', null, 'Tokens'))),

      section('Breadcrumbs',
        h('ol', { class: 'om-crumbs' },
          h('li', null, fakeLink({ class: 'om-link' }, 'Brain')),
          h('li', null, fakeLink({ class: 'om-link' }, 'knowledge')),
          h('li', null, 'bureau-process.md'))),

      section('Rows',
        h('div', { class: 'om-list' },
          fakeLink({ class: 'om-list-row' }, h('span', { class: 'om-swatch om-d50' }), h('span', { class: 'om-grow om-clip' }, 'A row, hover it'), h('span', { class: 'om-meta' }, '2h ago')),
          fakeLink({ class: 'om-list-row', 'aria-current': 'page' }, h('span', { class: 'om-swatch om-d75' }), h('span', { class: 'om-grow om-clip' }, 'The current row'), h('span', { class: 'om-meta' }, '1d ago'))),
        h('div', { class: 'om-list', role: 'listbox', 'aria-label': 'Selected rows' },
          h('button', { class: 'om-list-row', role: 'option', 'aria-selected': 'true' }, h('span', { class: 'om-swatch om-hatch' }), h('span', { class: 'om-grow om-clip' }, 'A selected row')))),

      section('Alert rows',
        h('div', null,
          h('div', { class: 'om-alert-row' }, h('span', { class: 'om-swatch om-d75' }), h('span', { class: 'om-grow' }, 'The loudest thing on a page'), h('button', { class: 'om-btn' }, 'Approve')),
          h('div', { class: 'om-alert-row' }, h('span', { class: 'om-swatch om-hatch' }), h('span', { class: 'om-grow' }, 'A second one'), h('button', { class: 'om-btn' }, 'Answer')))),

      section('Cards and panels',
        fakeLink({ class: 'om-card' }, h('span', { class: 'om-strong' }, 'A card'), h('span', { class: 'om-meta' }, 'Hover inverts')),
        h('div', { class: 'om-panel' }, 'A panel'),
        h('div', { class: 'om-panel-heavy', style: 'padding:12px' }, 'A heavy panel')),

      section('Tags',
        h('div', { class: 'om-row' }, h('span', { class: 'om-tag' }, 'Tag'), h('span', { class: 'om-tag om-tag-solid' }, 'Solid'))),

      section('Table',
        h('div', { class: 'om-table-wrap' },
          h('table', { class: 'om-table' },
            h('thead', null, h('tr', null, h('th', null, 'Name'), h('th', null, 'Open'), h('th', null, 'Approval'))),
            h('tbody', null,
              h('tr', null, h('td', null, 'bureau'), h('td', null, '12'), h('td', null, 'in-session')),
              h('tr', null, h('td', null, 'general'), h('td', null, '3'), h('td', null, 'strict')))))),

      section('Banners',
        ['om-d12', 'om-d50', 'om-cross'].map((edge) => h('div', { class: 'om-banner' },
          h('div', { class: `om-banner-edge ${edge}` }),
          h('div', { class: 'om-banner-body' }, 'A level is a pattern at the edge.')))),

      section('Empty',
        h('div', { class: 'om-empty' }, 'Nothing here yet.')),

      section('Top bar',
        h('div', { class: 'om-top' },
          fakeLink({ class: 'om-brand' }, mark(), h('span', { class: 'om-strong' }, 'BRAND')),
          h('nav', { class: 'om-nav', 'aria-label': `Specimen navigation, ${theme === 'light' ? 'paper' : 'ink'}` }, fakeLink({ 'aria-current': 'page' }, 'One'), fakeLink(null, 'Two')))),

      section('Footer',
        h('div', { class: 'om-foot' }, h('span', null, 'The black slab'), fakeLink(null, 'A link'))),

      section('Dialog on its scrim',
        h('div', { class: 'ds-inline' },
          h('div', { class: 'om-scrim' },
            h('div', { class: 'om-dialog' },
              h('div', { class: 'om-dialog-head' }, h('span', { class: 'om-label' }, 'Dialog'), h('button', { class: 'om-btn om-btn-ghost' }, 'Close')),
              h('div', { class: 'om-dialog-body' }, 'Hard edges and a hard shadow.'),
              h('div', { class: 'om-dialog-foot' }, h('button', { class: 'om-btn' }, 'Cancel'), h('button', { class: 'om-btn om-btn-primary' }, 'Do it')))))),

      section('Palette',
        h('div', { class: 'ds-inline' },
          h('div', { class: 'om-dialog' },
            h('input', { class: 'om-palette-input', placeholder: 'Search or type a command', 'aria-label': 'Search or type a command' }),
            h('div', { class: 'om-palette-list' },
              h('div', { class: 'om-list', role: 'listbox', 'aria-label': 'Results' },
                h('button', { class: 'om-list-row', role: 'option', 'aria-selected': 'true' }, 'First result'),
                h('button', { class: 'om-list-row', role: 'option', 'aria-selected': 'false' }, 'Second result')))))),

      section('Toast',
        h('div', { class: 'ds-inline' },
          h('div', { class: 'om-toasts' },
            h('div', { class: 'om-toast' }, 'Saved.'))),
        h('button', { class: 'om-btn', onClick: () => toast('A real toast.') }, 'Show one')),

      section('Prose',
        h('div', { class: 'om-prose' },
          h('h1', null, 'Heading one'),
          h('p', null, 'Rendered markdown. ', h('strong', null, 'Bold'), ', ', h('em', null, 'italic'), ', ', fakeLink(null, 'a link'), ' and ', h('code', null, 'code'), '.'),
          h('h2', null, 'Heading two'),
          h('h3', null, 'Heading three'),
          h('h4', null, 'Heading four'),
          h('ul', null, h('li', null, 'A list'), h('li', null, 'With arrows', h('ul', null, h('li', null, 'And depth')))),
          h('ol', null, h('li', null, 'Numbered'), h('li', null, 'Too')),
          h('p', null, h('input', { type: 'checkbox', checked: true, disabled: true, 'aria-label': 'A task, done' }), 'A task, done'),
          h('blockquote', null, h('p', null, 'A quote.')),
          h('pre', null, h('code', null, 'const pre = "a block of code";')),
          h('hr'),
          h('table', null,
            h('thead', null, h('tr', null, h('th', null, 'Head'), h('th', null, 'Head'))),
            h('tbody', null, h('tr', null, h('td', null, 'Cell'), h('td', null, 'Cell')))))),

      section('Hidden until needed',
        h('p', null, 'om-sr is for screen readers only, like the words after this sentence. om-skip is the skip link: press Tab on a fresh page to see it.', h('span', { class: 'om-sr' }, ' Only a screen reader says this.')))));
}

function registers() {
  return h('section', { class: 'app-page ds-section' },
    h('h2', { class: 'om-display om-h2' }, 'Two registers'),
    h('p', null, 'Desk is the compact one, for screens that hold a lot. Poster is the loud one, for a page people read once.'),
    h('div', { class: 'om-row', style: 'align-items:flex-start' },
      h('div', { class: 'om-stack' },
        h('p', { class: 'om-label' }, 'Desk'),
        h('button', { class: 'om-btn' }, 'A button'),
        h('input', { class: 'om-input', value: 'A field', 'aria-label': 'A field, desk' })),
      h('div', { class: 'om-stack', 'data-density': 'poster' },
        h('p', { class: 'om-label' }, 'Poster'),
        h('button', { class: 'om-btn' }, 'A button'),
        h('input', { class: 'om-input', value: 'A field', 'aria-label': 'A field, poster' }))));
}

export function render() {
  return h('div', null,
    h('div', { class: 'app-page om-stack' },
      h('h1', { class: 'om-display om-h1' }, 'omako-ds'),
      h('p', null, 'Ink, paper and dither. Every part, on both sides. Source is in /omako-ds/.')),
    registers(),
    h('div', { class: 'ds-sheets' }, specimen('light'), specimen('dark')));
}

// The look picker: Paper or Ink, Marker or Pencil, a colour, a ground, and
// whether the office follows. Settings, Appearance and the first-run guide
// both show it. Everything goes through looks.js (window.BureauLooks), which
// applies a change at once and tells every open picker to repaint.

import { h } from '../dom.js';
import { field } from './kit.js';

const THEME_WORDS = { system: 'System', paper: 'Paper', ink: 'Ink' };
const THEME_HINT = { system: 'Paper or ink, as your machine is set.', paper: 'Ink on paper.', ink: 'Paper on ink.' };
const MARKER_WORDS = { marker: 'Marker', pencil: 'Pencil' };
const MARKER_HINT = { marker: 'Bold and sharp, the strongest contrast.', pencil: 'Softer and vintage: the colour\'s own shades, less contrast, still easy to read.' };
const COLOUR_WORDS = { pure: 'Pure', pocket: 'Grey', olive: 'Olive', dmg: 'Green', amber: 'Amber' };
const COLOUR_HINT = { pure: 'Black and white.', pocket: 'Pocket grey.', olive: 'Olive, the first office.', dmg: 'The original pea green.', amber: 'Warm amber, like an old monitor.' };
const GROUND_WORDS = { dots: 'Dots', fine: 'Fine dither', lines: 'Scanlines', solid: 'Solid', gradient: 'Gradient', fade: 'Dithered fade' };
const GROUND_HINT = {
  dots: 'A sparse dot screen. The default.', fine: 'Twice as dense.', lines: 'A line every four pixels, like an old monitor.',
  solid: 'One flat tint, a step from the paper. The quietest.', gradient: 'A smooth fade into a deeper tint.', fade: 'The same fade in dither pixels: thick at the foot, gone at the top.',
};

function segOf(label, list, words, now, choose) {
  return h('div', { class: 'om-seg', role: 'group', 'aria-label': label }, list.map((name) => h('button', {
    type: 'button',
    'aria-pressed': name === now ? 'true' : 'false',
    dataset: { k: name },
    onClick() { choose(name); },
  }, words[name])));
}

let seq = 0;
const noop = () => {};

// Returns the picker's node. It repaints on any change to the look, from
// itself, the command palette or another tab. The page that shows it calls
// node.stop() when it closes.
export function lookPicker({ office = true } = {}) {
  const L = window.BureauLooks;
  const id = `look-${++seq}`;
  const body = h('div', { class: 'set-form look-picker' });
  body.stop = noop;
  if (!L) return body;
  const follow = h('input', { type: 'checkbox', onChange() { L.set({ follow: follow.checked }); } });

  function paint(focusKey) {
    const p = L.get();
    const tone = L.toneOf(p.theme);
    const choose = (change) => { L.set(change); };
    body.replaceChildren(
      field('Paper or Ink', segOf('Paper or Ink', ['system', 'paper', 'ink'], THEME_WORDS, p.theme, (theme) => choose({ theme })), THEME_HINT[p.theme]),
      field('Marker or Pencil', segOf('Marker or Pencil', L.MARKERS, MARKER_WORDS, p.marker, (marker) => choose({ marker })), MARKER_HINT[p.marker]),
      h('div', { class: 'om-field' },
        h('span', { class: 'om-field-label', id: `${id}-colour` }, 'Colour'),
        h('div', { class: 'look-swatches', role: 'group', 'aria-labelledby': `${id}-colour` }, L.COLOURS.map((c) => {
          const l = L.look(tone, p.marker, c);
          return h('button', {
            type: 'button', class: 'look-swatch', 'aria-pressed': c === p.colour ? 'true' : 'false', dataset: { k: `c-${c}` },
            title: COLOUR_HINT[c], onClick() { choose({ colour: c }); },
          }, h('span', { class: 'look-chip', 'aria-hidden': 'true' }, h('i', { style: { background: l.paper } }), h('i', { style: { background: l.ink } })), COLOUR_WORDS[c]);
        })),
        h('p', { class: 'om-field-help set-hint' }, COLOUR_HINT[p.colour])),
      h('div', { class: 'om-field' },
        h('span', { class: 'om-field-label', id: `${id}-ground` }, 'Ground'),
        h('div', { class: 'look-grounds', role: 'group', 'aria-labelledby': `${id}-ground` }, L.GROUNDS.map((g) => h('button', {
          type: 'button', class: 'look-ground', 'aria-pressed': g === p.ground ? 'true' : 'false', dataset: { k: `g-${g}` },
          onClick() { choose({ ground: g }); },
        }, h('span', { class: `look-tile is-${g}`, 'aria-hidden': 'true' }), GROUND_WORDS[g]))),
        h('p', { class: 'om-field-help set-hint' }, `${GROUND_HINT[p.ground]} Text always sits on a sheet, never on the ground.`)),
      office ? h('label', { class: 'om-check' }, follow, 'The office uses the same colour') : null);
    follow.checked = p.follow;
    if (focusKey) {
      const again = body.querySelector(`[data-k="${focusKey}"]`);
      if (again) again.focus();
    }
  }

  const repaint = () => {
    const k = document.activeElement && body.contains(document.activeElement) ? document.activeElement.dataset.k : null;
    paint(k);
  };
  function stop() {
    window.removeEventListener('bureau:look', repaint);
    window.removeEventListener('storage', repaint);
  }
  window.addEventListener('bureau:look', repaint);
  window.addEventListener('storage', repaint);
  paint();
  body.stop = stop;
  return body;
}

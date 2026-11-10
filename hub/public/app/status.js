// What a mission status looks like. The one place this mapping lives: dither
// and a word, never a hue.

import { h } from './dom.js';

export const STATUSES = {
  queued: { word: 'Queued', dither: 'om-d12', lane: 'queued' },
  claimed: { word: 'Claimed', dither: 'om-d25', lane: 'working' },
  in_progress: { word: 'In progress', dither: 'om-d50', lane: 'working' },
  blocked: { word: 'Blocked', dither: 'om-hatch', lane: 'working' },
  // Back with its holder to apply what was approved: the boss is done with it.
  approved: { word: 'Approved', dither: 'om-bars', lane: 'working' },
  review: { word: 'Review', dither: 'om-d75', lane: 'review' },
  done: { word: 'Done', dither: 'om-d100', lane: 'closed' },
  failed: { word: 'Failed', dither: 'om-cross', lane: 'closed' },
  discarded: { word: 'Discarded', dither: 'om-d0', lane: 'closed' },
};

export const LANES = [
  { key: 'queued', word: 'Queued', dither: 'om-d12' },
  { key: 'working', word: 'Working', dither: 'om-d50' },
  { key: 'review', word: 'Review', dither: 'om-d75' },
  { key: 'closed', word: 'Closed', dither: 'om-d100' },
];

const info = (status) => STATUSES[status] || { word: String(status || 'Unknown'), dither: 'om-d0', lane: 'queued' };

export const statusWord = (status) => info(status).word;
export const statusLane = (status) => info(status).lane;
export const statusDither = (status) => info(status).dither;

// The swatch alone. It carries its word for screen readers and on hover.
export function swatch(status) {
  const { word, dither } = info(status);
  return h('span', { class: `om-swatch ${dither}`, role: 'img', 'aria-label': word, title: word });
}

// Swatch and written word, for anywhere there's room.
export function statusLabel(status) {
  const word = info(status).word;
  const mark = swatch(status);
  mark.removeAttribute('role');
  mark.removeAttribute('aria-label');
  mark.setAttribute('aria-hidden', 'true');
  return h('span', { class: 'app-status' }, mark, h('span', { class: 'om-label' }, word));
}

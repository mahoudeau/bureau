// The frame around every page: top bar, the slot the router fills, footer slab.

import { h, s } from './dom.js';
import * as store from './store.js';
import { toast } from './ui.js';

const NAV = [
  ['Desk', '/'],
  ['Missions', '/missions'],
  ['Goals', '/goals'],
  ['Brain', '/brain'],
  ['Agents', '/agents'],
  ['Office', '/office'],
];
// Rarely used, so they sit with the tools and leave the main nav alone.
const SETUP = [
  ['Projects', '/projects'],
  ['Settings', '/settings'],
];
const ALL = [...NAV, ...SETUP];

const LIVE = {
  connecting: { word: 'Connecting', dither: 'om-d25', title: 'Connecting to the hub' },
  live: { word: 'Live', dither: 'om-d100', title: 'The event stream is up' },
  polling: { word: 'Polling', dither: 'om-hatch', title: 'The stream dropped. Checking every minute until it comes back' },
};

const logo = () => s('svg', { class: 'om-mark', viewBox: '-1.5 -1.5 103 103', 'aria-hidden': 'true' },
  s('path', { 'fill-rule': 'evenodd', d: 'M50 -1.5A51.5 51.5 0 1 0 50 101.5A51.5 51.5 0 1 0 50 -1.5ZM50 37A13 13 0 1 1 50 63A13 13 0 1 1 50 37Z' }));

const isCurrent = (href, path) => (href === '/' ? path === '/' || path === '/index.html' : path === href || path.startsWith(`${href}/`));

let searchHandler = null;
// The palette registers itself here. The search button calls it.
export function onSearch(fn) {
  searchHandler = fn;
}

// Builds the frame inside root. Returns the outlet and update({ path, bare }):
// a bare page (sign-in) keeps the brand and footer and loses the nav.
export function mountLayout(root) {
  const links = ALL.map(([label, href]) => h('a', { href }, label));
  const nav = h('nav', { class: 'om-nav', 'aria-label': 'Main' }, links.slice(0, NAV.length));
  const setup = h('nav', { class: 'om-nav', 'aria-label': 'Setup' }, links.slice(NAV.length));

  const liveMark = h('span', { class: 'om-swatch', 'aria-hidden': 'true' });
  const liveWord = h('span');
  const liveEl = h('span', { class: 'app-live om-label', hidden: true }, liveMark, liveWord);

  const modifier = /mac|iphone|ipad/i.test(navigator.platform) ? 'Cmd' : 'Ctrl';
  const search = h('button', {
    type: 'button',
    class: 'om-btn',
    onClick() {
      if (searchHandler) searchHandler();
      else toast('Search is not built yet.');
    },
  }, 'Search', h('kbd', { class: 'om-kbd app-kbd' }, `${modifier} K`));

  const tools = h('div', { class: 'app-tools' }, setup, liveEl, search);

  const top = h('header', { class: 'om-top' },
    h('a', { class: 'om-brand', href: '/' }, logo(), h('span', { class: 'om-strong app-word' }, 'BUREAU')),
    nav, tools);

  const outlet = h('main', { id: 'main', class: 'app-main', tabindex: '-1' });

  const versionEl = h('span');
  const foot = h('footer', { class: 'om-foot' }, h('span', null, 'Built by OMAKO'), versionEl);

  function paintLive(state, version) {
    const look = LIVE[state];
    liveEl.hidden = !look;
    if (look) {
      liveMark.className = `om-swatch ${look.dither}`;
      liveWord.textContent = look.word;
      liveEl.title = look.title;
    }
    versionEl.textContent = version ? `Bureau ${version}` : '';
  }
  paintLive(store.getLive(), store.getVersion());
  store.subscribeLive(paintLive);

  root.replaceChildren(
    h('a', { class: 'om-skip', href: '#main' }, 'Skip to the page'),
    top, outlet, foot);

  function update({ path, bare }) {
    nav.hidden = !!bare;
    tools.hidden = !!bare;
    ALL.forEach(([, href], i) => {
      if (isCurrent(href, path)) links[i].setAttribute('aria-current', 'page');
      else links[i].removeAttribute('aria-current');
    });
  }

  return { outlet, update };
}

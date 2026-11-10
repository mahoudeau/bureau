// History API routing. A route is { path, title, load, public, bare }, where
// path can hold :name (one segment) and *name (the rest, any depth) and load
// imports the page module.
//
// A page module exports render(ctx), sync or async, returning a node or
// { node, cleanup }. ctx is { path, params, query, signal, title(text),
// navigate(to, opts), setQuery(changes), reload(), onCleanup(fn) }.

import { fill, h } from './dom.js';
import { emptyState, errorState, loadingState } from './ui.js';
import { isAbort } from './api.js';

const SLOW_MS = 150;
const SCROLL_FRAMES = 60;

let table = [];
let outlet = null;
let guard = null;
let onRoute = null;
let renderId = 0;
let rendered = ''; // pathname + search of the page on screen
let leave = () => {};
let firstRender = true;

let entryKey = 0;
let nextKey = Date.now();
const positions = new Map();

function compile(route) {
  const names = [];
  const source = route.path.split('/').map((seg) => {
    if (seg.startsWith(':')) { names.push(seg.slice(1)); return '([^/]+)'; }
    if (seg.startsWith('*')) { names.push(seg.slice(1)); return '(.+)'; }
    return seg.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }).join('/');
  return { ...route, names, re: new RegExp(`^${source}$`) };
}

function match(pathname) {
  for (const route of table) {
    const m = route.re.exec(pathname);
    if (!m) continue;
    try {
      const params = {};
      route.names.forEach((name, i) => { params[name] = decodeURIComponent(m[i + 1]); });
      return { route, params };
    } catch {
      return null;
    }
  }
  return null;
}

const here = () => location.pathname + location.search;

function setTitle(text) {
  document.title = text ? `${text} · Bureau` : 'Bureau';
}

// Pages fetch after they mount, so what we're scrolling to can arrive a few
// frames late.
function settleScroll(id, hash, y) {
  let frames = 0;
  const step = () => {
    if (id !== renderId) return;
    if (hash) {
      let name = hash.slice(1);
      try { name = decodeURIComponent(name); } catch { /* use it as written */ }
      const target = document.getElementById(name);
      if (target) { target.scrollIntoView(); return; }
    } else if (y === undefined) {
      window.scrollTo(0, 0);
      return;
    } else {
      window.scrollTo(0, y);
      if (Math.abs(window.scrollY - y) < 2) return;
    }
    if (++frames < SCROLL_FRAMES) requestAnimationFrame(step);
  };
  step();
}

function notFound() {
  return h('div', { class: 'app-page' },
    emptyState('Nothing here', "That page doesn't exist, or it moved.", h('a', { class: 'om-link', href: '/' }, 'Back to the Desk')));
}

async function render(y) {
  const id = ++renderId;
  leave();
  leave = () => {};
  const url = new URL(location.href);
  rendered = here();

  const found = match(url.pathname);
  if (!found) {
    if (onRoute) onRoute({ path: url.pathname, bare: false, route: null });
    setTitle('Not found');
    fill(outlet, notFound());
    return;
  }
  const redirect = guard ? guard(found.route, url) : null;
  if (redirect) {
    navigate(redirect, { replace: true });
    return;
  }

  if (onRoute) onRoute({ path: url.pathname, bare: !!found.route.bare, route: found.route });
  setTitle(found.route.title);

  const controller = new AbortController();
  const cleanups = [];
  const runCleanups = () => {
    controller.abort();
    for (const fn of cleanups.splice(0).reverse()) {
      try { fn(); } catch (e) { console.error(e); }
    }
  };
  const ctx = {
    path: url.pathname,
    params: found.params,
    get query() { return new URLSearchParams(location.search); },
    signal: controller.signal,
    title: setTitle,
    navigate,
    setQuery,
    reload: () => render(),
    onCleanup: (fn) => cleanups.push(fn),
  };

  const slow = setTimeout(() => {
    if (id === renderId) fill(outlet, h('div', { class: 'app-page' }, loadingState()));
  }, SLOW_MS);

  try {
    const page = await found.route.load();
    if (id !== renderId) { runCleanups(); return; }
    const out = await page.render(ctx);
    clearTimeout(slow);
    const node = out instanceof Node ? out : out && out.node;
    if (out && !(out instanceof Node) && typeof out.cleanup === 'function') cleanups.push(out.cleanup);
    if (id !== renderId) { runCleanups(); return; }
    leave = runCleanups;
    fill(outlet, node);
  } catch (e) {
    clearTimeout(slow);
    runCleanups();
    if (id !== renderId || isAbort(e)) return;
    console.error(e);
    fill(outlet, h('div', { class: 'app-page' }, errorState(e.message || 'This page failed to load.', () => render())));
  }

  if (!firstRender) outlet.focus({ preventScroll: true });
  firstRender = false;
  settleScroll(id, url.hash, y);
}

// Go somewhere. A path with no route, or another origin, is a full page load:
// /office, /r/ links and the server's 404 all live out there.
export function navigate(to, { replace = false } = {}) {
  const url = new URL(to, location.href);
  if (url.origin !== location.origin || !match(url.pathname)) {
    location.assign(url.href);
    return;
  }
  entryKey = nextKey++;
  const state = { k: entryKey };
  const target = url.pathname + url.search + url.hash;
  if (replace) history.replaceState(state, '', target);
  else history.pushState(state, '', target);
  render();
}

// Change the query string without a new render, for filters that live in the
// URL. { key: value } sets, { key: null } removes.
export function setQuery(changes) {
  const url = new URL(location.href);
  for (const [key, value] of Object.entries(changes)) {
    if (value === null || value === undefined || value === '') url.searchParams.delete(key);
    else url.searchParams.set(key, value);
  }
  history.replaceState(history.state, '', url);
  rendered = here();
}

function onClick(e) {
  if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
  const a = e.target.closest ? e.target.closest('a[href]') : null;
  if (!a || a.hasAttribute('download') || (a.target && a.target !== '_self')) return;
  const url = new URL(a.getAttribute('href'), location.href);
  if (url.origin !== location.origin) return;
  // An anchor on this page is the browser's job.
  if (url.hash && url.pathname === location.pathname && url.search === location.search) return;
  if (!match(url.pathname)) return;
  e.preventDefault();
  navigate(url.pathname + url.search + url.hash, { replace: url.href === location.href });
}

function onPop(e) {
  if (e.state && e.state.k) {
    entryKey = e.state.k;
  } else {
    // A fragment jump makes an entry we didn't stamp.
    entryKey = nextKey++;
    history.replaceState({ k: entryKey }, '', location.href);
  }
  if (here() === rendered) return;
  render(positions.get(entryKey));
}

// config: { routes, outlet, guard(route, url) returning a path to redirect to,
// onRoute({ path, bare, route }) }.
export function startRouter(config) {
  table = config.routes.map(compile);
  outlet = config.outlet;
  guard = config.guard || null;
  onRoute = config.onRoute || null;

  history.scrollRestoration = 'manual';
  entryKey = (history.state && history.state.k) || nextKey++;
  history.replaceState({ k: entryKey }, '', location.href);

  window.addEventListener('scroll', () => positions.set(entryKey, window.scrollY), { passive: true });
  document.addEventListener('click', onClick);
  window.addEventListener('popstate', onPop);
  render();
}

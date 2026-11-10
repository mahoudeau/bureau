// The way the app makes DOM. A string always becomes a text node, so data can
// never turn into markup. There is deliberately no way to pass HTML in.

const SVG_NS = 'http://www.w3.org/2000/svg';
const PROPERTIES = new Set(['value', 'checked', 'selected', 'disabled', 'indeterminate']);

function setProps(el, props) {
  let ref = null;
  for (const [key, value] of Object.entries(props || {})) {
    if (value === null || value === undefined) continue;
    if (key.startsWith('on')) {
      // A string here would be an inline handler, which the CSP refuses anyway.
      if (typeof value === 'function') el.addEventListener(key.slice(2).toLowerCase(), value);
    } else if (key === 'ref') {
      ref = value;
    } else if (PROPERTIES.has(key)) {
      el[key] = value;
    } else if (value === false) {
      continue;
    } else if (key === 'class') {
      el.setAttribute('class', Array.isArray(value) ? value.filter(Boolean).join(' ') : value);
    } else if (key === 'style' && typeof value === 'object') {
      for (const [name, v] of Object.entries(value)) {
        if (name.startsWith('--')) el.style.setProperty(name, v);
        else el.style[name] = v;
      }
    } else if (key === 'dataset') {
      Object.assign(el.dataset, value);
    } else {
      el.setAttribute(key, value === true ? '' : String(value));
    }
  }
  if (ref) ref(el);
}

function add(parent, child) {
  if (child === null || child === undefined || child === false || child === true) return;
  if (Array.isArray(child)) child.forEach((c) => add(parent, c));
  else parent.append(child instanceof Node ? child : document.createTextNode(String(child)));
}

// h('a', { class: 'om-link', href, onClick: fn }, 'text', node, [more, nodes])
export function h(tag, props, ...children) {
  const el = document.createElement(tag);
  setProps(el, props);
  add(el, children);
  return el;
}

// The same for SVG elements, which live in their own namespace.
export function s(tag, props, ...children) {
  const el = document.createElementNS(SVG_NS, tag);
  setProps(el, props);
  add(el, children);
  return el;
}

export function frag(...children) {
  const f = document.createDocumentFragment();
  add(f, children);
  return f;
}

export function clear(el) {
  el.replaceChildren();
  return el;
}

// Replace everything inside el.
export function fill(el, ...children) {
  el.replaceChildren();
  add(el, children);
  return el;
}

// addEventListener that hands back its own removal, for page cleanups.
export function on(target, type, fn, opts) {
  target.addEventListener(type, fn, opts);
  return () => target.removeEventListener(type, fn, opts);
}

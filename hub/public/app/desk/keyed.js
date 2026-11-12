// Live pages repaint several times a minute. This reuses the node of anything
// that didn't change, so scroll, focus, an open <details> and half-typed text
// all survive a heartbeat.

const held = new WeakMap();

const fieldState = (el) => (el && typeof el.selectionStart === 'number' ? [el.selectionStart, el.selectionEnd] : null);

// keyed(parent, list, { key, sig, create, patch })
// key(item): stable identity. sig(item): anything JSON-able that changes when
// the row should. create(item): the node. patch(node, item): when given, called
// on a changed row instead of building a new one.
export function keyed(parent, list, { key, sig, create, patch }) {
  const before = held.get(parent) || new Map();
  const after = new Map();
  const nodes = list.map((item) => {
    const k = key(item);
    const mark = JSON.stringify(sig ? sig(item) : item);
    const old = before.get(k);
    let node;
    if (old && old.mark === mark) node = old.node;
    else if (old && patch) { node = old.node; patch(node, item); } else node = create(item);
    after.set(k, { node, mark });
    return node;
  });
  held.set(parent, after);

  const same = nodes.length === parent.children.length && nodes.every((n, i) => parent.children[i] === n);
  if (same) return nodes;
  const active = document.activeElement;
  const selection = fieldState(active);
  parent.replaceChildren(...nodes);
  if (active && active !== document.activeElement && active.isConnected) {
    active.focus({ preventScroll: true });
    if (selection) active.setSelectionRange(selection[0], selection[1]);
  }
  return nodes;
}

// True when the keyboard is in a text field. Keys and repaints both ask.
export function isTypingIn(el) {
  if (!el || !el.tagName) return false;
  if (el.tagName === 'TEXTAREA' || el.tagName === 'SELECT' || el.isContentEditable) return true;
  if (el.tagName !== 'INPUT') return false;
  return !['button', 'checkbox', 'radio', 'submit', 'reset', 'file'].includes(el.type);
}

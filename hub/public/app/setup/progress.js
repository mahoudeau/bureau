// When a guide step counts as finished, and which step a guide opens on. Pure,
// no DOM and no imports, so test/guide.test.js runs it in plain node.
//
// local is what the browser remembers: flags (clicks and screens seen) and
// choices. A step is { id, action, then? } as in wizard.js.

// A screen with nothing to do (none) or something to look at (show) is
// finished once it has been seen, not before. Counting it finished from the
// start made a fresh guide skip it: the welcome screen went unseen.
export const seenIsDone = (st) => st.action.type === 'none' || st.action.type === 'show';

export function stepDone(st, local) {
  const a = st.action;
  if (a.type === 'done') return true;
  if (seenIsDone(st)) return !!local.flags[st.id];
  if (a.type === 'choice') return local.choices[a.key] !== undefined && local.choices[a.key] !== null;
  const first = a.check ? a.check() : !!local.flags[st.id];
  if (!st.then) return first;
  return (first || st.then.check()) && st.then.check();
}

// Where a guide opens: the step it was left on, else the first one not done,
// else the last.
export function openingStep(steps, local, savedAt) {
  return steps.find((st) => st.id === savedAt)
    || steps.find((st) => !stepDone(st, local))
    || steps[steps.length - 1];
}

// How things arrive and leave. The rules are OMAKO DS's (README, "Dither"):
// the more often it happens, the less motion it gets.
//   bayer   dialogs, the palette, toasts
//   spread  the screen changing because you acted (a verdict, an empty queue)
//   fold    once a session at most: signing in opens the Desk
//   none    menus, selects, tooltips, page changes
// omako-ds/js/dither.js draws them. Without it, or with reduced motion,
// things just show and hide.

const dither = () => window.OmakoDither;

export function appear(el, mode = 'bayer', origin) {
  const d = dither();
  if (!d) { el.hidden = false; return Promise.resolve(); }
  return d.dissolve(el, { mode, origin });
}

export function vanish(el, mode = 'bayer', origin) {
  const d = dither();
  if (!d) { el.hidden = true; return Promise.resolve(); }
  return d.dissolve(el, { mode, origin, out: true });
}

// The fold plays once a session at most: signing in asks for it, and the
// next page to render plays it.
const FOLD = 'bureau_fold';
export function foldNext() {
  try { if (sessionStorage.getItem(FOLD) !== 'done') sessionStorage.setItem(FOLD, 'next'); } catch (e) { /* no storage: no fold */ }
}
export function foldIfAsked(el) {
  let asked = false;
  try { asked = sessionStorage.getItem(FOLD) === 'next'; if (asked) sessionStorage.setItem(FOLD, 'done'); } catch (e) { /* no storage */ }
  return asked ? appear(el, 'fold', 'right') : Promise.resolve();
}

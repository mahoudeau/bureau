// System, paper or ink, kept in localStorage. Paper (light) is the default;
// system is a choice you make. The look itself (Marker or Pencil, colour,
// ground) lives in looks.js, which index.html runs before the first paint.

export const THEMES = ['system', 'paper', 'ink'];

const looks = () => window.BureauLooks;

export function getTheme() {
  return looks() ? looks().get().theme : 'paper';
}

export function setTheme(name) {
  return looks() ? looks().set({ theme: name }).theme : 'paper';
}
